import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import {
  addScan,
  getScansForSession,
  deleteScan,
  updateScan,
  clearSent,
  deleteScansBySession,
} from './db.js';
import { getStoredWebAppUrl, getStoredSyncToken } from './settings-store.js';
import { initAppNav } from './nav.js';
import { playScanBeep, primeScanSound } from './scan-sound.js';

const $ = (id) => document.getElementById(id);

const sessionGate = $('sessionGate');
const scanWorkspace = $('scanWorkspace');
const operatorName = $('operatorName');
const startSessionBtn = $('startSessionBtn');
const changeOperatorBtn = $('changeOperatorBtn');
const sessionSummaryName = $('sessionSummaryName');
const scanCategory = $('scanCategory');
const historyHint = $('historyHint');
const historyList = $('historyList');
const gateStatus = $('gateStatus');

const toggleScan = $('toggleScan');
const flipCameraBtn = $('flipCamera');
const manualCode = $('manualCode');
const addManual = $('addManual');
const sendNow = $('sendNow');
const clearSentBtn = $('clearSent');
const queueList = $('queueList');
const pendingCount = $('pendingCount');
const syncStatus = $('syncStatus');

/** @type {{ sessionId: string; name: string } | null} */
let activeSession = null;

let html5Qr = null;
let scanning = false;
/** @type {{ id: string; label: string }[]} */
let cameraList = [];
let cameraIndex = 0;
/** @type {string | null} */
let lastScanValue = null;
let lastScanAt = 0;
const DEBOUNCE_MS = 1200;
let pendingForUnload = 0;

/** @type {AbortController | null} */
let historyAbort = null;
let historyDebounceTimer = 0;

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || '');
    return d.toLocaleString('th-TH', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return String(iso || '');
  }
}

function showGate() {
  sessionGate.hidden = false;
  scanWorkspace.hidden = true;
}

function showWorkspace() {
  sessionGate.hidden = true;
  scanWorkspace.hidden = false;
}

function updateSessionBanner() {
  if (!activeSession) return;
  sessionSummaryName.textContent = activeSession.name;
}

function getCurrentScanCategory() {
  return String(scanCategory?.value || '').trim();
}

