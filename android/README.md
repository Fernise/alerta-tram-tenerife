# Alerta Tram Tenerife for Android

The Android source wraps the Alerta Tram PWA in a Trusted Web Activity (TWA). A TWA displays the hosted application through a compatible browser. Without a valid Digital Asset Links association, it falls back to a browser Custom Tab.

## Source layout

- `app/`: generated Android application source and Gradle configuration.
- `twa-manifest.json`: Bubblewrap application metadata.
- `scripts/generate-assetlinks.mjs`: validates certificate fingerprints and generates Digital Asset Links JSON without storing private keys.
- `store-assets/`: project-owned app icons and feature artwork.

The source targets Android API 36, with API 24 as the minimum, and uses package ID `com.alertatram.tenerife`. The wrapper does not request location, camera, contacts or payment permissions. Web notifications remain opt-in.

## Local source checks

From the repository root:

```sh
npm ci
npm run test:android
```

These offline checks cover metadata, artwork dimensions and the asset-links generator. They do not build an Android binary or establish device compatibility.

## Android development

Open `android/` in Android Studio with the Android SDK and a compatible JDK. Review the checked-in Gradle files and configure your own SDK location locally. To target a different deployment, update the host and web-manifest URLs consistently in `twa-manifest.json` and `app/build.gradle` before rebuilding.

Keep signing material, passwords, machine paths and generated APK/AAB files outside Git. Device distribution requires your own hosting and Android configuration. This public snapshot does not establish current Play Console status, an installed release or live push delivery.

## Documentation

- [Main project README](../README.md)
- [Public configuration guide](../docs/CONFIGURATION.md)
- [Verification and limits](../docs/VERIFICATION.md)
- [Development approach](../CONTRIBUTING.md#development-approach)

Private store-account records, launch checklists and operational procedures are intentionally excluded. See the [public security reporting policy](../SECURITY.md) for vulnerability reports.
