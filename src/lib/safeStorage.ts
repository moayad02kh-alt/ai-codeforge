/**
 * Safe storage utility for sandboxed previews.
 *
 * The preview iframe uses sandbox="allow-scripts" WITHOUT allow-same-origin,
 * which makes window.localStorage throw SecurityError on access in some browsers.
 * This utility safely detects availability and falls back to in-memory storage.
 *
 * Usage:
 *   import { safeStorage } from './lib/safeStorage';
 *   safeStorage.setItem('key', 'value');
 *   safeStorage.getItem('key');
 *
 * For generated apps (standalone HTML), include the inline version:
 *   const safeStorage = (() => { ... })();
 */

interface SafeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
  readonly length: number;
}

function createMemoryStorage(): SafeStorage {
  let memory: Record<string, string> = {};

  return {
    getItem(k: string) {
      return memory[k] ?? null;
    },
    setItem(k: string, v: string) {
      memory[k] = String(v);
    },
    removeItem(k: string) {
      delete memory[k];
    },
    clear() {
      memory = {};
    },
    key(i: number) {
      return Object.keys(memory)[i] ?? null;
    },
    get length() {
      return Object.keys(memory).length;
    },
  };
}

function isLocalStorageAvailable(): boolean {
  try {
    const test = '__cf_storage_test__';
    window.localStorage.setItem(test, '1');
    window.localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

function createSafeStorage(): SafeStorage {
  const memory = createMemoryStorage();
  const hasLocal = isLocalStorageAvailable();

  if (!hasLocal) {
    return memory;
  }

  // Wrap localStorage with try-catch fallback to memory
  const original = window.localStorage;

  return {
    getItem(k: string) {
      try {
        return original.getItem(k);
      } catch {
        return memory.getItem(k);
      }
    },
    setItem(k: string, v: string) {
      try {
        original.setItem(k, String(v));
      } catch {
        memory.setItem(k, v);
      }
    },
    removeItem(k: string) {
      try {
        original.removeItem(k);
      } catch {
        memory.removeItem(k);
      }
    },
    clear() {
      try {
        original.clear();
      } catch {
        memory.clear();
      }
      // Also clear memory to keep in sync
      memory.clear();
    },
    key(i: number) {
      try {
        return original.key(i);
      } catch {
        return memory.key(i);
      }
    },
    get length() {
      try {
        return original.length;
      } catch {
        return memory.length;
      }
    },
  };
}

// Singleton for app code
export const safeStorage: SafeStorage = typeof window !== 'undefined' ? createSafeStorage() : createMemoryStorage();

// Inline version for generated apps (standalone HTML without imports)
// This is what the AI should include in generated files
export const SAFE_STORAGE_INLINE = `
const safeStorage = (() => {
  let memory = {};
  let useMemory = false;
  try {
    const test = '__cf_test__';
    window.localStorage.setItem(test, '1');
    window.localStorage.removeItem(test);
  } catch (e) {
    useMemory = true;
  }
  return {
    getItem(k) {
      if (useMemory) return memory[k] ?? null;
      try { return window.localStorage.getItem(k); } catch { return memory[k] ?? null; }
    },
    setItem(k, v) {
      if (useMemory) { memory[k] = String(v); return; }
      try { window.localStorage.setItem(k, String(v)); } catch { memory[k] = String(v); }
    },
    removeItem(k) {
      if (useMemory) { delete memory[k]; return; }
      try { window.localStorage.removeItem(k); } catch { delete memory[k]; }
    },
    clear() {
      if (useMemory) { memory = {}; return; }
      try { window.localStorage.clear(); } catch {}
      memory = {};
    },
    key(i) {
      if (useMemory) return Object.keys(memory)[i] || null;
      try { return window.localStorage.key(i); } catch { return Object.keys(memory)[i] || null; }
    },
    get length() {
      if (useMemory) return Object.keys(memory).length;
      try { return window.localStorage.length; } catch { return Object.keys(memory).length; }
    }
  };
})();
`.trim();
