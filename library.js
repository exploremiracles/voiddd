/**
 * Campus Unfolded — Library
 * Books and research papers page.
 *
 * Flow:
 * 1. Auth gate (cinematic transition)
 * 2. Verify whitelist
 * 3. Fetch categories + books in parallel
 * 4. Render categories (horizontal bento)
 * 5. Render trending (featured or top-downloaded)
 * 6. Render all books (paginated + infinite scroll)
 * 7. Handle download clicks (increment downloads counter)
 * 8. Book detail drawer (tap card → sheet with details + download)
 */

(function () {
  'use strict';

  // ============================================
  // CONFIG
  // ============================================
  const CONFIG = Object.freeze({
    COLLECTIONS: {
      BOOKS: 'books',
      CATEGORIES: 'libraryCategories',
      WHITELIST: 'whitelist'
    },
    PAGE_SIZE: 5,
    TRENDING_LIMIT: 8,
    AUTH_GATE_MIN_MS: 2200,
    CATEGORY_COLORS: [
      '#5a745f', // sage
      '#c96b8d', // blush
      '#7c9c6b', // olive
      '#6b8fc9', // sky
      '#c98a5b', // terracotta
      '#8a6bc9', // lavender
      '#c9b56b', // gold
      '#5b98a3', // teal
      '#c96b6b', // rose
      '#8a5b98'  // plum
    ]
  });

  // ============================================
  // STATE
  // ============================================
  let currentUser = null;
  let currentUserId = null;
  let allCategories = [];
  let allBooks = [];
  let trendingBooks = [];
  let displayedCount = 0;
  let selectedCategory = null;
  let authGateStartedAt = 0;
  let sentinelObserver = null;
  let isLoadingMore = false;
  let initialLoadComplete = false;
  let activeDrawerBook = null;

  const $ = (id) => document.getElementById(id);

  // ============================================
  // UTIL
  // ============================================
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

  function showToast(message, type = 'success') {
    const toast = $('libraryToast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'scrapbook-toast show' + (type === 'error' ? ' error' : '');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
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
      { text: 'Opening the library',   delay: 0,    progress: 20 },
      { text: 'Loading categories',    delay: 500,  progress: 45 },
      { text: 'Finding trending books',delay: 1000, progress: 70 },
      { text: 'Almost ready',          delay: 1500, progress: 90 }
    ];

    STAGES.forEach(({ text, delay, progress }) => {
      setTimeout(() => {
        if (statusEl) statusEl.textContent = text;
        if (progressBar) progressBar.style.width = `${progress}%`;
      }, delay);
    });
  }

  function hideAuthGate() {
    const gate = $('authGate');
    $('libraryRoot')?.removeAttribute('hidden');
    document.body.style.overflow = 'auto';

    if (!gate) return;

    const elapsed = Date.now() - authGateStartedAt;
    const remaining = Math.max(0, CONFIG.AUTH_GATE_MIN_MS - elapsed);

    setTimeout(() => {
      const progressBar = $('authGateProgressBar');
      const statusEl = $('authGateStatus');
      if (progressBar) progressBar.style.width = '100%';
      if (statusEl) statusEl.textContent = 'Welcome to the library!';

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

  // ============================================
  // THEME TOGGLE
  // ============================================
  function setupThemeToggle() {
    const btn = $('libraryThemeBtn');
    if (!btn) return;

    // Sync icon with current theme
    const syncIcon = () => {
      const t = document.documentElement.getAttribute('data-theme') || 'default';
      const icon = btn.querySelector('.material-icons');
      if (icon) icon.textContent = t === 'default' ? 'dark_mode' : 'light_mode';
    };
    syncIcon();

    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'default';
      const next = current === 'dark' || current === 'midnight' ? 'default' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('enlighten_theme', next); } catch (_) {}
      syncIcon();
    });
  }

  // ============================================
  // AUTH BOOTSTRAP
  // ============================================
  function bootstrap() {
    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        window.location.replace('index.html');
        return;
      }

      currentUser = user;
      currentUserId = user.uid;

      // Verify whitelist
      try {
        const email = (user.email || '').toLowerCase();
        const doc = await db.collection(CONFIG.COLLECTIONS.WHITELIST).doc(email).get();
        if (!doc.exists || doc.data().active !== true) {
          await auth.signOut();
          window.location.replace('index.html');
          return;
        }
      } catch (err) {
        console.warn('[Library] Whitelist check failed:', err.code);
        window.location.replace('index.html');
        return;
      }

      // Load everything
      try {
        await Promise.all([
          loadCategories(),
          loadBooks()
        ]);
        renderCategories();
        renderTrending();
        renderBooks();
        setupInfiniteScroll();
        initialLoadComplete = true;
      } catch (err) {
        console.warn('[Library] Data load failed:', err.code);
        showToast('Could not load library', 'error');
      }

      hideAuthGate();
    }, (err) => {
      console.warn('[Library] Auth error:', err);
      window.location.replace('index.html');
    });
  }

  // ============================================
  // FETCH
  // ============================================
  async function loadCategories() {
    try {
      const snap = await db.collection(CONFIG.COLLECTIONS.CATEGORIES)
        .orderBy('order', 'asc')
        .get();

      allCategories = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || data.displayName || 'Untitled',
          displayName: data.displayName || data.name || 'Untitled',
          icon: data.icon || 'category',
          color: data.color || null,
          order: data.order || 0
        };
      });

      // Auto-assign colors if not set
      allCategories.forEach((cat, i) => {
        if (!cat.color) {
          cat.color = CONFIG.CATEGORY_COLORS[i % CONFIG.CATEGORY_COLORS.length];
        }
      });
    } catch (err) {
      console.warn('[Library] Categories load failed:', err.code);
      allCategories = [];
    }
  }

  async function loadBooks() {
    try {
      const snap = await db.collection(CONFIG.COLLECTIONS.BOOKS)
        .orderBy('uploadedAt', 'desc')
        .get();

      allBooks = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: data.title || 'Untitled',
          author: data.author || 'Unknown',
          description: data.description || '',
          category: data.category || '',
          pdfUrl: data.pdfUrl || '',
          coverImageUrl: data.coverImageUrl || '',
          class: Array.isArray(data.class) ? data.class : [],
          downloads: typeof data.downloads === 'number' ? data.downloads : 0,
          featured: data.featured === true,
          uploadedAt: data.uploadedAt
        };
      });

      // Compute trending: featured first, then by downloads desc
      const featured = allBooks.filter((b) => b.featured);
      const nonFeatured = allBooks
        .filter((b) => !b.featured)
        .sort((a, b) => b.downloads - a.downloads);

      trendingBooks = [...featured, ...nonFeatured].slice(0, CONFIG.TRENDING_LIMIT);
    } catch (err) {
      console.warn('[Library] Books load failed:', err.code);
      allBooks = [];
      trendingBooks = [];
    }
  }

  // ============================================
  // RENDER — CATEGORIES
  // ============================================
  function renderCategories() {
    const container = $('libraryCategories');
    if (!container) return;

    if (!allCategories.length) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    // Count books per category
    const counts = {};
    allBooks.forEach((b) => {
      if (b.category) counts[b.category] = (counts[b.category] || 0) + 1;
    });

    const html = allCategories.map((cat) => {
      const count = counts[cat.name] || 0;
      return `
        <button class="library-category-card"
                data-category="${escapeAttr(cat.name)}"
                style="background: linear-gradient(135deg, ${cat.color} 0%, ${shadeColor(cat.color, -15)} 100%);"
                role="tab"
                aria-label="${escapeAttr(cat.displayName)} — ${count} books">
          <div class="library-category-icon">
            <span class="material-icons">${escapeHtml(cat.icon)}</span>
          </div>
          <div class="library-category-info">
            <div class="library-category-name">${escapeHtml(cat.displayName)}</div>
            <div class="library-category-count">${count} ${count === 1 ? 'book' : 'books'}</div>
          </div>
        </button>
      `;
    }).join('');

    container.innerHTML = html;

    // Wire clicks
    container.querySelectorAll('.library-category-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.category;
        selectCategory(cat);
      });
    });
  }

  // Darken/lighten hex color
  function shadeColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, Math.min(255, (num >> 16) + Math.round(255 * percent / 100)));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + Math.round(255 * percent / 100)));
    const b = Math.max(0, Math.min(255, (num & 0x0000FF) + Math.round(255 * percent / 100)));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  // ============================================
  // RENDER — TRENDING
  // ============================================
  function renderTrending() {
    const container = $('libraryTrending');
    if (!container) return;

    if (!trendingBooks.length) {
      container.innerHTML = `
        <div class="library-empty" style="grid-column: 1/-1; padding: 2rem 1rem;">
          <span class="material-icons">auto_stories</span>
          <h3>No trending books yet</h3>
          <p>Popular books will appear here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = trendingBooks
      .map((book) => renderBookCard(book, true))
      .join('');

    wireBookCardButtons(container);
  }

  // ============================================
  // RENDER — BOOKS GRID
  // ============================================
  function renderBooks() {
    const container = $('libraryBooks');
    const emptyState = $('libraryEmpty');
    const countEl = $('libraryBooksCount');
    if (!container) return;

    let books = allBooks;
    if (selectedCategory) {
      books = books.filter((b) => b.category === selectedCategory);
    }

    if (countEl) {
      countEl.textContent = books.length
        ? `${books.length} ${books.length === 1 ? 'book' : 'books'}`
        : '';
    }

    if (!books.length) {
      container.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    // Reset and render first batch
    displayedCount = Math.min(CONFIG.PAGE_SIZE, books.length);
    const batch = books.slice(0, displayedCount);

    container.innerHTML = batch.map((book, i) => {
      const card = renderBookCard(book, false);
      // Add stagger delay
      const delay = Math.min(i, 10) * 40;
      return card.replace('class="library-book-card"', `class="library-book-card reveal" style="animation-delay:${delay}ms;"`);
    }).join('');

    wireBookCardButtons(container);
  }

  function appendBooksBatch() {
    if (isLoadingMore) return;
    isLoadingMore = true;

    const container = $('libraryBooks');
    if (!container) { isLoadingMore = false; return; }

    let books = allBooks;
    if (selectedCategory) {
      books = books.filter((b) => b.category === selectedCategory);
    }

    if (displayedCount >= books.length) {
      isLoadingMore = false;
      return;
    }

    const start = displayedCount;
    const end = Math.min(start + CONFIG.PAGE_SIZE, books.length);
    const batch = books.slice(start, end);

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = batch.map((book, i) => {
      const card = renderBookCard(book, false);
      const delay = Math.min(i, 10) * 40;
      return card.replace('class="library-book-card"', `class="library-book-card reveal" style="animation-delay:${delay}ms;"`);
    }).join('');

    while (tempDiv.firstChild) {
      container.appendChild(tempDiv.firstChild);
    }

    wireBookCardButtons(container);
    displayedCount = end;
    isLoadingMore = false;
  }

  // ============================================
  // BOOK CARD RENDER
  // ============================================
  function renderBookCard(book, isTrending) {
    const title = escapeHtml(book.title);
    const author = escapeHtml(book.author);
    const description = escapeHtml(book.description);
    const category = escapeHtml(book.category);
    const pdfUrl = escapeAttr(book.pdfUrl);
    const coverUrl = escapeAttr(book.coverImageUrl);
    const downloads = book.downloads;
    const bookId = escapeAttr(book.id);

    const trendingBadge = (isTrending && (book.featured || downloads > 0))
      ? `<div class="library-book-trending-badge">
           <span class="material-icons">star</span>
           Featured
         </div>`
      : '';

    const coverHtml = book.coverImageUrl
      ? `<img src="${coverUrl}" class="library-book-cover-img" alt="${title}" loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
         <div class="library-book-cover-fallback" style="display:none;">
           <span class="material-icons">menu_book</span>
           <div class="library-book-cover-fallback-title">${title}</div>
         </div>`
      : `<div class="library-book-cover-fallback">
           <span class="material-icons">menu_book</span>
           <div class="library-book-cover-fallback-title">${title}</div>
         </div>`;

    return `
      <div class="library-book-card ${isTrending ? 'trending' : ''}"
           data-book-id="${bookId}"
           role="button"
           tabindex="0">
        <div class="library-book-cover">
          ${trendingBadge}
          ${coverHtml}
          <div class="library-book-downloads-badge">
            <span class="material-icons">download</span>
            <span>${downloads}</span>
          </div>
        </div>
        <div class="library-book-info">
          ${category ? `<div class="library-book-category">${category}</div>` : ''}
          <h3 class="library-book-title">${title}</h3>
          <p class="library-book-author">by ${author}</p>
          ${description ? `<p class="library-book-desc">${description}</p>` : ''}
          <a href="${pdfUrl || '#'}"
             target="_blank"
             rel="noopener noreferrer"
             class="library-book-download-btn"
             data-download-book-id="${bookId}"
             ${!pdfUrl ? 'aria-disabled="true"' : ''}>
            <span class="material-icons">download</span>
            <span>Download PDF</span>
          </a>
        </div>
      </div>
    `;
  }

  function wireBookCardButtons(container) {
    if (!container) return;
    // Download button click → increment counter
    container.querySelectorAll('[data-download-book-id]').forEach((btn) => {
      if (btn.dataset.wired === 'true') return;
      btn.dataset.wired = 'true';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const bookId = btn.dataset.downloadBookId;
        const href = btn.getAttribute('href');
        if (!href || href === '#') {
          e.preventDefault();
          showToast('PDF not available yet', 'error');
          return;
        }
        // Increment download count (fire and forget — doesn't block opening)
        incrementDownloadCount(bookId);
      });
    });

    // Card click → open detail drawer
    container.querySelectorAll('.library-book-card').forEach((card) => {
      if (card.dataset.wired === 'true') return;
      card.dataset.wired = 'true';
      card.addEventListener('click', (e) => {
        // Ignore if clicking the download button
        if (e.target.closest('[data-download-book-id]')) return;
        openBookDrawer(card.dataset.bookId);
      });

      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      });
    });
  }

  async function incrementDownloadCount(bookId) {
    try {
      // Atomic increment — rules allow ONLY this field to change by any auth user
      await db.collection(CONFIG.COLLECTIONS.BOOKS).doc(bookId).update({
        downloads: firebase.firestore.FieldValue.increment(1)
      });

      // Update local state so UI reflects immediately
      const book = allBooks.find((b) => b.id === bookId);
      if (book) book.downloads = (book.downloads || 0) + 1;

      // Update the visible counter badge
      const card = document.querySelector(`[data-book-id="${bookId}"]`);
      if (card) {
        const badge = card.querySelector('.library-book-downloads-badge span:last-child');
        if (badge && book) badge.textContent = book.downloads;
      }

      // Also update the drawer counter if this book is currently open
      if (activeDrawerBook && activeDrawerBook.id === bookId) {
        const drawerDownloads = $('bookDrawerDownloads');
        if (drawerDownloads) drawerDownloads.textContent = book ? book.downloads : '';
      }
    } catch (err) {
      // Silent failure — don't block the actual download
      console.warn('[Library] Download count update failed:', err.code);
    }
  }

  // ============================================
  // CATEGORY SELECT
  // ============================================
  function selectCategory(categoryName) {
    if (selectedCategory === categoryName) {
      // Deselect
      selectedCategory = null;
    } else {
      selectedCategory = categoryName;
    }

    // Update active states
    document.querySelectorAll('.library-category-card').forEach((card) => {
      const isActive = card.dataset.category === selectedCategory;
      card.classList.toggle('library-category-card-active', isActive);
    });

    // Update title
    const booksTitle = $('libraryBooksTitle');
    if (booksTitle) {
      booksTitle.textContent = selectedCategory
        ? `${selectedCategory} Books`
        : 'All Books';
    }

    // Scroll to books section
    const booksSection = $('libraryBooks');
    booksSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    renderBooks();
  }

  // ============================================
  // BOOK DETAIL DRAWER
  // ============================================
  function openBookDrawer(bookId) {
    const book = allBooks.find((b) => b.id === bookId);
    if (!book) return;

    activeDrawerBook = book;

    const overlay = $('bookDrawerOverlay');
    if (!overlay) return;

    // Cover (DOM API — no inline onerror, CSP-safe)
    const cover = $('bookDrawerCover');
    if (cover) {
      cover.innerHTML = '';
      if (book.coverImageUrl) {
        const img = document.createElement('img');
        img.src = book.coverImageUrl;
        img.alt = book.title || '';
        img.addEventListener('error', () => {
          cover.innerHTML = '<span class="material-icons">menu_book</span>';
        }, { once: true });
        cover.appendChild(img);
      } else {
        cover.innerHTML = '<span class="material-icons">menu_book</span>';
      }
    }

    const catEl = $('bookDrawerCategory');
    if (catEl) catEl.textContent = book.category || '';

    const titleEl = $('bookDrawerTitle');
    if (titleEl) titleEl.textContent = book.title || 'Untitled';

    const authorEl = $('bookDrawerAuthor');
    if (authorEl) authorEl.textContent = book.author ? `by ${book.author}` : '';

    const downloadsEl = $('bookDrawerDownloads');
    if (downloadsEl) downloadsEl.textContent = book.downloads || 0;

    const descEl = $('bookDrawerDesc');
    if (descEl) descEl.textContent = book.description || '';

    const dlBtn = $('bookDrawerDownloadBtn');
    if (dlBtn) {
      const labelEl = dlBtn.querySelector('span:last-child');
      if (book.pdfUrl) {
        dlBtn.href = book.pdfUrl;
        dlBtn.removeAttribute('aria-disabled');
        if (labelEl) labelEl.textContent = 'Download PDF';
      } else {
        dlBtn.href = '#';
        dlBtn.setAttribute('aria-disabled', 'true');
        if (labelEl) labelEl.textContent = 'Not available';
      }
    }

    // Show
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeBookDrawer() {
    const overlay = $('bookDrawerOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    activeDrawerBook = null;
  }

  function setupBookDrawer() {
    const overlay = $('bookDrawerOverlay');
    const closeBtn = $('bookDrawerClose');
    const dlBtn = $('bookDrawerDownloadBtn');

    if (!overlay) return;

    // Close button
    closeBtn?.addEventListener('click', closeBookDrawer);

    // Overlay click (outside drawer)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeBookDrawer();
    });

    // ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('active')) {
        closeBookDrawer();
      }
    });

    // Download button inside drawer
    dlBtn?.addEventListener('click', (e) => {
      if (!activeDrawerBook || !activeDrawerBook.pdfUrl) {
        e.preventDefault();
        showToast('PDF not available yet', 'error');
        return;
      }
      incrementDownloadCount(activeDrawerBook.id);
      showToast('Opening PDF…');
      // let the <a> open normally
    });
  }

  // ============================================
  // INFINITE SCROLL
  // ============================================
  function setupInfiniteScroll() {
    const sentinel = $('librarySentinel');
    if (!sentinel) return;

    if ('IntersectionObserver' in window) {
      sentinelObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && initialLoadComplete) {
            appendBooksBatch();
          }
        });
      }, {
        rootMargin: '400px 0px 400px 0px',
        threshold: 0
      });
      sentinelObserver.observe(sentinel);
    }
  }

  // ============================================
  // BOOT
  // ============================================
  document.addEventListener('DOMContentLoaded', () => {
    startAuthGateAnimation();
    setupThemeToggle();
    setupBookDrawer();

    if (typeof firebase !== 'undefined' && firebase.auth) {
      bootstrap();
    } else {
      console.warn('[Library] Firebase not loaded');
    }
  });
})();
