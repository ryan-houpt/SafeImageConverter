const SOURCE_QUERY_PARAM_NAMES = [
  'imgurl',
  'mediaurl',
  'image_url',
  'imageurl',
  'img',
  'src',
  'url'
];

const IMAGE_ATTRIBUTE_NAMES = [
  'src',
  'currentSrc',
  'srcset',
  'data-src',
  'data-original',
  'data-lazy-src',
  'data-image',
  'data-image-src',
  'data-full',
  'data-full-url',
  'data-url',
  'data-iurl'
];

const FILENAME_HINT_ATTRIBUTE_NAMES = [
  'alt',
  'title',
  'aria-label',
  'data-title',
  'data-name',
  'data-image-title'
];

document.addEventListener('contextmenu', handleContextMenu, true);

function handleContextMenu(event) {
  const image = findImageElement(event);
  if (!image) return;

  const displayedSrc = image.currentSrc || image.src;
  if (!displayedSrc) return;

  const candidates = collectSourceCandidates(image, displayedSrc);
  if (candidates.length === 0) return;

  chrome.runtime.sendMessage({
    action: 'cacheSourceCandidates',
    displayedSrc: displayedSrc,
    candidates: candidates,
    filenameHints: collectFilenameHints(image)
  }).catch(() => {});
}

function findImageElement(event) {
  if (typeof event.composedPath === 'function') {
    for (const node of event.composedPath()) {
      if (node instanceof HTMLImageElement) return node;
    }
  }

  if (event.target instanceof HTMLImageElement) return event.target;
  if (event.target && typeof event.target.closest === 'function') {
    return event.target.closest('img');
  }
  return null;
}

function collectSourceCandidates(image, displayedSrc) {
  const candidates = [];
  const seen = new Set();

  function pushCandidate(value) {
    const normalized = normalizeCandidateUrl(value, image.baseURI || document.baseURI);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  }

  pushCandidate(displayedSrc);

  for (const attributeName of IMAGE_ATTRIBUTE_NAMES) {
    const value = attributeName === 'currentSrc'
      ? image.currentSrc
      : image.getAttribute(attributeName);

    if (!value) continue;

    if (attributeName === 'srcset') {
      for (const candidate of parseSrcset(value)) {
        pushCandidate(candidate);
      }
      continue;
    }

    pushCandidate(value);
  }

  const link = image.closest('a[href]');
  if (link) {
    for (const candidate of extractLinkCandidates(link)) {
      pushCandidate(candidate);
    }
  }

  return candidates;
}

function collectFilenameHints(image) {
  const hints = [];
  const seen = new Set();

  function pushHint(value) {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    hints.push(trimmed);
  }

  for (const attributeName of FILENAME_HINT_ATTRIBUTE_NAMES) {
    pushHint(image.getAttribute(attributeName));
  }

  const link = image.closest('a[href]');
  if (link) {
    pushHint(link.getAttribute('download'));
    pushHint(link.getAttribute('title'));
    pushHint(link.getAttribute('aria-label'));
  }

  return hints.slice(0, 8);
}

function extractLinkCandidates(link) {
  const candidates = [];
  const href = link.getAttribute('href');
  if (!href) return candidates;

  const resolvedHref = normalizeCandidateUrl(href, document.baseURI);
  if (resolvedHref && looksDirectImageUrl(resolvedHref)) {
    candidates.push(resolvedHref);
  }

  try {
    const url = new URL(href, document.baseURI);

    for (const paramName of SOURCE_QUERY_PARAM_NAMES) {
      const value = url.searchParams.get(paramName);
      if (value) {
        candidates.push(value);
      }
    }

    for (const [, value] of url.searchParams) {
      if (looksLikeUrl(value)) {
        candidates.push(value);
      }
    }
  } catch {
    // Ignore malformed hrefs.
  }

  return candidates;
}

function parseSrcset(srcset) {
  return srcset
    .split(',')
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function normalizeCandidateUrl(value, baseUrl) {
  if (!value) return null;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed === 'about:blank') return null;

  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('file:')) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.href;
    }
  } catch {
    return null;
  }

  return null;
}

function looksLikeUrl(value) {
  return typeof value === 'string' && /^(https?:)?\/\//i.test(value);
}

function looksDirectImageUrl(value) {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    return /\.(png|jpe?g|webp|gif|bmp|avif|svg)(?:$|[?#])/i.test(pathname);
  } catch {
    return false;
  }
}
