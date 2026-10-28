#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '../..');
const twaManifestPath = resolve(projectRoot, 'android/twa-manifest.json');
const defaultOutputPath = resolve(projectRoot, 'public/.well-known/assetlinks.json');
const fingerprintPattern = /^(?:[0-9a-f]{2}:){31}[0-9a-f]{2}$/i;

function usage() {
  return [
    'Uso:',
    '  node android/scripts/generate-assetlinks.mjs --fingerprint AA:BB:...:FF [--fingerprint ...] [--out ruta]',
    '',
    'Incluye una huella por cada certificado válido: normalmente el de subida local y el de Play App Signing.',
  ].join('\n');
}

function parseArguments(argumentsList) {
  const fingerprints = [];
  let outputPath = defaultOutputPath;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--fingerprint') {
      fingerprints.push(argumentsList[index + 1] ?? '');
      index += 1;
    } else if (argument === '--out') {
      outputPath = resolve(process.cwd(), argumentsList[index + 1] ?? '');
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Argumento desconocido: ${argument}`);
    }
  }

  const normalized = [...new Set(fingerprints.map((value) => value.toUpperCase()))];
  if (normalized.length === 0 || normalized.some((value) => !fingerprintPattern.test(value))) {
    throw new Error(`Debes indicar al menos una huella SHA-256 completa.\n\n${usage()}`);
  }

  return { fingerprints: normalized, outputPath };
}

const { fingerprints, outputPath } = parseArguments(process.argv.slice(2));
const twaManifest = JSON.parse(await readFile(twaManifestPath, 'utf8'));
const assetLinks = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: twaManifest.packageId,
      sha256_cert_fingerprints: fingerprints,
    },
  },
];

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(assetLinks, null, 2)}\n`, 'utf8');
console.log(`Asset Links generado para ${twaManifest.packageId}: ${outputPath}`);
