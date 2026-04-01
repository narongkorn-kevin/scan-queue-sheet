export const LS_URL = 'scanQueue.webAppUrl';
export const LS_TOKEN = 'scanQueue.syncToken';

export function getStoredWebAppUrl() {
  return localStorage.getItem(LS_URL) || '';
}

export function getStoredSyncToken() {
  return localStorage.getItem(LS_TOKEN) || '';
}

export function persistSettings(url, token) {
  localStorage.setItem(LS_URL, url.trim());
  localStorage.setItem(LS_TOKEN, token.trim());
}
