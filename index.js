/**
 * Campus Unfolded — Login
 * Single-step Google auth with hardened whitelist check.
 */

(function () {
  'use strict';

  // ============================================
  // CONFIG
  // ============================================
  const CONFIG = Object.freeze({
    COLLECTIONS: { WHITELIST: 'whitelist' },
    STORAGE: { THEME: 'enlighten_theme', SESSION: 'session' },
    ROUTES: { DASHBOARD: 'dashboard.html' },
    UPI_ID: 'exploremiracles2017@okaxis',
    SESSION_TTL_MS: 2 * 60 * 60 * 1000, // 2 hours (informational only)
    TRANSITION_MS: 1400
  });

  // ============================================
  // STATE
  // ============================================
  let signingIn = false;
  let whitelistCache = null; // { email, data, fetchedAt }
  const WHITELIST_CACHE_MS = 60 * 1000;

  // ============================================
  // DOM HELPERS
  // ============================================
  const $ = (id) => document.getElementById(id);

  function setGoogleLoading(loading) {
    const btn = $('googleSignInBtn');
    const text = $('googleBtnText');
    const spinner = $('googleSpinner');
    if (!btn) return;
    btn.disabled = loading;
    text.textContent = loading ? 'Signing in...' : 'Sign in with Google';
    spinner.style.display = loading ? 'block' : 'none';
  }

  function showError(message) {
    const err = $('errorMessage');
    const errText = $('errorText');
    const ok = $('successMessage');
    if (!err || !errText) return;
    errText.textContent = message;
    err.classList.add('show');
    if (ok) ok.classList.remove('show');
  }

  function showSuccess(message) {
    const ok = $('successMessage');
    const okText = $('successText');
    const err = $('errorMessage');
    if (!ok || !okText) return;
    okText.textContent = message;
    ok.classList.add('show');
    if (err) err.classList.remove('show');
  }

  function clearMessages() {
    $('errorMessage')?.classList.remove('show');
    $('successMessage')?.classList.remove('show');
  }

  function showPageTransition(studentName) {
    const transition = $('pageTransition');
    const transitionText = $('transitionText');
    if (!transition) return;
    if (studentName && transitionText) {
      transitionText.textContent = `Welcome, ${studentName.split(' ')[0]}!`;
    }
    transition.classList.add('active');
    transition.setAttribute('aria-hidden', 'false');
  }

  // ============================================
  // THEME
  // ============================================
  function applyTheme(theme) {
    const safe = theme === 'dark' ? 'dark' : 'default';
    document.documentElement.setAttribute('data-theme', safe);
    const icon = $('loginThemeIcon');
    if (icon) icon.textContent = safe === 'dark' ? 'dark_mode' : 'light_mode';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', safe === 'dark' ? '#0d1117' : '#DFDDD3');
  }

  function toggleLoginTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'default';
    const next = current === 'dark' ? 'default' : 'dark';
    try { localStorage.setItem(CONFIG.STORAGE.THEME, next); } catch (_) {}
    applyTheme(next);
  }

  function loadLoginTheme() {
    let saved = 'default';
    try { saved = localStorage.getItem(CONFIG.STORAGE.THEME) || 'default'; } catch (_) {}
    applyTheme(saved);
  }

  // ============================================
  // COPY UPI
  // ============================================
  async function copyUPI(btn) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(CONFIG.UPI_ID);
      } else {
        // Fallback for non-secure contexts
        const ta = document.createElement('textarea');
        ta.value = CONFIG.UPI_ID;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      const original = btn.innerHTML;
      btn.innerHTML = '<span class="material-icons">check</span> Copied!';
      setTimeout(() => { btn.innerHTML = original; }, 2000);
    } catch (err) {
      showError('Could not copy. Please copy manually: ' + CONFIG.UPI_ID);
    }
  }

  // ============================================
  // WHITELIST LOOKUP (with short cache)
  // ============================================
  async function fetchWhitelist(email) {
    const now = Date.now();
    if (whitelistCache &&
        whitelistCache.email === email &&
        now - whitelistCache.fetchedAt < WHITELIST_CACHE_MS) {
      return whitelistCache.data;
    }

    const doc = await db.collection(CONFIG.COLLECTIONS.WHITELIST).doc(email).get();
    const data = doc.exists ? doc.data() : null;
    whitelistCache = { email, data, fetchedAt: now };
    return data;
  }

  // ============================================
  // SIGN-IN
  // ============================================
  async function signInWithGoogle() {
    if (signingIn) return;
    signingIn = true;
    clearMessages();
    setGoogleLoading(true);

    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      let result;
      try {
        result = await auth.signInWithPopup(provider);
      } catch (popupErr) {
        // Fallback to redirect on mobile/PWA
        if (['auth/popup-blocked',
             'auth/operation-not-supported-in-this-environment',
             'auth/cancelled-popup-request'].includes(popupErr.code)) {
          await auth.signInWithRedirect(provider);
          return; // page unloads
        }
        throw popupErr;
      }

      await finishSignIn(result.user);
    } catch (err) {
      handleAuthError(err);
    } finally {
      signingIn = false;
      setGoogleLoading(false);
    }
  }

  async function finishSignIn(user) {
    if (!user || !user.email) {
      await safeSignOut();
      showError('Unable to retrieve your email from Google. Please try again.');
      return;
    }

    const email = user.email.toLowerCase();

    let data;
    try {
      data = await fetchWhitelist(email);
    } catch (err) {
      console.error('Whitelist read error:', err.code);
      await safeSignOut();
      showError('Could not verify access. Please try again in a moment.');
      return;
    }

    if (!data) {
      await safeSignOut();
      showError('No access found for this Gmail. Complete payment first, then return here.');
      return;
    }

    if (data.active !== true) {
      await safeSignOut();
      showError('Your access has been deactivated. Contact support to reactivate.');
      return;
    }

    if (data.expiresAt && typeof data.expiresAt.toDate === 'function') {
      const expiry = data.expiresAt.toDate();
      if (expiry < new Date()) {
        await safeSignOut();
        showError('Your access has expired. Please renew to continue.');
        return;
      }
    }

    // Build local session (informational; server verifies every request)
    const sessionData = {
      uid: user.uid,
      email,
      displayName: data.studentName || user.displayName || 'Student',
      photoURL: user.photoURL || '',
      allowedClasses: Array.isArray(data.allowedClasses) ? data.allowedClasses : [],
      expiresAt: data.expiresAt && typeof data.expiresAt.toDate === 'function'
        ? data.expiresAt.toDate().toISOString()
        : null,
      loginTime: Date.now()
    };

    try {
      localStorage.setItem(CONFIG.STORAGE.SESSION, JSON.stringify(sessionData));
    } catch (_) {}

    showSuccess('Signed in successfully!');

    const name = sessionData.displayName;
    showPageTransition(name);

    setTimeout(() => {
      window.location.href = CONFIG.ROUTES.DASHBOARD;
    }, CONFIG.TRANSITION_MS);
  }

  async function safeSignOut() {
    try { await auth.signOut(); } catch (_) {}
  }

  function handleAuthError(err) {
    const code = (err && err.code) || '';
    const messages = {
      'auth/popup-closed-by-user':   'Sign-in cancelled. Please try again.',
      'auth/cancelled-popup-request':'Sign-in cancelled. Please try again.',
      'auth/popup-blocked':          'Popup was blocked. Allow popups or try again on a mobile device.',
      'auth/network-request-failed': 'Network error. Check your connection and try again.',
      'auth/too-many-requests':      'Too many attempts. Please wait a few minutes.',
      'auth/user-disabled':          'This account has been disabled. Contact support.',
      'auth/account-exists-with-different-credential':
        'This email is registered with a different sign-in method. Use that method.'
    };
    showError(messages[code] || 'Sign-in failed. Please try again.');
    // Log for diagnostics (not shown to user)
    if (code) console.warn('[Auth]', code);
  }

  // ============================================
  // SESSION / REDIRECT RESULT
  // ============================================
  function hasFreshSession() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE.SESSION);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s || !s.loginTime) return false;
      if (Date.now() - s.loginTime > CONFIG.SESSION_TTL_MS) {
        localStorage.removeItem(CONFIG.STORAGE.SESSION);
        return false;
      }
      return true;
    } catch (_) {
      try { localStorage.removeItem(CONFIG.STORAGE.SESSION); } catch (e) {}
      return false;
    }
  }

  async function handleRedirectResult() {
    try {
      const result = await auth.getRedirectResult();
      if (result && result.user) {
        setGoogleLoading(true);
        await finishSignIn(result.user);
        setGoogleLoading(false);
      }
    } catch (err) {
      handleAuthError(err);
    }
  }

  async function redirectIfSessionActive() {
    // Only redirect if Firebase confirms the user is actually signed in
    // AND the local session hasn't expired.
    return new Promise((resolve) => {
      const unsubscribe = auth.onAuthStateChanged((user) => {
        unsubscribe();
        if (user && hasFreshSession()) {
          showPageTransition('');
          setTimeout(() => {
            window.location.href = CONFIG.ROUTES.DASHBOARD;
          }, 300);
        }
        resolve();
      }, () => resolve());
    });
  }

  // ============================================
  // INIT
  // ============================================
  function init() {
    loadLoginTheme();

    if (typeof auth === 'undefined' || typeof db === 'undefined') {
      showError('Authentication service unavailable. Please refresh the page.');
      return;
    }

    // Handle mobile redirect result first
    handleRedirectResult();

    // Don't redirect until Firebase has settled AND we're not handling a redirect result
    redirectIfSessionActive();

    // Clear error on theme toggle (avoid stale error after navigation)
    const themeBtn = document.querySelector('.theme-toggle');
    themeBtn?.addEventListener('click', () => {
      // Already handled inline; nothing extra
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  // Expose only what the HTML needs
  window.toggleLoginTheme = toggleLoginTheme;
  window.copyUPI = copyUPI;
  window.signInWithGoogle = signInWithGoogle;
})();
