const DB_NAME = 'scan-queue-sheets';
const DB_VERSION = 2;
const STORE = 'scans';

/**
 * @typedef {{
 *   id: string,
 *   barcode: string,
 *   scannedAt: string,
 *   status: 'pending' | 'sent' | 'failed',
 *   error?: string,
 *   sessionId?: string,
 *   operatorName?: string,
 *   category?: string,
 * }} ScanRow
 */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('status', 'status', { unique: false });
        os.createIndex('scannedAt', 'scannedAt', { unique: false });
        os.createIndex('sessionId', 'sessionId', { unique: false });
      } else if (ev.oldVersion < 2) {
        const tx = /** @type {IDBTransaction} */ (ev.target.transaction);
        const os = tx.objectStore(STORE);
        if (!os.indexNames.contains('sessionId')) {
          os.createIndex('sessionId', 'sessionId', { unique: false });
        }
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

/** @param {string} sessionId */
export async function getScansForSession(sessionId) {
  if (!sessionId) return [];
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    if (!store.indexNames.contains('sessionId')) {
      getAllScans()
        .then((all) => resolve(all.filter((r) => r.sessionId === sessionId)))
        .catch(reject);
      return;
    }
    const req = store.index('sessionId').getAll(sessionId);
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

/** ลบเฉพาะแถวที่ status === 'sent' ใน session นี้ (ถ้าไม่ส่ง sessionId = ลบ sent ทั้งหมดแบบเดิม) */
export async function clearSent(sessionId) {
  const all = sessionId
    ? await getScansForSession(sessionId)
    : await getAllScans();
  const toDelete = all.filter((r) => r.status === 'sent').map((r) => r.id);
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    toDelete.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve(toDelete.length);
    tx.onerror = () => reject(tx.error);
  });
}

/** ลบทุกแถวของ session (หลังส่งสำเร็จหรือยกเลิกคนนี้) */
export async function deleteScansBySession(sessionId) {
  const rows = await getScansForSession(sessionId);
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    rows.forEach((r) => store.delete(r.id));
    tx.oncomplete = () => resolve(rows.length);
    tx.onerror = () => reject(tx.error);
  });
}
