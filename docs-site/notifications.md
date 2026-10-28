# Notifications

Servomon sends web push and Discord alerts for downtime/recovery, low battery and low storage. These checks are scheduled, not an immediate threshold evaluation on every sample; see the [task schedule](/architecture#scheduled-alerts).

## Enable web push

1. Open your dashboard over **HTTPS** and log in. Push requires a browser secure context (localhost is a development exception).
2. Open **Notifications** in the sidebar, click **Enable notifications**, and accept the browser permission prompt. Permission is requested from this explicit user gesture, not automatically on page load.
3. Turn on **Alerts** for the systems you want to monitor, using the overview row or system detail toggle.
4. Repeat notification setup on each browser/device where you want alerts.

On **iOS/iPadOS 16.4+**, first add the site to your home screen, launch that installed web app, then enable notifications. See [WebKit's web push guidance](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/). Desktop and Android support varies by browser and OS notification settings.

The per-system **Alerts** toggle gates both push and Discord, not just the current device. Removing browser permission is separate from disabling a system's alerts.

## Push keys are automatic

You do not need to generate VAPID keys for a new installation. With both key variables unset, the server generates a pair once and stores it under persistent `serverState` storage. Keep `/app/data` across restarts so subscriptions continue using the same keys. The dashboard retrieves the public key through the operator-authenticated `GET /api/push/public-key` endpoint.

### Optional: pin your own keys

```sh
docker run --rm ghcr.io/nirjan-dev/servomon generate-vapid-keys
```

The command prints exactly two assignment lines, ready to copy into your server environment:

```text
NUXT_PUBLIC_PUSH_PUBLIC_KEY=<public-key>
NUXT_PUSH_PRIVATE_KEY=<private-key>
```

For a source checkout, `pnpm generate:vapid-keys` from `web/` runs the same builtin-only Node script. Configure **both keys together**; the environment pair overrides stored keys. Never publish the private key. After changing the pair, restart the server and re-enable notifications on your devices to create subscriptions with the new key.

Set **`NUXT_PUSH_SUBJECT`** to a contact URI you control, e.g. `mailto:you@example.com` or `https://example.com/contact`. Its default is `https://servomon.nirjan.dev`.

## Discord

1. In your Discord server's channel settings, open **Integrations → Webhooks**, create a webhook, and copy its URL. You need permission to manage webhooks.
2. Set `NUXT_DISCORD_WEBHOOK_URL` to that secret URL and `NUXT_PUBLIC_ENABLE_DISCORD_ALERTS=true` on the Servomon server.
3. Restart/redeploy the server and enable **Alerts** for the relevant systems.

The webhook posts alerts into that channel; Discord setup does not require browser notification permission. Keep the URL private and revoke it in Discord if exposed. See [Discord webhook help](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks).

Not receiving alerts? Follow [notification troubleshooting](/troubleshooting#push-not-arriving).
