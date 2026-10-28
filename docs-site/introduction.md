# Meet Servomon

Servomon is a self-hosted dashboard for Linux machines. Run one web server, then install a small agent on each machine you want to monitor. The agent makes outbound connections: you do not need to expose an inbound port on every machine.

## What you can see

- CPU load, memory usage and disk usage.
- Network throughput, errors and drops.
- Battery charge on machines with a battery.
- Docker container statistics and top processes.
- Multiple systems together on the overview, with charts on each system's detail page.

Freshness is explicit: **Live** means the newest sample is less than 60 seconds old; **Stale** means 60 seconds to three minutes; **Offline** means more than three minutes. A system with no samples is **Unknown**. These are sample-age indicators, not a guarantee that every service on the machine is healthy.

## What you can do

Stop, pause or unpause Docker containers, or kill a process from its system detail page. These are real, potentially disruptive actions, executed with the agent user's permissions. Forwarded commands are audit-logged.

Receive web push and Discord alerts for downtime/recovery, low battery and low storage. Enable or disable alerts per system. Install the dashboard as a progressive web app (PWA) for convenient access from a phone.

## Security without a shared fleet password

Operators log in to the dashboard. Each agent requests approval and gets its own bearer token; removing that agent revokes its access. Commands use authenticated WebSockets admitted with single-use tickets, not long-lived credentials in URLs.

Check the pairing code and fingerprint label before approving an agent. The fingerprint is a comparison label, **not verified proof of private-key ownership**. See [enrollment design and limitations](/agent-enrollment).

## Small, intentionally single-instance

The Nuxt server stores metrics, enrollments, push subscriptions, settings and audit data on disk. WebSocket connections and short-lived tickets live in process memory. Run one server instance with one persistent disk — no external database is required. Metrics are short rolling history, not a long-term observability archive.

Start with the [two-step quick start](/guide), explore the [architecture](/architecture), or [watch the demo](/demo).
