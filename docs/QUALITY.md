# Tooling quality

The reviewed lockfile passes `npm audit --audit-level=low` with **zero known dependency findings** on 28 October 2026. CI checks all severity levels. TypeScript, ESLint with zero warnings, the production build and offline tests are also required.

## Targeted dependency repairs

Two transitive dependencies are constrained in `package.json`:

- `@esbuild-kit/core-utils > esbuild` resolves to `0.25.12`, repairing [GHSA-67mh-4wv8-2f99](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99). A regression verifies that an unrelated website is not granted cross-origin access to the loopback development server.
- `satori > fflate` resolves to the patched `0.7.5` release, repairing [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98). A bounded subprocess regression supplies a ZIP64 archive with a missing required extra field and verifies that parsing rejects it without hanging.

A separate test generates migrations from the actual checked-in TypeScript schema into a temporary directory. The overrides retain the current application toolchain and do not downgrade Vinext or Drizzle to old releases suggested by a forced audit fix. Cloudflare worker types also match Wrangler’s peer requirement.

The upstream `@esbuild-kit` loader packages remain deprecated in the migration dependency chain. Their patched transitive esbuild is tested; replacement of those upstream packages can be considered when Drizzle removes them. A deprecation notice is distinct from an unresolved security advisory.

## UI synchronization

Browser preferences use an SSR-safe external store with a stable server snapshot, malformed-storage handling and subscription cleanup. Route changes reset selected-tram focus in the user event. Polling updates are handled in network-response callbacks. The earlier lint severity exception has been removed; React Compiler remains disabled.

Desktop and mobile checks covered stored-language hydration, preference persistence, route-selection reset, layout overflow and browser errors with fictional API responses and external requests blocked.

Use loopback for development. These checks do not verify live providers, production deployment, Android devices or store release. Audit results can change as new advisories are published.
