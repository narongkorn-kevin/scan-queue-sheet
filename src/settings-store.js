export const LS_URL = 'scanQueue.webAppUrl';
export const LS_TOKEN = 'scanQueue.syncToken';

/** URL Web App เริ่มต้น — แก้ตรงนี้ถ้า deploy สคริปต์ใหม่ */
export const DEFAULT_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbxPbfUGzY1Z0fJOPXWKa6T4gpFfqRI-oHPIU1xCh11Zt3oIaYY0frBiUpDzBSS2KW_4/exec';

export function getStoredWebAppUrl() {
  return localStorage.getItem(LS_URL) || DEFAULT_WEB_APP_URL;
}

export function getStoredSyncToken() {
  return localStorage.getItem(LS_TOKEN) || '';
}

export function persistSettings(url, token) {
  localStorage.setItem(LS_URL, url.trim());
  localStorage.setItem(LS_TOKEN, token.trim());
}
