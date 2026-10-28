# Configuration

## Local database

`vite.config.ts` uses `.openai/hosting.json` only for logical binding names. The public configuration contains no project/account identifier. Use Node.js 22.13+ and `npm ci`.

Initialize the isolated local D1 schema before exercising community mutations:

```sh
npx wrangler d1 migrations apply DB --local --config wrangler.local.jsonc
npm run dev
```

The local migration configuration uses the same placeholder database identity as the Vite plugin. Never run these local example commands against production.

## Web application settings

Configure credentials through your runtime environment or your hosting platform's secret store; do not place them in committed JSON.

| Setting | Purpose |
| --- | --- |
| `TRANVIA_REALTIME_URL` | The authorized relay's vehicle endpoint |
| `TRANVIA_OCCUPANCY_URL` | Optional occupancy endpoint |
| `TRANVIA_HISTORY_URL` | Optional aggregated history endpoint |
| `TRANVIA_REALTIME_TOKEN` | Private bearer value for relay access |
| `MODERATION_OWNER_USER_ID` / `MODERATION_OWNER_EMAIL` | Owner identity expected from the hosting identity adapter |
| `METRICS_ADMIN_TOKEN` | Optional private technical metrics access |

Private moderation depends on the hosting identity integration. A public code repository does not grant owner access or enable a public pilot. Do not bypass identity checks to obtain screenshots or simplify setup.

## Relay and notifications

The relay lives in `infra/realtime-relay/`. Its `RELAY_TOKEN` is private. `RELAY_HOST`, `RELAY_PORT`, `HISTORY_DB` and `COLLECT_SECONDS` control runtime behavior. Optional push uses `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`; keep the private key in a secret store. Use your own authorized upstream configuration.

Install its optional dependencies with `python3 -m pip install -r infra/realtime-relay/requirements.txt`. Unit tests use fixtures and mocks; do not point them at live passenger/community data.

## Android

`android/` is a TWA wrapper around the web app. Configure your own application identity, public website and Digital Asset Links before creating a derivative package. Store all keystores and signing passwords outside Git. The checked-in artwork and metadata do not establish a Play Store release or device-tested installation.
