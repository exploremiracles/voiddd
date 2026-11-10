/**
 * Campus Unfolded — Cross Search
 * sessionStorage cache (survives page back), onUserReady() gate,
 * array-contains-any for posts, access verification on click.
 */

(function () {
  'use strict';

  const CONFIG = Object.freeze({
    RESULTS_PER_PAGE: 8,
    DEBOUNCE_MS: 280,
    CACHE_TTL_MS: 5 * 60 * 1000,
    CACHE_MAX_ENTRIES: 20,
    CACHE_STORAGE_KEY: 'enlighten_search_cache',
    LIMIT_PER_COLLECTION: 30,
    POSTS_LIMIT: 50,
    MAX_CLASSES: 10
  });

  const TYPE_CONFIG = {
    video: { icon: 'play_circle', label: 'Video', cls: 'video', tab: 'videos' },
    pdf:   { icon: 'picture_as_pdf', label: 'PDF', cls: 'pdf', tab: 'pdfs' },
    image: { icon: 'image', label: 'Image', cls: 'image', tab: 'images' },
    post:  { icon: 'article', label: 'Post', cls: 'post', tab: 'posts' }
  };

  // ============================================
  // CACHE (sessionStorage-backed)
  // ============================================
  class SearchCache {
    constructor() {
      this.map = new Map();
      this.load();
    }
    load() {
      try {
        const raw = sessionStorage.getItem(CONFIG.CACHE_STORAGE_KEY);
        if (!raw) return;
        const arr = JSON.parse(raw);
        const now = Date.now();
        for (const [key, val] of arr) {
          if (val && now - val.timestamp < CONFIG.CACHE_TTL_MS) {
            this.map.set(key, val);
          }
        }
      } catch (_) {}
    }
    save() {
      try {
        const arr = Array.from(this.map.entries())
          .sort((a, b) => b[1].timestamp - a[1].timestamp)
          .slice(0, CONFIG.CACHE_MAX_ENTRIES);
        sessionStorage.setItem(CONFIG.CACHE_STORAGE_KEY, JSON.stringify(arr));
      } catch (_) {}
    }
    get(query) {
      const entry = this.map.get(query);
      if (!entry) return null;
      if (Date.now() - entry.timestamp > CONFIG.CACHE_TTL_MS) {
        this.map.delete(query);
        return null;
      }
      return entry.data;
    }
    set(query, data) {
      if (this.map.size >= CONFIG.CACHE_MAX_ENTRIES) {
        // Evict oldest
        let oldestKey = null, oldest = Infinity;
        for (const [k, v] of this.map) {
          if (v.timestamp < oldest) { oldest = v.timestamp; oldestKey = k; }
        }
        if (oldestKey) this.map.delete(oldestKey);
      }
      this.map.set(query, { data, timestamp: Date.now() });
      this.save();
    }
    clear() {
      this.map.clear();
      try { sessionStorage.removeItem(CONFIG.CACHE_STORAGE_KEY); } catch (_) {}
    }
  }

  // ============================================
  // CROSS SEARCH
  // ============================================
  class CrossSearch {
    constructor() {
      this.searchInput = null;
      this.searchResults = null;
      this.clearBtn = null;
      this.spinner = null;
      this.debounceTimer = null;
      this.currentQuery = '';
      this.allResults = [];
      this.displayedCount = 0;
      this.searchStartTime = 0;
      this.listenersAttached = false;
      this.classesCache = null;
      this.lastSearchQuery = '';
      this.cache = new SearchCache();
      this.searchRunId = 0;
    }

    async initialize() {
      if (!document.getElementById('searchInput')) this.createSearchUI();

      // Wait for dashboard to confirm user + classes
      await new Promise((resolve) => {
        if (typeof window.onUserReady === 'function') {
          window.onUserReady(resolve);
        } else {
          const t0 = Date.now();
          const tick = setInterval(() => {
            if (typeof currentUser !== 'undefined' && currentUser &&
                currentUser.allowedClasses && currentUser.allowedClasses.length) {
              clearInterval(tick); resolve();
            } else if (Date.now() - t0 > 10000) {
              clearInterval(tick); resolve();
            }
          }, 150);
        }
      });

      if (typeof currentUser !== 'undefined' && currentUser && currentUser.allowedClasses) {
        this.classesCache = currentUser.allowedClasses.slice();
      }
      this.attachListeners();
    }

    createSearchUI() {
      if (document.getElementById('searchContainer')) return;
      const html = `
        <div class="search-container" id="searchContainer">
          <div class="search-bar">
            <span class="material-icons search-icon">search</span>
            <input type="text" class="search-input" id="searchInput"
                   placeholder="Search videos, PDFs, images, posts..."
                   autocomplete="off" aria-label="Search content">
            <div class="search-spinner" id="searchSpinner"></div>
            <button class="search-clear" id="searchClear" aria-label="Clear search">
              <span class="material-icons">close</span>
            </button>
          </div>
          <div class="search-results" id="searchResults" role="listbox"></div>
        </div>
      `;
      const filters = document.querySelector('.filters-section');
      if (filters && filters.parentNode) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        filters.parentNode.insertBefore(tmp.firstElementChild, filters);
      }
    }

    attachListeners() {
      if (this.listenersAttached) return;
      this.searchInput = document.getElementById('searchInput');
      this.searchResults = document.getElementById('searchResults');
      this.clearBtn = document.getElementById('searchClear');
      this.spinner = document.getElementById('searchSpinner');
      if (!this.searchInput) return;

      this.searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        this.clearBtn.classList.toggle('visible', query.length > 0);
        if (!query) { this.hideResults(); return; }
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.performSearch(query), CONFIG.DEBOUNCE_MS);
      });

      this.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          clearTimeout(this.debounceTimer);
          this.performSearch(e.target.value.trim());
        }
        if (e.key === 'Escape') this.clearSearch();
      });

      this.clearBtn.addEventListener('click', () => this.clearSearch());

      document.addEventListener('click', (e) => {
        if (!e.target.closest('#searchContainer')) this.hideResults();
      });

      this.listenersAttached = true;
    }

    async getAllowedClasses() {
  // 1. Cache hit
  if (this.classesCache && this.classesCache.length) return this.classesCache;

  // 2. Primary: ask dashboard via exposed getter (IIFE-safe)
  if (typeof window.__CU_getUser === 'function') {
    const user = window.__CU_getUser();
    if (user && Array.isArray(user.allowedClasses) && user.allowedClasses.length) {
      this.classesCache = user.allowedClasses.slice();
      return this.classesCache;
    }
  }

  // 3. Fallback: read from localStorage session (still maintained by dashboard.js)
  try {
    const raw = localStorage.getItem('session');
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.allowedClasses) && s.allowedClasses.length) {
        this.classesCache = s.allowedClasses.slice();
        return this.classesCache;
      }
    }
  } catch (_) {}

  // 4. Last resort: legacy global (kept for compatibility, normally unused)
  if (typeof window.currentUser !== 'undefined' && window.currentUser) {
    const classes = window.currentUser.allowedClasses;
    if (Array.isArray(classes) && classes.length) {
      this.classesCache = classes.slice();
      return this.classesCache;
    }
  }

  return [];
}

    async performSearch(query) {
      if (!query || query.length < 2) { this.hideResults(); return; }

      const lower = query.toLowerCase();
      this.currentQuery = lower;

      // Skip duplicate
      if (lower === this.lastSearchQuery && this.allResults.length) {
        this.displayResults(this.allResults, false);
        return;
      }
      this.lastSearchQuery = lower;

      // Cache hit
      const cached = this.cache.get(lower);
      if (cached) {
        this.allResults = cached;
        this.displayedCount = 0;
        this.displayResults(cached, false);
        return;
      }

      // Prefix-match cache: if "phys" cached and query is "physi",
      // filter in-memory rather than network again
      for (const [key] of this.cache.map) {
        if (key.length >= 2 && lower.startsWith(key)) {
          const parent = this.cache.get(key);
          if (parent) {
            const filtered = this.filterResults(parent, lower);
            this.allResults = filtered;
            this.displayedCount = 0;
            this.cache.set(lower, filtered);
            this.displayResults(filtered, false);
            return;
          }
        }
      }

      const runId = ++this.searchRunId;
      this.searchStartTime = Date.now();
      this.spinner.classList.add('visible');

      try {
        const classes = await this.getAllowedClasses();
        if (!classes.length) {
          this.spinner.classList.remove('visible');
          this.showError('Please wait, loading your content...');
          return;
        }

        const [videos, pdfs, images, posts] = await Promise.all([
          this.searchCollection('videos', classes),
          this.searchCollection('pdfs', classes),
          this.searchCollection('images', classes),
          this.searchPosts(classes)
        ]);

        // Abort if another search started
        if (runId !== this.searchRunId) return;

        const all = [
          ...videos.map((v) => ({ ...v, type: 'video' })),
          ...pdfs.map((p) => ({ ...p, type: 'pdf' })),
          ...images.map((i) => ({ ...i, type: 'image' })),
          ...posts.map((p) => ({ ...p, type: 'post' }))
        ];

        // Dedup
        const seen = new Set();
        const deduped = all.filter((r) => {
          const key = `${r.type}_${r.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        const filtered = this.filterResults(deduped, lower);
        const sorted = this.sortByRelevance(filtered, lower);

        this.cache.set(lower, sorted);
        this.allResults = sorted;
        this.displayedCount = 0;

        const elapsed = Date.now() - this.searchStartTime;
        if (elapsed < 200) {
          await new Promise((r) => setTimeout(r, 200 - elapsed));
        }
        if (runId !== this.searchRunId) return;

        this.spinner.classList.remove('visible');
        this.displayResults(sorted, false);
      } catch (err) {
        if (runId !== this.searchRunId) return;
        console.warn('[Search] error:', err.code || err.message);
        this.spinner.classList.remove('visible');
        this.showError('Search failed. Please try again.');
      }
    }

    async searchCollection(collectionName, allowedClasses) {
      try {
        const classes = allowedClasses.slice(0, CONFIG.MAX_CLASSES);
        const snap = await db.collection(collectionName)
          .where('class', 'in', classes)
          .limit(CONFIG.LIMIT_PER_COLLECTION)
          .get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch (err) {
        if (err.code === 'permission-denied') {
          // Treat as revoked — dashboard will handle redirect
          console.warn('[Search] permission denied on', collectionName);
        }
        return [];
      }
    }

    async searchPosts(allowedClasses) {
      try {
        const classes = allowedClasses.slice(0, CONFIG.MAX_CLASSES);
        const snap = await db.collection('posts')
          .where('class', 'array-contains-any', classes)
          .limit(CONFIG.POSTS_LIMIT)
          .get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch (err) {
        if (err.code === 'permission-denied') {
          console.warn('[Search] permission denied on posts');
        }
        return [];
      }
    }

    filterResults(results, query) {
      return results.filter((item) => {
        const fields = [
          item.title, item.subject, item.description,
          item.content, item.class, item.studentName
        ].filter(Boolean);
        return fields.some((f) => String(f).toLowerCase().includes(query));
      });
    }

    sortByRelevance(results, query) {
      return results.sort((a, b) => {
        const aT = (a.title || '').toLowerCase();
        const bT = (b.title || '').toLowerCase();
        const aExact = aT === query ? 3 : 0;
        const bExact = bT === query ? 3 : 0;
        if (aExact !== bExact) return bExact - aExact;
        const aStart = aT.startsWith(query) ? 2 : 0;
        const bStart = bT.startsWith(query) ? 2 : 0;
        if (aStart !== bStart) return bStart - aStart;
        const aIn = aT.includes(query) ? 1 : 0;
        const bIn = bT.includes(query) ? 1 : 0;
        if (aIn !== bIn) return bIn - aIn;
        return aT.localeCompare(bT);
      });
    }

    displayResults(results, append = false) {
      if (!this.searchResults) return;

      if (!append) {
        this.searchResults.innerHTML = '';
        this.searchResults.classList.add('visible');
      }

      if (results.length === 0) {
        this.showEmpty();
        return;
      }

      this.searchResults.querySelector('.search-show-more')?.remove();

      const start = this.displayedCount;
      const end = Math.min(start + CONFIG.RESULTS_PER_PAGE, results.length);
      const batch = results.slice(start, end);

      if (!append) {
        const header = document.createElement('div');
        header.className = 'search-results-header';
        header.innerHTML = `
          <span>Search Results</span>
          <span class="search-results-count">${results.length} found</span>
        `;
        this.searchResults.appendChild(header);
      }

      const frag = document.createDocumentFragment();
      batch.forEach((item) => frag.appendChild(this.createResultElement(item)));
      this.searchResults.appendChild(frag);
      this.displayedCount = end;

      if (this.displayedCount < results.length) {
        const btn = document.createElement('button');
        btn.className = 'search-show-more';
        btn.innerHTML = `
          <span class="material-icons">expand_more</span>
          <span>Show more (${results.length - this.displayedCount} remaining)</span>
        `;
        btn.onclick = (e) => { e.stopPropagation(); this.displayResults(results, true); };
        this.searchResults.appendChild(btn);
      }
    }

    createResultElement(item) {
      const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.video;
      const title = this.highlightText(item.title || 'Untitled', this.currentQuery);
      const meta = [];
      if (item.subject) meta.push({ icon: 'menu_book', text: item.subject });
      if (item.class) {
        const cls = Array.isArray(item.class) ? item.class.join(', ') : item.class;
        meta.push({ icon: 'school', text: cls });
      }
      if (item.duration) meta.push({ icon: 'schedule', text: item.duration });

      const el = document.createElement('div');
      el.className = 'search-result-item';
      el.setAttribute('role', 'option');
      el.innerHTML = `
        <div class="result-badge ${cfg.cls}">
          <span class="material-icons">${cfg.icon}</span>
          <span>${cfg.label}</span>
        </div>
        <div class="result-content">
          <div class="result-title">${title}</div>
          <div class="result-meta">
            ${meta.map((m) => `
              <span class="meta-item">
                <span class="material-icons">${m.icon}</span>
                ${this.escapeHtml(m.text)}
              </span>
            `).join('')}
          </div>
        </div>
      `;
      el.addEventListener('click', () => this.handleResultClick(item));
      return el;
    }

    highlightText(text, query) {
      if (!text) return '';
      const escaped = this.escapeHtml(text);
      if (!query) return escaped;
      const re = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
      return escaped.replace(re, '<span class="search-highlight">$1</span>');
    }
    escapeHtml(text) {
      const d = document.createElement('div');
      d.textContent = text == null ? '' : String(text);
      return d.innerHTML;
    }
    escapeRegex(s) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    async handleResultClick(item) {
      this.hideResults();
      const cfg = TYPE_CONFIG[item.type];
      if (!cfg) return;

      if (typeof switchTab === 'function') switchTab(cfg.tab);
      await new Promise((r) => setTimeout(r, 350));

      // Resolve target class + verify access
      let targetClass = null;
      const studentClasses = (typeof currentUser !== 'undefined' && currentUser && currentUser.allowedClasses) ||
                             [];
      if (item.class) {
        if (Array.isArray(item.class)) {
          targetClass = item.class.find((c) => studentClasses.includes(c)) || null;
        } else {
          targetClass = studentClasses.includes(item.class) ? item.class : null;
        }
      }
      if (!targetClass) {
        this.showToast('You do not have access to this content', 'error');
        return;
      }

      const chips = document.querySelectorAll('.class-chips .chip');
      let chipToClick = null;
      let alreadyActive = false;
      chips.forEach((chip) => {
        const cls = chip.dataset.class || chip.textContent.trim();
        if (cls === targetClass) {
          chipToClick = chip;
          if (chip.classList.contains('active')) alreadyActive = true;
        }
      });
      if (!chipToClick) {
        this.showToast('Class not available', 'error');
        return;
      }
      if (!alreadyActive) {
        chipToClick.click();
        // Wait for content to load + class to apply
        await new Promise((r) => setTimeout(r, 800));
        // Verify class actually got selected
        if (typeof selectedClass !== 'undefined' && selectedClass !== targetClass) {
          this.showToast('Could not switch to that class', 'error');
          return;
        }
      }

      await new Promise((r) => setTimeout(r, 400));
      this.scrollToAndHighlight(item);

      this.searchInput.value = '';
      this.clearBtn.classList.remove('visible');
    }

    scrollToAndHighlight(item) {
      let attempts = 0;
      const maxAttempts = 30;
      let autoLoads = 0;
      const maxAutoLoads = 20;

      this.showLoadingToast('Loading content...');

      const tryFind = () => {
        attempts++;
        let card = null;
        try {
          card = document.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`);
        } catch (_) {
          card = document.querySelector(`[data-item-id="${item.id}"]`);
        }
        if (card) {
          this.hideLoadingToast();
          this.highlightCard(card);
          return;
        }
        const loadMore = document.querySelector('.load-more-btn:not(.modal-content .load-more-btn)');
        if (loadMore && autoLoads < maxAutoLoads) {
          autoLoads++;
          loadMore.click();
          setTimeout(tryFind, 200);
          return;
        }
        if (attempts >= maxAttempts) {
          this.hideLoadingToast();
          this.showToast('Content not found', 'error');
          return;
        }
        setTimeout(tryFind, 200);
      };
      setTimeout(tryFind, 400);
    }

    highlightCard(card) {
      document.querySelectorAll('.golden-highlight').forEach((el) => el.classList.remove('golden-highlight'));
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        card.classList.add('golden-highlight');
        setTimeout(() => card.classList.remove('golden-highlight'), 3200);
      }, 500);
      this.showToast('Content found!', 'success');
    }

    showLoadingToast(message) {
      this.hideLoadingToast();
      const toast = document.createElement('div');
      toast.className = 'search-loading-toast';
      toast.style.cssText = `
        position: fixed; bottom: 30px; left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #5a745f, #7c967a);
        color: white; padding: 14px 24px; border-radius: 25px;
        font-weight: 600; font-size: 0.85rem;
        box-shadow: 0 10px 30px rgba(90,116,95,0.4);
        z-index: 99999; display: flex; align-items: center; gap: 10px;
        font-family: inherit;
      `;
      toast.innerHTML = `
        <div style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);
                    border-top-color:white;border-radius:50%;
                    animation:spin 0.6s linear infinite;"></div>
        <span>${message}</span>
      `;
      document.body.appendChild(toast);
    }
    hideLoadingToast() {
      document.querySelector('.search-loading-toast')?.remove();
    }

    showEmpty() {
      if (!this.searchResults) return;
      this.searchResults.innerHTML = `
        <div class="search-empty">
          <span class="material-icons">search_off</span>
          <div class="search-empty-title">No results found</div>
          <div class="search-empty-desc">Try different keywords</div>
        </div>
      `;
      this.searchResults.classList.add('visible');
    }

    showError(message) {
      if (!this.searchResults) return;
      this.searchResults.innerHTML = `
        <div class="search-empty">
          <span class="material-icons">error_outline</span>
          <div class="search-empty-title">${this.escapeHtml(message)}</div>
        </div>
      `;
      this.searchResults.classList.add('visible');
    }

    showToast(message, type = 'info') {
      document.querySelector('.search-toast')?.remove();
      let bg = 'linear-gradient(135deg, #6b7280, #9ca3af)';
      let icon = 'info';
      if (type === 'error') { bg = 'linear-gradient(135deg, #DC2626, #ef4444)'; icon = 'error'; }
      if (type === 'success') { bg = 'linear-gradient(135deg, #059669, #10b981)'; icon = 'check_circle'; }

      const toast = document.createElement('div');
      toast.className = 'search-toast';
      toast.style.cssText = `
        position: fixed; bottom: 30px; left: 50%;
        transform: translateX(-50%) translateY(100px);
        background: ${bg}; color: white; padding: 12px 22px;
        border-radius: 25px; font-weight: 600; font-size: 0.85rem;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        z-index: 99999; transition: transform 0.4s ease;
        font-family: inherit; display: flex; align-items: center; gap: 8px;
      `;
      toast.innerHTML = `<span class="material-icons" style="font-size:18px;">${icon}</span><span>${message}</span>`;
      document.body.appendChild(toast);
      setTimeout(() => { toast.style.transform = 'translateX(-50%) translateY(0)'; }, 50);
      setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(100px)';
        setTimeout(() => toast.remove(), 400);
      }, 2500);
    }

    hideResults() {
      this.searchResults?.classList.remove('visible');
    }

    clearSearch() {
      if (this.searchInput) this.searchInput.value = '';
      this.clearBtn?.classList.remove('visible');
      this.hideResults();
      this.currentQuery = '';
      this.lastSearchQuery = '';
      this.allResults = [];
      this.displayedCount = 0;
    }

    clearCache() {
      this.cache.clear();
    }
  }

  // ============================================
  // INIT
  // ============================================
  let crossSearch = null;

  document.addEventListener('DOMContentLoaded', () => {
    crossSearch = new CrossSearch();
    crossSearch.initialize();
  });

  window.clearSearch = () => crossSearch?.clearSearch();
  window.clearSearchCache = () => crossSearch?.clearCache();
})();
