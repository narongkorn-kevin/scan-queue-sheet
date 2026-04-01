export const LS_URL = 'scanQueue.webAppUrl';
export const LS_TOKEN = 'scanQueue.syncToken';

/** URL Web App เริ่มต้น (ใช้เมื่อยังไม่เคยบันทึกในเครื่อง) */
export const DEFAULT_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbwiVkFmIVbO-NMp_mCu0wvWGgd-0ofpVlG50lRlTtdl0N-eCTGP5inoYC4XdO6PACe0pw/exec';

export function getStoredWebAppUrl() {
  const saved = localStorage.getItem(LS_URL);
  if (saved !== null && saved.trim() !== '') return saved;
  return DEFAULT_WEB_APP_URL;
}

export function getStoredSyncToken() {
  return localStorage.getItem(LS_TOKEN) || '';
}

export function persistSettings(url, token) {
  localStorage.setItem(LS_URL, url.trim());
  localStorage.setItem(LS_TOKEN, token.trim());
}
