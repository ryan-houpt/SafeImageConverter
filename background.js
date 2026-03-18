/**
 * Safe Image Format Converter — Background Service Worker
 *
 * Responsibilities:
 * 1. Register context menu items on install
 * 2. Handle context menu clicks: fetch image, delegate conversion to offscreen doc, trigger download
 * 3. Manage offscreen document lifecycle (create on demand, close after 30s idle)
 * 4. Update context menu labels when default format changes
 */

const FORMATS = ['png', 'jpg', 'webp'];
const MENU_ID_PREFIX = 'save-as-';
const OFFSCREEN_URL = 'offscreen.html';

let offscreenCloseTimer = null;

// --- Context Menu ---

function menuLabel(format, defaultFormat) {
  const upper = format.toUpperCase();
  return format === defaultFormat
    ? chrome.i18n.getMessage('menuSaveAsDefault', [upper])
    : chrome.i18n.getMessage('menuSaveAs', [upper]);
}

async function createContextMenus(defaultFormat) {
  // Remove existing first to avoid duplicates on re-install / update
  await chrome.contextMenus.removeAll();
  for (const fmt of FORMATS) {
    await chrome.contextMenus.create({
      id: MENU_ID_PREFIX + fmt,
      title: menuLabel(fmt, defaultFormat),
      contexts: ['image']
    });
  }
}

async function updateContextMenuLabels(defaultFormat) {
  for (const fmt of FORMATS) {
    await chrome.contextMenus.update(MENU_ID_PREFIX + fmt, {
      title: menuLabel(fmt, defaultFormat)
    });
  }
}

// --- Offscreen Document Management ---

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['BLOBS'],
    justification: 'Image format conversion via canvas and blob creation'
  });
}

function resetOffscreenCloseTimer() {
  if (offscreenCloseTimer !== null) {
    clearTimeout(offscreenCloseTimer);
  }
  offscreenCloseTimer = setTimeout(async () => {
    if (await hasOffscreenDocument()) {
      await chrome.offscreen.closeDocument();
    }
    offscreenCloseTimer = null;
  }, 30000);
}

// --- Filename Extraction ---

function extractFilename(url) {
  try {
    if (url.startsWith('data:')) return null;
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split('/').pop();
    if (!lastSegment) return null;
    // Remove query-like suffixes and decode
    const decoded = decodeURIComponent(lastSegment.split('?')[0]);
    // Strip extension
    const dotIndex = decoded.lastIndexOf('.');
    if (dotIndex > 0) return decoded.substring(0, dotIndex);
    return decoded || null;
  } catch {
    return null;
  }
}

function buildDownloadFilename(srcUrl, targetFormat) {
  const baseName = extractFilename(srcUrl) || 'image';
  return `${baseName}-converted.${targetFormat}`;
}

// --- Base64 Helpers ---

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// --- Image Conversion Flow ---

async function convertImage(imageUrl, targetFormat) {
  // 1. Get settings for JPG quality
  const settings = await chrome.storage.local.get({ jpgQuality: 85 });

  // 2. Fetch the image in the background (bypasses page CORS)
  let imageArrayBuffer;
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    imageArrayBuffer = await response.arrayBuffer();
  } catch (err) {
    showConversionError();
    return;
  }

  // 3. Ensure offscreen document exists
  await ensureOffscreenDocument();

  // 4. Send image as base64 to offscreen for conversion, receive base64 blob data back
  const imageBase64 = arrayBufferToBase64(imageArrayBuffer);

  let result;
  try {
    result = await chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'convert',
      imageBase64: imageBase64,
      format: targetFormat,
      quality: settings.jpgQuality / 100
    });
  } catch (err) {
    showConversionError();
    return;
  }

  if (!result || !result.base64 || !result.mimeType) {
    showConversionError();
    return;
  }

  // 5. Reset idle timer
  resetOffscreenCloseTimer();

  // 6. Download using data URL (service workers don't support URL.createObjectURL)
  const dataUrl = `data:${result.mimeType};base64,${result.base64}`;
  const filename = buildDownloadFilename(imageUrl, targetFormat);

  chrome.downloads.download({
    url: dataUrl,
    filename: filename,
    saveAs: false
  });

  // 7. Increment conversion counter
  const data = await chrome.storage.local.get({ conversionCount: 0 });
  await chrome.storage.local.set({ conversionCount: data.conversionCount + 1 });
}

// --- Error Feedback ---

function showConversionError() {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: chrome.i18n.getMessage('errorTitle'),
    message: chrome.i18n.getMessage('errorMessage')
  });
}

// --- Event Listeners ---

chrome.runtime.onInstalled.addListener((details) => {
  // Create context menus FIRST, then set storage defaults.
  // Order matters: setting storage triggers onChanged listener which
  // calls updateContextMenuLabels — menus must exist before that fires.
  const defaultFormat = 'png';

  createContextMenus(defaultFormat).then(() => {
    if (details.reason === 'install') {
      return chrome.storage.local.set({
        defaultFormat: defaultFormat,
        jpgQuality: 85,
        conversionCount: 0,
        ratePromptDismissed: false
      });
    }
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  const menuId = info.menuItemId;
  if (typeof menuId !== 'string' || !menuId.startsWith(MENU_ID_PREFIX)) return;

  const format = menuId.substring(MENU_ID_PREFIX.length);
  if (!FORMATS.includes(format)) return;

  const imageUrl = info.srcUrl;
  if (!imageUrl) return;

  convertImage(imageUrl, format);
});

// Listen for default format changes to update context menu labels
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.defaultFormat) {
    // Guard: update may fail if menus haven't been created yet
    updateContextMenuLabels(changes.defaultFormat.newValue).catch(() => {});
  }
});
