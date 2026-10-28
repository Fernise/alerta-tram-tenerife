'use client';

import { useSyncExternalStore } from 'react';

export type PreferenceStore<T> = {
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  subscribe: (listener: () => void) => () => void;
  set: (next: T | ((previous: T) => T)) => void;
};

type StoreEnvironment = {
  storage: () => Pick<Storage, 'getItem' | 'setItem'>;
  subscribe: (key: string, listener: () => void) => () => void;
};

const browserEnvironment: StoreEnvironment = {
  storage: () => window.localStorage,
  subscribe(key, listener) {
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage && (event.key === key || event.key === null)) listener();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  },
};

/** Stable snapshots let React hydrate from a server default, then read browser storage. */
export function createPreferenceStore<T>(
  key: string,
  serverValue: T,
  decode: (raw: string | null) => T,
  encode: (value: T) => string = JSON.stringify,
  environment: StoreEnvironment = browserEnvironment,
): PreferenceStore<T> {
  let cachedRaw: string | null | undefined;
  let cachedValue = serverValue;
  const listeners = new Set<() => void>();
  let unsubscribeStorage: (() => void) | undefined;
  function getSnapshot() {
    try {
      const raw = environment.storage().getItem(key);
      if (raw !== cachedRaw) {
        try { cachedValue = decode(raw); } catch { cachedValue = serverValue; }
        cachedRaw = raw;
      }
    } catch { /* Storage may be blocked; keep this tab's in-memory preference. */ }
    return cachedValue;
  }
  return {
    getSnapshot,
    getServerSnapshot: () => serverValue,
    subscribe(listener) {
      listeners.add(listener);
      if (!unsubscribeStorage) unsubscribeStorage = environment.subscribe(key, () => {
        for (const notify of listeners) notify();
      });
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { unsubscribeStorage?.(); unsubscribeStorage = undefined; }
      };
    },
    set(next) {
      const previous = getSnapshot();
      const value = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
      const raw = encode(value);
      try { environment.storage().setItem(key, raw); cachedRaw = raw; } catch { /* Keep this value in memory while storage is unavailable. */ }
      cachedValue = value;
      for (const notify of listeners) notify();
    },
  };
}

export function usePreference<T>(store: PreferenceStore<T>) {
  return [useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot), store.set] as const;
}

export function confirmationSnapshot(raw: string | null, now: number, cooldown: number) {
  const parsed: unknown = JSON.parse(raw || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).filter(([, timestamp]) => (
    typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp <= now && now - timestamp < cooldown
  ))) as Record<string, number>;
}

export function stringListSnapshot(raw: string | null, valid: (value: string) => boolean = () => true) {
  const parsed: unknown = JSON.parse(raw || '[]');
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string' && valid(item)).slice(-100)
    : [];
}

const serverClock = { ready: false, now: 0 };
let browserClock = serverClock;
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | undefined;
function updateClock() {
  browserClock = { ready: true, now: Date.now() };
  for (const notify of clockListeners) notify();
}
const clockStore = {
  getSnapshot: () => browserClock,
  getServerSnapshot: () => serverClock,
  subscribe(listener: () => void) {
    clockListeners.add(listener);
    if (!clockTimer) {
      updateClock();
      clockTimer = setInterval(updateClock, 5000);
    }
    return () => {
      clockListeners.delete(listener);
      if (!clockListeners.size) { clearInterval(clockTimer); clockTimer = undefined; }
    };
  },
};

export function useBrowserClock() {
  return useSyncExternalStore(clockStore.subscribe, clockStore.getSnapshot, clockStore.getServerSnapshot);
}
