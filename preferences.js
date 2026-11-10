/**
 * Campus Unfolded — User Preferences
 * Font family + card layout.
 * Theme-aware menu, single source of truth, no inline styles.
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

  const STORAGE_KEYS = {
    FONT: 'enlighten_font_family',
    LAYOUT: 'enlighten_layout'
  };

  const MENU_ID = 'preferencesMenu';
  const CLOSE_DELAY_MS = 300;

  let outsideClickHandler = null;

  // ============================================
  // APPLY
  // ============================================
  function loadPreferences() {
    let font = 'inter';
    let layout = 'grid';
    try {
      font = localStorage.getItem(STORAGE_KEYS.FONT) || 'inter';
      layout = localStorage.getItem(STORAGE_KEYS.LAYOUT) || 'grid';
    } catch (_) {}
    applyFontFamily(font);
    applyLayout(layout);
  }

  function applyFontFamily(fontName) {
    if (!FONT_FAMILIES[fontName]) return;
    document.body.style.fontFamily = FONT_FAMILIES[fontName].fontFamily;
    try {
      localStorage.setItem(STORAGE_KEYS.FONT, fontName);
    } catch (_) {}
  }

  function applyLayout(layoutName) {
    if (!LAYOUTS[layoutName]) return;
    try {
      localStorage.setItem(STORAGE_KEYS.LAYOUT, layoutName);
    } catch (_) {}

    const contentArea = document.getElementById('contentArea');
    if (!contentArea) return;

    contentArea.classList.remove('grid-view', 'list-view');
    contentArea.classList.add(layoutName === 'grid' ? 'grid-view' : 'list-view');

    // Re-render current cards using dashboard.js's exposed helper.
    // Falls back to a no-op if dashboard hasn't finished loading.
    if (typeof window.__CU_rerenderContent === 'function') {
      window.__CU_rerenderContent();
    }
  }

  // ============================================
  // MENU
  // ============================================
  function togglePreferencesMenu() {
    let menu = document.getElementById(MENU_ID);

    // Rebuild every time — guarantees checkmarks match current state
    if (menu) menu.remove();
    menu = createPreferencesMenu();

    menu.classList.add('show');

    // Defer attaching the outside-click so this click doesn't close it
    setTimeout(() => {
      outsideClickHandler = (e) => {
        const btn = document.querySelector('.preferences-btn');
        if (
          menu && !menu.contains(e.target) &&
          btn && !btn.contains(e.target)
        ) {
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

    let html = '';
    html += '<div class="preferences-menu-header">Preferences</div>';
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

    // Delegate clicks — one listener, works for dynamically-built rows
    menu.addEventListener('click', onPreferenceClick);
    menu.addEventListener('keydown', onPreferenceKeydown);

    return menu;
  }

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

    // Update checkmarks in-place — no menu rebuild needed
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

    // Small delay so the checkmark is visible before closing
    setTimeout(closePreferencesMenu, CLOSE_DELAY_MS);
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
  // GLOBAL HANDLES (used from HTML inline)
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
