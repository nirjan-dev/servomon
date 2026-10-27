# Demo

<script setup>
import { withBase } from 'vitepress'
</script>

A silent walkthrough with synthetic agents (fake hostnames, no real machines):
the overview with live, stale and offline systems, a system detail page with
charts and a process command, agent approval, and dark mode. Recorded against
a local build.
<video controls width="100%" :src="withBase('/assets/demo.webm')">
  Your browser does not support the video tag.
</video>

## Screenshots

![Overview: every system with live status, CPU trend, memory, disk and network](/assets/dashboard.png)

![System detail in dark mode: CPU, memory and network charts, storage, containers and processes](/assets/detail.png)

![Overview on mobile](/assets/mobile.png)
