# Fly.io & Render

Every supported host runs the prebuilt **`ghcr.io/nirjan-dev/servomon:latest`** image as **one long-lived instance** with a **persistent disk mounted at `/app/data`**. The container listens on port **3000**. Set operator credentials before opening the dashboard. Push keys are generated and persisted automatically.

## Fly.io

Install [flyctl](https://fly.io/docs/flyctl/install/) and log in with `fly auth login`. From an empty deployment directory:

```sh
curl -fsSLo fly.toml https://raw.githubusercontent.com/nirjan-dev/servomon/main/deploy/fly.toml
fly launch --copy-config --no-deploy --ha=false --name YOUR-UNIQUE-APP --region ams
fly volumes create data --region ams --size 1
fly secrets set NUXT_BASIC_AUTH_USERS='admin:replace-with-a-strong-password'
fly deploy --ha=false
```

Replace the app name and region; keep the volume and app in the same region. Review the generated `fly.toml` before deploying. The template uses the published image, not a Docker build, and keeps one machine running. Fly terminates HTTPS for your `https://YOUR-UNIQUE-APP.fly.dev` URL. Open it, log in, and [add an agent](/agent-install).

Do not scale to multiple machines. Preserve the `data` volume on upgrades. This user template is `deploy/fly.toml`; `web/fly.toml` is the maintainer's instance, not your starting point. See [Fly volumes](https://fly.io/docs/volumes/overview/) for disk backup and recovery planning.

## Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/nirjan-dev/servomon)

1. Open the button, sign in to Render, and create the Blueprint service.
2. Enter `NUXT_BASIC_AUTH_USERS` with a strong `user:password` pair when prompted.
3. Review the paid **Starter** service and **1 GB persistent disk** mounted at `/app/data`; persistent storage is required. Keep one instance.
4. Deploy, then open the provided HTTPS service URL and log in.
5. [Install an agent](/agent-install) using that URL.

The repository's `render.yaml` uses the GHCR image and port 3000. Review the cost before deploying; do not substitute a diskless/free service and expect enrollment or history to survive. See [Render persistent disks](https://render.com/docs/disks).

## Why not Vercel or Cloudflare Workers?

Servomon needs persistent WebSocket connections, in-memory tickets/enrollment state, filesystem storage and in-process scheduled tasks in one long-lived process. It is not a stateless request handler. Vercel Functions and Cloudflare Workers are not supported deployment targets for this app as written.

- [Vercel: managing persistent state and WebSockets](https://vercel.com/docs/functions/websockets#manage-persistent-state)
- [Cloudflare Containers FAQ](https://developers.cloudflare.com/containers/faq/): Containers are a distinct product, not a drop-in Workers deployment recipe for Servomon. No Cloudflare-hosted application deployment is supported here.

A Cloudflare Tunnel in front of your own Docker host is different and can be used as an HTTPS proxy; see [Docker & HTTPS](/server-docker).
