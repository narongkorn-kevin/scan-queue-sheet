import { Html5Qrcode } from 'html5-qrcode';
import {
  addScan,
  getAllScans,
  deleteScan,
  updateScan,
  clearSent,
} from './db.js';
import { getStoredWebAppUrl, getStoredSyncToken } from './settings-store.js';
import { initAppNav } from './nav.js';

const $ = (id) => document.getElementById(id);

const toggleScan = $('toggleScan');
const flipCameraBtn = $('flipCamera');
const manualCode = $('manualCode');
const addManual = $('addManual');
const sendNow = $('sendNow');
const clearSentBtn = $('clearSent');
const queueList = $('queueList');
const pendingCount = $('pendingCount');
const syncStatus = $('syncStatus');

let html5Qr = null;
let scanning = false;
/** @type {{ id: string; label: string }[]} */
let cameraList = [];
/** ดัชนีกล้องที่ใช้อยู่ใน cameraList */
let cameraIndex = 0;
/** @type {string | null} */
let lastScanValue = null;
let lastScanAt = 0;
const DEBOUNCE_MS = 1200;
/** ใช้เตือนก่อนปิดแท็บเมื่อยังมีรายการรอส่ง */
let pendingForUnload = 0;

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('th-TH', {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  } catch {
    return iso;
  }
}

async function refreshQueue() {
  const rows = await getAllScans();
  rows.sort((a, b) => (a.scannedAt < b.scannedAt ? 1 : -1));

  const pending = rows.filter((r) => r.status === 'pending');
  pendingForUnload = pending.length;
  pendingCount.textContent = String(pending.length);
  const url = getStoredWebAppUrl().trim();
  sendNow.disabled = pending.length === 0 || !url;

  queueList.innerHTML = '';
  for (const row of rows) {
    const li = document.createElement('li');
    li.className = 'queue-item';
    li.innerHTML = `
      <div class="queue-meta">
        <div class="queue-code"></div>
        <div class="queue-time"></div>
        ${row.error ? `<div class="hint error" style="margin-top:0.25rem">${escapeHtml(row.error)}</div>` : ''}
      </div>
      <div style="display:flex;align-items:flex-start;gap:0.5rem">
        <span class="status-pill ${row.status}"></span>
        <div class="queue-item-actions"></div>
      </div>
    `;
    li.querySelector('.queue-code').textContent = row.barcode;
    li.querySelector('.queue-time').textContent = formatTime(row.scannedAt);
    const pill = li.querySelector('.status-pill');
    pill.textContent =
      row.status === 'pending' ? 'รอส่ง' : row.status === 'sent' ? 'ส่งแล้ว' : 'ล้มเหลว';

    const actions = li.querySelector('.queue-item-actions');
    if (row.status === 'pending') {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn secondary';
      del.textContent = 'ลบ';
      del.addEventListener('click', async () => {
        await deleteScan(row.id);
        await refreshQueue();
      });
      actions.appendChild(del);
    }
    if (row.status === 'failed') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn secondary';
      retry.textContent = 'คืนเป็นคิว';
      retry.addEventListener('click', async () => {
        await updateScan({
          ...row,
          status: 'pending',
          error: undefined,
        });
        await refreshQueue();
      });
      actions.appendChild(retry);
    }
    queueList.appendChild(li);
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function enqueueBarcode(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;

  const row = {
    id: newId(),
    barcode: trimmed,
    scannedAt: new Date().toISOString(),
    status: /** @type {'pending'} */ ('pending'),
  };
  await addScan(row);
  await refreshQueue();
}

function shouldAcceptScan(value) {
  const now = Date.now();
  if (value === lastScanValue && now - lastScanAt < DEBOUNCE_MS) {
    return false;
  }
  lastScanValue = value;
  lastScanAt = now;
  return true;
}

function getScanConfig() {
  const vw = window.innerWidth || 360;
  const w = Math.min(320, Math.max(200, Math.floor(vw * 0.88)));
  const h = Math.min(220, Math.max(120, Math.floor(w * 0.62)));
  return { fps: 10, qrbox: { width: w, height: h } };
}

async function ensureCameraList() {
  try {
    const cams = await Html5Qrcode.getCameras();
    cameraList = cams.map((c) => ({ id: c.id, label: c.label || '' }));
  } catch {
    cameraList = [];
  }
  return cameraList;
}

function pickInitialCameraIndex(cameras) {
  if (!cameras.length) return 0;
  const backHint = /back|rear|environment|หลัง|wide/i;
  const idx = cameras.findIndex((c) => backHint.test(c.label));
  return idx >= 0 ? idx : 0;
}

function updateFlipCameraUi() {
  if (!flipCameraBtn) return;
  if (scanning && cameraList.length >= 2) {
    flipCameraBtn.hidden = false;
    flipCameraBtn.disabled = false;
    const label = cameraList[cameraIndex]?.label?.trim();
    flipCameraBtn.title = label ? `กล้องปัจจุบัน: ${label}` : '';
  } else {
    flipCameraBtn.hidden = true;
    flipCameraBtn.disabled = true;
    flipCameraBtn.title = '';
  }
}

async function runScanner(cameraIdOrConfig) {
  if (!html5Qr) return;
  const config = getScanConfig();
  await html5Qr.start(
    cameraIdOrConfig,
    config,
    async (decodedText) => {
      if (!shouldAcceptScan(decodedText)) return;
      await enqueueBarcode(decodedText);
    },
    () => {}
  );
}

async function startCamera() {
  if (scanning) return;
  html5Qr = new Html5Qrcode('reader');
  await ensureCameraList();

  let cameraArg;
  if (cameraList.length >= 1) {
    cameraIndex = pickInitialCameraIndex(cameraList);
    cameraArg = cameraList[cameraIndex].id;
  } else {
    cameraArg = { facingMode: 'environment' };
  }

  await runScanner(cameraArg);
  scanning = true;
  toggleScan.textContent = 'หยุดกล้อง';
  updateFlipCameraUi();
}

async function stopCamera() {
  if (!html5Qr || !scanning) return;
  await html5Qr.stop();
  html5Qr.clear();
  html5Qr = null;
  scanning = false;
  toggleScan.textContent = 'เริ่มกล้อง';
  updateFlipCameraUi();
}

async function postToAppsScript(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 200) || 'ตอบกลับไม่ใช่ JSON');
  }
  if (!json.ok) {
    throw new Error(json.error || 'ส่งไม่สำเร็จ');
  }
  return json;
}

