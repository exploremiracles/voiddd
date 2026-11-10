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
    // NOTE: The session in localStorage is display-only. It is NOT used to
    // authorize access. Firestore rules + Firebase auth are the source of truth.
    // This value is informational (used only to show "you've been here 1h" etc).
    DISPLAY_SESSION_HINT_MS: 2 * 60 * 60 * 1000
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
  let subjectCache = {}; // { class => [subjects] }
  let isUserReady = false;
  const readyCallbacks = [];
  let classLoadToken = 0; // Incremented on every class selection to invalidate in-flight loads
  let contentLoadToken = 0; // Same for content loads

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
  // AUTH GATE
  // ============================================
  function hideAuthGate() {
    const gate = $('authGate');
    if (!gate) return;
    gate.classList.remove('active');
    $('dashboardRoot')?.removeAttribute('hidden');
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
  // SESSION (DISPLAY ONLY — never trusted for auth)
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
  // AUTHORITATIVE WHITELIST CHECK (runs on every load)
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

  // ============================================
  // LIVE STATUS LISTENER (1 read per change, not per 5s)
  // ============================================
  function startWhitelistListener(email) {
    // Idempotent: if already listening to this email, don't restart
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
  // REVOKED DIALOG
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
  // DOWNLOAD IMAGE (with graceful fallback)
  // ============================================
  async function downloadCurrentImage() {
    if (!currentImageUrl) return;
    const btn = $('imageDownloadBtn');
    const original = btn.innerHTML;
    try {
      btn.innerHTML = '<span class="material-icons">hourglass_empty</span> Downloading...';
      btn.disabled = true;
      const res = await fetch(currentImageUrl, { mode: 'cors' });
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (currentImageTitle || 'image').replace(/[^\w\-]+/g, '_') + '.jpg';
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
  // PWA + SERVICE WORKER UPDATE FLOW
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

  // Service Worker registration + update handler
  if ('serviceWorker' in navigator) {
    // Auto-reload when a new SW takes control (once per session)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!sessionStorage.getItem(CONFIG.STORAGE.SW_RELOADED)) {
        sessionStorage.setItem(CONFIG.STORAGE.SW_RELOADED, '1');
        window.location.reload();
      }
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        // Check for updates every 30 minutes
        setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);

        // If a new SW is installed and waiting, activate it
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
      .map((c) => `<button class="chip" role="tab" data-class="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
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
  // CLASS SELECT (race-safe)
  // ============================================
  async function selectClass(cls) {
    const token = ++classLoadToken;
    selectedClass = cls;
    selectedSubject = null;
    cachedData = [];
    displayedCount = 0;

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
    if (progress) progress.style.display = currentTab === 'videos' ? 'block' : 'none';

    await loadAvailableSubjects(cls, token);
    if (token !== classLoadToken) return; // superseded by a newer class click
    await loadContent(token);
  }

  // ============================================
  // SUBJECTS (cached per class, race-safe)
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
      html += `<button class="chip" data-subject="${escapeHtml(s)}">${escapeHtml(s)}</button>`;
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
    document.querySelectorAll('.subject-chips .chip').forEach((c) => c.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    loadContent();
  }

  // ============================================
  // CONTENT (race-safe)
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

      // Bail if state changed while awaiting
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
  // CARD RENDER (unchanged)
  // ============================================
  function generateCardHtml(item) {
    const title = escapeHtml(item.title || '');
    const subject = escapeHtml(item.subject || '');
    const description = escapeHtml(item.description || '');

    if (currentTab === 'videos') {
      const vid = extractYouTubeId(item.videoUrl);
      const thumb = vid ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg` : '';
      const duration = escapeHtml(item.duration || '');
      const watched = typeof isVideoWatched === 'function' ? isVideoWatched(item.id) : false;

      return `
        <div class="card ${watched ? 'watched-card' : ''}"
             data-item-id="${item.id}"
             data-item-title="${title}"
             onclick="playVideo('${escapeHtml(item.videoUrl || '')}','${title}','${description}')"
             role="button" tabindex="0">
          <div class="video-thumbnail">
            ${thumb ? `<img src="${thumb}" loading="lazy" alt="">` : ''}
            ${duration ? `<span class="video-duration">${duration}</span>` : ''}
          </div>
          <div class="card-info">
            <div class="card-title">${title}</div>
            ${subject ? `<div class="card-description">${subject}</div>` : ''}
            <div class="watched-indicator ${watched ? 'watched' : ''}"
                 onclick="event.stopPropagation(); toggleWatched('${item.id}', '${title}', this); return false;"
                 role="button" tabindex="0">
              <span class="material-icons">${watched ? 'check_circle' : 'check_circle_outline'}</span>
              <span>${watched ? 'Watched' : 'Mark as watched'}</span>
            </div>
          </div>
        </div>
      `;
    }
    if (currentTab === 'pdfs') {
      return `
        <div class="card pdf-card" data-item-id="${item.id}" data-item-title="${title}">
          <span class="material-icons pdf-icon">picture_as_pdf</span>
          <div class="card-title">${title}</div>
          ${subject ? `<div class="card-description">${subject}</div>` : ''}
          <a href="${escapeHtml(item.pdfUrl || '#')}" target="_blank" rel="noopener noreferrer" class="pdf-download-btn">Download PDF</a>
        </div>
      `;
    }
    if (currentTab === 'images') {
      return `
        <div class="card" data-item-id="${item.id}" data-item-title="${title}"
             onclick="viewImage('${escapeHtml(item.imageUrl || '')}','${title}','${description}','${subject}')"
             role="button" tabindex="0">
          <img src="${escapeHtml(item.imageUrl || '')}" class="image-thumbnail" alt="${title}" loading="lazy">
          <div class="card-info">
            <div class="card-title">${title}</div>
            ${subject ? `<div class="card-description">${subject}</div>` : ''}
          </div>
        </div>
      `;
    }
    if (currentTab === 'posts') {
      return `
        <div class="post-card" data-item-id="${item.id}">
          <div class="post-title">${title}</div>
          ${subject ? `<div class="card-description">${subject}</div>` : ''}
          <p class="post-content">${escapeHtml(item.content || '')}</p>
          ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="post-link">Read More →</a>` : ''}
        </div>
      `;
    }
    return '';
  }

  // ============================================
  // APPEND (paginated, unchanged)
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
    if (!document.fullscreenElement) c?.requestFullscreen?.().catch(() => {});
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
  // TAB SWITCH (race-safe)
  // ============================================
  function switchTab(tab) {
    if (!TABS.includes(tab)) return;
    currentTab = tab;
    cachedData = [];
    displayedCount = 0;
    contentLoadToken++;
    document.querySelectorAll('.sidebar-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });

    const progress = $('videoProgressContainer');
    if (progress) progress.style.display = tab === 'videos' && selectedClass ? 'block' : 'none';

    if (selectedClass) loadContent();
  }

  // ============================================
  // VIDEO PROGRESS
  // ============================================
  function updateVideoProgress(allVideos) {
    const wrap = $('videoProgressContainer');
    if (!wrap) return;
    if (currentTab !== 'videos' || !allVideos || allVideos.length === 0) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = 'block';

    const total = allVideos.length;
    const watched = allVideos.filter((v) => typeof isVideoWatched === 'function' && isVideoWatched(v.id)).length;
    const pct = total > 0 ? Math.round((watched / total) * 100) : 0;

    const wc = $('watchedCount'); if (wc) wc.textContent = watched;
    const tc = $('totalCount'); if (tc) tc.textContent = total;
    const fill = $('videoProgressFill'); if (fill) fill.style.width = pct + '%';
    const pctEl = $('videoProgressPercentage'); if (pctEl) pctEl.textContent = pct + '%';
    const bar = $('videoProgressBar');
    if (bar) bar.setAttribute('aria-valuenow', String(pct));

    updateProgressMessage(watched, total, pct);
    if ([25, 50, 75, 100].includes(pct)) celebrateMilestone(pct);
  }

  function updateProgressMessage(watched, total, pct) {
    const el = $('videoProgressMessage');
    if (!el) return;
    let m = '';
    if (watched === 0) m = '🎬 Start watching to track your progress!';
    else if (pct < 25) m = `🎯 Great start! ${total - watched} more lectures to go!`;
    else if (pct < 50) m = `🚀 You're ${pct}% done. Keep going!`;
    else if (pct < 75) m = `💪 Halfway there! ${total - watched} lectures remaining.`;
    else if (pct < 100) m = `🔥 Almost there! Just ${total - watched} left!`;
    else m = '🏆 Congratulations! You completed all lectures!';
    el.textContent = m;
  }

  function celebrateMilestone(pct) {
    const wrap = $('videoProgressContainer');
    if (!wrap) return;
    wrap.classList.add('milestone');
    setTimeout(() => wrap.classList.remove('milestone'), 600);
    const msgs = {
      25: '🎯 25% Complete! Great progress!',
      50: '🚀 Halfway there! Amazing!',
      75: '🔥 75% Done! Almost finished!',
      100: '🏆 All lectures completed! Legendary!'
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

  function onVideoWatched() { if (cachedData.length) updateVideoProgress(cachedData); }
  function onVideoUnwatched() { if (cachedData.length) updateVideoProgress(cachedData); }

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

  // ============================================
  // MODAL CLOSE ON OUTSIDE CLICK + ESC
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
    bootstrapAuth();
  });
})();
