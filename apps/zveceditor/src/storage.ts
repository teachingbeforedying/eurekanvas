/**
 * The automatic save of the drawing, in the browser's IndexedDB: a drawing can be much larger than the
 * 5 MB or so that `localStorage` allows (one stroke 1 375 levels deep already takes 1.3 MB). The drawing is
 * kept as its JSON text. Every function rejects when IndexedDB is not available; the page then works
 * without the automatic save.
 */

const DATABASE = "zveceditor";
const STORE = "drawings";
const AUTOSAVE_KEY = "autosave";

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const opening = indexedDB.open(DATABASE, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(STORE);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  return database;
}

/** Runs one request in a transaction, and resolves once the transaction is complete (so a write is stored). */
async function inStore<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = act(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** The text of the drawing saved automatically, or `null` if there is none. */
export async function loadAutosave(): Promise<string | null> {
  const value: unknown = await inStore("readonly", (store) => store.get(AUTOSAVE_KEY));
  return typeof value === "string" ? value : null;
}

export async function saveAutosave(text: string): Promise<void> {
  await inStore("readwrite", (store) => store.put(text, AUTOSAVE_KEY));
}

/**
 * Keeps a saved drawing that could not be read under a key of its own, so that the automatic save does not
 * overwrite it. Returns that key.
 */
export async function keepUnreadable(text: string, date: Date): Promise<string> {
  const key = `unreadable-${date.toISOString()}`;
  await inStore("readwrite", (store) => store.put(text, key));
  return key;
}
