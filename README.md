<p align="center">
  <img src="public/icon-512.png" width="64" alt="Alerta Tram Tenerife project logo" />
</p>

# Alerta Tram Tenerife

An independent Tenerife tram companion with live vehicle positions, occupancy, community alerts, a PWA and an Android TWA wrapper.

## Preview

![Tenerife tram route map and vehicle cards](docs/assets/route-desktop.png)

Captured locally on 28 October 2026 using the default public feed. Vehicle counts, positions and arrival times are a snapshot of that session, not current travel information. Source attribution is shown in the interface.

[![CI](https://github.com/Fernise/alerta-tram-tenerife/actions/workflows/ci.yml/badge.svg)](https://github.com/Fernise/alerta-tram-tenerife/actions/workflows/ci.yml)

**Technology:** React · TypeScript · Vinext/Vite · Cloudflare D1 · Python · Android TWA

[Overview](#what-it-does) · [Quick start](#quick-start) · [Architecture](docs/ARCHITECTURE.md) · [Verification](docs/VERIFICATION.md)

## What it does

For Tenerife residents and visitors who want tram positions and recent community information in one place.

- ES/EN tram map and vehicle cards with explicit freshness checks.
- Occupancy information and community reports with moderation controls.
- Opt-in notification preferences and install guidance.
- A server-side realtime relay, backup verification tools and an Android wrapper.

## Screenshots

<details>
<summary>When live data is unavailable</summary>

![Route map with live data unavailable](docs/assets/route-unavailable.png)

With transport endpoints blocked in this local capture, the app hides positions and arrival times and explains the missing data.

</details>

<details>
<summary>Mobile view</summary>

<img src="docs/assets/mobile-route.png" width="390" alt="Tenerife tram route map on a mobile screen" />

The same public-feed capture session. Positions and counts are time-dependent.

</details>

## Project status

An independently developed application with a substantial implementation and automated tests. Live feeds, notification delivery, Android installation and store release depend on external configuration and device testing. This repository is not an official transport-operator service.

## Quick start

Requires Node.js 22.13+ and npm. Python 3.11+ is used by the relay and backup tests.

```sh
git clone https://github.com/Fernise/alerta-tram-tenerife.git
cd alerta-tram-tenerife
npm ci
npm run dev
```

Use the local URL printed by Vite. Local D1 state is emulated by the Cloudflare plugin. Migrations live in `drizzle/`; hosting bindings are defined in `.openai/hosting.json` without an account/project identifier.

See [local configuration](docs/CONFIGURATION.md) for relay URLs, private bearer credentials, owner identity and optional push settings. A missing upstream configuration must not be represented as verified live data. Use your own hosting account and authorization when connecting a provider.

## Verification

```sh
npm test
npm run typecheck
npm run lint
npm run build
python3 -m unittest discover -s infra/realtime-relay -p 'test_*.py'
python3 -m unittest discover -s infra/operations -p 'test_*.py'
```

The web tests cover freshness, moderation boundaries, backup shape, accessibility interactions and Android release metadata. These checks do not prove physical-device installation or real push delivery.

## Repository map

| Path | Responsibility |
| --- | --- |
| `app/ and components/` | Web screens and API routes |
| `lib/, db/ and drizzle/` | Domain rules, D1 schema and migrations |
| `infra/realtime-relay/` | Private upstream relay and schedule analysis |
| `infra/operations/` | Logical backup verification |
| `android/` | TWA source, Gradle configuration and store artwork |
| `tests/` | Offline regression tests |

## Documentation

- [Verification record and limits](docs/VERIFICATION.md)
- [Architecture and data boundaries](docs/ARCHITECTURE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Security policy](SECURITY.md)
- [Contribution guidance](CONTRIBUTING.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

All rights reserved. See [LICENSE](LICENSE).

Third-party libraries and assets retain their own licenses.
