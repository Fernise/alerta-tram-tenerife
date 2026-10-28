import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInstallController, suggestedInstallPlatform } from '../lib/pwa-install.ts';

function fixture({ standalone = false, secure = true, navigatorStandalone = false } = {}) {
  const media = Object.assign(new EventTarget(), { matches: standalone });
  const target = Object.assign(new EventTarget(), {
    navigator: { userAgent: 'desktop', platform: 'MacIntel', maxTouchPoints: 0, standalone: navigatorStandalone },
    isSecureContext: secure,
    matchMedia(query) { assert.equal(query, '(display-mode: standalone)'); return media; },
  });
  const changes = [];
  const controller = createInstallController(target, (state) => changes.push(state));
  return { target, media, controller, changes };
}
function promptEvent(prompt) { return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt }); }

test('platform is only a local guide hint, including iPad desktop user agent', () => {
  assert.equal(suggestedInstallPlatform({ userAgent: 'Mozilla iPhone', platform: 'iPhone', maxTouchPoints: 5 }), 'ios');
  assert.equal(suggestedInstallPlatform({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }), 'ios');
  assert.equal(suggestedInstallPlatform({ userAgent: 'Mozilla Android', platform: 'Linux', maxTouchPoints: 5 }), 'android');
  assert.equal(suggestedInstallPlatform({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 }), 'desktop');
});

test('unsupported browser does not offer a fake install action', async () => {
  const { controller } = fixture();
  assert.equal(controller.getSnapshot().available, false);
  await controller.install();
  assert.equal(controller.getSnapshot().outcome, 'unavailable');
  controller.destroy();
});

test('prompt is requested only by explicit action, once even with double taps', async () => {
  const { target, controller } = fixture();
  let calls = 0, resolve;
  const event = promptEvent(() => { calls++; return new Promise((done) => { resolve = done; }); });
  target.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(controller.getSnapshot().available, true);
  assert.equal(calls, 0);
  const first = controller.install();
  assert.equal(calls, 1); // Synchronous call preserves browser user activation.
  await controller.install();
  assert.equal(calls, 1);
  assert.equal(controller.getSnapshot().prompting, true);
  resolve({ outcome: 'accepted' });
  await first;
  assert.equal(controller.getSnapshot().outcome, 'accepted');
  assert.equal(controller.getSnapshot().installed, false);
  assert.equal(controller.getSnapshot().available, false);
  target.dispatchEvent(new Event('appinstalled'));
  assert.equal(controller.getSnapshot().installed, true);
  assert.equal(controller.getSnapshot().outcome, 'idle');
  controller.destroy();
});

test('dismissal and failure consume the one-use prompt, allowing manual help', async () => {
  const { target, controller } = fixture();
  target.dispatchEvent(promptEvent(async () => ({ outcome: 'dismissed' })));
  await controller.install();
  assert.equal(controller.getSnapshot().outcome, 'dismissed');
  assert.equal(controller.getSnapshot().installed, false);
  assert.equal(controller.getSnapshot().available, false);
  target.dispatchEvent(promptEvent(async () => { throw new Error('not available'); }));
  await controller.install();
  assert.equal(controller.getSnapshot().outcome, 'unavailable');
  assert.equal(controller.getSnapshot().prompting, false);
  controller.destroy();
});

test('older userChoice API is supported without claiming completion', async () => {
  const { target, controller } = fixture();
  target.dispatchEvent(Object.assign(promptEvent(async () => undefined), { userChoice: Promise.resolve({ outcome: 'accepted' }) }));
  await controller.install();
  assert.equal(controller.getSnapshot().outcome, 'accepted');
  assert.equal(controller.getSnapshot().installed, false);
  controller.destroy();
});

test('installed or insecure contexts do not retain an install prompt', () => {
  for (const options of [{ standalone: true }, { navigatorStandalone: true }, { secure: false }]) {
    const { target, controller } = fixture(options);
    target.dispatchEvent(promptEvent(async () => ({ outcome: 'accepted' })));
    assert.equal(controller.getSnapshot().available, false);
    controller.destroy();
  }
});

test('display changes and appinstalled remove install action; cleanup removes listeners', () => {
  const { target, media, controller, changes } = fixture();
  target.dispatchEvent(promptEvent(async () => ({ outcome: 'accepted' })));
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  assert.equal(controller.getSnapshot().installed, true);
  assert.equal(controller.getSnapshot().available, false);
  controller.destroy();
  const count = changes.length;
  media.dispatchEvent(new Event('change'));
  target.dispatchEvent(new Event('appinstalled'));
  target.dispatchEvent(promptEvent(async () => ({ outcome: 'accepted' })));
  assert.equal(changes.length, count);
});

test('unmount during a pending prompt cannot update React later', async () => {
  const { target, controller, changes } = fixture();
  let resolve;
  target.dispatchEvent(promptEvent(() => new Promise((done) => { resolve = done; })));
  const pending = controller.install();
  controller.destroy();
  const count = changes.length;
  resolve({ outcome: 'dismissed' });
  await pending;
  assert.equal(changes.length, count);
});

test('manifest preserves installed identity and existing icons', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.id, manifest.start_url);
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const data = readFileSync(new URL(`../public${icon.src}`, import.meta.url));
    assert.equal(data.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(`${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`, icon.sizes);
  }
});
