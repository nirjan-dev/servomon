# Agent enrollment: from a new machine to an approved client

Enrollment answers **“should this Servomon instance trust this new agent?”** It happens before metrics ingestion or the [WebSocket ticket flow](websocket-auth.md). The operator approves a request in the dashboard; the server creates a per-agent bearer token; the agent saves it locally for future requests.

This document describes the implementation currently in the repository, not an idealized protocol.

> **Security boundary:** operator approval is required and protected against forged cross-site requests. Token collection requires a device-only secret that is never displayed; the pairing code alone only identifies the request. The generated keypair does not authenticate the agent: no signature or private-key proof is checked. Treat the pairing code as a temporary secret anyway. The [security limitations](#security-limitations-and-recommended-changes) below list what remains before calling this cryptographically verified device enrollment.

## Three different questions

- **Enrollment:** may this machine join? Answered by the operator's approval.
- **Agent authentication:** which enrolled system is making this HTTP request? Answered by its `AGENT_TOKEN` and the server's token record.
- **WebSocket admission:** may this connection open now, and as which role? Answered by a separate short-lived, single-use ticket.

The pairing code is not the agent token, and the agent token is not the WebSocket ticket.

## 1. What starts enrollment?

`agent/main.ts` loads the environment using `@std/dotenv/load`. It calls `enrollAgent(SERVER_URL, NAME, Deno.cwd())` only when `AGENT_TOKEN` is empty or absent.

```mermaid
flowchart TD
    S["Start agent in its working directory"] --> U{"SERVER_URL configured?"}
    U -- no --> E["Exit with configuration error"]
    U -- yes --> T{"AGENT_TOKEN nonempty?"}
    T -- yes --> R["Use existing token: no enrollment request"]
    T -- no --> I["Load or create local identity"]
    I --> Q["Request enrollment and wait for approval"]
    Q --> A{"Approved and token saved?"}
    A -- yes --> R
    A -- no --> F["Exit on denial, expiry, or other error"]
    R --> N["Send metrics and request WebSocket tickets"]
```

Important consequences:

- Building or replacing the executable does not itself trigger enrollment.
- A stale or revoked nonempty token also skips enrollment. The server rejects it; the agent does not automatically clear it or re-enroll.
- The working directory matters. The `.env` and `.servomon-identity.json` involved here are in `Deno.cwd()`, not necessarily beside the executable. Set the service's `WorkingDirectory` accordingly.
- `NAME` must pass the server's validation: 1–64 characters, starting with an ASCII letter or number, then letters, numbers, `.`, `_`, or `-`.
- `SERVER_URL` must point at the intended instance. Use HTTPS outside an isolated localhost check. The current helper does not enforce an HTTPS URL itself.

## 2. What gets created, and which values are secrets?

| Value | Meaning and creation | Storage / lifetime | Security role |
|---|---|---|---|
| `system` / `NAME` | Human-readable monitored-system name | Agent configuration and server record | An identifier, not a credential |
| `agentId` | `agent-` plus `crypto.randomUUID()` on the agent | Local identity file and server record | An identifier, not proof of identity |
| P-256 keypair | Generated with Web Crypto ECDSA | Both keys, exported as JWK strings, in `.servomon-identity.json` | Private material exists, but is not used for signing or authentication in this implementation |
| `fingerprint` | SHA-256 of the UTF-8 public-key JSON string | Pending request and enrolled record | A comparison label; the server never receives the public key or verifies that this hash belongs to it |
| Pairing `code` | Server-generated 6 random bytes encoded as 12 uppercase hex characters: 48 bits | Server memory, expires 15 minutes after the initial request | Identifies the request for approval and status polls; alone, it no longer collects the token |
| Collector secret | Agent-generated 32 random bytes, hex encoded: 256 bits | Agent identity file; SHA-256 hash on the pending request | Proves the collector is the device that made the request; never displayed or logged |
| `AGENT_TOKEN` | Server-generated 32 random bytes, base64url encoded: 43 characters, 256 bits | Plaintext in agent `.env`; salted scrypt hash on server; no automatic expiry | The actual reusable bearer credential |
| `AGENT_ID` | Agent id written into `.env` after collection | Agent `.env` | Informational; runtime authentication uses the token, not this setting |
| WebSocket ticket | Minted later using the token | Memory; normally 60 seconds and single-use | Admission to one WebSocket connection, explained separately in [WebSocket authentication](websocket-auth.md) |

A fingerprint hash and a token hash serve different purposes. The fingerprint is displayed to help a human compare requests. The salted token hash lets the server verify a supplied secret without keeping a recoverable copy of that secret in the agent registry. Neither operation encrypts the token for delivery.

The fingerprint is specifically a hash of a JSON string, not a standardized, canonical JWK thumbprint. Both the agent console and dashboard show only its first 19 hex characters followed by an ellipsis; the server stores the full submitted value.

## 3. First run, step by step

### Local identity

`agent/lib/enroll.ts` first tries to read `.servomon-identity.json`. If it contains `agentId`, `privateKey`, and `publicKey`, those values are reused. If the file is missing, unreadable, or lacks those fields, a new identity is generated and written with requested mode `0600`.

This is a field-presence check, not a cryptographic validation of the file. The file is not uploaded. Only the agent id, system name, and fingerprint are sent to the server.

### Request, approval, and delivery

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent terminal
    participant API as Servomon HTTP API
    participant M as Pending requests in RAM
    participant O as Operator dashboard
    participant D as Agent registry on disk
    A->>A: Load identity, hash public-key JSON, create collector secret
    A->>API: POST /api/enroll/request with system, agentId, fingerprint, collector secret
    API->>M: Store pending request, code, expiry, collector hash
    API-->>A: 200 with code and expiresAt
    A->>A: Print code and fingerprint prefix (secret stays local)
    O->>API: GET /api/enroll/pending with operator Basic auth
    API-->>O: Pending request metadata, not an agent token
    Note over A,O: Operator compares system, code, and fingerprint before approving
    A->>API: GET /api/enroll/CODE
    API-->>A: 202 pending
    O->>API: POST /api/enroll/approve with code, operator Basic auth, JSON body
    API->>D: Under approval lock: save agent id, system, fingerprint, salted token hash
    API->>M: Mark approved and hold plaintext token temporarily
    API-->>O: 200 with agentId and system, not the token
    A->>API: Next GET /api/enroll/CODE with Bearer collector secret
    API->>M: Verify secret, remove plaintext token from the request record
    API-->>A: 200 with token, agentId, and system (Cache-Control: no-store)
    A->>A: Atomically write AGENT_TOKEN and AGENT_ID into .env (0600)
    A->>API: Later requests use Authorization Bearer AGENT_TOKEN
```
**Request.** `POST /api/enroll/request` is intentionally public: a machine has no credentials yet. The server validates the submitted fields, rejects an already-enrolled or already-pending system name, rejects an already-enrolled agent id, then stores a pending record in memory. It returns `{code, expiresAt}`; no agent token exists at this stage.

If the same agent id already has a live pending request, matching `system` and `fingerprint` return its existing code. Different metadata for that pending id returns 409. The collector hash is bound on first submission and never rotated by re-requests, so replaying public metadata returns the code but never the collection secret.

**Operator review.** The dashboard fetches pending requests and enrolled agents when it loads, then every 15 seconds on every page (`useFleet.ts`), so the **Agents** link in the sidebar shows a badge while requests are waiting. Only an authenticated operator can list, approve, or deny pending requests. Approval and other unsafe operator calls require a same-origin request (browser `Origin` must match the host) or, without `Origin`, a JSON body — so a forged cross-site form post is rejected with 403. Compare the code shown by the terminal you started, not just a familiar hostname. A displayed fingerprint is not independently verified by the server.

**Approval.** The server looks up the pending code, checks its status and expiry, and under an approval lock checks that neither its system name nor its agent id is enrolled before persisting. It generates a fresh token, hashes it using scrypt with a random 16-byte salt and 32-byte output, and persists a record:

```text
agentId, system, tokenHash, fingerprint, createdAt, lastSeenAt
```

The `tokenHash` is stored as `saltHex:derivedHex`. `lastSeenAt` starts as `null`. Although `createAgentRecord()` generates an id, the approval handler overwrites it with the id submitted by the agent; that client-supplied id is the registry key actually used. Concurrent approvals of the same code serialize: exactly one wins, the other gets 410.

The plaintext token is kept on the approved in-memory enrollment record until collected. The approval response to the dashboard contains only the agent id and system name, not the token.

**Collection.** The agent waits five seconds between polls to `GET /api/enroll/:code`, sending its collector secret as `Authorization: Bearer <secret>`. Status polls need only the code and return 202 while pending; once approved, the token is returned only with the correct secret (401 otherwise). The response carries `Cache-Control: no-store`. The handler clears the token from the in-memory record before returning it. A later poll returns 410.

This is **one successful collection-handler execution**, not guaranteed delivery to exactly one intended device. The handler has no acknowledgement from the agent that the response arrived or was saved.

**Saving and continuing.** The helper writes `AGENT_TOKEN=` and `AGENT_ID=` to the working-directory `.env` atomically (temp file + rename) with mode `0600`. `main.ts` also sets the token in the current process, so it can continue without a restart. The agent now posts metrics and exchanges its token for WebSocket tickets. It does not send the pairing code or use its private key for those requests.

## 4. Pending, approved, collected, denied, expired

```mermaid
stateDiagram-v2
    [*] --> Pending: Public enrollment request
    Pending --> Denied: Operator denies
    Pending --> Expired: Request deadline passes
    Pending --> Approved: Operator approves and registry record is saved
    Approved --> Collected: First eligible poll clears token and returns it
    Approved --> Expired: Original request deadline passes before collection
    Approved --> Lost: Server restarts before collection
    Pending --> Lost: Server restarts
    Collected --> Enrolled: Agent successfully writes token locally
    Collected --> Recovery: Response lost or local save fails
    Expired --> Recovery
    Lost --> Recovery
    Denied --> [*]
    Enrolled --> Revoked: Operator removes enrollment
    Revoked --> [*]
```

`Collected`, `Expired`, `Lost`, and `Enrolled` above describe observable states, not extra database enum values. The in-memory enum has only `pending`, `approved`, and `denied`; an approved record whose `token` is absent has been collected. The persistent registry and pending request are separate stores.

- The deadline is 15 minutes from **request creation**, not 15 minutes from approval. Approving near the deadline leaves little time to collect.
- Expiry blocks collection but does not automatically remove a registry record already saved during approval.
- Server restart loses pending requests and uncollected plaintext tokens. Previously enrolled registry records survive in the mounted filesystem.
- A lost collection response or failed `.env` write leaves an enrolled server record but no usable local credential. The server cannot reconstruct the token from its hash.

## 5. Endpoint and failure reference

| Endpoint | Who calls it | Expected result |
|---|---|---|
| `POST /api/enroll/request` | Unauthenticated agent | 200 with code and expiry; 400 invalid fields; 409 enrolled/pending name, enrolled id, or conflicting pending agent id; 429 rate limit |
| `GET /api/enroll/pending` | Operator, Basic auth | 200 with live pending records |
| `POST /api/enroll/approve` | Operator, Basic auth, same-origin/JSON gate | 200 with id and system; 403 forged cross-site or foreign-origin request; 410 unavailable request; 409 enrolled name or id |
| `POST /api/enroll/deny` | Operator, Basic auth, same-origin/JSON gate | 200 denied; 403 forged request; 410 unavailable request |
| `GET /api/enroll/:code` | Holder of the code | 202 waiting; 200 with token once, only with the collector secret (401 otherwise) and `Cache-Control: no-store`; 410 missing, denied, expired, or collected; 429 rate limit |
| `GET /api/agents` | Operator, Basic auth | Public agent metadata, never the stored token hash |
| `DELETE /api/agents/:id` | Operator, Basic auth, same-origin gate | Removes the credential record and closes its agent sockets; retains metrics history |
| `DELETE /api/systems/:system` | Operator, Basic auth, same-origin gate | Removes matching enrollment and metrics, alert configuration, and liveness state |

The server allows 30 enrollment requests per rolling minute per IP and 60 polls per rolling minute per IP, using separate in-memory buckets. A single agent polling every five seconds makes about 12 polls per minute, so simultaneous enrollments behind one NAT share the poll allowance. IP selection uses forwarded headers; only trust those headers behind a proxy that controls them.

The agent continues only on 202 and successful collection. It exits on 410, 429, other HTTP errors, or a network exception; enrollment polling has no retry/backoff for these failures. The local 15-minute wait budget starts after the request response, while the server enforces its own original request expiry.

## 6. File storage and recovery

```mermaid
flowchart LR
    subgraph AgentMachine["Agent working directory"]
        I[".servomon-identity.json: id, both JWK strings, collector secret"]
        E[".env: SERVER_URL, NAME, AGENT_ID, plaintext AGENT_TOKEN"]
    end
    subgraph ServerProcess["Servomon server"]
        M["RAM: pending request, pairing code, expiry, collector hash, uncollected token"]
        D["Persistent agents mount: metadata and salted token hash"]
    end
    I -->|"Request sends id, fingerprint, collector secret"| M
    M -->|"Approval saves registry record"| D
    M -->|"One secret-bound collection over HTTPS"| E
    E -->|"Later requests send bearer token"| D
```

Protect both local files, and exclude them from source control and public support logs. The helper creates the identity file with mode `0600`, writes both files atomically (temp file + rename), and enforces `0600` on `.env` after saving the token, so a pre-existing `0644` `.env` is tightened automatically.

| Situation | Current recovery |
|---|---|
| Agent has a stale nonempty token and receives 401 | Stop it, remove its enrollment in the dashboard if still present, clear `AGENT_TOKEN` in its working-directory `.env`, and restart to request approval again |
| Approval succeeded but token was lost before saving | Remove the orphaned enrollment, leave the local token empty, restart, and approve a new request |
| Agent process restarted while still pending | The identity file is reused; a still-live matching pending request returns its original code without extending its deadline |
| Server restarted while pending | Restart the agent to request a new code; the old code is unavailable |
| Operator clicked Remove | Server revokes enrollment but does not alter local files; the agent must be re-enrolled manually to regain access |
| System remains visible after Remove | Its metrics history is retained intentionally. Use **Delete system…** in the system's **⋯** menu on the overview if that history should also be purged |

Copying an enrolled agent's `.env` to another machine copies its authority. The keypair does not prevent cloning: either machine can authenticate using the same bearer token.

## 7. Why this enrollment style?

This resembles approving a headless CLI from a browser: the agent needs only outbound HTTP, while the human uses the dashboard on another device. It does not require an inbound port for enrollment, SSH into the web host, an identity provider, or redeploying the server for every agent.

| Choice | Benefit | Cost or consideration |
|---|---|---|
| Dashboard approval rather than one shared fleet token | Per-agent identity and individual revocation, without editing server environment variables | Operator must verify which pending request is theirs; public submissions are untrusted |
| Agent polls rather than receiving a callback | Works behind NAT and firewalls with outbound HTTP only | Polling delay and load; shared-IP limits can affect multiple agents |
| Pending state in memory | No database needed for a single-instance deployment | Restart loses pending state and uncollected credentials; multiple machines would need shared state |
| Persistent, hashed per-agent bearer token | Simple HTTP authentication and registry storage without recoverable token copies on disk | Token is plaintext on the agent, has no automatic expiry, and can be copied; registry token checks scan agents and use synchronous scrypt |
| One-use, secret-bound collection | Later replay cannot obtain the plaintext again; only the requesting device can collect | Delivery failures require manual recovery |
| Keypair and visual fingerprint | Stable local comparison label | Currently adds cryptographic-looking machinery without proof of key ownership; not an authentication factor |

### Similar to OAuth device flow, but not OAuth

[RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html) and [GitHub's device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow) use separate values:

- `user_code`: a human-facing value used to identify the request being approved.
- `device_code`: a separate device-held value used to poll for and receive the credential; it is not displayed to the user.

Servomon now follows the same split: the pairing code is the human-facing approval identifier, and the collector secret is the device-held collection credential. Its route names, JSON responses, errors, and credential lifetimes remain custom. There is no OAuth authorization server, scope negotiation, refresh token, or standardized device grant implementation. The useful comparison is the interaction shape, not protocol conformance or equivalent security guarantees.

## Security limitations and recommended changes

These are implementation limits, not properties fixed by HTTPS or by the WebSocket ticket layer.

1. **The fingerprint is a submitted string, not verified identity.** The server accepts any fingerprint string of 8–128 characters; it does not receive a public key, recompute a fingerprint, issue a challenge, or verify a signature. The generated private key is never used. Copying the label is enough to copy what the UI displays. An operator matching it is not verifying private-key ownership. Either remove the unused keypair and describe the scheme as bearer-token enrollment, or implement real challenge/signature verification before claiming proof of possession.
2. **One-use delivery is not acknowledged or recoverable.** The plaintext is cleared before the response is delivered and before the agent saves it. Failure, expiry after approval, or a server restart can strand a registry record without a usable token. A recoverable delivery acknowledgement would close this gap; manual removal and re-enrollment is the current recovery.
3. **No automatic credential expiry or rotation.** Agent tokens live until removed. Add expiry/rotation if the deployment needs bounded credential lifetimes.

Fixed by this hardening pass: forged cross-site approval (same-origin/JSON gate), unbound token collection (collector secret), duplicate pending names and registry overwrites (pending reservation + approval lock), missing cache policy (`no-store` on collection), and insecure local saves (atomic `0600` writes).

## Code map and verification

| File | Responsibility |
|---|---|
| [`agent/main.ts`](../agent/main.ts) | Loads configuration; enters enrollment only without a token; continues with received credentials |
| [`agent/lib/enroll.ts`](../agent/lib/enroll.ts) | Identity generation, fingerprint, collector secret, public request, five-second polls, atomic local `.env` update |
| [`web/server/middleware/10-api-auth.ts`](../web/server/middleware/10-api-auth.ts) | Exposes request and code-poll endpoints; requires operator auth plus the same-origin/JSON CSRF gate for unsafe calls |
| [`web/server/api/enroll/`](../web/server/api/enroll/) | Request, pending list, locked approval, denial, secret-bound collection handlers |
| [`web/server/utils/ticketStore.ts`](../web/server/utils/ticketStore.ts) | Pending enrollment records, code generation, collector-hash checks, expiry checks, and IP buckets; also stores the separate WebSocket tickets |
| [`web/server/utils/agentStore.ts`](../web/server/utils/agentStore.ts) | Token generation and salted hashes, registry reads and writes, revocation |
| [`web/pages/agents.vue`](../web/pages/agents.vue), [`web/composables/useFleet.ts`](../web/composables/useFleet.ts) | Pending review UI, approval/denial, enrolled list and Remove action; shared polling of pending requests and agents |
| [`web/test/s1-auth.test.mjs`](../web/test/s1-auth.test.mjs) | HTTP/WebSocket regression coverage using synthetic enrollment records |

The suite covers forged-form and foreign-origin rejection, device-secret collection binding, pending-name and agent-id uniqueness, concurrent-approval serialization, token-authenticated ingestion, cross-system ingestion rejection, and credential/socket revocation. It does not establish private-key proof, safe recovery after a lost response, or filesystem permission enforcement.

An isolated local smoke run used the freshly built server and the real Deno `enrollAgent` helper, without a command executor. It observed identity creation, 202 while pending, 401 for anonymous approval, operator approval, token saving, 410 on repeated collection, a hashed registry record, successful ticket minting, denial, and rejection after removal. Fifteen-minute expiry and crash-recovery descriptions come from source tracing, not a timed expiry or crash test.

## Further reading

- [RFC 8628, OAuth 2.0 Device Authorization Grant](https://www.rfc-editor.org/rfc/rfc8628.html): especially sections 3.2–3.5 on separate user/device codes and polling, and section 5 on security.
- [GitHub: Device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow): a concrete implementation with separate `user_code` and `device_code`, polling intervals, expiry, and errors.
- [RFC 6750 §1.2, Bearer token terminology](https://www.rfc-editor.org/rfc/rfc6750.html#section-1.2): possession of a bearer token is enough to use it; it does not require private-key proof.
- [WebSocket ticket authentication in Servomon](websocket-auth.md): the separate, short-lived connection-admission mechanism used after enrollment.
