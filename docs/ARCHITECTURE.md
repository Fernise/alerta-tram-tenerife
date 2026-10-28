# Alerta Tram Tenerife — architecture

An independent Tenerife tram companion with live vehicle positions, occupancy, community alerts, a PWA and an Android TWA wrapper.

## Code boundaries

- **app/ and components/:** Web screens and API routes.
- **lib/, db/ and drizzle/:** Domain rules, D1 schema and migrations.
- **infra/realtime-relay/:** Private upstream relay and schedule analysis.
- **infra/operations/:** Logical backup verification.
- **android/:** TWA source, Gradle configuration and store artwork.
- **tests/:** Offline regression tests.

## Data boundary

This public repository contains application source and fictional test inputs. Personal/operational state belongs in ignored local storage or separately configured services. Test results establish the behavior exercised by the suite; they do not certify live integrations, product efficacy or deployment readiness.

See the README for implementation status and `CONFIGURATION.md` for provider-specific requirements.
