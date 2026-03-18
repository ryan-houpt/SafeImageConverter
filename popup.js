/**
 * Safe Image Format Converter — Popup Script
 *
 * Loads current settings from chrome.storage.local on every open.
 * Saves changes immediately. Shows rate prompt after 5 conversions.
 * All user-facing text loaded via chrome.i18n for localization.
 */

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // --- Localize UI text ---
  document.getElementById('header-title').textContent = chrome.i18n.getMessage('headerTitle');
  document.getElementById('format-label').textContent = chrome.i18n.getMessage('defaultFormat');
  document.getElementById('format-group').setAttribute('aria-label', chrome.i18n.getMessage('defaultFormat'));
  document.getElementById('quality-label').textContent = chrome.i18n.getMessage('outputQuality');
  document.getElementById('trust-text').textContent = chrome.i18n.getMessage('trustMessage');
  document.getElementById('rate-text').textContent = chrome.i18n.getMessage('ratePrompt');
  document.getElementById('rate-link').textContent = chrome.i18n.getMessage('rateAction');
  document.getElementById('rate-link').setAttribute('aria-label', chrome.i18n.getMessage('rateAriaLabel'));
  document.getElementById('rate-dismiss').setAttribute('aria-label', chrome.i18n.getMessage('rateDismiss'));

  // Localize format button aria-labels
  const formatButtons = document.querySelectorAll('.format-btn');
  formatButtons.forEach((btn) => {
    const fmt = btn.getAttribute('data-format').toUpperCase();
    btn.setAttribute('aria-label', chrome.i18n.getMessage('setDefaultFormat', [fmt]));
  });

  // Localize quality slider aria-label
  document.getElementById('quality-slider').setAttribute('aria-label', chrome.i18n.getMessage('outputQuality'));

  // --- Load settings ---
  const settings = await chrome.storage.local.get({
    defaultFormat: 'png',
    jpgQuality: 85,
    conversionCount: 0,
    ratePromptDismissed: false
  });

  // --- Format Buttons ---
  setActiveFormat(formatButtons, settings.defaultFormat);

  formatButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const format = btn.getAttribute('data-format');
      setActiveFormat(formatButtons, format);
      chrome.storage.local.set({ defaultFormat: format });
    });
  });

  // --- Quality Slider ---
  const slider = document.getElementById('quality-slider');
  const qualityValue = document.getElementById('quality-value');

  slider.value = settings.jpgQuality;
  qualityValue.textContent = settings.jpgQuality + '%';

  slider.addEventListener('input', () => {
    const val = parseInt(slider.value, 10);
    qualityValue.textContent = val + '%';
    chrome.storage.local.set({ jpgQuality: val });
  });

  // --- Conversion Counter ---
  updateCounter(settings.conversionCount);

  // --- Rate Prompt ---
  const rateSection = document.getElementById('rate-section');
  const rateLink = document.getElementById('rate-link');
  const rateDismiss = document.getElementById('rate-dismiss');

  if (settings.conversionCount >= 5 && !settings.ratePromptDismissed) {
    rateSection.hidden = false;
  }

  rateLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({
      url: `https://chromewebstore.google.com/detail/${chrome.runtime.id}`
    });
  });

  rateDismiss.addEventListener('click', () => {
    rateSection.hidden = true;
    chrome.storage.local.set({ ratePromptDismissed: true });
  });
}

function setActiveFormat(buttons, activeFormat) {
  buttons.forEach((btn) => {
    const isActive = btn.getAttribute('data-format') === activeFormat;
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function updateCounter(count) {
  const counterText = document.getElementById('counter-text');
  const counterSection = document.getElementById('counter-section');

  let label;
  if (count === 1) {
    label = chrome.i18n.getMessage('oneImageConverted');
  } else {
    label = chrome.i18n.getMessage('imagesConverted', [String(count)]);
  }

  counterText.textContent = label;
  counterSection.setAttribute('aria-label', label);
}
