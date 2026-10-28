import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const migrationRequire = createRequire(require.resolve('@esbuild-kit/core-utils'));
const imageRequire = createRequire(require.resolve('satori'));
const root = fileURLToPath(new URL('../', import.meta.url));

test('migration-tool esbuild does not allow arbitrary websites to read its dev server', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alerta-esbuild-'));
  const esbuild = migrationRequire('esbuild');
  let context;
  try {
    context = await esbuild.context({
      stdin: { contents: 'console.log("offline fixture");', resolveDir: directory },
      outfile: join(directory, 'app.js'), bundle: true,
    });
    const server = await context.serve({ host: '127.0.0.1', port: 0, servedir: directory });
    const response = await fetch(`http://127.0.0.1:${server.port}/app.js`, {
      headers: { Origin: 'https://untrusted.example' },
    });
    await response.text();
    assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
    assert.notEqual(response.headers.get('access-control-allow-origin'), 'https://untrusted.example');
  } finally {
    await context?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test('image-tool ZIP parser rejects malformed ZIP64 entries without hanging', () => {
  const { zipSync, strToU8 } = imageRequire('fflate');
  const ordinary = Buffer.from(zipSync({ 'fixture.txt': strToU8('offline fixture') }));
  const central = ordinary.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(central >= 0);
  const end = ordinary.length - 22;
  const zip64End = Buffer.alloc(56);
  zip64End.writeUInt32LE(0x06064b50, 0);
  zip64End.writeBigUInt64LE(44n, 4);
  zip64End.writeUInt16LE(45, 12);
  zip64End.writeUInt16LE(45, 14);
  zip64End.writeBigUInt64LE(1n, 24);
  zip64End.writeBigUInt64LE(1n, 32);
  zip64End.writeBigUInt64LE(BigInt(end - central), 40);
  zip64End.writeBigUInt64LE(BigInt(central), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(end), 8);
  locator.writeUInt32LE(1, 16);
  const legacyEnd = Buffer.from(ordinary.subarray(end));
  legacyEnd.writeUInt16LE(0xffff, 8);
  legacyEnd.writeUInt16LE(0xffff, 10);
  legacyEnd.writeUInt32LE(0xffffffff, 16);
  const zip = Buffer.concat([ordinary.subarray(0, end), zip64End, locator, legacyEnd]);
  // Enter the ZIP64 parsing path, then omit the required per-entry ZIP64 extra field.
  zip.writeUInt32LE(0xffffffff, central + 20);
  const script = `
    const { unzipSync } = require(${JSON.stringify(imageRequire.resolve('fflate'))});
    try { unzipSync(Buffer.from(process.argv[1], 'base64')); process.exitCode = 1; }
    catch { process.exitCode = 0; }
  `;
  const result = spawnSync(process.execPath, ['-e', script, zip.toString('base64')], {
    timeout: 5000, encoding: 'utf8',
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test('patched migration tooling generates SQL from the checked-in TypeScript schema', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alerta-drizzle-'));
  try {
    const output = join(directory, 'migrations');
    const config = join(directory, 'drizzle.config.mjs');
    await writeFile(config, `export default ${JSON.stringify({ dialect: 'sqlite', schema: join(root, 'db/schema.ts'), out: output })};\n`);
    const result = spawnSync(process.execPath, [join(root, 'node_modules/drizzle-kit/bin.cjs'), 'generate', '--config', config], {
      cwd: root, timeout: 30000, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const files = (await readdir(output)).filter(name => name.endsWith('.sql'));
    assert.ok(files.length > 0);
    const sql = await readFile(join(output, files[0]), 'utf8');
    assert.match(sql, /CREATE TABLE/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
