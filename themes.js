/**
 * Campus Unfolded — Theme Management
 * 6 themes, theme-aware meta color, no listener leaks, keyboard-navigable.
 */

(function () {
  'use strict';

  // ============================================
  // CONFIG
  // ============================================
  const THEMES = {
    default:  { name: 'Enlighten Classic', icon: 'light_mode',  meta: '#DFDDD3' },
    midnight: { name: 'Midnight Blue',     icon: 'dark_mode',   meta: '#0a0d19' },
    forest:   { name: 'Forest Green',      icon: 'forest',      meta: '#111714' },
    sunset:   { name: 'Sunset Orange',     icon: 'wb_twilight', meta: '#140f0d' },
    ocean:    { name: 'Ocean Blue',        icon: 'waves',       meta: '#e3f2fd' },
    dark:     { name: 'Dark Mode',         icon: 'bedtime',     meta: '#121212' }
  };

  const STORAGE_KEY = 'enlighten_theme';
  const MENU_ID = 'themeMenu';
  const CLOSE_DELAY_MS = 300;

  let outsideClickHandler = null;

  // ============================================
  // APPLY
  // ============================================
  function getActiveTheme() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr && THEMES[attr]) return attr;
    return 'default';
  }

  function loadTheme() {
    let saved = 'default';
    try {
      saved = localStorage.getItem(STORAGE_KEY) || 'default';
    } catch (_) {}
    if (!THEMES[saved]) saved = 'default';
    applyTheme(saved);
  }

  function applyTheme(themeName) {
    if (!THEMES[themeName]) return;

    document.documentElement.setAttribute('data-theme', themeName);

    try {
      localStorage.setItem(STORAGE_KEY, themeName);
    } catch (_) {}

    updateThemeIcon(themeName);
    updateMetaThemeColor(themeName);
  }

  function updateThemeIcon(themeName) {
    const icon = document.getElementById('themeIcon');
    if (icon && THEMES[themeName]) {
      icon.textContent = THEMES[themeName].icon;
    }
  }

  function updateMetaThemeColor(themeName) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    // Use the pre-defined meta color per theme — reliable across gradient backgrounds
    meta.setAttribute('content', THEMES[themeName].meta);
  }

  // ============================================
  // MENU
  // ============================================
  function toggleThemeMenu() {
    let menu = document.getElementById(MENU_ID);

    // Rebuild every time — checkmarks always match current theme
    if (menu) menu.remove();
    menu = createThemeMenu();

    menu.classList.add('show');

    // Focus first item for keyboard users
    const firstItem = menu.querySelector('.theme-option');
    firstItem?.focus({ preventScroll: true });

    // Defer outside-click attach so this click doesn't close it immediately
    setTimeout(() => {
      outsideClickHandler = (e) => {
        const btn = document.querySelector('.theme-btn');
        if (
          menu && !menu.contains(e.target) &&
          btn && !btn.contains(e.target)
        ) {
          closeThemeMenu();
        }
      };
      document.addEventListener('click', outsideClickHandler);
    }, 100);
  }

  function createThemeMenu() {
    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.className = 'theme-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Theme selector');

    const currentTheme = getActiveTheme();

    let html = '<div class="theme-menu-header">Choose Theme</div>';

    Object.keys(THEMES).forEach((key) => {
      const theme = THEMES[key];
      const isActive = currentTheme === key;
      html += `
        <div class="theme-option" role="menuitem"
             data-theme-key="${key}"
             tabindex="${isActive ? '0' : '-1'}">
          <span class="material-icons theme-option-icon" aria-hidden="true">${theme.icon}</span>
          <span class="theme-option-text">${theme.name}</span>
          ${isActive ? '<span class="material-icons theme-check" aria-hidden="true">check</span>' : ''}
        </div>
      `;
    });

    menu.innerHTML = html;
    document.body.appendChild(menu);

    // Event delegation — works for dynamically-built rows, one listener
    menu.addEventListener('click', onThemeClick);
    menu.addEventListener('keydown', onThemeKeydown);

    return menu;
  }

  function onThemeClick(e) {
    const row = e.target.closest('.theme-option');
    if (!row) return;
    applyThemeFromRow(row);
  }

  function onThemeKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.theme-option');
    if (!row) return;
    e.preventDefault();
    applyThemeFromRow(row);
  }

  function applyThemeFromRow(row) {
    const key = row.dataset.themeKey;
    if (!key || !THEMES[key]) return;

    applyTheme(key);

    // Update checkmarks in-place — no menu rebuild
    const menu = document.getElementById(MENU_ID);
    if (menu) {
      menu.querySelectorAll('.theme-option').forEach((el) => {
        el.querySelector('.theme-check')?.remove();
      });
      const check = document.createElement('span');
      check.className = 'material-icons theme-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = 'check';
      row.appendChild(check);
    }

    // Small delay so the checkmark is visible before closing
    setTimeout(closeThemeMenu, CLOSE_DELAY_MS);
  }

  function closeThemeMenu() {
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
  document.addEventListener('DOMContentLoaded', loadTheme);

  // ============================================
  // GLOBAL HANDLES (used from HTML inline)
  // ============================================
  window.toggleThemeMenu = toggleThemeMenu;
  window.closeThemeMenu = closeThemeMenu;
  window.applyTheme = applyTheme;
})();