async function refreshQueue() {
  if (!activeSession) {
    pendingForUnload = 0;
    pendingCount.textContent = '0';
    sendNow.disabled = true;
    queueList.innerHTML = '';
    return;
  }

  const rows = await getScansForSession(activeSession.sessionId);
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
        <div class="queue-cat"></div>
        <div class="queue-code"></div>
        <div class="queue-time"></div>
        ${row.error ? `<div class="hint error" style="margin-top:0.25rem">${escapeHtml(row.error)}</div>` : ''}
      </div>
      <div style="display:flex;align-items:flex-start;gap:0.5rem">
        <span class="status-pill ${row.status}"></span>
        <div class="queue-item-actions"></div>
      </div>
    `;
    const catEl = li.querySelector('.queue-cat');
    if (catEl) {
      catEl.textContent = row.category || '—';
      catEl.className = 'queue-cat';
    }
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
  if (!activeSession) {
    return;
  }

  const trimmed = String(text || '').trim();
  if (!trimmed) return;

  const cat = getCurrentScanCategory();
  if (!cat) {
    syncStatus.textContent = 'กรุณาเลือก Category ด้านบนก่อนสแกน';
    syncStatus.classList.add('error');
    return;
  }

  const sessionRows = await getScansForSession(activeSession.sessionId);
  const dup = sessionRows.some(
    (r) =>
      (r.status === 'pending' || r.status === 'failed') &&
      String(r.barcode || '').trim() === trimmed
  );
  if (dup) {
    syncStatus.textContent = `แจ้งเตือน: รหัส "${trimmed}" มีในรายการแล้ว (สแกนซ้ำ)`;
    syncStatus.classList.remove('ok');
    syncStatus.classList.add('error');
    return;
  }

  primeScanSound();

  const row = {
    id: newId(),
    barcode: trimmed,
    scannedAt: new Date().toISOString(),
    status: /** @type {'pending'} */ ('pending'),
    sessionId: activeSession.sessionId,
    operatorName: activeSession.name,
    category: cat,
  };
  await addScan(row);
  playScanBeep();
  syncStatus.textContent = '';
  syncStatus.classList.remove('error', 'ok');
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

/**
 * iPhone / iPad รวม Chrome, Edge, Firefox บน iOS — ทุกตัวใช้ WebKit เหมือน Safari
 * กฎกล้อง (ต้อง HTTPS, facingMode) เหมือนกันหมด
 */
function isAppleTouchDevice() {
  const ua = navigator.userAgent || '';
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
    /(CriOS|EdgiOS|FxiOS)/.test(ua)
  );
}

/**
 * บน iOS ให้ใช้ตัวถอดรหัส ZXing ของไลบรารีเท่านั้น — BarcodeDetector ของเว็บมักถอดไม่ได้แต่ความจริงแล้วยังบางครั้ง
 */
function getHtml5QrFactoryConfig() {
  if (!isAppleTouchDevice()) {
    return { verbose: false };
  }
  return {
    verbose: false,
    useBarCodeDetectorIfSupported: false,
    /** เน้น Code 128 / บาร์โค้ด 1D ก่อน แล้วค่อย QR — ลำดับช่วยตัวถอดรหัสบน iOS */
    formatsToSupport: [
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.CODE_93,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.CODABAR,
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.DATA_MATRIX,
      Html5QrcodeSupportedFormats.PDF_417,
    ],
  };
}

/**
 * Code 128 เป็นแถบแนวนอน — ต้องให้กรอบสแกนกว้างและเตี้ย ไม่ใช่กล่องจัตุรัสแบบ QR อย่างเดียว
 * (ใช้ร่วมกับได้ทั้ง QR ที่อยู่ในแถบกลางภาพ)
 */
function getQrBoxBarcodeFriendly(viewfinderWidth, viewfinderHeight) {
  const boxW = Math.min(
    Math.floor(viewfinderWidth * 0.94),
    viewfinderWidth - 16
  );
  const hByWidth = Math.floor(boxW * 0.22);
  const hByVideo = Math.floor(viewfinderHeight * 0.36);
  const boxH = Math.min(Math.max(hByWidth, 72), hByVideo, Math.floor(viewfinderHeight * 0.42));
  return {
    width: Math.max(220, boxW),
    height: Math.max(72, boxH),
  };
}

function getScanConfig() {
  const isApple = isAppleTouchDevice();
  return {
    fps: isApple ? 16 : 12,
    ...(isApple
      ? { aspectRatio: 1.777777778, disableFlip: false }
      : {}),
    qrbox: getQrBoxBarcodeFriendly,
  };
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
  const readerEl = document.getElementById('reader');
  const video = readerEl?.querySelector('video');
  if (video) {
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.playsInline = true;
  }
}

async function startCamera() {
  if (scanning) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('เบราว์เซอร์นี้ไม่รองรับการเข้าถึงกล้อง');
  }
  if (!window.isSecureContext) {
    throw new Error(
      'ต้องใช้ HTTPS เพื่อเปิดกล้อง — บน iPhone ทั้ง Safari และ Chrome ใช้กฎเดียวกัน เปิดจากลิงก์ https:// เท่านั้น (เช่น npm run dev + plugin SSL) หรือโฮสต์บน Vercel'
    );
  }

  html5Qr = new Html5Qrcode('reader', getHtml5QrFactoryConfig());
  await ensureCameraList();

  let cameraArg;
  if (isAppleTouchDevice()) {
    /** iOS: เริ่มด้วย facingMode เสถียรกว่า deviceId หลายเครื่อง */
    cameraIndex = 0;
    cameraArg = { facingMode: 'environment' };
  } else if (cameraList.length >= 1) {
    cameraIndex = pickInitialCameraIndex(cameraList);
    cameraArg = cameraList[cameraIndex].id;
  } else {
    cameraArg = { facingMode: 'environment' };
  }

  try {
    await runScanner(cameraArg);
  } catch (firstErr) {
    if (
      isAppleTouchDevice() &&
      cameraList.length >= 1 &&
      typeof cameraArg === 'object' &&
      cameraArg !== null &&
      'facingMode' in cameraArg
    ) {
      cameraIndex = pickInitialCameraIndex(cameraList);
      cameraArg = cameraList[cameraIndex].id;
      await runScanner(cameraArg);
    } else {
      throw firstErr;
    }
  }

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

const HISTORY_WIDE_CATS = ['NB', 'CM', 'MN1', 'MN2', 'UPS'];

/**
 * แปลง response ประวัติเป็นรายการแสดงผล — รองรับทั้งแบบ wide (แถวเดียวหลายคอลัมน์) และแบบเก่า
 * @param {unknown[]} rows
 */
function historyRowsToDisplayEntries(rows) {
  /** @type {{ category: string; barcode: string; receivedAt: string }[]} */
  const out = [];
  for (const raw of rows) {
    const r = /** @type {Record<string, unknown>} */ (raw || {});
    const isWide =
      r.NB != null ||
      r.CM != null ||
      r.MN1 != null ||
      r.MN2 != null ||
      r.UPS != null ||
      r.created_at != null;

    if (isWide) {
      const ts = String(r.updated_at || r.created_at || '');
      for (const c of HISTORY_WIDE_CATS) {
        const code = r[c];
        if (code != null && String(code).trim() !== '') {
          out.push({
            category: c,
            barcode: String(code).trim(),
            receivedAt: ts,
          });
        }
      }
    } else if (r.barcode != null && String(r.barcode).trim() !== '') {
      out.push({
        category: String(r.category || '—'),
        barcode: String(r.barcode).trim(),
        receivedAt: String(r.receivedAt || ''),
      });
    }
  }
  out.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
  return out;
}

async function runHistoryFetch() {
  if (!historyHint || !historyList) return;
  historyAbort?.abort();
  historyAbort = new AbortController();
  const signal = historyAbort.signal;

  const name = operatorName.value.trim();
  if (name.length < 1) {
    historyList.innerHTML = '';
    historyHint.textContent = 'กรอกชื่อแล้วรอสักครู่ ระบบจะดึงแถวที่เคย sync ไว้';
    return;
  }

  const url = getStoredWebAppUrl().trim();
  if (!url) {
    historyList.innerHTML = '';
    historyHint.textContent = 'ตั้งค่า URL Web App ในหน้าตั้งค่าก่อน จึงจะดูประวัติได้';
    return;
  }

  historyHint.textContent = 'กำลังโหลดประวัติ…';
  historyList.innerHTML = '';

  try {
    const token = getStoredSyncToken().trim() || undefined;
    const res = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'history', token, name }),
      signal,
    });
    const text = await res.text();
    const json = JSON.parse(text);
    if (!json.ok) {
      throw new Error(json.error || 'โหลดประวัติไม่สำเร็จ');
    }
    const rows = json.rows || [];
    const entries = historyRowsToDisplayEntries(rows);
    if (entries.length === 0) {
      historyHint.textContent = 'ยังไม่มีข้อมูลชื่อนี้ใน Sheet';
      return;
    }
    historyHint.textContent = `ข้อมูลใน Sheet: ${entries.length} ช่องหมวดที่มีบาร์โค้ด`;
    for (const ent of entries) {
      const li = document.createElement('li');
      const cat = document.createElement('span');
      cat.className = 'history-cat';
      cat.textContent = ent.category || '—';
      const code = document.createElement('span');
      code.className = 'history-code';
      code.textContent = ent.barcode || '';
      const meta = document.createElement('span');
      meta.className = 'history-meta';
      meta.textContent =
        formatTime(ent.receivedAt) || String(ent.receivedAt || '') || '';
      li.appendChild(cat);
      li.appendChild(code);
      li.appendChild(meta);
      historyList.appendChild(li);
    }
  } catch (e) {
    if (signal.aborted || e.name === 'AbortError') return;
    const msg = e instanceof Error ? e.message : String(e);
    historyHint.textContent = msg;
  }
}

function scheduleHistoryFetch() {
  window.clearTimeout(historyDebounceTimer);
  historyDebounceTimer = window.setTimeout(() => {
    void runHistoryFetch();
  }, 450);
}

startSessionBtn.addEventListener('click', () => {
  if (gateStatus) {
    gateStatus.textContent = '';
    gateStatus.classList.remove('error', 'ok');
  }
  const name = operatorName.value.trim();
  if (!name) {
    if (gateStatus) {
      gateStatus.textContent = 'กรุณากรอกชื่อ';
      gateStatus.classList.add('error');
    }
    return;
  }
  activeSession = { sessionId: newId(), name };
  if (scanCategory) {
    scanCategory.value = 'NB';
  }
  updateSessionBanner();
  showWorkspace();
  void refreshQueue();
});

changeOperatorBtn.addEventListener('click', async () => {
  if (!activeSession) return;
  const rows = await getScansForSession(activeSession.sessionId);
  const pending = rows.filter((r) => r.status === 'pending');
  if (
    pending.length > 0 &&
    !window.confirm(
      `ยังมี ${pending.length} รายการที่ยังไม่ได้ส่ง ต้องการเปลี่ยนคนและล้างคิวในครั้งนี้หรือไม่?`
    )
  ) {
    return;
  }
  await stopCamera();
  await deleteScansBySession(activeSession.sessionId);
  activeSession = null;
  showGate();
  if (gateStatus) {
    gateStatus.textContent = '';
    gateStatus.classList.remove('error', 'ok');
  }
  await refreshQueue();
});

operatorName.addEventListener('input', scheduleHistoryFetch);

sendNow.addEventListener('click', async () => {
  const url = getStoredWebAppUrl().trim();
  if (!url) {
    syncStatus.textContent = 'กรุณาตั้งค่า URL Web App ในหน้าตั้งค่า';
    syncStatus.classList.add('error');
    return;
  }
  if (!activeSession) return;

  const rows = await getScansForSession(activeSession.sessionId);
  const pending = rows.filter((r) => r.status === 'pending');
  if (pending.length === 0) return;

  sendNow.disabled = true;
  syncStatus.textContent = 'กำลังส่ง…';
  syncStatus.classList.remove('error', 'ok');

  const token = getStoredSyncToken().trim() || undefined;
  const sid = activeSession.sessionId;
  /** รายการเก่าในเครื่องอาจไม่มี category — ใช้ค่าจาก dropdown หรือ NB */
  const categoryFallback = getCurrentScanCategory() || 'NB';
  const payload = {
    token,
    session: {
      name: activeSession.name,
      category: categoryFallback,
    },
    rows: pending.map((r) => {
      const cat = String(r.category || '').trim() || categoryFallback;
      return {
        id: r.id,
        barcode: r.barcode,
        scannedAt: r.scannedAt,
        category: cat,
      };
    }),
  };

  try {
    await postToAppsScript(url, payload);
    for (const r of pending) {
      await updateScan({ ...r, status: 'sent', error: undefined });
    }
    const okMsg = `ส่งสำเร็จ ${pending.length} รายการ — กรอกข้อมูลคนถัดไป`;
    syncStatus.textContent = okMsg;
    syncStatus.classList.add('ok');
    await deleteScansBySession(sid);
    await stopCamera();
    activeSession = null;
    operatorName.value = '';
    showGate();
    if (gateStatus) {
      gateStatus.textContent = okMsg;
      gateStatus.classList.remove('error');
      gateStatus.classList.add('ok');
    }
    scheduleHistoryFetch();
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
  const sid = activeSession?.sessionId;
  const n = await clearSent(sid);
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
      primeScanSound();
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
    void refreshQueue();
    scheduleHistoryFetch();
  }
});

initAppNav('scan');
showGate();
void refreshQueue();
scheduleHistoryFetch();
