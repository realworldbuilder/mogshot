/** Somewhere to keep derived data between visits. Values must survive structured cloning. */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

const DATABASE = 'mogshot';
const STORE = 'cache';

/** A cache in the browser's IndexedDB. Any failure is treated as a miss: the cache only speeds things up. */
export class IndexedDbCache implements Cache {
  private readonly db: Promise<IDBDatabase | undefined>;

  constructor() {
    this.db = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
        request.onblocked = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    const db = await this.db;
    if (!db) return undefined;
    return new Promise((resolve) => {
      try {
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  async put(key: string, value: unknown): Promise<void> {
    const db = await this.db;
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(STORE, 'readwrite');
        transaction.objectStore(STORE).put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

/** A cache that lives as long as the object: for tests, and as a stand-in when IndexedDB is unavailable. */
export class MemoryCache implements Cache {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }
}
