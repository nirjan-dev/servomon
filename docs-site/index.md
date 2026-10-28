---
layout: home
hero:
  name: Servomon
  text: Your Linux servers, live.
  tagline: See what is happening, act when needed, and get alerted when it matters. One dashboard for your homelab or hosted servers.
  image:
    src: /favicon.svg
    alt: Servomon
  actions:
    - theme: brand
      text: Get started
      link: /guide
    - theme: alt
      text: GitHub
      link: https://github.com/nirjan-dev/servomon
features:
  - title: The whole machine, at a glance
    details: Live CPU, memory, disk, network, battery, processes and Docker container metrics — across multiple Linux servers.
    link: /introduction
  - title: Act without opening a terminal
    details: Stop, pause or unpause containers and kill processes from a system's detail page. Commands are audit-logged.
    link: /architecture
  - title: Know when data is old
    details: Live, stale and offline states distinguish a healthy connection from an old sample. No frozen dashboard pretending to be current.
    link: /introduction
  - title: Alerts where you need them
    details: Web push and Discord alerts for downtime, low battery and low storage. Install the dashboard as a PWA on your phone.
    link: /notifications
  - title: Secure by default
    details: Operator login, individual agent approval and revocation, single-use WebSocket tickets, and a command audit log.
    link: /websocket-auth
  - title: Predictable retention
    details: Metrics use a 24-hour window and newest-500 cap per system, retaining the newest five even after a quiet stretch. Persistent storage, no database to administer.
    link: /architecture
---
