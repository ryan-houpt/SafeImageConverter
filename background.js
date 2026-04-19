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
const SOURCE_CANDIDATE_KEY_PREFIX = 'source-candidates:';
const SOURCE_CANDIDATE_MAX_AGE_MS = 30000;
const SPECIAL_ACTION_SEPARATOR_ID = 'background-actions-separator';
const MENU_REMOVE_PREVIEW_BACKGROUND = 'remove-preview-background';
const MENU_ADD_WHITE_BACKGROUND = 'add-white-background';
const MENU_ADD_BLACK_BACKGROUND = 'add-black-background';
const GENERIC_FILENAME_BASES = new Set([
  'attachment',
  'default',
  'download',
  'file',
  'full',
  'image',
  'img',
  'media',
  'original',
  'photo',
  'pic',
  'picture',
  'placeholder',
  'temp',
  'thumbnail',
  'thumb'
]);

let offscreenCloseTimer = null;

// --- Context Menu ---

function menuLabel(format, defaultFormat) {
  const upper = format.toUpperCase();
  return format === defaultFormat
    ? chrome.i18n.getMessage('menuSaveAsDefault', [upper])
    : chrome.i18n.getMessage('menuSaveAs', [upper]);
}

async function createContextMenus(defaultFormat) {
  await chrome.contextMenus.removeAll();

  for (const format of FORMATS) {
    await chrome.contextMenus.create({
      id: MENU_ID_PREFIX + format,
      title: menuLabel(format, defaultFormat),
      contexts: ['image']
    });
  }

  await chrome.contextMenus.create({
    id: SPECIAL_ACTION_SEPARATOR_ID,
    type: 'separator',
    contexts: ['image']
  });

  await chrome.contextMenus.create({
    id: MENU_REMOVE_PREVIEW_BACKGROUND,
    title: chrome.i18n.getMessage('menuRemoveWhiteBackground'),
    contexts: ['image']
  });

  await chrome.contextMenus.create({
    id: MENU_ADD_WHITE_BACKGROUND,
    title: chrome.i18n.getMessage('menuAddWhiteBackground'),
    contexts: ['image']
  });

  await chrome.contextMenus.create({
    id: MENU_ADD_BLACK_BACKGROUND,
    title: chrome.i18n.getMessage('menuAddBlackBackground'),
    contexts: ['image']
  });
}

