/**
 * ผูกกับ Google Sheet (Extensions → Apps Script วางโค้ดนี้ในสเปรดชีตเดียวกัน)
 * Deploy → Web app, Execute as: Me, Who has access: ตามต้องการ
 *
 * โครงสเปรดชีต (แถวที่ 1):
 * name | NB | CM | MN1 | MN2 | UPS | created_at | updated_at
 *
 * หนึ่งชื่อ = หนึ่งแถว — แต่ละ Category เก็บบาร์โค้ดล่าสุดในคอลัมน์ของหมวดนั้น
 * Sync ซ้ำชื่อเดิม = อัปเดตคอลัมน์ NB…UPS ที่ส่งมา + updated_at (created_at คงเดิม)
 *
 * (ไม่บังคับ) Script properties → SYNC_TOKEN
 */

const SHEET_NAME = 'Sheet1';
const HEADER = ['name', 'NB', 'CM', 'MN1', 'MN2', 'UPS', 'created_at', 'updated_at'];

/** รหัส category จากแอป → คอลัมน์ 1-based */
const CAT_COL = {
  NB: 2,
  CM: 3,
  MN1: 4,
  MN2: 5,
  UPS: 6,
};

const COL_CREATED = 7;
const COL_UPDATED = 8;
const FIRST_DATA_ROW = 2;

function normalizeName(n) {
  return String(n || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function ensureSheetReady_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER);
  }
}

function findRowIndexByName_(sheet, rawName) {
  const target = normalizeName(rawName);
  if (target === '') return -1;
  const last = sheet.getLastRow();
  if (last < FIRST_DATA_ROW) return -1;
  const colA = sheet.getRange(FIRST_DATA_ROW, 1, last, 1).getValues();
  for (let i = 0; i < colA.length; i++) {
    if (normalizeName(colA[i][0]) === target) return FIRST_DATA_ROW + i;
  }
  return -1;
}

function cellToIsoString_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * ใน batch เดียว หมวดเดียวกันถ้าหลายบาร์โค้ด เก็บตัวสุดท้ายในอาร์เรย์
 */
function mergeLastBarcodePerCategory_(rows, fallbackCategory) {
  const byCat = {};
  const fb = String(fallbackCategory || '').trim();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cat = String(r.category || fb || '').trim();
    const code = String(r.barcode || '').trim();
    if (code === '' || cat === '') continue;
    if (!CAT_COL[cat]) continue;
    byCat[cat] = code;
  }
  return byCat;
}

function handleHistory_(sheet, data) {
  const want = normalizeName(data.name);
  if (want === '') {
    return { ok: false, error: 'name required' };
  }
  if (sheet.getLastRow() < FIRST_DATA_ROW) {
    return { ok: /** @type {const} */ (true), rows: [] };
  }
  const idx = findRowIndexByName_(sheet, data.name);
  if (idx < 0) {
    return { ok: /** @type {const} */ (true), rows: [] };
  }
  const vals = sheet.getRange(idx, 1, idx, HEADER.length).getValues()[0];
  const pad = HEADER.length - vals.length;
  for (let p = 0; p < pad; p++) {
    vals.push('');
  }
  return {
    ok: /** @type {const} */ (true),
    rows: [
      {
        name: String(vals[0] || ''),
        NB: vals[1] != null ? String(vals[1]) : '',
        CM: vals[2] != null ? String(vals[2]) : '',
        MN1: vals[3] != null ? String(vals[3]) : '',
        MN2: vals[4] != null ? String(vals[4]) : '',
        UPS: vals[5] != null ? String(vals[5]) : '',
        created_at: cellToIsoString_(vals[6]),
        updated_at: cellToIsoString_(vals[7]),
      },
    ],
  };
}

function doPost(e) {
  const out = ContentService.createTextOutput();
  out.setMimeType(ContentService.MimeType.JSON);

  try {
    if (!e || !e.postData || !e.postData.contents) {
      out.setContent(JSON.stringify({ ok: false, error: 'no body' }));
      return out;
    }

    const data = JSON.parse(e.postData.contents);
    const expected = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
    if (expected && data.token !== expected) {
      out.setContent(JSON.stringify({ ok: false, error: 'unauthorized' }));
      return out;
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

    ensureSheetReady_(sheet);

    if (data.action === 'history') {
      const hist = handleHistory_(sheet, data);
      out.setContent(JSON.stringify(hist));
      return out;
    }

    const rows = data.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      out.setContent(JSON.stringify({ ok: false, error: 'rows required' }));
      return out;
    }

    const session = data.session || {};
    const sessionName = String(session.name || '').trim();
    const sessionCatFallback = String(session.category || '').trim();
    if (sessionName === '') {
      out.setContent(JSON.stringify({ ok: false, error: 'session.name required' }));
      return out;
    }

    const byCat = mergeLastBarcodePerCategory_(rows, sessionCatFallback);
    const catsToWrite = Object.keys(byCat);
    if (catsToWrite.length === 0) {
      out.setContent(
        JSON.stringify({
          ok: false,
          error: 'no valid rows (ต้องมี barcode และ category เป็น NB/CM/MN1/MN2/UPS)',
        })
      );
      return out;
    }

    const now = new Date().toISOString();
    let rowIdx = findRowIndexByName_(sheet, sessionName);

    if (rowIdx < 0) {
      const newRow = [sessionName, '', '', '', '', '', now, now];
      for (let c = 0; c < catsToWrite.length; c++) {
        const cat = catsToWrite[c];
        newRow[CAT_COL[cat] - 1] = byCat[cat];
      }
      sheet.appendRow(newRow);
    } else {
      const createdRaw = sheet.getRange(rowIdx, COL_CREATED).getValue();
      let createdStr = createdRaw ? cellToIsoString_(createdRaw) : now;
      if (!createdStr) createdStr = now;

      sheet.getRange(rowIdx, 1).setValue(sessionName);

      for (let c = 0; c < catsToWrite.length; c++) {
        const cat = catsToWrite[c];
        sheet.getRange(rowIdx, CAT_COL[cat]).setValue(byCat[cat]);
      }

      sheet.getRange(rowIdx, COL_CREATED).setValue(createdStr);
      sheet.getRange(rowIdx, COL_UPDATED).setValue(now);
    }

    out.setContent(
      JSON.stringify({
        ok: true,
        count: catsToWrite.length,
        inputRows: rows.length,
        mode: 'wide-row',
      })
    );
    return out;
  } catch (err) {
    out.setContent(
      JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) })
    );
    return out;
  }
}

function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, message: 'POST JSON body here' })
  ).setMimeType(ContentService.MimeType.JSON);
}
