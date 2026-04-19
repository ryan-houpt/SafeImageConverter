/**
 * Safe Image Format Converter — Popup Script
 *
 * Loads current settings from chrome.storage.local on every open.
 * Saves changes immediately. Shows rate prompt after 5 conversions.
 * All user-facing text loaded via chrome.i18n for localization.
 */

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const currentVersion = chrome.runtime.getManifest().version;

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
  document.getElementById('whats-new-kicker').textContent = chrome.i18n.getMessage('whatsNewKicker');
  document.getElementById('whats-new-title').textContent = chrome.i18n.getMessage('whatsNewTitle');
  document.getElementById('whats-new-body').textContent = chrome.i18n.getMessage('whatsNewBody');
  document.getElementById('whats-new-dismiss').setAttribute('aria-label', chrome.i18n.getMessage('whatsNewDismiss'));

  const formatButtons = document.querySelectorAll('.format-btn[data-format]');
  formatButtons.forEach((btn) => {
    const format = btn.getAttribute('data-format').toUpperCase();
    btn.setAttribute('aria-label', chrome.i18n.getMessage('setDefaultFormat', [format]));
  });

  document.getElementById('quality-slider').setAttribute('aria-label', chrome.i18n.getMessage('outputQuality'));

  // --- Load settings ---
  const settings = await chrome.storage.local.get({
    defaultFormat: 'png',
    jpgQuality: 85,
    conversionCount: 0,
    ratePromptDismissed: false,
    pendingWhatsNewVersion: ''
  });

  // --- Format Buttons ---
  setActiveButtons(formatButtons, settings.defaultFormat, 'data-format');

  formatButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const format = btn.getAttribute('data-format');
      setActiveButtons(formatButtons, format, 'data-format');
      await chrome.storage.local.set({ defaultFormat: format });
    });
  });

  // --- Quality Slider ---
  const slider = document.getElementById('quality-slider');
  const qualityValue = document.getElementById('quality-value');

  slider.value = settings.jpgQuality;
  qualityValue.textContent = settings.jpgQuality + '%';

  slider.addEventListener('input', async () => {
    const value = parseInt(slider.value, 10);
    qualityValue.textContent = value + '%';
    await chrome.storage.local.set({ jpgQuality: value });
  });

  // --- What's New ---
  const whatsNewSection = document.getElementById('whats-new-section');
  const whatsNewDismiss = document.getElementById('whats-new-dismiss');

  if (settings.pendingWhatsNewVersion === currentVersion) {
    whatsNewSection.hidden = false;
  }

  whatsNewDismiss.addEventListener('click', async () => {
    whatsNewSection.hidden = true;
    await chrome.storage.local.set({ pendingWhatsNewVersion: '' });
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

  rateLink.addEventListener('click', (event) => {
    event.preventDefault();
    chrome.tabs.create({
      url: `https://chromewebstore.google.com/detail/${chrome.runtime.id}`
    });
  });

  rateDismiss.addEventListener('click', async () => {
    rateSection.hidden = true;
    await chrome.storage.local.set({ ratePromptDismissed: true });
  });
}

function setActiveButtons(buttons, activeValue, attributeName) {
  buttons.forEach((btn) => {
    const isActive = btn.getAttribute(attributeName) === activeValue;
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
