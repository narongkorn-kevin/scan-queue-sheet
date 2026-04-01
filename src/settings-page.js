import {
  getStoredWebAppUrl,
  getStoredSyncToken,
  persistSettings,
} from './settings-store.js';
import { initAppNav } from './nav.js';

const $ = (id) => document.getElementById(id);

const webAppUrl = $('webAppUrl');
const syncToken = $('syncToken');
const saveSettings = $('saveSettings');
const settingsHint = $('settingsHint');

function loadForm() {
  webAppUrl.value = getStoredWebAppUrl();
  syncToken.value = getStoredSyncToken();
}

saveSettings.addEventListener('click', () => {
  persistSettings(webAppUrl.value, syncToken.value);
  settingsHint.textContent = 'บันทึกแล้ว';
  settingsHint.classList.remove('error');
  settingsHint.classList.add('ok');
  setTimeout(() => {
    settingsHint.textContent = '';
    settingsHint.classList.remove('ok');
  }, 2000);
});

initAppNav('settings');
loadForm();
