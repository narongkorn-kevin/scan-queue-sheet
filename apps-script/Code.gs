  /**
  * ผูกกับ Google Sheet ที่ต้องการ (สร้างสเปรดชีตใหม่ แล้ว Extensions → Apps Script วางโค้ดนี้)
  * Deploy → New deployment → Type: Web app
  * Execute as: Me
  * Who has access: Anyone (หรือ Anyone with Google account ตามความเหมาะสม)
  *
  * (ไม่บังคับ) ตั้งโทเคน: Project Settings → Script properties → เพิ่ม SYNC_TOKEN
  */

  const SHEET_NAME = 'Sheet1';
  const HEADER = ['id', 'barcode', 'scannedAt', 'receivedAt'];

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

      const rows = data.rows;
      if (!Array.isArray(rows) || rows.length === 0) {
        out.setContent(JSON.stringify({ ok: false, error: 'rows required' }));
        return out;
      }

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

      if (sheet.getLastRow() === 0) {
        sheet.appendRow(HEADER);
      }

      const now = new Date().toISOString();
      rows.forEach(function (r) {
        sheet.appendRow([
          r.id || '',
          r.barcode || '',
          r.scannedAt || '',
          now,
        ]);
      });

      out.setContent(JSON.stringify({ ok: true, count: rows.length }));
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
