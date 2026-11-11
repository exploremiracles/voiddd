/**
 * Campus Unfolded — Live Presence
 * Shows students currently studying the SAME CLASS as the viewer.
 *
 * Design goals:
 * - One doc per user (presence/{uid})
 * - Auto-refreshes "lastSeen" every 30s while the tab is visible
 * - Cleans up on unload / logout / tab hidden for >2min
 * - Filters by currently selected class (from dashboard.js)
 * - Graceful when dashboard isn't ready yet
 */

(function () {
  'use strict';

  const COLLECTION = 'presence';
  const HEARTBEAT_MS = 30000;          // refresh lastSeen every 30s
  const STALE_MS = 90000;              // consider offline after 90s without heartbeat
  const REFRESH_LIST_MS = 15000;       // re-sort/refresh dropdown every 15s
  const AVATAR_LIMIT = 4;
  const PALETTE = [
    '#5a745f', '#7c9c6b', '#c98a5b', '#c96b8d',
    '#6b8fc9', '#8a6bc9', '#c9b56b', '#5b98a3',
    '#8a5b98', '#6bc98a', '#c96b6b', '#6b7bc9'
  ];

  // ============================================
  // STATE
  // ============================================
  let currentUserId = null;
  let currentUserName = '';
  let currentClass = null;
  let isReady = false;
  let heartbeatTimer = null;
  let listRefreshTimer = null;
  let presenceUnsub = null;
  let dropdownOpen = false;
  let latestPresence = [];             // [{userId, name, class, lastSeen, email}]
  let lastKnownSelectedClass = null;

  const $ = (id) => document.getElementById(id);

  // ============================================
  // HELPERS
  // ============================================
  function colorFor(seed) {
    let hash = 0;
    const str = String(seed || '');
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return PALETTE[Math.abs(hash) % PALETTE.length];
  }

  function initialFor(name) {
    if (!name) return '?';
    const cleaned = String(name).trim();
    if (!cleaned) return '?';
    // Skip leading emojis / spaces; grab first letter/digit
    const match = cleaned.match(/[A-Za-z0-9]/);
    return match ? match[0].toUpperCase() : cleaned.charAt(0).toUpperCase();
  }

  function relativeTime(ts) {
    if (!ts) return 'just now';
    const ms = ts.toMillis ? ts.toMillis() : (ts instanceof Date ? ts.getTime() : Number(ts));
    if (!ms) return 'just now';
    const sec = Math.floor((Date.now() - ms) / 1000);
    if (sec < 20) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    return `${hr}h ago`;
  }

  function isStale(lastSeen) {
    if (!lastSeen) return true;
    const ms = lastSeen.toMillis ? lastSeen.toMillis() : (lastSeen instanceof Date ? lastSeen.getTime() : Number(lastSeen));
    return Date.now() - ms > STALE_MS;
  }

  function getSelectedClass() {
    // Prefer dashboard getter (authoritative)
    if (typeof window.__CU_getSelectedClass === 'function') {
      return window.__CU_getSelectedClass();
    }
    // Fallback: active class chip
    const activeChip = document.querySelector('.class-chips .chip.active');
    if (activeChip) return activeChip.dataset.class || activeChip.textContent.trim();
    return null;
  }

  // ============================================
  // INIT
  // ============================================
  async function init() {
    await new Promise((resolve) => {
      if (typeof window.onUserReady === 'function') {
        window.onUserReady(resolve);
      } else {
        const t0 = Date.now();
        const tick = setInterval(() => {
          if (auth.currentUser) { clearInterval(tick); resolve(); }
          else if (Date.now() - t0 > 10000) { clearInterval(tick); resolve(); }
        }, 150);
      }
    });

    const user = auth.currentUser;
    if (!user) return;

    currentUserId = user.uid;
    const cu = typeof window.__CU_getUser === 'function' ? window.__CU_getUser() : null;
    currentUserName = (cu && cu.displayName) || user.displayName || (user.email || '').split('@')[0] || 'Student';

    isReady = true;

    // Wait for the user to pick a class before showing anything
    lastKnownSelectedClass = getSelectedClass();
    if (lastKnownSelectedClass) {
      await joinPresence(lastKnownSelectedClass);
    }

    // Watch class chip changes so we can update presence when class switches
    watchClassChipChanges();

    // Cleanup listeners
    window.addEventListener('beforeunload', leavePresence);
    window.addEventListener('pagehide', leavePresence);
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Auth sign out → delete presence
    auth.onAuthStateChanged((u) => {
      if (!u) leavePresence();
    });

    // Auto-refresh relative times in dropdown
    listRefreshTimer = setInterval(() => {
      if (dropdownOpen) renderList();
    }, REFRESH_LIST_MS);
  }

  function watchClassChipChanges() {
    const chipsContainer = document.querySelector('.class-chips');
    if (!chipsContainer) return;

    // Poll for active class every second (cheap, avoids MutationObserver noise)
    setInterval(() => {
      const cls = getSelectedClass();
      if (cls && cls !== lastKnownSelectedClass) {
        lastKnownSelectedClass = cls;
        joinPresence(cls);
      } else if (!cls && lastKnownSelectedClass) {
        // Class deselected — leave presence
        lastKnownSelectedClass = null;
        leavePresence();
      }
    }, 1000);
  }

  // ============================================
  // JOIN / LEAVE / HEARTBEAT
  // ============================================
  async function joinPresence(className) {
    if (!isReady || !currentUserId || !className) return;
    currentClass = className;

    // Ensure we're subscribed (once)
    if (!presenceUnsub) subscribeToPresence();

    await writePresence();

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (document.visibilityState === 'visible') writePresence();
    }, HEARTBEAT_MS);
  }

  async function writePresence() {
    if (!currentUserId || !currentClass) return;
    try {
      await db.collection(COLLECTION).doc(currentUserId).set({
        userId: currentUserId,
        name: currentUserName,
        class: currentClass,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (err) {
      if (err.code !== 'permission-denied') {
        console.warn('[Presence] Write failed:', err.code);
      }
    }
  }

  async function leavePresence() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (!currentUserId) return;
    try {
      await db.collection(COLLECTION).doc(currentUserId).delete();
    } catch (_) {}
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      writePresence();
    }
  }

  // ============================================
  // SUBSCRIBE
  // ============================================
  function subscribeToPresence() {
    presenceUnsub = db.collection(COLLECTION)
      .onSnapshot((snap) => {
        const docs = [];
        snap.forEach((doc) => {
          const data = doc.data();
          if (!data || !data.userId) return;
          if (isStale(data.lastSeen)) return;
          docs.push(data);
        });
        latestPresence = docs;
        renderWidget();
      }, (err) => {
        if (err.code !== 'permission-denied') {
          console.warn('[Presence] Subscribe error:', err.code);
        }
      });
  }

  // ============================================
  // RENDER
  // ============================================
  function filteredForCurrentClass() {
    const cls = lastKnownSelectedClass;
    if (!cls) return [];
    return latestPresence
      .filter((p) => p.class === cls)
      .sort((a, b) => {
        // Current user always first
        if (a.userId === currentUserId) return -1;
        if (b.userId === currentUserId) return 1;
        const ta = a.lastSeen?.toMillis?.() || 0;
        const tb = b.lastSeen?.toMillis?.() || 0;
        return tb - ta;
      });
  }

  function renderWidget() {
    const widget = $('presenceWidget');
    if (!widget) return;

    const list = filteredForCurrentClass();
    const count = list.length;

    // Hide if no class selected
    if (!lastKnownSelectedClass) {
      widget.hidden = true;
      return;
    }

    // Always show if there's at least the current user OR someone else
    if (count === 0) {
      widget.hidden = true;
      return;
    }

    widget.hidden = false;

    // Avatars
    const avatarsEl = $('presenceAvatars');
    const countEl = $('presenceCount');

    const shown = list.slice(0, AVATAR_LIMIT);
    const extra = count - shown.length;

    let avatarHtml = '';
    shown.forEach((p) => {
      const initial = initialFor(p.name);
      const color = colorFor(p.userId || p.name);
      avatarHtml += `<div class="presence-avatar" style="background:${color}" title="${escapeHtml(p.name)}">${initial}</div>`;
    });
    if (extra > 0) {
      avatarHtml += `<div class="presence-avatar presence-avatar-more">+${extra}</div>`;
    }
    avatarsEl.innerHTML = avatarHtml;

    // Count text
    const youIncluded = list.some((p) => p.userId === currentUserId);
    let text;
    if (count === 1 && youIncluded) text = 'You studying';
    else if (count === 1) text = '1 studying';
    else if (youIncluded) text = `You + ${count - 1} studying`;
    else text = `${count} studying`;
    countEl.textContent = text;

    // Header
    const headerEl = $('presenceHeaderText');
    if (headerEl) {
      headerEl.textContent = `Studying ${lastKnownSelectedClass} — ${count} online`;
    }

    // Render list if dropdown is open
    if (dropdownOpen) renderList();
  }

  function renderList() {
    const listEl = $('presenceList');
    if (!listEl) return;

    const list = filteredForCurrentClass();

    if (!list.length) {
      listEl.innerHTML = `
        <div class="presence-empty">
          <span class="material-icons">group_off</span>
          No one else is studying ${escapeHtml(lastKnownSelectedClass || '')} right now.
        </div>
      `;
      return;
    }

    const html = list.map((p) => {
      const initial = initialFor(p.name);
      const color = colorFor(p.userId || p.name);
      const isYou = p.userId === currentUserId;
      const time = relativeTime(p.lastSeen);
      return `
        <div class="presence-list-item">
          <div class="presence-list-avatar" style="background:${color}">${initial}</div>
          <div class="presence-list-info">
            <div class="presence-list-name">
              ${escapeHtml(p.name || 'Student')}
              ${isYou ? '<span class="presence-list-you">You</span>' : ''}
            </div>
            <div class="presence-list-time">${time}</div>
          </div>
        </div>
      `;
    }).join('');

    listEl.innerHTML = html;
  }

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  // ============================================
  // DROPDOWN
  // ============================================
  function openDropdown() {
    const dd = $('presenceDropdown');
    const pill = $('presencePill');
    if (!dd || !pill) return;
    dropdownOpen = true;
    dd.classList.add('open');
    pill.setAttribute('aria-expanded', 'true');
    renderList();
  }

  function closeDropdown() {
    const dd = $('presenceDropdown');
    const pill = $('presencePill');
    if (!dd || !pill) return;
    dropdownOpen = false;
    dd.classList.remove('open');
    pill.setAttribute('aria-expanded', 'false');
  }

  function toggleDropdown() {
    if (dropdownOpen) closeDropdown();
    else openDropdown();
  }

  function setupDropdownHandlers() {
    const pill = $('presencePill');
    const dd = $('presenceDropdown');
    if (!pill || !dd) return;

    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });

    document.addEventListener('click', (e) => {
      if (!dropdownOpen) return;
      const widget = $('presenceWidget');
      if (widget && !widget.contains(e.target)) {
        closeDropdown();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dropdownOpen) closeDropdown();
    });
  }

  // ============================================
  // BOOT
  // ============================================
  function boot() {
    // Wire up click handlers first (they exist even before user is ready)
    setupDropdownHandlers();
    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Expose for debugging / external calls
  window.__CU_presence = {
    refresh: writePresence,
    getCount: () => filteredForCurrentClass().length,
    leave: leavePresence
  };
})();
