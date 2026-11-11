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
    grid: { name: 'Grid View', icon: 'grid_view' },
    list: { name: 'List View', icon: 'view_list' }
  };

  // Text size steps: 0 = smallest, 4 = largest
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
  let currentSliderValue = DEFAULT_TEXT_SIZE;

  // ============================================
  // APPLY
  // ============================================
  function loadPreferences() {
    let font = 'inter', layout = 'grid', textSize = DEFAULT_TEXT_SIZE;
    try {
      font     = localStorage.getItem(STORAGE_KEYS.FONT)      || 'inter';
      layout   = localStorage.getItem(STORAGE_KEYS.LAYOUT)    || 'grid';
      const ts = parseInt(localStorage.getItem(STORAGE_KEYS.TEXT_SIZE), 10);
      if (Number.isInteger(ts) && ts >= 0 && ts <= 4) textSize = ts;
    } catch (_) {}
    applyFontFamily(font);
    applyLayout(layout);
    applyTextSize(textSize);
  }

  function applyFontFamily(fontName) {
    if (!FONT_FAMILIES[fontName]) return;
    document.body.style.fontFamily = FONT_FAMILIES[fontName].fontFamily;
    try { localStorage.setItem(STORAGE_KEYS.FONT, fontName); } catch (_) {}
  }

  function applyLayout(layoutName) {
    if (!LAYOUTS[layoutName]) return;
    try { localStorage.setItem(STORAGE_KEYS.LAYOUT, layoutName); } catch (_) {}

    const contentArea = document.getElementById('contentArea');
    if (!contentArea) return;

    contentArea.classList.remove('grid-view', 'list-view');
    contentArea.classList.add(layoutName === 'grid' ? 'grid-view' : 'list-view');

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

    // Apply to root so every rem/em scales proportionally
    document.documentElement.style.setProperty('--text-scale', String(scale));

    // Adjust root font size for anything using rem
    document.documentElement.style.fontSize = `${16 * scale}px`;

    try { localStorage.setItem(STORAGE_KEYS.TEXT_SIZE, String(index)); } catch (_) {}

    currentSliderValue = index;
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

    // Update tick marks
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

    const currentFont = (() => {
      try { return localStorage.getItem(STORAGE_KEYS.FONT) || 'inter'; }
      catch (_) { return 'inter'; }
    })();
    const currentLayout = (() => {
      try { return localStorage.getItem(STORAGE_KEYS.LAYOUT) || 'grid'; }
      catch (_) { return 'grid'; }
    })();
    const currentSize = (() => {
      try {
        const v = parseInt(localStorage.getItem(STORAGE_KEYS.TEXT_SIZE), 10);
        return Number.isInteger(v) && v >= 0 && v <= 4 ? v : DEFAULT_TEXT_SIZE;
      } catch (_) { return DEFAULT_TEXT_SIZE; }
    })();

    let html = '';
    html += '<div class="preferences-menu-header">Preferences</div>';

    // ---- Text size slider (NEW) ----
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

    // Wire up slider
    setupTextSizeSlider(menu, currentSize);

    // Delegate clicks for font/layout rows
    menu.addEventListener('click', onPreferenceClick);
    menu.addEventListener('keydown', onPreferenceKeydown);

    return menu;
  }

  // ============================================
  // TEXT SIZE SLIDER — UI + events
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

    // Click on the track moves the thumb to that position (native range input does this too,
    // but we add smooth feedback via the fill)
    const track = menu.querySelector('.pill-slider-track');
    track?.addEventListener('click', (e) => {
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const value = Math.round(pct * (TEXT_SIZES.length - 1));
      slider.value = String(value);
      applyTextSize(value);
    });

    // Initialize UI to current value
    updateSliderUI(initialValue);
  }

  // ============================================
  // FONT / LAYOUT CLICK HANDLERS (unchanged)
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

    // Don't auto-close — user may still want to adjust text size after
    // (Previously we auto-closed after 300ms; that's now removed for font/layout
    //  so the slider stays accessible. Close only on outside click or ESC.)
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
})();
