const DB_NAME = 'scan-queue-sheets';
const DB_VERSION = 1;
const STORE = 'scans';

/** @typedef {{ id: string, barcode: string, scannedAt: string, status: 'pending' | 'sent' | 'failed', error?: string }} ScanRow */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('status', 'status', { unique: false });
        os.createIndex('scannedAt', 'scannedAt', { unique: false });
      }
    };
  });
}

/** @returns {Promise<IDBDatabase>} */
export async function getDb() {
  return openDb();
}

/** @param {ScanRow} row */
export async function addScan(row) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** @returns {Promise<ScanRow[]>} */
export async function getAllScans() {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/** @param {string} id */
export async function deleteScan(id) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** @param {ScanRow} row */
export async function updateScan(row) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** ลบเฉพาะแถวที่ status === 'sent' */
export async function clearSent() {
  const db = await getDb();
  const all = await getAllScans();
  const toDelete = all.filter((r) => r.status === 'sent').map((r) => r.id);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    toDelete.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve(toDelete.length);
    tx.onerror = () => reject(tx.error);
  });
}