sendNow.addEventListener('click', async () => {
  const url = getStoredWebAppUrl().trim();
  if (!url) {
    syncStatus.textContent = 'กรุณาตั้งค่า URL Web App ในหน้าตั้งค่า';
    syncStatus.classList.add('error');
    return;
  }

  const rows = await getAllScans();
  const pending = rows.filter((r) => r.status === 'pending');
  if (pending.length === 0) return;

  sendNow.disabled = true;
  syncStatus.textContent = 'กำลังส่ง…';
  syncStatus.classList.remove('error', 'ok');

  const token = getStoredSyncToken().trim() || undefined;
  const payload = {
    token,
    rows: pending.map((r) => ({
      id: r.id,
      barcode: r.barcode,
      scannedAt: r.scannedAt,
    })),
  };

  try {
    await postToAppsScript(url, payload);
    for (const r of pending) {
      await updateScan({ ...r, status: 'sent', error: undefined });
    }
    syncStatus.textContent = `ส่งสำเร็จ ${pending.length} รายการ`;
    syncStatus.classList.add('ok');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    for (const r of pending) {
      await updateScan({ ...r, status: 'failed', error: msg });
    }
    syncStatus.textContent = `ส่งไม่สำเร็จ: ${msg}`;
    syncStatus.classList.add('error');
  }

  await refreshQueue();
});

clearSentBtn.addEventListener('click', async () => {
  const n = await clearSent();
  syncStatus.textContent = n ? `ล้างรายการที่ส่งแล้ว ${n} แถว` : 'ไม่มีรายการที่ส่งแล้ว';
  syncStatus.classList.toggle('ok', n > 0);
  syncStatus.classList.toggle('error', false);
  await refreshQueue();
});

toggleScan.addEventListener('click', async () => {
  try {
    if (scanning) {
      await stopCamera();
    } else {
      await startCamera();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    syncStatus.textContent = `กล้อง: ${msg}`;
    syncStatus.classList.add('error');
    if (html5Qr) {
      try {
        html5Qr.clear();
      } catch {
        /* ignore */
      }
      html5Qr = null;
    }
    scanning = false;
    toggleScan.textContent = 'เริ่มกล้อง';
    updateFlipCameraUi();
  }
});

flipCameraBtn?.addEventListener('click', async () => {
  if (!scanning || !html5Qr || cameraList.length < 2) return;
  const prevIndex = cameraIndex;
  cameraIndex = (cameraIndex + 1) % cameraList.length;
  flipCameraBtn.disabled = true;
  try {
    await html5Qr.stop();
    await runScanner(cameraList[cameraIndex].id);
    scanning = true;
    updateFlipCameraUi();
  } catch (e) {
    cameraIndex = prevIndex;
    try {
      await runScanner(cameraList[cameraIndex].id);
      scanning = true;
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : String(e2);
      syncStatus.textContent = `สลับกล้องไม่สำเร็จ: ${msg}`;
      syncStatus.classList.add('error');
      try {
        html5Qr.clear();
      } catch {
        /* ignore */
      }
      html5Qr = null;
      scanning = false;
      toggleScan.textContent = 'เริ่มกล้อง';
    }
    updateFlipCameraUi();
  }
});

addManual.addEventListener('click', async () => {
  await enqueueBarcode(manualCode.value);
  manualCode.value = '';
  manualCode.focus();
});

manualCode.addEventListener('keydown', async (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    await enqueueBarcode(manualCode.value);
    manualCode.value = '';
  }
});

window.addEventListener('beforeunload', (e) => {
  if (pendingForUnload > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

window.addEventListener('storage', (e) => {
  if (e.key === 'scanQueue.webAppUrl' || e.key === 'scanQueue.syncToken') {
    refreshQueue();
  }
});

initAppNav('scan');
refreshQueue();
