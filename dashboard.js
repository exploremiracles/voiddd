/**
 * Campus Unfolded — Dashboard
 *
 * Security model:
 * - Auth state is verified via Firebase onAuthStateChanged (never trusted from localStorage)
 * - Whitelist is re-read from Firestore on every page load
 * - Live onSnapshot listener detects revocation in real time
 * - Permission-denied errors on any read = fail closed, show revoked dialog
 * - LocalStorage session is DISPLAY ONLY. It is never a security boundary.
 */

(function () {
  'use strict';

  // ============================================
  // CONFIG
  // ============================================
  const CONFIG = Object.freeze({
    COLLECTIONS: {
      WHITELIST: 'whitelist',
      VIDEOS: 'videos',
      PDFS: 'pdfs',
      IMAGES: 'images',
      POSTS: 'posts'
    },
    STORAGE: {
      THEME: 'enlighten_theme',
      SESSION: 'session',
      SW_RELOADED: 'cu_sw_reloaded'
    },
    ROUTES: { LOGIN: 'index.html' },
    PAGE_SIZE: 5,
    DISPLAY_SESSION_HINT_MS: 2 * 60 * 60 * 1000,
    AUTH_GATE_MIN_MS: 2200
  });

  const TABS = ['videos', 'pdfs', 'images', 'posts'];

  // ============================================
  // STATE
  // ============================================
  let currentUser = null;
  let currentTab = 'videos';
  let selectedClass = null;
  let selectedSubject = null;
  let cachedData = [];
  let displayedCount = 0;
  let currentImageUrl = '';
  let currentImageTitle = '';
  let deferredPrompt = null;
  let whitelistUnsubscribe = null;
  let listenerEmail = null;
  let subjectCache = {};
  let isUserReady = false;
  const readyCallbacks = [];
  let classLoadToken = 0;
  let contentLoadToken = 0;
  let coverflowIndex = 0;
  let authGateStartedAt = 0;

  // ============================================
  // UTIL
  // ============================================
  const $ = (id) => document.getElementById(id);

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  function escapeAttr(text) {
    if (text == null) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function onUserReady(callback) {
    if (isUserReady) return callback();
    readyCallbacks.push(callback);
  }

  function markUserReady() {
    isUserReady = true;
    readyCallbacks.splice(0).forEach((cb) => {
      try { cb(); } catch (err) { console.warn('ready cb error', err); }
    });
  }

  // ============================================
  // AUTH GATE ANIMATION
  // ============================================
  function startAuthGateAnimation() {
    authGateStartedAt = Date.now();

    const statusEl = $('authGateStatus');
    const progressBar = $('authGateProgressBar');
    if (!statusEl && !progressBar) return;

    const STAGES = [
      { text: 'Verifying your access', delay: 0,    progress: 20 },
      { text: 'Checking permissions',  delay: 500,  progress: 45 },
      { text: 'Loading your content',  delay: 1000, progress: 70 },
      { text: 'Almost ready',          delay: 1500, progress: 90 }
    ];

    STAGES.forEach(({ text, delay, progress }) => {
      setTimeout(() => {
        if (statusEl) statusEl.textContent = text;
        if (progressBar) progressBar.style.width = `${progress}%`;
      }, delay);
    });
  }

  // ============================================
  // AUTH GATE
  // ============================================
  function hideAuthGate() {
    const gate = $('authGate')
      || document.querySelector('.page-transition.active')
      || $('campusLoader');

    $('dashboardRoot')?.removeAttribute('hidden');
    document.body.style.overflow = 'auto';

    if (!gate) return;

    // Ensure the animation has had at least AUTH_GATE_MIN_MS
    const elapsed = Date.now() - authGateStartedAt;
    const remaining = Math.max(0, CONFIG.AUTH_GATE_MIN_MS - elapsed);

    setTimeout(() => {
      // Snap progress to 100%
      const progressBar = $('authGateProgressBar');
      const statusEl = $('authGateStatus');
      if (progressBar) progressBar.style.width = '100%';
      if (statusEl) statusEl.textContent = 'Welcome back!';

      // Exit animation
      setTimeout(() => {
        gate.classList.add('exiting');
        setTimeout(() => {
          gate.classList.remove('active');
          gate.classList.remove('exiting');
          gate.style.display = 'none';
        }, 500);
      }, 250);
    }, remaining);
  }

  function failClosed(message, reason) {
    if (message) {
      try { alert(message); } catch (_) {}
    }
    try { localStorage.removeItem(CONFIG.STORAGE.SESSION); } catch (_) {}
    auth.signOut().catch(() => {}).finally(() => {
      window.location.replace(CONFIG.ROUTES.LOGIN);
    });
    if (reason) console.warn('[Gate]', reason);
  }

  // ============================================
  // SESSION (DISPLAY ONLY)
  // ============================================
  function saveSession(data) {
    try { localStorage.setItem(CONFIG.STORAGE.SESSION, JSON.stringify(data)); } catch (_) {}
  }

  function formatDisplayName(data, user) {
    let name = data.studentName || user.displayName || '';
    if (!name || name === 'undefined' || name === 'null') {
      name = (user.email || '').split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return name || 'Student';
  }

  // ============================================
  // WHITELIST
  // ============================================
  async function verifyWhitelist(user) {
    const email = (user.email || '').toLowerCase();
    const doc = await db.collection(CONFIG.COLLECTIONS.WHITELIST).doc(email).get();
    if (!doc.exists) return { ok: false, reason: 'not-whitelisted' };
    const data = doc.data();
    if (data.active !== true) return { ok: false, reason: 'inactive' };
    if (data.expiresAt && typeof data.expiresAt.toDate === 'function') {
      if (data.expiresAt.toDate() < new Date()) return { ok: false, reason: 'expired' };
    }
    return { ok: true, data };
  }

  function startWhitelistListener(email) {
    if (listenerEmail === email && whitelistUnsubscribe) return;

    if (whitelistUnsubscribe) {
      try { whitelistUnsubscribe(); } catch (_) {}
      whitelistUnsubscribe = null;
    }
    listenerEmail = email;

    whitelistUnsubscribe = db.collection(CONFIG.COLLECTIONS.WHITELIST).doc(email)
      .onSnapshot((doc) => {
        if (!doc.exists) return showAccessRevoked('Your access has been removed.');
        const data = doc.data();
        if (data.active !== true) return showAccessRevoked('Your access has been deactivated.');
        if (data.expiresAt && typeof data.expiresAt.toDate === 'function') {
          if (data.expiresAt.toDate() < new Date()) {
            return showAccessRevoked('Your access has expired.');
          }
        }
      }, (err) => {
        if (err.code === 'permission-denied') return showAccessRevoked('Access revoked.');
        console.warn('Whitelist listener error:', err.code);
      });
  }

  // ============================================
  // REVOKED
  // ============================================
  function showAccessRevoked(message) {
    if (whitelistUnsubscribe) { try { whitelistUnsubscribe(); } catch (_) {} whitelistUnsubscribe = null; }
    listenerEmail = null;
    const overlay = $('accessRevokedOverlay');
    const msg = $('revokedMessage');
    if (msg && message) msg.textContent = message;
    overlay?.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(async () => {
      try { localStorage.removeItem(CONFIG.STORAGE.SESSION); } catch (_) {}
      await auth.signOut();
      window.location.replace(CONFIG.ROUTES.LOGIN);
    }, 3000);
  }

  // ============================================
  // DOWNLOAD IMAGE
  // ============================================
  async function downloadCurrentImage() {
    if (!currentImageUrl) return;
    const btn = $('imageDownloadBtn');
    if (!btn) return;

    const original = btn.innerHTML;
    const filename = (currentImageTitle || 'image').replace(/[^\w\-]+/g, '_') + '.jpg';

    try {
      btn.innerHTML = '<span class="material-icons">hourglass_empty</span> Downloading...';
      btn.disabled = true;

      const res = await fetch(currentImageUrl, { mode: 'cors' });
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (_) {
      window.open(currentImageUrl, '_blank', 'noopener,noreferrer');
    } finally {
      btn.innerHTML = original;
      btn.disabled = false;
    }
  }

  // ============================================
  // REFRESH
  // ============================================
  async function refreshAllContent() {
    const btn = $('refreshBtn');
    const loader = $('campusLoader');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('spinning');
    loader?.classList.add('active');
    try {
      subjectCache = {};
      cachedData = [];
      displayedCount = 0;
      coverflowIndex = 0;
      classLoadToken++;
      contentLoadToken++;
      if (selectedClass) {
        const cls = selectedClass;
        await loadAvailableSubjects(cls);
        if (selectedClass === cls) await loadContent();
      }
    } catch (err) {
      console.warn('Refresh error:', err);
    } finally {
      loader?.classList.remove('active');
      btn.disabled = false;
      btn.classList.remove('spinning');
    }
  }

  // ============================================
  // LOGOUT
  // ============================================
  function showLogoutDialog() {
    $('logoutDialogOverlay')?.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function closeLogoutDialog() {
    $('logoutDialogOverlay')?.classList.remove('active');
    document.body.style.overflow = 'auto';
  }
  async function confirmLogout() {
    try {
      if (whitelistUnsubscribe) { try { whitelistUnsubscribe(); } catch (_) {} }
      whitelistUnsubscribe = null;
      listenerEmail = null;
      localStorage.removeItem(CONFIG.STORAGE.SESSION);
      await auth.signOut();
    } catch (_) {}
    window.location.replace(CONFIG.ROUTES.LOGIN);
  }

  // ============================================
// BACK BUTTON LOGOUT
// ============================================
function setupBackButtonLogout() {
    // Only set up once per session
    if (window.__backLogoutSetup) return;
    window.__backLogoutSetup = true;

    // Push a duplicate history entry so pressing back doesn't leave the page
    try {
        history.pushState({ cu_dashboard: true }, '', location.href);
    } catch (_) {}

    // Handle back button: if user tries to leave, trigger logout flow
    window.addEventListener('popstate', (e) => {
        // If the browser fires popstate on dashboard, it means the user
        // pressed back from a state where dashboard is still shown.
        // We push them back forward (so they stay) and prompt logout.
        try {
            history.pushState({ cu_dashboard: true }, '', location.href);
        } catch (_) {}

        // Show logout dialog
        showLogoutDialog();
    });
}
  // ============================================
  // SIDEBAR
  // ============================================
  function openSidebar() {
    $('sidebar')?.classList.add('open');
    $('sidebarOverlay')?.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    $('sidebar')?.classList.remove('open');
    $('sidebarOverlay')?.classList.remove('active');
    document.body.style.overflow = 'auto';
  }
  function handleMobileTabClick(tab) {
    if (window.innerWidth <= 768) closeSidebar();
    switchTab(tab);
  }

  // ============================================
  // PWA + SW
  // ============================================
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = $('installBtn');
    if (btn) btn.style.display = 'flex';
  });
  async function installApp() {
    if (!deferredPrompt) { alert('Open browser menu → Install App'); return; }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    const btn = $('installBtn');
    if (btn) btn.style.display = 'none';
  }
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const btn = $('installBtn');
    if (btn) btn.style.display = 'none';
  });
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
    const btn = $('installBtn');
    if (btn) btn.style.display = 'none';
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!sessionStorage.getItem(CONFIG.STORAGE.SW_RELOADED)) {
        sessionStorage.setItem(CONFIG.STORAGE.SW_RELOADED, '1');
        window.location.reload();
      }
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage('SKIP_WAITING');
            }
          });
        });
      }).catch((err) => {
        console.warn('[SW] Register failed:', err?.message);
      });
    });
  }

  // ============================================
  // AUTH BOOTSTRAP
  // ============================================
  function bootstrapAuth() {
    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        try { localStorage.removeItem(CONFIG.STORAGE.SESSION); } catch (_) {}
        window.location.replace(CONFIG.ROUTES.LOGIN);
        return;
      }

      let verification;
      try {
        verification = await verifyWhitelist(user);
      } catch (err) {
        console.warn('Whitelist read failed:', err.code);
        failClosed('Could not verify access. Please sign in again.', err.code);
        return;
      }

      if (!verification.ok) {
        failClosed('Your access is not active. Please contact support.', verification.reason);
        return;
      }

      const data = verification.data;
      const email = (user.email || '').toLowerCase();
      const displayName = formatDisplayName(data, user);

      const sessionData = {
        uid: user.uid,
        email,
        displayName,
        photoURL: user.photoURL || '',
        allowedClasses: Array.isArray(data.allowedClasses) ? data.allowedClasses : [],
        expiresAt: data.expiresAt && typeof data.expiresAt.toDate === 'function'
          ? data.expiresAt.toDate().toISOString()
          : null,
        loginTime: Date.now()
      };
      saveSession(sessionData);
      currentUser = sessionData;

      hydrateUI();
      startWhitelistListener(email);
      hideAuthGate();
      markUserReady();
      setupBackButtonLogout();
    }, (err) => {
      console.warn('Auth state error:', err);
      failClosed('Authentication error. Please sign in again.');
    });
  }

  function hydrateUI() {
    const nameEl = $('welcomeName');
    const subEl = $('welcomeSubtitle');
    if (nameEl) nameEl.textContent = `Welcome, ${currentUser.displayName}!`;
    if (subEl) subEl.textContent = currentUser.email || '';

    if (currentUser.expiresAt) {
      const expiry = new Date(currentUser.expiresAt);
      const el = $('expiryDateValue');
      if (el && !isNaN(expiry)) {
        el.textContent = expiry.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      }
    }

    loadClassChips();
    showClassSelectionPrompt();
  }

  // ============================================
  // CLASS CHIPS
  // ============================================
  function loadClassChips() {
    const chipsDiv = $('classChips');
    if (!chipsDiv) return;
    const classes = (currentUser && currentUser.allowedClasses) || [];
    if (!classes.length) {
      chipsDiv.innerHTML = '<p style="color:var(--text-secondary);">No classes assigned.</p>';
      return;
    }
    chipsDiv.innerHTML = classes
      .map((c) => `<button class="chip" role="tab" data-class="${escapeAttr(c)}">${escapeHtml(c)}</button>`)
      .join('');
    chipsDiv.querySelectorAll('.chip').forEach((btn) => {
      btn.addEventListener('click', () => selectClass(btn.dataset.class));
    });
  }

  function showClassSelectionPrompt() {
    const area = $('contentArea');
    if (!area) return;
    area.innerHTML = `
      <div class="empty-state">
        <span class="material-icons">touch_app</span>
        <h3>Select Your Class</h3>
        <p>Choose a class above to view content</p>
      </div>
    `;
  }

  // ============================================
  // CLASS SELECT
  // ============================================
  async function selectClass(cls) {
    const token = ++classLoadToken;
    selectedClass = cls;
    selectedSubject = null;
    cachedData = [];
    displayedCount = 0;
    coverflowIndex = 0;

    document.querySelectorAll('.class-chips .chip').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.class === cls);
    });

    const subjLabel = $('subjectLabel');
    const subjChips = $('subjectChips');
    if (subjLabel) subjLabel.style.display = 'block';
    if (subjChips) {
      subjChips.style.display = 'flex';
      subjChips.innerHTML = '<span style="color:var(--text-secondary);font-size:0.8rem;">Loading...</span>';
    }

    const progress = $('videoProgressContainer');
    if (progress) progress.hidden = true;

    await loadAvailableSubjects(cls, token);
    if (token !== classLoadToken) return;
    await loadContent(token);
  }

  // ============================================
  // SUBJECTS
  // ============================================
  async function loadAvailableSubjects(cls, token) {
    const chipsDiv = $('subjectChips');
    if (!chipsDiv) return;

    if (subjectCache[cls]) {
      if (token !== undefined && token !== classLoadToken) return;
      renderSubjectChips(subjectCache[cls]);
      return;
    }

    try {
      const [videos, pdfs, images, posts] = await Promise.all([
        db.collection(CONFIG.COLLECTIONS.VIDEOS).where('class', '==', cls).get(),
        db.collection(CONFIG.COLLECTIONS.PDFS).where('class', '==', cls).get(),
        db.collection(CONFIG.COLLECTIONS.IMAGES).where('class', '==', cls).get(),
        db.collection(CONFIG.COLLECTIONS.POSTS).where('class', 'array-contains', cls).get()
      ]);

      if (token !== undefined && token !== classLoadToken) return;

      const set = new Set();
      [videos, pdfs, images, posts].forEach((snap) => {
        snap.forEach((d) => {
          const s = d.data().subject;
          if (s) set.add(s);
        });
      });

      const subjects = Array.from(set).sort();
      subjectCache[cls] = subjects;
      renderSubjectChips(subjects);
    } catch (err) {
      if (token !== undefined && token !== classLoadToken) return;
      console.warn('Subjects load failed:', err.code);
      chipsDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:0.8rem;">Could not load subjects.</p>';
    }
  }

  function renderSubjectChips(subjects) {
    const chipsDiv = $('subjectChips');
    if (!chipsDiv) return;
    if (!subjects.length) {
      chipsDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:0.8rem;">No subjects yet.</p>';
      return;
    }
    let html = `<button class="chip active" data-subject="">All (${subjects.length})</button>`;
    subjects.forEach((s) => {
      html += `<button class="chip" data-subject="${escapeAttr(s)}">${escapeHtml(s)}</button>`;
    });
    chipsDiv.innerHTML = html;
    chipsDiv.querySelectorAll('.chip').forEach((btn) => {
      btn.addEventListener('click', () => selectSubject(btn.dataset.subject || null, btn));
    });
  }

  function selectSubject(subject, btnEl) {
    selectedSubject = subject;
    cachedData = [];
    displayedCount = 0;
    coverflowIndex = 0;
    document.querySelectorAll('.subject-chips .chip').forEach((c) => c.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    loadContent();
  }

  // ============================================
  // CONTENT LOADING
  // ============================================
  async function loadContent(token) {
    if (!selectedClass) return;
    const area = $('contentArea');
    if (!area) return;

    const myToken = token !== undefined ? token : ++contentLoadToken;
    const tabAtStart = currentTab;
    const classAtStart = selectedClass;
    const subjectAtStart = selectedSubject;

    area.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text);">Loading...</div>';

    try {
      let data = [];
      switch (tabAtStart) {
        case 'videos': data = await fetchCollection(CONFIG.COLLECTIONS.VIDEOS, 'class', classAtStart); break;
        case 'pdfs':   data = await fetchCollection(CONFIG.COLLECTIONS.PDFS,   'class', classAtStart); break;
        case 'images': data = await fetchCollection(CONFIG.COLLECTIONS.IMAGES, 'class', classAtStart); break;
        case 'posts':  data = await fetchPosts(classAtStart); break;
      }

      if (tabAtStart !== currentTab) return;
      if (classAtStart !== selectedClass) return;
      if (subjectAtStart !== selectedSubject) return;
      if (token === undefined && myToken !== contentLoadToken) return;

      if (subjectAtStart) data = data.filter((d) => d.subject === subjectAtStart);

      data.sort((a, b) => {
        const ta = a.uploadedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
        const tb = b.uploadedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
        return tb - ta;
      });

      cachedData = data;
      displayedCount = 0;
      coverflowIndex = 0;
      area.innerHTML = '';
      appendContent();
      updateVideoProgress(data);
    } catch (err) {
      if (tabAtStart !== currentTab || classAtStart !== selectedClass) return;
      console.warn('Content load failed:', err.code);
      if (err.code === 'permission-denied') {
        return showAccessRevoked('Access revoked. Redirecting…');
      }
      area.innerHTML = `
        <div class="empty-state">
          <span class="material-icons">error_outline</span>
          <h3>Error Loading Content</h3>
          <p>Please try again.</p>
        </div>
      `;
    }
  }

  async function fetchCollection(name, field, value) {
    const snap = await db.collection(name).where(field, '==', value).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async function fetchPosts(cls) {
    const snap = await db.collection(CONFIG.COLLECTIONS.POSTS).where('class', 'array-contains', cls).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // ============================================
  // CARD RENDER (Grid + List)
  // ============================================
  function generateCardHtml(item) {
    const title = escapeHtml(item.title || '');
    const titleAttr = escapeAttr(item.title || '');
    const subject = escapeHtml(item.subject || '');

    if (currentTab === 'videos') {
      const vid = extractYouTubeId(item.videoUrl);
      const thumb = vid ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg` : '';
      const duration = escapeHtml(item.duration || '');
      const watched = typeof isVideoWatched === 'function' ? isVideoWatched(item.id) : false;

      return `
        <div class="card ${watched ? 'watched-card' : ''}"
             data-item-id="${escapeAttr(item.id)}"
             data-item-title="${titleAttr}">
          <div class="video-thumbnail"
               role="button" tabindex="0"
               data-action="play-video"
               data-video-url="${escapeAttr(item.videoUrl || '')}"
               data-video-title="${titleAttr}"
               data-video-desc="${escapeAttr(item.description || '')}">
            ${thumb ? `<img src="${thumb}" loading="lazy" alt="">` : ''}
            ${duration ? `<span class="video-duration">${duration}</span>` : ''}
          </div>
          <div class="card-info">
            <div class="card-title">${title}</div>
            ${subject ? `<div class="card-description">${subject}</div>` : ''}
            <div class="watched-indicator ${watched ? 'watched' : ''}"
                 data-watched-id="${escapeAttr(item.id)}"
                 data-watched-title="${titleAttr}"
                 role="button" tabindex="0">
              <span class="material-icons">${watched ? 'check_circle' : 'check_circle_outline'}</span>
              <span>${watched ? 'Watched' : 'Mark as watched'}</span>
            </div>
            <div class="note-indicator"
                 data-note-id="${escapeAttr(item.id)}"
                 data-note-title="${titleAttr}"
                 role="button" tabindex="0"
                 aria-label="Open note for ${titleAttr}">
              <span class="material-icons">sticky_note_2</span>
              <span>Add note</span>
            </div>
          </div>
        </div>
      `;
    }
    if (currentTab === 'pdfs') {
      return `
        <div class="card pdf-card" data-item-id="${escapeAttr(item.id)}" data-item-title="${titleAttr}">
          <span class="material-icons pdf-icon">picture_as_pdf</span>
          <div class="card-title">${title}</div>
          ${subject ? `<div class="card-description">${subject}</div>` : ''}
          <a href="${escapeAttr(item.pdfUrl || '#')}" target="_blank" rel="noopener noreferrer" class="pdf-download-btn">Download PDF</a>
        </div>
      `;
    }
    if (currentTab === 'images') {
      return `
        <div class="card" data-item-id="${escapeAttr(item.id)}" data-item-title="${titleAttr}"
             role="button" tabindex="0"
             data-action="view-image"
             data-image-url="${escapeAttr(item.imageUrl || '')}"
             data-image-title="${titleAttr}"
             data-image-desc="${escapeAttr(item.description || '')}"
             data-image-subject="${escapeAttr(item.subject || '')}">
          <img src="${escapeAttr(item.imageUrl || '')}" class="image-thumbnail" alt="${titleAttr}" loading="lazy">
          <div class="card-info">
            <div class="card-title">${title}</div>
            ${subject ? `<div class="card-description">${subject}</div>` : ''}
          </div>
        </div>
      `;
    }
    if (currentTab === 'posts') {
      return `
        <div class="post-card" data-item-id="${escapeAttr(item.id)}">
          <div class="post-title">${title}</div>
          ${subject ? `<div class="card-description">${subject}</div>` : ''}
          <p class="post-content">${escapeHtml(item.content || '')}</p>
          ${item.url ? `<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer" class="post-link">Read More →</a>` : ''}
        </div>
      `;
    }
    return '';
  }

  // ============================================
  // APPEND
  // ============================================
  function appendContent() {
    const area = $('contentArea');
    if (!area) return;
    const all = cachedData;

    if (!all.length) {
      const empties = {
        videos: { icon: 'video_library', title: 'No Videos Yet', desc: 'New videos will appear here.' },
        pdfs:   { icon: 'picture_as_pdf', title: 'No PDFs Yet', desc: 'New PDFs will appear here.' },
        images: { icon: 'image', title: 'No Images Yet', desc: 'New images will appear here.' },
        posts:  { icon: 'article', title: 'No Posts Yet', desc: 'Announcements will appear here.' }
      };
      const m = empties[currentTab];
      area.innerHTML = `
        <div class="empty-state">
          <span class="material-icons">${m.icon}</span>
          <h3>${m.title}</h3>
          <p>${m.desc}</p>
        </div>
      `;
      return;
    }

    if (area.classList.contains('coverflow-view')) {
      renderCoverflow();
      return;
    }

    area.querySelector('.load-more-btn:not(.modal-content .load-more-btn)')?.remove();

    let container;
    if (currentTab === 'posts') {
      container = area.querySelector('.posts-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'posts-container';
        area.appendChild(container);
      }
    } else {
      container = area.querySelector('.content-grid');
      if (!container) {
        container = document.createElement('div');
        container.className = 'content-grid';
        area.appendChild(container);
      }
    }

    const start = displayedCount;
    const end = Math.min(start + CONFIG.PAGE_SIZE, all.length);
    const batch = all.slice(start, end);
    const frag = document.createDocumentFragment();
    const temp = document.createElement('div');

    batch.forEach((item) => {
      temp.innerHTML = generateCardHtml(item);
      while (temp.firstChild) frag.appendChild(temp.firstChild);
    });
    container.appendChild(frag);
    displayedCount = end;

    if (displayedCount < all.length) {
      const btn = document.createElement('button');
      btn.className = 'load-more-btn';
      btn.textContent = `Load More (${all.length - displayedCount} remaining)`;
      btn.onclick = appendContent;
      area.appendChild(btn);
    }

    if (typeof refreshWatchedBadges === 'function') {
      setTimeout(refreshWatchedBadges, 100);
    }
    if (typeof window.refreshNoteBadges === 'function') {
      setTimeout(window.refreshNoteBadges, 120);
    }
  }

  // ============================================
  // COVER FLOW VIEW
  // ============================================
  function renderCoverflow() {
    const area = $('contentArea');
    if (!area) return;

    area.querySelector('.coverflow-wrapper')?.remove();

    if (!cachedData.length) return;

    const total = cachedData.length;

    if (coverflowIndex >= total) coverflowIndex = total - 1;
    if (coverflowIndex < 0) coverflowIndex = 0;

    const wrapper = document.createElement('div');
    wrapper.className = 'coverflow-wrapper';

    const track = document.createElement('div');
    track.className = 'coverflow-track';
    track.setAttribute('role', 'listbox');
    track.setAttribute('aria-label', 'Content carousel');

    const cardWidth = 280;
    const gap = 20;
    const stepPx = cardWidth + gap;

    cachedData.forEach((item, i) => {
      const offset = i - coverflowIndex;
      const absOffset = Math.abs(offset);

      if (absOffset > 4) return;

      const card = document.createElement('div');
      card.className = 'coverflow-card';
      card.dataset.cfIndex = String(i);
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', String(i === coverflowIndex));
      card.setAttribute('tabindex', i === coverflowIndex ? '0' : '-1');

      const tx = offset * stepPx * 0.85;
      const tz = -absOffset * 180;
      const ry = offset === 0 ? 0 : (offset < 0 ? 40 : -40);
      const scale = offset === 0 ? 1 : Math.max(0.72, 1 - absOffset * 0.12);
      const opacity = offset === 0 ? 1 : Math.max(0.35, 1 - absOffset * 0.22);
      const zIndex = 100 - absOffset;

      card.style.transform = `translateX(${tx}px) translateZ(${tz}px) rotateY(${ry}deg) scale(${scale})`;
      card.style.opacity = String(opacity);
      card.style.zIndex = String(zIndex);

      card.innerHTML = generateCoverflowCardContent(item);
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-watched-id], [data-note-id]')) return;

        if (i === coverflowIndex) {
          handleCoverflowOpen(item);
        } else {
          setCoverflowIndex(i);
        }
      });

      track.appendChild(card);
    });

    wrapper.appendChild(track);

    const dots = document.createElement('div');
    dots.className = 'coverflow-dots';
    cachedData.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.className = 'coverflow-dot' + (i === coverflowIndex ? ' active' : '');
      dot.setAttribute('aria-label', `Go to item ${i + 1}`);
      dot.addEventListener('click', () => setCoverflowIndex(i));
      dots.appendChild(dot);
    });
    wrapper.appendChild(dots);

    const prevBtn = document.createElement('button');
    prevBtn.className = 'coverflow-nav coverflow-prev';
    prevBtn.setAttribute('aria-label', 'Previous item');
    prevBtn.innerHTML = '<span class="material-icons">chevron_left</span>';
    prevBtn.disabled = coverflowIndex === 0;
    prevBtn.addEventListener('click', () => setCoverflowIndex(coverflowIndex - 1));

    const nextBtn = document.createElement('button');
    nextBtn.className = 'coverflow-nav coverflow-next';
    nextBtn.setAttribute('aria-label', 'Next item');
    nextBtn.innerHTML = '<span class="material-icons">chevron_right</span>';
    nextBtn.disabled = coverflowIndex === total - 1;
    nextBtn.addEventListener('click', () => setCoverflowIndex(coverflowIndex + 1));

    wrapper.appendChild(prevBtn);
    wrapper.appendChild(nextBtn);

    area.appendChild(wrapper);

    const counter = document.createElement('div');
    counter.className = 'coverflow-counter';
    counter.textContent = `${coverflowIndex + 1} / ${total}`;
    wrapper.appendChild(counter);
  }

  function generateCoverflowCardContent(item) {
    const title = escapeHtml(item.title || '');
    const titleAttr = escapeAttr(item.title || '');
    const subject = escapeHtml(item.subject || '');
    const itemIdAttr = escapeAttr(item.id);

    if (currentTab === 'videos') {
      const vid = extractYouTubeId(item.videoUrl);
      const thumb = vid ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg` : '';
      const duration = escapeHtml(item.duration || '');
      const watched = typeof isVideoWatched === 'function' ? isVideoWatched(item.id) : false;

      return `
        <div class="coverflow-thumb">
          ${thumb ? `<img src="${thumb}" loading="lazy" alt="">` : ''}
          ${duration ? `<span class="video-duration">${duration}</span>` : ''}
          ${item.videoUrl ? '<div class="coverflow-play"><span class="material-icons">play_arrow</span></div>' : ''}
        </div>
        <div class="coverflow-info">
          <div class="coverflow-title">${title}</div>
          ${subject ? `<div class="coverflow-subject">${subject}</div>` : ''}
          <div class="coverflow-actions">
            <button class="coverflow-action ${watched ? 'active' : ''}"
                    data-watched-id="${itemIdAttr}"
                    data-watched-title="${titleAttr}"
                    aria-label="${watched ? 'Unmark watched' : 'Mark as watched'}">
              <span class="material-icons">${watched ? 'check_circle' : 'check_circle_outline'}</span>
            </button>
            <button class="coverflow-action"
                    data-note-id="${itemIdAttr}"
                    data-note-title="${titleAttr}"
                    aria-label="Open note">
              <span class="material-icons">sticky_note_2</span>
            </button>
          </div>
        </div>
      `;
    }
    if (currentTab === 'pdfs') {
      return `
        <div class="coverflow-thumb coverflow-thumb-pdf">
          <span class="material-icons">picture_as_pdf</span>
        </div>
        <div class="coverflow-info">
          <div class="coverflow-title">${title}</div>
          ${subject ? `<div class="coverflow-subject">${subject}</div>` : ''}
        </div>
      `;
    }
    if (currentTab === 'images') {
      const imgSrc = item.imageUrl || '';
      if (!imgSrc) {
        return `
          <div class="coverflow-thumb coverflow-thumb-post">
            <span class="material-icons">image</span>
          </div>
          <div class="coverflow-info">
            <div class="coverflow-title">${title}</div>
            ${subject ? `<div class="coverflow-subject">${subject}</div>` : ''}
          </div>
        `;
      }
      return `
        <div class="coverflow-thumb">
          <img src="${escapeAttr(imgSrc)}" loading="lazy" alt="">
        </div>
        <div class="coverflow-info">
          <div class="coverflow-title">${title}</div>
          ${subject ? `<div class="coverflow-subject">${subject}</div>` : ''}
        </div>
      `;
    }
    if (currentTab === 'posts') {
      return `
        <div class="coverflow-thumb coverflow-thumb-post">
          <span class="material-icons">article</span>
        </div>
        <div class="coverflow-info">
          <div class="coverflow-title">${title}</div>
          ${subject ? `<div class="coverflow-subject">${subject}</div>` : ''}
        </div>
      `;
    }
    return `<div class="coverflow-info"><div class="coverflow-title">${title}</div></div>`;
  }

  function setCoverflowIndex(i) {
    const total = cachedData.length;
    if (!total) return;
    coverflowIndex = Math.max(0, Math.min(total - 1, i));
    renderCoverflow();

    const selected = document.querySelector(`.coverflow-card[data-cf-index="${coverflowIndex}"]`);
    if (selected) {
      selected.focus({ preventScroll: true });
    }
  }

  // ============================================
  // HANDLE OPEN
  // ============================================
  function handleCoverflowOpen(item) {
    if (currentTab === 'videos' && item.videoUrl) {
      playVideo(item.videoUrl, item.title || '', item.description || '');
    } else if (currentTab === 'images' && item.imageUrl) {
      viewImage(item.imageUrl, item.title || '', item.description || '', item.subject || '');
    } else if (currentTab === 'pdfs' && item.pdfUrl) {
      window.open(item.pdfUrl, '_blank', 'noopener,noreferrer');
    } else if (currentTab === 'posts' && item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    }
  }

  // ============================================
  // YOUTUBE
  // ============================================
  function extractYouTubeId(url) {
    if (!url) return null;
    if (url.includes('youtu.be/')) return url.split('youtu.be/')[1].split(/[?&]/)[0];
    if (url.includes('/watch')) return url.split('v=')[1]?.split('&')[0];
    if (url.includes('/embed/')) return url.split('/embed/')[1].split(/[?&]/)[0];
    if (url.includes('/shorts/')) return url.split('/shorts/')[1].split(/[?&]/)[0];
    return null;
  }
  function getEmbedUrl(url) {
    const id = extractYouTubeId(url);
    return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1` : url;
  }

  // ============================================
  // MODALS
  // ============================================
  function playVideo(url, title, desc) {
    $('modalVideo').src = getEmbedUrl(url);
    $('modalTitle').textContent = title;
    $('modalDescription').textContent = desc;
    $('videoModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
  function toggleFullscreen() {
    const c = $('videoPlayerContainer');
    if (!c || typeof c.requestFullscreen !== 'function') return;
    if (!document.fullscreenElement) c.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
  }
  function closeVideoModal() {
    if (document.fullscreenElement) document.exitFullscreen();
    $('videoModal').style.display = 'none';
    $('modalVideo').src = '';
    document.body.style.overflow = 'auto';
  }

  function viewImage(url, title, desc, subject) {
    currentImageUrl = url;
    currentImageTitle = title;
    $('modalImage').src = url;
    $('imageModalTitle').textContent = title;
    $('imageModalDescription').textContent = `${subject || ''}${desc ? ' • ' + desc : ''}`;
    $('imageModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
  function closeImageModal() {
    $('imageModal').style.display = 'none';
    $('modalImage').src = '';
    currentImageUrl = '';
    currentImageTitle = '';
    document.body.style.overflow = 'auto';
  }

  // ============================================
  // TAB SWITCH
  // ============================================
  function switchTab(tab) {
    if (!TABS.includes(tab)) return;
    currentTab = tab;
    cachedData = [];
    displayedCount = 0;
    coverflowIndex = 0;
    contentLoadToken++;

    document.querySelectorAll('.sidebar-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });

    const progress = $('videoProgressContainer');
    if (progress) progress.hidden = (tab !== 'videos' || !selectedClass);

    if (selectedClass) loadContent();
  }

  // ============================================
  // VIDEO PROGRESS
  // ============================================
  function updateVideoProgress(allVideos) {
    const wrap = $('videoProgressContainer');
    if (!wrap) return;
    if (currentTab !== 'videos' || !allVideos || allVideos.length === 0) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;

    const total = allVideos.length;
    const watched = allVideos.filter((v) => typeof isVideoWatched === 'function' && isVideoWatched(v.id)).length;
    const pct = total > 0 ? Math.round((watched / total) * 100) : 0;

    const wc = $('watchedCount'); if (wc) wc.textContent = watched;
    const tc = $('totalCount'); if (tc) tc.textContent = total;
    const fill = $('videoProgressFill'); if (fill) fill.style.width = pct + '%';
    const pctEl = $('videoProgressPercentage'); if (pctEl) pctEl.textContent = pct + '%';
    const bar = $('videoProgressBar');
    if (bar) bar.setAttribute('aria-valuenow', String(pct));

    if ([25, 50, 75, 100].includes(pct)) celebrateMilestone(pct);
  }

  function celebrateMilestone(pct) {
    const wrap = $('videoProgressContainer');
    if (!wrap) return;
    wrap.classList.add('milestone');
    setTimeout(() => wrap.classList.remove('milestone'), 600);
    const msgs = {
      25: '25% Done!',
      50: '50% Done!',
      75: '75% Done!',
      100: '100% Completed!'
    };
    if (msgs[pct]) showProgressToast(msgs[pct]);
  }

  function showProgressToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; top: 100px; left: 50%;
      transform: translateX(-50%) translateY(-100px);
      background: linear-gradient(135deg, var(--success, #059669), var(--success, #10b981));
      color: var(--accent-contrast, #fff); padding: 14px 28px; border-radius: 25px;
      font-weight: 600; font-size: 0.9rem;
      box-shadow: 0 10px 30px rgba(5,150,105,0.4);
      z-index: 99999;
      animation: progressToastIn 0.5s cubic-bezier(0.68,-0.55,0.265,1.55) forwards;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    if (!$('progressToastStyles')) {
      const s = document.createElement('style');
      s.id = 'progressToastStyles';
      s.textContent = `
        @keyframes progressToastIn { 0%{transform:translateX(-50%) translateY(-100px);opacity:0} 100%{transform:translateX(-50%) translateY(0);opacity:1} }
        @keyframes progressToastOut { 0%{transform:translateX(-50%) translateY(0);opacity:1} 100%{transform:translateX(-50%) translateY(-100px);opacity:0} }
      `;
      document.head.appendChild(s);
    }
    setTimeout(() => {
      toast.style.animation = 'progressToastOut 0.5s ease-out forwards';
      setTimeout(() => toast.remove(), 500);
    }, 3000);
  }

  function onVideoWatched() {
    if (cachedData.length) updateVideoProgress(cachedData);
    refreshAllViews();
  }

  function onVideoUnwatched() {
    if (cachedData.length) updateVideoProgress(cachedData);
    refreshAllViews();
  }

  function refreshAllViews() {
    const area = $('contentArea');
    if (!area) return;
    if (area.classList.contains('coverflow-view')) {
      renderCoverflow();
    }
  }

  // ============================================
  // CARD CLICK DELEGATION
  // ============================================
  document.addEventListener('click', (e) => {
    const videoEl = e.target.closest('[data-action="play-video"]');
    if (videoEl) {
      e.stopPropagation();
      playVideo(
        videoEl.dataset.videoUrl || '',
        videoEl.dataset.videoTitle || '',
        videoEl.dataset.videoDesc || ''
      );
      return;
    }

    const imageEl = e.target.closest('[data-action="view-image"]');
    if (imageEl) {
      e.stopPropagation();
      viewImage(
        imageEl.dataset.imageUrl || '',
        imageEl.dataset.imageTitle || '',
        imageEl.dataset.imageDesc || '',
        imageEl.dataset.imageSubject || ''
      );
      return;
    }

    const watchedEl = e.target.closest('[data-watched-id]');
    if (watchedEl) {
      e.stopPropagation();
      const id = watchedEl.dataset.watchedId;
      const title = watchedEl.dataset.watchedTitle || '';
      if (typeof window.toggleWatched === 'function') {
        window.toggleWatched(id, title, watchedEl);
      }
      return;
    }

    const noteEl = e.target.closest('[data-note-id]');
    if (noteEl) {
      e.stopPropagation();
      const id = noteEl.dataset.noteId;
      const title = noteEl.dataset.noteTitle || '';
      if (typeof window.openNote === 'function') {
        window.openNote(id, title);
      } else {
        setTimeout(() => {
          if (typeof window.openNote === 'function') {
            window.openNote(id, title);
          } else {
            window.showToast?.('Notes loading, please try again', 'error');
          }
        }, 300);
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;

    const interactive = e.target.closest?.(
      '[data-action="play-video"], [data-action="view-image"], [data-watched-id], [data-note-id]'
    );
    if (!interactive) return;

    e.preventDefault();
    interactive.click();
  });

  // ============================================
  // COVERFLOW KEYBOARD NAV
  // ============================================
  document.addEventListener('keydown', (e) => {
    const area = $('contentArea');
    if (!area || !area.classList.contains('coverflow-view')) return;
    if (!cachedData.length) return;

    if (e.target.matches('input, textarea, select')) return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setCoverflowIndex(coverflowIndex - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setCoverflowIndex(coverflowIndex + 1);
    } else if (e.key === 'Enter') {
      const focused = cachedData[coverflowIndex];
      if (focused) {
        e.preventDefault();
        handleCoverflowOpen(focused);
      }
    }
  });

  // ============================================
  // COVERFLOW SWIPE
  // ============================================
  (function setupCoverflowSwipe() {
    let touchStartX = 0;
    let touchStartY = 0;

    document.addEventListener('touchstart', (e) => {
      const area = $('contentArea');
      if (!area || !area.classList.contains('coverflow-view')) return;
      if (!cachedData.length) return;
      if (e.touches.length !== 1) return;

      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      const area = $('contentArea');
      if (!area || !area.classList.contains('coverflow-view')) return;
      if (!cachedData.length) return;
      if (!e.changedTouches.length) return;

      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;

      if (Math.abs(dx) < 50) return;
      if (Math.abs(dy) > Math.abs(dx) * 0.7) return;

      if (dx < 0) setCoverflowIndex(coverflowIndex + 1);
      else setCoverflowIndex(coverflowIndex - 1);
    }, { passive: true });
  })();

  // ============================================
  // GLOBAL HANDLERS
  // ============================================
  window.openSidebar = openSidebar;
  window.closeSidebar = closeSidebar;
  window.handleMobileTabClick = handleMobileTabClick;
  window.showLogoutDialog = showLogoutDialog;
  window.closeLogoutDialog = closeLogoutDialog;
  window.confirmLogout = confirmLogout;
  window.refreshAllContent = refreshAllContent;
  window.installApp = installApp;
  window.playVideo = playVideo;
  window.toggleFullscreen = toggleFullscreen;
  window.closeVideoModal = closeVideoModal;
  window.viewImage = viewImage;
  window.closeImageModal = closeImageModal;
  window.downloadCurrentImage = downloadCurrentImage;
  window.onUserReady = onUserReady;
  window.onVideoWatched = onVideoWatched;
  window.onVideoUnwatched = onVideoUnwatched;
  window.showAccessRevoked = showAccessRevoked;

  // Cross-file getters
  window.__CU_getUser = function () {
    if (!currentUser) return null;
    return {
      uid: currentUser.uid,
      email: currentUser.email,
      displayName: currentUser.displayName,
      allowedClasses: (currentUser.allowedClasses || []).slice()
    };
  };

  window.__CU_getSelectedClass = function () {
    return selectedClass;
  };

  window.__CU_rerenderContent = function () {
    const area = $('contentArea');
    if (!area || !cachedData || cachedData.length === 0) return;
    displayedCount = 0;
    area.innerHTML = '';
    appendContent();
  };

  window.__CU_refreshCoverflow = function () {
    const area = $('contentArea');
    if (area && area.classList.contains('coverflow-view')) {
      renderCoverflow();
    }
  };

  window.__CU_setCoverflowIndex = setCoverflowIndex;
  window.__CU_getCoverflowIndex = () => coverflowIndex;

  // ============================================
  // MODAL DISMISS
  // ============================================
  document.getElementById('videoModal')?.addEventListener('click', function (e) {
    if (e.target === this) closeVideoModal();
  });
  document.getElementById('imageModal')?.addEventListener('click', function (e) {
    if (e.target === this) closeImageModal();
  });
  document.getElementById('logoutDialogOverlay')?.addEventListener('click', function (e) {
    if (e.target === this) closeLogoutDialog();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLogoutDialog();
      closeVideoModal();
      closeImageModal();
    }
  });

  // ============================================
  // BOOT
  // ============================================
  document.addEventListener('DOMContentLoaded', () => {
    startAuthGateAnimation();
    bootstrapAuth();

    // Intercept in-app navigation — use replaceState so back button
    // returns to login, not to previous app pages
    document.addEventListener('click', (e) => {
        const navLink = e.target.closest('a[data-nav]');
        if (!navLink) return;
        // Let browser handle normal navigation
        // But mark that we navigated within the app so dashboard knows
        try {
            sessionStorage.setItem('cu_navigated_from_dashboard', '1');
        } catch (_) {}
    });
});
})();
