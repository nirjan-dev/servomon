# S3 case study: predictable retention and streaming

## The problem, in production terms

The cleanup task referenced `MIN_METRICS_TO_KEEP`, a constant that didn't
exist. Every scheduled run threw `ReferenceError`, so **no retention was
happening at all** — metrics grew unbounded on the Fly volume. And the
dashboard stream re-read every stored key and re-sent the full array every 2
seconds per open tab: cost grew with history length × open tabs, forever.

Two failures, one theme: storage and bandwidth had no bound.

## The policy

One module owns the decision: `web/server/utils/retention.ts`.

- **Keep samples newer than 24h, intersected with the newest 500.**
  The intersection is the point: a chatty agent can't blow past the count
  cap, and a quiet stretch can't fill the window with ancient samples.
- **Floor of 5:** the newest samples always survive, even if every sample is
  older than the window — a quiet system never shows empty.
- **Numeric timestamp sort.** Out-of-order arrivals are ordered; deletion only
  ever removes the oldest samples. Non-numeric keys are never touched.
- The decision is a **pure function** (`partitionKeys`), unit-tested in
  isolation; the scheduled task only does storage I/O and now awaits every
  per-system cleanup with per-system failure reporting (previously
  fire-and-forget `forEach`).

## The stream protocol

`GET /api/metrics-stream?name=` now speaks sync/delta:

- First push (and every ~30s resync): `{ type: "sync", metrics: [...] }`,
  newest 500, sorted ascending.
- Otherwise: `{ type: "delta", metrics: [...] }` with only samples newer than
  the last push. Empty deltas still push as a liveness heartbeat.
- An immediate push on connect — clients never wait a full interval.

Clients (`web/composables/useMetricsStream.ts`, shared by both pages) replace
on sync, merge deltas by timestamp (duplicates and out-of-order arrivals
handled), and trim to 500. As part of this, each index card now owns its own
stream — the parent's per-system bookkeeping is gone, and deleting a card
unmounts it, which closes its stream.

## Measurements

Synthetic history through the real production build on this machine (16-core,
32 GB RAM — **not** Fly `shared-cpu-1x` numbers; relative ratios transfer,
absolute timings don't). Two systems, 600 samples each (~553 bytes/sample),
fresh + 25h-old mix:

| Measurement | Result |
|---|---|
| Ingest | 1200 sequential posts in 70s (~17/s; agents post every ~6s, so headroom is ~100×) |
| Full history GET | 14ms, 281 KiB for 500 samples |
| Stream sync push | 281 KiB / 500 samples |
| Stream idle delta | ~30 bytes (`{"type":"delta","metrics":[]}`), 0 samples |
| Store | ~0.6 KiB/sample on disk |

The delta number is the payoff: previously every tab re-downloaded the full
~281 KiB every 2 seconds; now an idle tab costs ~30 bytes per push — a
~10,000× reduction in steady-state stream bandwidth. Reads are bounded too:
deltas only fetch keys newer than the last push.

Notably, the scheduled cleanup fired unprompted mid-benchmark and removed
exactly the 100 over-cap samples (600 → 500 on the count-capped system) —
end-to-end proof of the policy on schedule, not just in unit tests.

## What the tests prove — and don't

- `web/test/retention.test.mjs` (7 tests, `node --experimental-strip-types`):
  window expiry, count cap, floor survival, out-of-order safety, non-numeric
  keys untouched, empty input. Pure function, no server needed.
- `web/test/s1-auth.test.mjs`: the stream test now asserts the first push is
  a `sync` object, and `stream sends only new samples after sync` posts a
  fresh sample mid-stream and asserts the next delta carries exactly it.
- Suite: `pnpm test` → 7/7 retention + 68/68 S1 green. CI runs both.

What they don't prove: the cron trigger itself (Nitro framework behavior —
but observed firing live during the benchmark), long-run behavior over days
(window edge cases at 24h are unit-tested, not soak-tested), or Fly-volume
I/O characteristics (local tmpfs measurements only).

## Identity and state ownership

| Question | Answer | Owner |
|---|---|---|
| Which samples survive? | Window ∩ count ∩ floor, by numeric timestamp | `partitionKeys` (pure, tested) |
| When does deletion run? | Every 2 min via Nitro scheduled task | Framework trigger + `cleanup.ts` wrapper |
| What does the client hold? | Last sync + merged deltas, trimmed to 500 | `useMetricsStream` composable |
| Who closes streams? | Card unmount (index) / page unmount (detail) | Vue lifecycle, no manual bookkeeping |
