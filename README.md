# scan-queue-sheets

เว็บสำหรับสแกนบาร์โค้ด/QR ด้วยกล้อง เก็บคิวในเครื่อง (IndexedDB) แล้วกด **ส่งทั้งหมดที่รอส่ง** ไป Google Sheet ผ่าน Google Apps Script

## ความต้องการ

- Node.js 18+ (มี `npm`)

## รันบนเครื่องพัฒนา

```bash
cd Projects/scan-queue-sheets
npm install
npm run dev
```

เปิดตาม URL ที่ Vite แสดง (มือถือใน Wi‑Fi เดียวกัน: ใช้ `--host` มีอยู่แล้วใน `vite.config.js`)

## ฝั่ง Google Sheet

1. สร้าง Google Spreadsheet ใหม่
2. **Extensions → Apps Script** วางโค้ดจาก `apps-script/Code.gs` (ผูกกับสเปรดชีตเดียวกัน)
3. **Deploy → New deployment** → Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (หรือตามนโยบายองค์กร)
4. Copy URL ที่ได้ ไปวางในช่อง **URL Web App** บนหน้าเว็บ แล้วกดบันทึก

### โทเคน (แนะนำถ้าเปิด “Anyone”)

ใน Apps Script: **Project Settings → Script properties**

- Key: `SYNC_TOKEN`
- Value: สตริงลับที่คุณคิดเอง

จากนั้นใส่โทเคนเดียวกันในช่อง **โทเคน** บนหน้าเว็บ

## Build สำหรับโฮสต์ static

```bash
npm run build
```

โฟลเดอร์ `dist/` เอาไปวางบน hosting ใดก็ได้ (HTTPS แนะนำเพื่อใช้กล้อง)

## หมายเหตุ

- ถ้าเบราว์เซอร์แจ้ง CORS เวลาส่ง ให้ตรวจว่า deploy Web App แล้ว และ URL ลงท้าย `/exec`
- ข้อมูลคิวอยู่ในเครื่องจนกว่าจะส่งสำเร็จ — อย่าล้างข้อมูลเว็บไซต์ของเบราว์เซอร์ถ้ายังไม่ต้องการสูญหาย
# scan-queue-sheet
