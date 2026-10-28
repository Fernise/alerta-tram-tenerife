import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { confirmationSnapshot, createPreferenceStore, stringListSnapshot, usePreference } from '../lib/browser-preferences.ts';

function environment(initial = null) {
  let raw = initial;
  let storageListener;
  let attaches = 0;
  let detaches = 0;
  const storage = {
    getItem: () => raw,
    setItem: (_key, value) => { raw = value; },
  };
  return {
    storage,
    get raw() { return raw; },
    get attaches() { return attaches; },
    get detaches() { return detaches; },
    externalWrite(value) { raw = value; storageListener?.(); },
    options: {
      storage: () => storage,
      subscribe(_key, listener) {
        attaches += 1;
        storageListener = listener;
        return () => { detaches += 1; storageListener = undefined; };
      },
    },
  };
}

test('SSR uses a deterministic default without reading browser storage', () => {
  const store = createPreferenceStore('language', 'es', (raw) => raw || 'en', (value) => value, {
    storage() { throw new Error('SSR must not read browser storage'); },
    subscribe() { throw new Error('SSR must not subscribe'); },
  });
  function Example() {
    const [language] = usePreference(store);
    return createElement('span', null, language);
  }
  assert.equal(renderToString(createElement(Example)), '<span>es</span>');
});

test('browser snapshots are cached, update atomically and observe changes from another tab', () => {
  const env = environment('["saved"]');
  const fallback = [];
  const store = createPreferenceStore('hidden', fallback, stringListSnapshot, JSON.stringify, env.options);
  assert.equal(store.getServerSnapshot(), fallback);
  const first = store.getSnapshot();
  assert.deepEqual(first, ['saved']);
  assert.equal(store.getSnapshot(), first, 'unchanged raw content must keep a stable React snapshot');
  let notifications = 0;
  const off = store.subscribe(() => { notifications += 1; });
  store.set((previous) => [...previous, 'new']);
  assert.equal(env.raw, '["saved","new"]');
  assert.deepEqual(store.getSnapshot(), ['saved', 'new']);
  assert.equal(notifications, 1);
  env.externalWrite('["another-tab"]');
  assert.equal(notifications, 2);
  assert.deepEqual(store.getSnapshot(), ['another-tab']);
  env.externalWrite(null);
  assert.deepEqual(store.getSnapshot(), []);
  off();
  assert.equal(env.detaches, 1);
});

test('shared preference subscriptions are detached after their last consumer', () => {
  const env = environment('true');
  const store = createPreferenceStore('accepted', false, JSON.parse, JSON.stringify, env.options);
  const offFirst = store.subscribe(() => {});
  const offSecond = store.subscribe(() => {});
  assert.equal(env.attaches, 1);
  offFirst();
  assert.equal(env.detaches, 0);
  offSecond();
  assert.equal(env.detaches, 1);
});

test('malformed stored data falls back to a stable default and a rejected write stays usable in memory', () => {
  const env = environment('{invalid');
  const fallback = [];
  const store = createPreferenceStore('hidden', fallback, stringListSnapshot, JSON.stringify, env.options);
  assert.equal(store.getSnapshot(), fallback);
  assert.equal(store.getSnapshot(), fallback);
  env.storage.setItem = () => { throw new Error('quota denied'); };
  store.set(['local-only']);
  assert.deepEqual(store.getSnapshot(), ['local-only']);
});

test('confirmation hydration ignores expired, future and malformed timestamps', () => {
  const now = 2_000_000;
  assert.deepEqual(confirmationSnapshot(JSON.stringify({ current: now - 1000, expired: now - 600_000, future: now + 1, text: 'recent', empty: null }), now, 600_000), { current: now - 1000 });
  assert.deepEqual(confirmationSnapshot('null', now, 600_000), {});
  assert.deepEqual(confirmationSnapshot('[1,2]', now, 600_000), {});
});

test('hidden and blocked report hydration bounds lists and rejects invalid source identities', () => {
  const many = Array.from({ length: 110 }, (_, index) => `report-${index}`);
  const hidden = stringListSnapshot(JSON.stringify([null, 42, ...many]));
  assert.equal(hidden.length, 100);
  assert.equal(hidden[0], 'report-10');
  assert.deepEqual(stringListSnapshot(JSON.stringify(['source_abcdef0123456789', 'invalid', false]), (token) => /^source_[a-f0-9]{16}$/.test(token)), ['source_abcdef0123456789']);
});
