/**
 * Campus Unfolded — User Preferences
 * Font family + card layout + text size slider.
 */

(function () {
  'use strict';

  // ============================================
  // CONFIG
  // ============================================
  const FONT_FAMILIES = {
    inter:    { name: 'Inter',          fontFamily: "'Inter', sans-serif",           icon: 'text_fields' },
    playfair: { name: 'Playfair',       fontFamily: "'Playfair Display', serif",     icon: 'format_quote' },
    dancing:  { name: 'Dancing Script', fontFamily: "'Dancing Script', cursive",     icon: 'brush' },
    roboto:   { name: 'Roboto',         fontFamily: "'Roboto', sans-serif",          icon: 'article' },
    caveat:   { name: 'Caveat',         fontFamily: "'Caveat', cursive",             icon: 'edit' }
  };

  const LAYOUTS = {
    grid:      { name: 'Grid View',      icon: 'grid_view' },
    list:      { name: 'List View',      icon: 'view_list' },
    coverflow: { name: 'Cover Flow',     icon: 'view_carousel' }
};

  const TEXT_SIZES = [
    { value: 0, label: 'Small',   scale: 0.90 },
    { value: 1, label: 'Default', scale: 1.00 },
    { value: 2, label: 'Large',   scale: 1.08 },
    { value: 3, label: 'Larger',  scale: 1.16 },
    { value: 4, label: 'Largest', scale: 1.25 }
  ];
  const DEFAULT_TEXT_SIZE = 1;

  const STORAGE_KEYS = {
    FONT:      'enlighten_font_family',
    LAYOUT:    'enlighten_layout',
    TEXT_SIZE: 'enlighten_text_size'
  };

  const MENU_ID = 'preferencesMenu';
  const CLOSE_DELAY_MS = 300;

  let outsideClickHandler = null;

  // ============================================
  // SAFE localStorage
  // ============================================
  function safeGet(key, fallback) {
    try { return localStorage.getItem(key) || fallback; }
    catch (_) { return fallback; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  // ============================================
  // APPLY
  // ============================================
  function loadPreferences() {
    const font = safeGet(STORAGE_KEYS.FONT, 'inter');
    let layout = safeGet(STORAGE_KEYS.LAYOUT, 'grid');
    // Migration: story view was removed — fall back to grid
    if (layout === 'story') {
        layout = 'grid';
        safeSet(STORAGE_KEYS.LAYOUT, 'grid');
    }
    const ts = parseInt(safeGet(STORAGE_KEYS.TEXT_SIZE, String(DEFAULT_TEXT_SIZE)), 10);
    const textSize = Number.isInteger(ts) && ts >= 0 && ts <= 4 ? ts : DEFAULT_TEXT_SIZE;

    applyFontFamily(font);
    applyLayout(layout);
    applyTextSize(textSize);
  }

  function applyFontFamily(fontName) {
    if (!FONT_FAMILIES[fontName]) return;
    document.body.style.fontFamily = FONT_FAMILIES[fontName].fontFamily;
    safeSet(STORAGE_KEYS.FONT, fontName);
  }

  function applyLayout(layoutName) {
    if (!LAYOUTS[layoutName]) return;
    safeSet(STORAGE_KEYS.LAYOUT, layoutName);

    const contentArea = document.getElementById('contentArea');
    if (!contentArea) return;

    contentArea.classList.remove('grid-view', 'list-view', 'coverflow-view');
const classMap = {
    grid: 'grid-view',
    list: 'list-view',
    coverflow: 'coverflow-view'
};
contentArea.classList.add(classMap[layoutName] || 'grid-view');

// Reset scroll/focus for coverflow
if (layoutName === 'coverflow') {
    contentArea.scrollLeft = 0;
    window.__CU_setCoverflowIndex?.(0);
}

    if (typeof window.__CU_rerenderContent === 'function') {
        window.__CU_rerenderContent();
    }
}

  // ============================================
  // TEXT SIZE
  // ============================================
  function applyTextSize(index) {
    const step = TEXT_SIZES[index] || TEXT_SIZES[DEFAULT_TEXT_SIZE];
    const scale = step.scale;

    document.documentElement.style.setProperty('--text-scale', String(scale));
    document.documentElement.style.fontSize = `${16 * scale}px`;

    safeSet(STORAGE_KEYS.TEXT_SIZE, String(index));
    updateSliderUI(index);
  }

  function updateSliderUI(index) {
    const menu = document.getElementById(MENU_ID);
    if (!menu) return;

    const slider = menu.querySelector('#textSizeSlider');
    const fill   = menu.querySelector('#textSizeFill');
    const label  = menu.querySelector('#textSizeLabel');

    if (slider) {
      const pct = (index / (TEXT_SIZES.length - 1)) * 100;
      slider.value = String(index);
      slider.setAttribute('aria-valuenow', String(index));
      slider.setAttribute('aria-valuetext', TEXT_SIZES[index].label);
      if (fill) fill.style.width = `${pct}%`;
    }
    if (label) label.textContent = TEXT_SIZES[index].label;

    menu.querySelectorAll('.text-size-tick').forEach((tick, i) => {
      tick.classList.toggle('active', i === index);
      tick.classList.toggle('passed', i < index);
    });
  }

  // ============================================
  // MENU
  // ============================================
  function togglePreferencesMenu() {
    let menu = document.getElementById(MENU_ID);
    if (menu) menu.remove();
    menu = createPreferencesMenu();

    menu.classList.add('show');

    setTimeout(() => {
      outsideClickHandler = (e) => {
        const btn = document.querySelector('.preferences-btn');
        if (menu && !menu.contains(e.target) && btn && !btn.contains(e.target)) {
          closePreferencesMenu();
        }
      };
      document.addEventListener('click', outsideClickHandler);
    }, 100);
  }

  function createPreferencesMenu() {
    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.className = 'preferences-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Preferences');

    const currentFont = safeGet(STORAGE_KEYS.FONT, 'inter');
    const currentLayout = safeGet(STORAGE_KEYS.LAYOUT, 'grid');
    const currentSize = (() => {
      const v = parseInt(safeGet(STORAGE_KEYS.TEXT_SIZE, String(DEFAULT_TEXT_SIZE)), 10);
      return Number.isInteger(v) && v >= 0 && v <= 4 ? v : DEFAULT_TEXT_SIZE;
    })();

    let html = '';
html += `
  <div class="preferences-menu-header">
    <span>Preferences</span>
    <button class="preferences-menu-close" id="prefMenuCloseBtn" aria-label="Close preferences" type="button">
      <span class="material-icons">close</span>
    </button>
  </div>
`;

    // ---- Text size slider ----
    html += '<div class="preferences-section-label">Text Size</div>';
    html += renderTextSizeSlider(currentSize);

    html += '<div class="preferences-divider"></div>';

    // ---- Font family ----
    html += '<div class="preferences-section-label">Font Family</div>';
    Object.keys(FONT_FAMILIES).forEach((key) => {
      const font = FONT_FAMILIES[key];
      const isActive = currentFont === key;
      html += `
        <div class="preference-option" role="menuitem"
             data-pref-type="font" data-pref-value="${key}"
             tabindex="0">
          <span class="material-icons preference-icon" aria-hidden="true">${font.icon}</span>
          <span class="preference-text">${font.name}</span>
          ${isActive ? '<span class="material-icons preference-check" aria-hidden="true">check</span>' : ''}
        </div>
      `;
    });

    html += '<div class="preferences-divider"></div>';

    // ---- Card layout ----
    html += '<div class="preferences-section-label">Card Layout</div>';
    Object.keys(LAYOUTS).forEach((key) => {
      const layout = LAYOUTS[key];
      const isActive = currentLayout === key;
      html += `
        <div class="preference-option" role="menuitem"
             data-pref-type="layout" data-pref-value="${key}"
             tabindex="0">
          <span class="material-icons preference-icon" aria-hidden="true">${layout.icon}</span>
          <span class="preference-text">${layout.name}</span>
          ${isActive ? '<span class="material-icons preference-check" aria-hidden="true">check</span>' : ''}
        </div>
      `;
    });

    menu.innerHTML = html;
document.body.appendChild(menu);

setupTextSizeSlider(menu, currentSize);

menu.addEventListener('click', onPreferenceClick);
menu.addEventListener('keydown', onPreferenceKeydown);

// Wire up close button
const closeBtn = menu.querySelector('#prefMenuCloseBtn');
if (closeBtn) {
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closePreferencesMenu();
  });
}

return menu;
  }

  // ============================================
  // TEXT SIZE SLIDER
  // ============================================
  function renderTextSizeSlider(index) {
    const pct = (index / (TEXT_SIZES.length - 1)) * 100;
    const label = TEXT_SIZES[index].label;
    const ticks = TEXT_SIZES.map((t, i) => `
      <span class="text-size-tick ${i === index ? 'active' : ''} ${i < index ? 'passed' : ''}"
            aria-hidden="true"></span>
    `).join('');

    return `
      <div class="text-size-control">
        <div class="text-size-header">
          <span class="material-icons" aria-hidden="true">text_fields</span>
          <span class="text-size-label" id="textSizeLabel">${label}</span>
        </div>

        <div class="pill-slider-wrap">
          <div class="pill-slider-track" aria-hidden="true">
            <div class="pill-slider-fill" id="textSizeFill" style="width: ${pct}%;"></div>
          </div>
          <input
            type="range"
            id="textSizeSlider"
            class="pill-slider-input"
            min="0"
            max="${TEXT_SIZES.length - 1}"
            step="1"
            value="${index}"
            aria-label="Text size"
            aria-valuemin="0"
            aria-valuemax="${TEXT_SIZES.length - 1}"
            aria-valuenow="${index}"
            aria-valuetext="${label}">
        </div>

        <div class="text-size-ticks" aria-hidden="true">
          ${ticks}
        </div>
      </div>
    `;
  }

  function setupTextSizeSlider(menu, initialValue) {
    const slider = menu.querySelector('#textSizeSlider');
    if (!slider) return;

    let rafId = null;
    const onInput = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const value = parseInt(slider.value, 10);
        if (!Number.isInteger(value)) return;
        applyTextSize(value);
      });
    };

    slider.addEventListener('input', onInput);
    slider.addEventListener('change', onInput);

    const track = menu.querySelector('.pill-slider-track');
    track?.addEventListener('click', (e) => {
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const value = Math.round(pct * (TEXT_SIZES.length - 1));
      slider.value = String(value);
      applyTextSize(value);
    });

    updateSliderUI(initialValue);
  }

  // ============================================
  // FONT / LAYOUT CLICK HANDLERS
  // ============================================
  function onPreferenceClick(e) {
    const row = e.target.closest('.preference-option');
    if (!row) return;
    applyPreference(row);
  }

  function onPreferenceKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.preference-option');
    if (!row) return;
    e.preventDefault();
    applyPreference(row);
  }

  function applyPreference(row) {
    const type = row.dataset.prefType;
    const value = row.dataset.prefValue;
    if (!type || !value) return;

    if (type === 'font') applyFontFamily(value);
    if (type === 'layout') applyLayout(value);

    const menu = document.getElementById(MENU_ID);
    if (menu) {
      menu.querySelectorAll('.preference-option').forEach((el) => {
        if (el.dataset.prefType === type) {
          el.querySelector('.preference-check')?.remove();
        }
      });
      const check = document.createElement('span');
      check.className = 'material-icons preference-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = 'check';
      row.appendChild(check);
    }
  }

  function closePreferencesMenu() {
    const menu = document.getElementById(MENU_ID);
    if (menu) menu.classList.remove('show');
    if (outsideClickHandler) {
      document.removeEventListener('click', outsideClickHandler);
      outsideClickHandler = null;
    }
  }

  // ============================================
  // BOOT
  // ============================================
  document.addEventListener('DOMContentLoaded', loadPreferences);

  // ============================================
  // GLOBAL HANDLES
  // ============================================
  window.togglePreferencesMenu = togglePreferencesMenu;
  window.closePreferencesMenu = closePreferencesMenu;
  window.selectFontFamily = (value) => {
    applyFontFamily(value);
    setTimeout(closePreferencesMenu, CLOSE_DELAY_MS);
  };
  window.selectLayout = (value) => {
    applyLayout(value);
    setTimeout(closePreferencesMenu, CLOSE_DELAY_MS);
  };

  console.log('[Preferences] Loaded — togglePreferencesMenu available:', typeof window.togglePreferencesMenu);
})();
