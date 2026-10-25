// 本地存储层：基于 IndexedDB，离线优先，数据不出本机
const DB_NAME = 'memory-assistant';
const STORE = 'items';
const VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('status', 'status', { unique: false });
        os.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function store(mode) {
  const db = await openDB();
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function getAll() {
  const os = await store('readonly');
  return new Promise((resolve, reject) => {
    const req = os.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function put(item) {
  const os = await store('readwrite');
  return new Promise((resolve, reject) => {
    const req = os.put(item);
    req.onsuccess = () => resolve(item);
    req.onerror = () => reject(req.error);
  });
}

export async function remove(id) {
  const os = await store('readwrite');
  return new Promise((resolve, reject) => {
    const req = os.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearDone() {
  const all = await getAll();
  for (const it of all.filter((i) => i.status === 'done')) {
    await remove(it.id);
  }
}

export async function exportAll() {
  const all = await getAll();
  return JSON.stringify(
    { app: 'memory-assistant', version: 1, exportedAt: new Date().toISOString(), items: all },
    null,
    2
  );
}

export async function importAll(jsonText) {
  const data = JSON.parse(jsonText);
  const items = Array.isArray(data) ? data : data.items;
  if (!Array.isArray(items)) throw new Error('invalid');
  for (const it of items) await put(it);
}
