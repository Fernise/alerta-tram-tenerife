# Public source verification

Prepared on 28 October 2026 from the reviewed publication snapshot.

90 web tests; 12 relay tests; 8 backup verification tests; build, types, zero-warning lint and local D1 migrations.

Automated test cases passed in local verification: **110**.

Verification used fictional fixtures, temporary databases and mocked providers. It does not establish real-service access, deployed readiness, legal compliance or measured product efficacy. No production deployment or real messaging was performed.

GitHub Actions reruns the documented verification on Ubuntu, Node.js 22 and/or Python 3.11. Use the CI badge for the current remote result.

The dependency audit reports zero known findings across all severity levels. Targeted fixes, tooling regressions and UI synchronization checks are documented in [QUALITY.md](QUALITY.md).
