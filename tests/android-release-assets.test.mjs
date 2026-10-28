import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const projectRoot = new URL('../', import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, projectRoot), 'utf8'));
}

async function pngDimensions(relativePath) {
  const png = await readFile(new URL(relativePath, projectRoot));
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

test('the PWA manifest exposes Android-friendly metadata and icons', async () => {
  const manifest = await readJson('public/manifest.webmanifest');

  assert.equal(manifest.lang, 'es');
  assert.equal(manifest.dir, 'ltr');
  assert.equal(manifest.orientation, 'any');
  assert.equal(manifest.prefer_related_applications, false);
  assert.ok(manifest.icons.some((icon) => (
    icon.src === '/icon-android-512.png'
      && icon.sizes === '512x512'
      && icon.purpose === 'any'
  )));
});

test('the TWA manifest uses the immutable Android identity and secure production URLs', async () => {
  const manifest = await readJson('android/twa-manifest.json');

  assert.equal(manifest.packageId, 'com.alertatram.tenerife');
  assert.equal(manifest.host, 'alerta-tram-tenerife.docentesec.chatgpt.site');
  assert.equal(manifest.appVersionCode, 1);
  assert.equal(manifest.appVersion, '1.0.0');
  assert.equal(manifest.enableNotifications, true);
  assert.equal(manifest.minSdkVersion, 24);
  assert.match(manifest.iconUrl, /^https:\/\//);
  assert.match(manifest.webManifestUrl, /^https:\/\//);
});

test('Google Play artwork has the required pixel dimensions', async () => {
  assert.deepEqual(await pngDimensions('android/store-assets/app-icon-512.png'), {
    width: 512,
    height: 512,
  });
  assert.deepEqual(await pngDimensions('android/store-assets/app-icon-1024.png'), {
    width: 1024,
    height: 1024,
  });
  assert.deepEqual(await pngDimensions('android/store-assets/feature-graphic-1024x500.png'), {
    width: 1024,
    height: 500,
  });
  assert.deepEqual(await pngDimensions('public/icon-android-512.png'), {
    width: 512,
    height: 512,
  });
});

test('asset links generator validates and writes the configured package', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alerta-tram-assetlinks-'));
  const outputPath = join(directory, 'assetlinks.json');
  const fingerprint = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join(':').toUpperCase();

  try {
    const result = spawnSync(process.execPath, [
      new URL('android/scripts/generate-assetlinks.mjs', projectRoot).pathname,
      '--fingerprint',
      fingerprint,
      '--out',
      outputPath,
    ], {
      cwd: new URL('.', projectRoot),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const assetLinks = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(assetLinks[0].target.package_name, 'com.alertatram.tenerife');
    assert.deepEqual(assetLinks[0].target.sha256_cert_fingerprints, [fingerprint]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