async function updateContextMenuLabels(defaultFormat) {
  for (const format of FORMATS) {
    await chrome.contextMenus.update(MENU_ID_PREFIX + format, {
      title: menuLabel(format, defaultFormat)
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

function extractPathSegments(url) {
  try {
    if (!url || url.startsWith('data:')) return [];
    const pathname = new URL(url).pathname;
    return pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeFilenameBaseCandidate(value) {
  if (typeof value !== 'string') return null;

  let candidate = value.trim();
  if (!candidate) return null;

  candidate = candidate.normalize('NFKC');
  candidate = candidate.replace(/\.[a-z0-9]{2,5}$/i, '');
  candidate = candidate.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ');
  candidate = candidate.replace(/[%]+/g, ' ');
  candidate = candidate.replace(/[_+]+/g, ' ');
  candidate = candidate.replace(/\s*[-–—]\s*/g, '-');
  candidate = candidate.replace(/\s+/g, ' ');
  candidate = candidate.replace(/\b\d{2,4}x\d{2,4}\b/ig, ' ');
  candidate = candidate.replace(/\b(?:scaled|large|medium|small|thumbnail|thumb)\b/ig, ' ');
  candidate = candidate.replace(/\s+/g, '-');
  candidate = candidate.replace(/-+/g, '-');
  candidate = candidate.replace(/^[.\-_ ]+|[.\-_ ]+$/g, '');

  if (!candidate) return null;
  if (candidate.length > 80) {
    candidate = candidate.slice(0, 80).replace(/-+$/g, '');
  }

  return candidate || null;
}

function isMeaningfulFilenameBase(value) {
  if (!value) return false;

  const normalized = value.toLowerCase();
  const compact = normalized.replace(/-/g, '');
  if (compact.length < 2) return false;
  if (GENERIC_FILENAME_BASES.has(normalized)) return false;
  if (/^\d{5,}$/.test(compact)) return false;
  if (/^[a-f0-9]{12,}$/i.test(compact)) return false;

  return true;
}

function collectFilenameCandidatesFromUrl(url) {
  const segments = extractPathSegments(url);
  const candidates = [];

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const normalized = normalizeFilenameBaseCandidate(segments[index]);
    if (!normalized) continue;
    candidates.push(normalized);
  }

  return candidates;
}

function collectFilenameCandidatesFromTitle(title) {
  if (typeof title !== 'string' || !title.trim()) return [];

  const candidates = [];
  const normalizedTitle = title.trim();
  const parts = normalizedTitle.split(/\s(?:[-–—])\s|\s?[|•·]\s?/);

  for (const part of parts) {
    const normalized = normalizeFilenameBaseCandidate(part);
    if (normalized) {
      candidates.push(normalized);
    }
  }

  const fullTitle = normalizeFilenameBaseCandidate(normalizedTitle);
  if (fullTitle) {
    candidates.push(fullTitle);
  }

  return candidates;
}

function pickBestFilenameBase(context) {
  const prioritizedGroups = [
    collectFilenameCandidatesFromUrl(context.sourceUrl),
    Array.isArray(context.filenameHints)
      ? context.filenameHints.map(normalizeFilenameBaseCandidate).filter(Boolean)
      : [],
    Array.isArray(context.candidateUrls)
      ? context.candidateUrls.flatMap(collectFilenameCandidatesFromUrl)
      : [],
    collectFilenameCandidatesFromTitle(context.pageTitle)
  ];

  const seen = new Set();
  const orderedCandidates = [];

  for (const group of prioritizedGroups) {
    for (const candidate of group) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      orderedCandidates.push(candidate);
    }
  }

  for (const candidate of orderedCandidates) {
    if (isMeaningfulFilenameBase(candidate)) {
      return candidate;
    }
  }

  return orderedCandidates[0] || 'image';
}

function buildDownloadFilename(context, targetFormat) {
  const baseName = pickBestFilenameBase(context);
  if (baseName === 'image') {
    return `image-converted.${targetFormat}`;
  }
  return `${baseName}.${targetFormat}`;
}

function getSourceCandidateKey(tabId) {
  return `${SOURCE_CANDIDATE_KEY_PREFIX}${tabId}`;
}

function normalizeComparableUrl(url) {
  if (!url) return null;
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('file:')) {
    return url;
  }

  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return url;
  }
}

function urlsMatch(left, right) {
  return normalizeComparableUrl(left) === normalizeComparableUrl(right);
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

async function getCachedSourceContext(tabId, displayedImageUrl) {
  if (typeof tabId !== 'number') {
    return { candidates: [], filenameHints: [] };
  }

  const key = getSourceCandidateKey(tabId);
  const data = await chrome.storage.session.get(key);
  const cached = data[key];
  if (!cached) {
    return { candidates: [], filenameHints: [] };
  }

  const isFresh = typeof cached.capturedAt === 'number' &&
    (Date.now() - cached.capturedAt) <= SOURCE_CANDIDATE_MAX_AGE_MS;
  const matchesDisplayedImage = urlsMatch(cached.displayedSrc, displayedImageUrl);

  if (!isFresh || !matchesDisplayedImage || !Array.isArray(cached.candidates)) {
    return { candidates: [], filenameHints: [] };
  }

  return {
    candidates: cached.candidates,
    filenameHints: Array.isArray(cached.filenameHints) ? cached.filenameHints : []
  };
}

function buildFetchCandidates(displayedImageUrl, sourceCandidates, preferDisplayedImage) {
  const orderedCandidates = [];
  const seen = new Set();

  function pushCandidate(url) {
    const normalized = normalizeComparableUrl(url);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    orderedCandidates.push(url);
  }

  if (preferDisplayedImage) {
    pushCandidate(displayedImageUrl);

    for (const candidate of sourceCandidates) {
      if (!urlsMatch(candidate, displayedImageUrl)) {
        pushCandidate(candidate);
      }
    }

    return orderedCandidates;
  }

  for (const candidate of sourceCandidates) {
    if (!urlsMatch(candidate, displayedImageUrl)) {
      pushCandidate(candidate);
    }
  }

  pushCandidate(displayedImageUrl);

  return orderedCandidates;
}

function isConvertibleImageContentType(contentType) {
  if (!contentType) return true;
  const normalized = contentType.toLowerCase();
  return normalized.startsWith('image/') ||
    normalized.startsWith('application/octet-stream');
}

async function fetchImageBytes(candidateUrls) {
  for (const candidateUrl of candidateUrls) {
    try {
      const response = await fetch(candidateUrl);
      if (!response.ok) continue;

      const contentType = response.headers.get('content-type');
      if (!isConvertibleImageContentType(contentType)) continue;

      return {
        imageArrayBuffer: await response.arrayBuffer(),
        sourceUrl: response.url || candidateUrl
      };
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

// --- Image Conversion Flow ---

async function convertImage(candidateUrls, options, displayedImageUrl) {
  const settings = await chrome.storage.local.get({
    jpgQuality: 85
  });

  const targetFormat = FORMATS.includes(options.targetFormat) ? options.targetFormat : 'png';
  const jpgBackground = options.jpgBackground === 'black' ? 'black' : 'white';

  const fetchedImage = await fetchImageBytes(candidateUrls);
  if (!fetchedImage) {
    showConversionError();
    return;
  }

  await ensureOffscreenDocument();

  const imageBase64 = arrayBufferToBase64(fetchedImage.imageArrayBuffer);

  let result;
  try {
    result = await chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'convert',
      imageBase64,
      format: targetFormat,
      quality: settings.jpgQuality / 100,
      jpgBackground,
      removePreviewBackground: options.removePreviewBackground === true
    });
  } catch {
    showConversionError();
    return;
  }

  if (!result || !result.base64 || !result.mimeType) {
    showConversionError();
    return;
  }

  resetOffscreenCloseTimer();

  const dataUrl = `data:${result.mimeType};base64,${result.base64}`;
  const actualFormat = result.format && FORMATS.includes(result.format)
    ? result.format
    : targetFormat;
  const filename = buildDownloadFilename({
    sourceUrl: fetchedImage.sourceUrl,
    displayedImageUrl,
    candidateUrls,
    filenameHints: options.filenameHints,
    pageTitle: options.pageTitle
  }, actualFormat);

  chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false
  });

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

function getConversionOptions(menuId) {
  if (typeof menuId !== 'string') return null;

  if (menuId.startsWith(MENU_ID_PREFIX)) {
    const format = menuId.substring(MENU_ID_PREFIX.length);
    if (!FORMATS.includes(format)) return null;

    return {
      targetFormat: format,
      preferDisplayedImage: false,
      removePreviewBackground: false
    };
  }

  switch (menuId) {
    case MENU_REMOVE_PREVIEW_BACKGROUND:
      return {
        targetFormat: 'png',
        preferDisplayedImage: true,
        removePreviewBackground: true
      };
    case MENU_ADD_WHITE_BACKGROUND:
      return {
        targetFormat: 'jpg',
        preferDisplayedImage: true,
        removePreviewBackground: true,
        jpgBackground: 'white'
      };
    case MENU_ADD_BLACK_BACKGROUND:
      return {
        targetFormat: 'jpg',
        preferDisplayedImage: true,
        removePreviewBackground: true,
        jpgBackground: 'black'
      };
    default:
      return null;
  }
}

// --- Event Listeners ---

async function syncContextMenusFromStorage() {
  const data = await chrome.storage.local.get({ defaultFormat: 'png' });
  const defaultFormat = FORMATS.includes(data.defaultFormat) ? data.defaultFormat : 'png';
  await createContextMenus(defaultFormat);
}

chrome.runtime.onInstalled.addListener((details) => {
  syncContextMenusFromStorage().then(() => {
    if (details.reason === 'install') {
      return chrome.storage.local.set({
        defaultFormat: 'png',
        jpgQuality: 85,
        conversionCount: 0,
        ratePromptDismissed: false,
        pendingWhatsNewVersion: ''
      });
    }
    if (details.reason === 'update') {
      return chrome.storage.local.set({
        pendingWhatsNewVersion: chrome.runtime.getManifest().version
      });
    }
  }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  syncContextMenusFromStorage().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.action !== 'cacheSourceCandidates') return;

  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number') return;
  if (!message.displayedSrc || !Array.isArray(message.candidates)) return;

  chrome.storage.session.set({
    [getSourceCandidateKey(tabId)]: {
      displayedSrc: message.displayedSrc,
      candidates: message.candidates.slice(0, 12),
      filenameHints: Array.isArray(message.filenameHints) ? message.filenameHints.slice(0, 8) : [],
      capturedAt: Date.now()
    }
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(getSourceCandidateKey(tabId)).catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const options = getConversionOptions(info.menuItemId);
  if (!options) return;

  const displayedImageUrl = info.srcUrl;
  if (!displayedImageUrl) return;

  const sourceContext = await getCachedSourceContext(tab?.id, displayedImageUrl);
  const candidateUrls = buildFetchCandidates(
    displayedImageUrl,
    sourceContext.candidates,
    options.preferDisplayedImage === true
  );

  await convertImage(candidateUrls, {
    ...options,
    filenameHints: sourceContext.filenameHints,
    pageTitle: tab?.title || ''
  }, displayedImageUrl);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.defaultFormat) {
    updateContextMenuLabels(changes.defaultFormat.newValue).catch(() => {});
  }
});
