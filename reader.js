/**
 * Campus Unfolded — Reader
 * Sessions 2 + 3 + 4 + 5 (continuous scroll mode)
 */

(function () {
    'use strict';

    const CONFIG = Object.freeze({
        COLLECTIONS: {
            BOOKS: 'books',
            WHITELIST: 'whitelist',
            READING_PROGRESS: 'readingProgress',
            READING_HISTORY: 'readingHistory'
        },
        AUTH_GATE_MIN_MS: 1800,
        ZOOM_MIN: 0.25,
        ZOOM_MAX: 3.0,
        ZOOM_STEP: 0.15,
        PREF_KEY: 'cu_reader_prefs',
        PROGRESS_SAVE_DEBOUNCE_MS: 1500,
        SESSION_TICK_MS: 1000,
        HISTORY_FLUSH_MS: 30000,
        THUMB_MAX_PAGES: 100,
        THUMB_SCALE: 0.25,
        NOTE_MAX_CHARS: 1500,
        SWIPE_THRESHOLD_PX: 60,
        SWIPE_MAX_VERTICAL_PX: 80,
        // Continuous
        SCROLL_PREFETCH_PAGES: 2,   // render this many pages above/below viewport
        SCROLL_PAGE_GAP: 16,
        SCROLL_RENDER_SCALE: 1.5,   // resolution multiplier for continuous canvases
        SCROLL_DETECT_SCROLL_DEBOUNCE: 120
    });

    let currentUser = null;
    let currentUserId = null;
    let bookId = null;
    let bookData = null;
    let pdfDoc = null;
    let totalPages = 0;

    let currentPage = 1;
    let maxPageReached = 1;

    let currentScale = 1.0;
    let zoomMode = 'auto';
    let readerTheme = 'light';
    let brightness = 100;
    let readingMode = 'continuous'; // 'single' | 'continuous'

    let authGateStartedAt = 0;

    // Single mode
    let rendering = false;
    let renderTask = null;

    // Continuous mode
    let scrollPageStates = [];      // [{ el, rendered, rendering, height, viewportWidth }]
    let scrollObserver = null;      // IntersectionObserver for lazy render
    let scrollActiveObserver = null; // tracks which page is "active"
    let scrollUpdateTimer = null;
    let scrollInitialPage = 1;
    let scrollRenderedAtScale = 0;  // track re-render on zoom

    let progressRef = null;
    let progressUnsubscribe = null;
    let progressData = null;
    let progressSaveTimer = null;
    let progressDirty = false;
    let historyRef = null;
    let historyFlushTimer = null;

    let sessionStartMs = 0;
    let sessionElapsedMs = 0;
    let totalReadingMs = 0;
    let pagesReadThisSession = 0;
    let sessionTickInterval = null;
    let isPageVisible = true;

    let bookmarks = [];
    let notes = [];

    let thumbsRendered = new Set();
    let thumbsObserver = null;

    let resumeTargetPage = 1;
    let resumeShown = false;

    let editingNotePage = null;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let touchActive = false;

    let toolbarVisibility = {};

    const $ = (id) => document.getElementById(id);
    const scrollStack = () => $('readerScrollStack');
    const mainEl = () => $('readerMain');

    // ============================================
    // UTIL
    // ============================================
    function escapeHtml(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }
    function nowMs() { return Date.now(); }
    function dateKey(d = new Date()) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    function progressDocId() { return `${currentUserId}__${bookId}`; }
    function historyDocId() { return `${currentUserId}__${bookId}__${dateKey()}`; }

    function savePrefs() {
        try {
            localStorage.setItem(CONFIG.PREF_KEY, JSON.stringify({
                readerTheme, brightness, zoomMode, toolbarVisibility, readingMode
            }));
        } catch (_) {}
    }

    function loadPrefs() {
        try {
            const raw = localStorage.getItem(CONFIG.PREF_KEY);
            if (!raw) return;
            const p = JSON.parse(raw);
            if (p.readerTheme) readerTheme = p.readerTheme;
            if (typeof p.brightness === 'number') brightness = p.brightness;
            if (p.zoomMode) zoomMode = p.zoomMode;
            if (p.readingMode === 'single' || p.readingMode === 'continuous') readingMode = p.readingMode;
            if (p.toolbarVisibility && typeof p.toolbarVisibility === 'object') {
                toolbarVisibility = p.toolbarVisibility;
            }
        } catch (_) {}
    }

    // ============================================
    // AUTH GATE
    // ============================================
    function startAuthGateAnimation() {
        authGateStartedAt = Date.now();
        const statusEl = $('authGateStatus');
        const bar = $('authGateProgressBar');
        if (!statusEl && !bar) return;
        const stages = [
            { text: 'Opening reader',         delay: 0,    progress: 20 },
            { text: 'Loading PDF engine',     delay: 450,  progress: 45 },
            { text: 'Fetching your progress', delay: 900,  progress: 70 },
            { text: 'Almost ready',           delay: 1350, progress: 90 }
        ];
        stages.forEach(({ text, delay, progress }) => {
            setTimeout(() => {
                if (statusEl) statusEl.textContent = text;
                if (bar) bar.style.width = `${progress}%`;
            }, delay);
        });
    }

    function hideAuthGate() {
        const gate = $('authGate');
        $('readerShell')?.removeAttribute('hidden');
        document.body.style.overflow = 'hidden';
        if (!gate) return;
        const elapsed = Date.now() - authGateStartedAt;
        const remaining = Math.max(0, CONFIG.AUTH_GATE_MIN_MS - elapsed);
        setTimeout(() => {
            const bar = $('authGateProgressBar');
            const statusEl = $('authGateStatus');
            if (bar) bar.style.width = '100%';
            if (statusEl) statusEl.textContent = 'Ready';
            setTimeout(() => {
                gate.classList.add('exiting');
                setTimeout(() => {
                    gate.classList.remove('active', 'exiting');
                    gate.style.display = 'none';
                }, 500);
            }, 200);
        }, remaining);
    }

    // ============================================
    // PDF LOADING
    // ============================================
    async function loadPdf(url) {
    const loading = $('readerLoading');
    const error = $('readerError');
    if (loading) loading.hidden = false;
    if (error) error.hidden = true;

    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('PDF load timeout')), 20000);
    });

    try {
        const loadingTask = pdfjsLib.getDocument(url);
        pdfDoc = await Promise.race([loadingTask.promise, timeoutPromise]);
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
        totalPages = pdfDoc.numPages;

        if (loading) loading.hidden = true;

        applyReadingMode(readingMode, true);
        updateProgressUI();
        buildThumbnails();
    } catch (err) {
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
        console.error('[Reader] PDF load failed:', err);
        if (loading) loading.hidden = true;
        if (error) {
            error.hidden = false;
            const p = error.querySelector('p');
            if (p) {
                if (err.message === 'PDF load timeout') {
                    p.textContent = 'The PDF is taking too long to load. Check your connection and try again.';
                } else if (err.name === 'MissingPDFException' || err.name === 'InvalidPDFException') {
                    p.textContent = 'This PDF could not be opened. It may have been moved or removed.';
                } else {
                    p.textContent = 'The PDF may be unavailable. Try again later.';
                }
            }
        }
    }
}

    // ============================================
    // READING MODE SWITCH
    // ============================================
    function applyReadingMode(mode, initial = false) {
        readingMode = mode;
        savePrefs();
        const main = mainEl();
        if (!main) return;
        main.setAttribute('data-mode', mode);
        document.querySelectorAll('.reader-mode-btn').forEach((b) => {
            b.classList.toggle('active', b.dataset.mode === mode);
        });

        if (mode === 'single') {
            // Tear down continuous
            destroyContinuousScroll();
            $('readerCanvasWrapper')?.removeAttribute('hidden');
            $('readerScrollStack')?.setAttribute('hidden', '');
            // Restore current page in single canvas
            currentPage = scrollActivePage() || currentPage;
            updatePageIndicator();
            renderPage(currentPage);
        } else {
            // Tear down single canvas
            if (renderTask) {
                try { renderTask.cancel(); } catch (_) {}
                renderTask = null;
            }
            $('readerCanvasWrapper')?.setAttribute('hidden', '');
            $('readerScrollStack')?.removeAttribute('hidden');
            buildContinuousScroll(initial ? currentPage : (scrollActivePage() || currentPage));
        }
    }

    // ============================================
    // SINGLE PAGE RENDER (unchanged from session 4)
    // ============================================
    async function renderPage(pageNum) {
        if (!pdfDoc || rendering) return;
        if (readingMode === 'continuous') return; // don't use single renderer in continuous mode
        rendering = true;

        if (renderTask) {
            try { renderTask.cancel(); } catch (_) {}
            renderTask = null;
        }

        const canvas = $('readerCanvas');
        const wrapper = $('readerCanvasWrapper');
        if (!canvas || !wrapper) { rendering = false; return; }

        try {
            const page = await pdfDoc.getPage(pageNum);
            const baseViewport = page.getViewport({ scale: 1.0 });

            let scale = currentScale;
            if (zoomMode === 'width' || zoomMode === 'auto') {
                const maxWidth = wrapper.clientWidth - 48;
                scale = Math.max(0.25, maxWidth / baseViewport.width);
            } else if (zoomMode === 'page') {
                const maxHeight = wrapper.clientHeight - 48;
                const maxWidth = wrapper.clientWidth - 48;
                const scaleW = maxWidth / baseViewport.width;
                const scaleH = maxHeight / baseViewport.height;
                scale = Math.max(0.25, Math.min(scaleW, scaleH));
            }
            scale = Math.max(CONFIG.ZOOM_MIN, Math.min(CONFIG.ZOOM_MAX, scale));

            const viewport = page.getViewport({ scale });
            const context = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            canvas.width = viewport.width * dpr;
            canvas.height = viewport.height * dpr;
            canvas.style.width = viewport.width + 'px';
            canvas.style.height = viewport.height + 'px';
            context.scale(dpr, dpr);

            const renderContext = {
                canvasContext: context,
                viewport: page.getViewport({ scale })
            };

            renderTask = page.render(renderContext);
            await renderTask.promise;
            renderTask = null;

            const zoomEl = $('readerZoomLevel');
            if (zoomEl) zoomEl.textContent = Math.round(scale * 100) + '%';

            if (pageNum > maxPageReached) maxPageReached = pageNum;
            pagesReadThisSession++;
            updateProgressUI();
            updateBookmarkBtnState();
            updateThumbActive(pageNum);

            scheduleProgressSave();
        } catch (err) {
            if (err.name !== 'RenderingCancelledException') {
                console.warn('[Reader] Render failed:', err);
            }
        } finally {
            rendering = false;
        }
    }

    // ============================================
    // CONTINUOUS SCROLL
    // ============================================
    function computeContinuousWidthScale() {
        const main = mainEl();
        if (!main) return 1;
        const avail = main.clientWidth - 32;
        return Math.max(0.3, Math.min(1.5, avail / 612)); // rough baseline; each page recomputes from its own viewport
    }

    async function buildContinuousScroll(startPage) {
        const stack = scrollStack();
        if (!stack || !pdfDoc) return;

        stack.innerHTML = '';
        scrollPageStates = [];
        scrollRenderedAtScale = currentScale;

        // Pre-calc page dimensions at scale=1 for layout skeletons
        const firstPage = await pdfDoc.getPage(1);
        const baseVp = firstPage.getViewport({ scale: 1 });

        // Target visual width in CSS pixels — depends on zoom mode
        const main = mainEl();
        const availWidth = main.clientWidth - 32;

        let targetWidth;
        if (zoomMode === 'auto' || zoomMode === 'width') {
            targetWidth = Math.min(availWidth, 900);
        } else if (zoomMode === 'page') {
            const availHeight = main.clientHeight - 32;
            const scaleByH = availHeight / baseVp.height;
            const scaleByW = availWidth / baseVp.width;
            const scale = Math.min(scaleByH, scaleByW);
            targetWidth = baseVp.width * scale;
        } else {
            targetWidth = baseVp.width * currentScale;
        }
        targetWidth = Math.max(200, targetWidth);

        const scale = targetWidth / baseVp.width;

        const zoomEl = $('readerZoomLevel');
        if (zoomEl) zoomEl.textContent = Math.round(scale * 100) + '%';

        // Build one placeholder per page, then lazily render
        for (let i = 1; i <= totalPages; i++) {
            const placeholder = document.createElement('div');
            placeholder.className = 'reader-scroll-page';
            placeholder.dataset.page = String(i);
            placeholder.style.width = targetWidth + 'px';

            const baseForThisPage = baseVp; // assume uniform, refine per page on render
            const skeletonHeight = baseForThisPage.height * scale;

            const skeleton = document.createElement('div');
            skeleton.className = 'reader-scroll-page-skeleton';
            skeleton.style.width = '100%';
            skeleton.style.height = skeletonHeight + 'px';
            skeleton.textContent = `Page ${i}`;
            placeholder.appendChild(skeleton);

            const badge = document.createElement('span');
            badge.className = 'reader-scroll-page-number';
            badge.textContent = String(i);
            placeholder.appendChild(badge);

            // Click on page to make it current (updates bookmark/note targets)
            placeholder.addEventListener('click', () => {
                setActivePage(i, false);
            });

            stack.appendChild(placeholder);

            scrollPageStates.push({
                el: placeholder,
                rendered: false,
                rendering: false,
                pageNum: i,
                height: skeletonHeight,
                width: targetWidth,
                scale
            });
        }

        setupScrollObservers();

        // Scroll to start page after layout settles
        requestAnimationFrame(() => {
            setTimeout(() => {
                scrollToPage(startPage, false);
                setActivePage(startPage, true);
            }, 60);
        });
    }

    function setupScrollObservers() {
        const stack = scrollStack();
        if (!stack) return;

        // Lazy render observer
        if (scrollObserver) scrollObserver.disconnect();
        if ('IntersectionObserver' in window) {
            scrollObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    const pageEl = entry.target;
                    const pageNum = parseInt(pageEl.dataset.page, 10);
                    const state = scrollPageStates[pageNum - 1];
                    if (!state) return;
                    if (entry.isIntersecting && !state.rendered && !state.rendering) {
                        renderScrollPage(pageNum);
                    }
                });
            }, {
                root: mainEl(),
                rootMargin: '600px 0px 600px 0px',
                threshold: 0.01
            });
            stack.querySelectorAll('.reader-scroll-page').forEach((el) => scrollObserver.observe(el));
        }

        // Active page observer
        if (scrollActiveObserver) scrollActiveObserver.disconnect();
        if ('IntersectionObserver' in window) {
            scrollActiveObserver = new IntersectionObserver((entries) => {
                // Pick the entry with highest intersection ratio
                let best = null;
                entries.forEach((entry) => {
                    if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry;
                });
                if (best && best.isIntersecting) {
                    const pageNum = parseInt(best.target.dataset.page, 10);
                    if (pageNum) setActivePage(pageNum, false);
                }
            }, {
                root: mainEl(),
                threshold: [0.25, 0.5, 0.75, 1.0]
            });
            stack.querySelectorAll('.reader-scroll-page').forEach((el) => scrollActiveObserver.observe(el));
        }

        // Scroll listener to debounce progress save
        mainEl().addEventListener('scroll', onMainScroll, { passive: true });
    }

    function onMainScroll() {
        if (readingMode !== 'continuous') return;
        if (scrollUpdateTimer) return;
        scrollUpdateTimer = setTimeout(() => {
            scrollUpdateTimer = null;
            const active = scrollActivePage();
            if (active && active !== currentPage) {
                currentPage = active;
                updatePageIndicator();
                updateBookmarkBtnState();
                updateThumbActive(active);
                if (active > maxPageReached) maxPageReached = active;
                updateProgressUI();
            }
            scheduleProgressSave();
        }, CONFIG.SCROLL_DETECT_SCROLL_DEBOUNCE);
    }

    async function renderScrollPage(pageNum) {
        const state = scrollPageStates[pageNum - 1];
        if (!state || state.rendered || state.rendering || !pdfDoc) return;
        state.rendering = true;

        try {
            const page = await pdfDoc.getPage(pageNum);
            const baseVp = page.getViewport({ scale: 1 });
            const scale = state.width / baseVp.width;
            const viewport = page.getViewport({ scale });

            // Update placeholder height to real height
            state.el.style.width = viewport.width + 'px';
            state.el.style.minHeight = viewport.height + 'px';

            const canvas = document.createElement('canvas');
            const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap at 2 for perf
            canvas.width = viewport.width * dpr;
            canvas.height = viewport.height * dpr;
            canvas.style.width = viewport.width + 'px';
            canvas.style.height = viewport.height + 'px';
            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);

            await page.render({ canvasContext: ctx, viewport }).promise;

            // Clear skeleton
            const skeleton = state.el.querySelector('.reader-scroll-page-skeleton');
            if (skeleton) skeleton.remove();

            // Insert canvas before badge
            const badge = state.el.querySelector('.reader-scroll-page-number');
            state.el.insertBefore(canvas, badge);

            state.rendered = true;
            state.rendering = false;
            state.height = viewport.height;
            state.scale = scale;

            // Mark bookmark state
            if (bookmarks.some((b) => b.page === pageNum)) {
                state.el.classList.add('has-bookmark');
            }

            pagesReadThisSession++;
            updateProgressUI();
        } catch (err) {
            state.rendering = false;
            console.warn('[Reader] Scroll page render failed:', pageNum, err);
        }
    }

    function scrollToPage(pageNum, animate = true) {
        const state = scrollPageStates[pageNum - 1];
        if (!state) return;
        const main = mainEl();
        if (!main) return;
        const top = state.el.offsetTop - 8;
        main.scrollTo({ top, behavior: animate ? 'smooth' : 'auto' });
        state.el.classList.add('flash');
        setTimeout(() => state.el.classList.remove('flash'), 800);
    }

    function setActivePage(pageNum, force) {
        if (!force && pageNum === currentPage) return;
        currentPage = pageNum;
        updatePageIndicator();
        updateBookmarkBtnState();
        updateThumbActive(pageNum);
        if (pageNum > maxPageReached) maxPageReached = pageNum;

        // Update active class
        scrollPageStates.forEach((s, i) => {
            if (s.el) s.el.classList.toggle('active', i + 1 === pageNum);
        });

        updateProgressUI();
        scheduleProgressSave();
    }

    function scrollActivePage() {
        return currentPage;
    }

    function destroyContinuousScroll() {
        const stack = scrollStack();
        if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }
        if (scrollActiveObserver) { scrollActiveObserver.disconnect(); scrollActiveObserver = null; }
        if (mainEl()) mainEl().removeEventListener('scroll', onMainScroll);
        if (stack) stack.innerHTML = '';
        scrollPageStates = [];
    }

    // On resize/zoom change in continuous mode → rebuild
    function rebuildContinuousAtCurrentPage() {
        if (readingMode !== 'continuous' || !pdfDoc) return;
        const anchor = scrollActivePage() || 1;
        buildContinuousScroll(anchor);
    }

    // ============================================
    // NAVIGATION (mode-aware)
    // ============================================
    function goToPage(n) {
        if (!pdfDoc) return;
        const page = Math.max(1, Math.min(totalPages, n));
        currentPage = page;
        updatePageIndicator();

        if (readingMode === 'continuous') {
            scrollToPage(page, true);
            setActivePage(page, true);
        } else {
            renderPage(currentPage);
        }
    }

    function nextPage() {
        if (readingMode === 'continuous') {
            goToPage(currentPage + 1);
        } else {
            goToPage(currentPage + 1);
        }
    }

    function prevPage() {
        goToPage(currentPage - 1);
    }

    function updatePageIndicator() {
        const ind = $('readerPageIndicator');
        const input = $('readerPageInput');
        if (ind) ind.textContent = `${currentPage} / ${totalPages}`;
        if (input) {
            input.max = totalPages;
            input.value = currentPage;
        }
    }

    function updateProgressUI() {
        const total = totalPages || 1;
        const percent = Math.min(100, Math.round((maxPageReached / total) * 100));
        const fill = $('readerProgressFill');
        if (fill) fill.style.width = percent + '%';
        const statProgress = $('readerStatProgress');
        if (statProgress) statProgress.textContent = percent + '%';
        const statPages = $('readerStatPages');
        if (statPages) statPages.textContent = String(pagesReadThisSession);
        const statTime = $('readerStatTime');
        if (statTime) statTime.textContent = formatDuration(sessionElapsedMs);
        const statTotal = $('readerStatTotalTime');
        if (statTotal) statTotal.textContent = formatDuration(totalReadingMs + sessionElapsedMs);
    }

    function formatDuration(ms) {
        const totalSec = Math.floor(ms / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    // ============================================
    // ZOOM
    // ============================================
    function setZoomMode(mode) {
        zoomMode = mode;
        document.querySelectorAll('.reader-zoom-btn').forEach((b) => {
            b.classList.toggle('active', b.dataset.zoomMode === mode);
        });
        savePrefs();
        if (readingMode === 'continuous') {
            rebuildContinuousAtCurrentPage();
        } else {
            renderPage(currentPage);
        }
    }

    function zoomIn() {
        currentScale = Math.min(CONFIG.ZOOM_MAX, currentScale + CONFIG.ZOOM_STEP);
        if (zoomMode !== 'auto') {
            zoomMode = 'auto';
            document.querySelectorAll('.reader-zoom-btn').forEach((b) => b.classList.remove('active'));
        }
        savePrefs();
        if (readingMode === 'continuous') rebuildContinuousAtCurrentPage();
        else renderPage(currentPage);
    }

    function zoomOut() {
        currentScale = Math.max(CONFIG.ZOOM_MIN, currentScale - CONFIG.ZOOM_STEP);
        if (zoomMode !== 'auto') {
            zoomMode = 'auto';
            document.querySelectorAll('.reader-zoom-btn').forEach((b) => b.classList.remove('active'));
        }
        savePrefs();
        if (readingMode === 'continuous') rebuildContinuousAtCurrentPage();
        else renderPage(currentPage);
    }

    // ============================================
    // THEME & BRIGHTNESS
    // ============================================
    function applyTheme(theme) {
        readerTheme = theme;
        const shell = $('readerShell');
        if (shell) shell.setAttribute('data-reader-theme', theme);
        document.querySelectorAll('.reader-theme-btn').forEach((b) => {
            b.classList.toggle('active', b.dataset.readerTheme === theme);
        });
        savePrefs();
    }

    function applyBrightness(value) {
        brightness = value;
        const wrapper = $('readerCanvasWrapper');
        const stack = scrollStack();
        if (wrapper) wrapper.style.filter = `brightness(${value / 100})`;
        if (stack) stack.style.filter = `brightness(${value / 100})`;
        const valEl = $('readerBrightnessValue');
        if (valEl) valEl.textContent = value + '%';
        savePrefs();
    }

    // ============================================
    // FULLSCREEN
    // ============================================
    function toggleFullscreen() {
        if (typeof document.documentElement.requestFullscreen !== 'function') return;
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    }

    // ============================================
    // TOOLBAR CUSTOMIZATION (unchanged)
    // ============================================
    function applyToolbarVisibility() {
        Object.keys(toolbarVisibility).forEach((id) => {
            const el = $(id);
            if (!el) return;
            const visible = toolbarVisibility[id] !== false;
            el.setAttribute('data-toolbar-hidden', visible ? 'false' : 'true');
            if (id === 'readerZoomInBtn') {
                const out = $('readerZoomOutBtn');
                const lvl = $('readerZoomLevel');
                if (out) out.setAttribute('data-toolbar-hidden', visible ? 'false' : 'true');
                if (lvl) lvl.setAttribute('data-toolbar-hidden', visible ? 'false' : 'true');
            }
        });
    }

    function setupToolbarCustomization() {
        const container = $('readerToolbarToggles');
        if (!container) return;
        container.querySelectorAll('input[data-toggle-btn]').forEach((input) => {
            const id = input.dataset.toggleBtn;
            if (id in toolbarVisibility) {
                input.checked = toolbarVisibility[id] !== false;
            }
            input.addEventListener('change', () => {
                toolbarVisibility[id] = input.checked;
                savePrefs();
                applyToolbarVisibility();
            });
        });
    }

    // ============================================
    // PROGRESS
    // ============================================
    async function loadProgress() {
    progressRef = db.collection(CONFIG.COLLECTIONS.READING_PROGRESS).doc(progressDocId());

    // Step 1: try to read existing progress. Non-fatal if it fails.
    try {
        const doc = await progressRef.get();
        if (doc.exists) {
            progressData = doc.data();
            applyProgressData(progressData);
        }
    } catch (err) {
        console.warn('[Reader] Progress read failed:', err.code);
    }

    // Step 2: best-effort create (don't await in the critical path — but we do want
    // the doc to exist before onSnapshot, so we do await with a hard timeout).
    if (!progressData) {
        const initial = {
            userId: currentUserId,
            bookId: bookId,
            lastPage: 1,
            maxPageReached: 1,
            totalPages: totalPages || 1,
            progressPercent: 0,
            bookmarks: [],
            notes: [],
            totalReadingMs: 0,
            lastReadAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
            await Promise.race([
                progressRef.set(initial),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
            ]);
            progressData = initial;
        } catch (err) {
            console.warn('[Reader] Progress create skipped:', err.code || err.message);
            // Fallback: use the in-memory shape so bookmark/note mutations have something to work with
            progressData = initial;
        }
    }

    // Step 3: live sync — only if we have ref data. Wrap so it can never hang.
    try {
        progressUnsubscribe = progressRef.onSnapshot((snap) => {
            if (!snap.exists) return;
            progressData = snap.data();
            applyProgressData(progressData, true);
        }, (err) => console.warn('[Reader] Progress sync error:', err.code));
    } catch (err) {
        console.warn('[Reader] Progress listener failed:', err.code);
    }
}

    function applyProgressData(data, fromSnapshot) {
        if (!fromSnapshot) {
            const savedPage = Math.max(1, Math.min(totalPages || 1, data.lastPage || 1));
            resumeTargetPage = savedPage;
            currentPage = savedPage;
            maxPageReached = Math.max(1, data.maxPageReached || savedPage);
            totalReadingMs = Math.max(0, data.totalReadingMs || 0);
            bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks.slice() : [];
            notes = Array.isArray(data.notes) ? data.notes.slice() : [];
        } else {
            if (Array.isArray(data.bookmarks)) bookmarks = data.bookmarks.slice();
            if (Array.isArray(data.notes)) notes = data.notes.slice();
            if (typeof data.totalReadingMs === 'number') totalReadingMs = data.totalReadingMs;
        }
        renderBookmarksPanel();
        renderNotesPanel();
        updateBookmarkBtnState();
        // Update bookmark markers in continuous mode
        if (readingMode === 'continuous') {
            scrollPageStates.forEach((s) => {
                if (!s.el) return;
                const has = bookmarks.some((b) => b.page === s.pageNum);
                s.el.classList.toggle('has-bookmark', has);
            });
        }
    }

    function scheduleProgressSave() {
        progressDirty = true;
        if (progressSaveTimer) return;
        progressSaveTimer = setTimeout(() => {
            progressSaveTimer = null;
            flushProgressSave();
        }, CONFIG.PROGRESS_SAVE_DEBOUNCE_MS);
    }

    async function flushProgressSave() {
        if (!progressDirty || !progressRef) return;
        progressDirty = false;
        const total = totalPages || 1;
        const percent = Math.min(100, Math.round((maxPageReached / total) * 100));
        const payload = {
            lastPage: currentPage,
            maxPageReached: maxPageReached,
            totalPages: totalPages,
            progressPercent: percent,
            totalReadingMs: totalReadingMs + sessionElapsedMs,
            lastReadAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
            await progressRef.update(payload);
        } catch (err) {
            console.warn('[Reader] Progress save failed:', err.code);
            progressDirty = true;
        }
    }

    // ============================================
    // HISTORY
    // ============================================
    function setupHistory() {
        historyRef = db.collection(CONFIG.COLLECTIONS.READING_HISTORY).doc(historyDocId());
        historyFlushTimer = setInterval(() => flushHistory(false), CONFIG.HISTORY_FLUSH_MS);
    }
    async function flushHistory(final) {
        if (!historyRef || !currentUserId) return;
        const ms = sessionElapsedMs;
        if (ms <= 0 && !final) return;
        try {
            await historyRef.set({
                userId: currentUserId,
                bookId: bookId,
                dateKey: dateKey(),
                readingMs: firebase.firestore.FieldValue.increment(ms),
                pagesRead: firebase.firestore.FieldValue.increment(pagesReadThisSession),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } catch (err) {
            console.warn('[Reader] History flush failed:', err.code);
        }
    }

    // ============================================
    // TIME
    // ============================================
    function startSessionTimer() {
        sessionStartMs = nowMs();
        sessionTickInterval = setInterval(() => {
            if (!isPageVisible) return;
            sessionElapsedMs = nowMs() - sessionStartMs;
            updateProgressUI();
        }, CONFIG.SESSION_TICK_MS);
    }
    function stopSessionTimer() {
        if (sessionTickInterval) {
            clearInterval(sessionTickInterval);
            sessionTickInterval = null;
        }
    }
    document.addEventListener('visibilitychange', () => {
        isPageVisible = document.visibilityState === 'visible';
        if (!isPageVisible && sessionStartMs) {
            flushProgressSave();
            flushHistory(false);
        }
    });

    // ============================================
    // BOOKMARKS
    // ============================================
    function updateBookmarkBtnState() {
        const btn = $('readerBookmarkBtn');
        if (!btn) return;
        const icon = btn.querySelector('.material-icons');
        const has = bookmarks.some((b) => b.page === currentPage);
        if (icon) icon.textContent = has ? 'bookmark' : 'bookmark_border';
        btn.classList.toggle('active', has);
    }

    async function toggleBookmark(page) {
        if (!progressRef || !progressData) return;
        const existingIdx = bookmarks.findIndex((b) => b.page === page);
        let newBookmarks;
        if (existingIdx >= 0) {
            newBookmarks = bookmarks.filter((_, i) => i !== existingIdx);
        } else {
            newBookmarks = [...bookmarks, { page, label: `Page ${page}`, createdAt: Date.now() }]
                .sort((a, b) => a.page - b.page);
        }
        bookmarks = newBookmarks;
        updateBookmarkBtnState();
        renderBookmarksPanel();
        // update continuous markers
        scrollPageStates.forEach((s) => {
            if (!s.el) return;
            s.el.classList.toggle('has-bookmark', bookmarks.some((b) => b.page === s.pageNum));
        });
        try {
            await progressRef.update({ bookmarks: newBookmarks });
        } catch (err) {
            console.warn('[Reader] Bookmark save failed:', err.code);
        }
    }

    async function removeBookmark(page) { await toggleBookmark(page); }

    function renderBookmarksPanel() {
        const list = $('readerBookmarksList');
        const empty = $('readerBookmarksEmpty');
        if (!list) return;
        if (!bookmarks.length) {
            list.innerHTML = '';
            if (empty) empty.style.display = 'block';
            return;
        }
        if (empty) empty.style.display = 'none';
        list.innerHTML = bookmarks.map((bm) => `
            <div class="reader-sidebar-item" data-bookmark-page="${bm.page}">
                <div class="reader-sidebar-item-body">
                    <div class="reader-sidebar-item-title">Page ${bm.page}</div>
                    <div class="reader-sidebar-item-meta">${formatTime(bm.createdAt)}</div>
                </div>
                <button class="reader-sidebar-item-delete" data-bookmark-delete="${bm.page}" aria-label="Remove bookmark">
                    <span class="material-icons">delete_outline</span>
                </button>
            </div>
        `).join('');
        list.querySelectorAll('[data-bookmark-page]').forEach((el) => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('[data-bookmark-delete]')) return;
                goToPage(parseInt(el.dataset.bookmarkPage, 10));
            });
        });
        list.querySelectorAll('[data-bookmark-delete]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeBookmark(parseInt(btn.dataset.bookmarkDelete, 10));
            });
        });
    }

    // ============================================
    // NOTES
    // ============================================
    function renderNotesPanel() {
        const list = $('readerNotesList');
        const empty = $('readerNotesEmpty');
        if (!list) return;
        if (!notes.length) {
            list.innerHTML = '';
            if (empty) empty.style.display = 'block';
            return;
        }
        if (empty) empty.style.display = 'none';
        list.innerHTML = notes
            .slice()
            .sort((a, b) => a.page - b.page)
            .map((note) => `
                <div class="reader-sidebar-item" data-note-page="${note.page}">
                    <div class="reader-sidebar-item-body">
                        <div class="reader-sidebar-item-title">Page ${note.page}</div>
                        <div class="reader-sidebar-item-meta">${escapeHtml(note.text.slice(0, 80))}${note.text.length > 80 ? '…' : ''}</div>
                    </div>
                    <button class="reader-sidebar-item-delete" data-note-delete="${note.page}" aria-label="Delete note">
                        <span class="material-icons">delete_outline</span>
                    </button>
                </div>
            `).join('');
        list.querySelectorAll('[data-note-page]').forEach((el) => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('[data-note-delete]')) return;
                goToPage(parseInt(el.dataset.notePage, 10));
            });
        });
        list.querySelectorAll('[data-note-delete]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteNote(parseInt(btn.dataset.noteDelete, 10));
            });
        });
    }

    function openNoteEditor(page) {
        editingNotePage = page;
        const existing = notes.find((n) => n.page === page);
        const modal = $('readerNoteModal');
        const title = $('readerNoteModalTitle');
        const textarea = $('readerNoteText');
        const charCount = $('readerNoteCharCount');
        const deleteBtn = $('readerNoteDeleteBtn');
        if (title) title.textContent = `Note on page ${page}`;
        if (textarea) textarea.value = existing ? existing.text : '';
        if (charCount) charCount.textContent = `${(textarea?.value.length || 0)} / ${CONFIG.NOTE_MAX_CHARS}`;
        if (deleteBtn) deleteBtn.hidden = !existing;
        if (modal) modal.hidden = false;
        setTimeout(() => textarea?.focus(), 50);
    }
    function closeNoteEditor() {
        const modal = $('readerNoteModal');
        if (modal) modal.hidden = true;
        editingNotePage = null;
    }
    async function saveNote() {
        if (editingNotePage == null || !progressRef) return;
        const textarea = $('readerNoteText');
        const text = (textarea?.value || '').trim();
        if (!text) {
            await deleteNote(editingNotePage);
            closeNoteEditor();
            return;
        }
        const existingIdx = notes.findIndex((n) => n.page === editingNotePage);
        const payload = {
            page: editingNotePage,
            text: text.slice(0, CONFIG.NOTE_MAX_CHARS),
            createdAt: existingIdx >= 0 ? notes[existingIdx].createdAt : Date.now(),
            updatedAt: Date.now()
        };
        let newNotes;
        if (existingIdx >= 0) {
            newNotes = notes.slice();
            newNotes[existingIdx] = payload;
        } else {
            newNotes = [...notes, payload];
        }
        notes = newNotes.sort((a, b) => a.page - b.page);
        renderNotesPanel();
        try {
            await progressRef.update({ notes: notes });
        } catch (err) {
            console.warn('[Reader] Note save failed:', err.code);
        }
        closeNoteEditor();
    }
    async function deleteNote(page) {
        if (!progressRef) return;
        notes = notes.filter((n) => n.page !== page);
        renderNotesPanel();
        try {
            await progressRef.update({ notes: notes });
        } catch (err) {
            console.warn('[Reader] Note delete failed:', err.code);
        }
    }
    function formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
               d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    // ============================================
    // THUMBNAILS
    // ============================================
    function buildThumbnails() {
        const container = $('readerThumbs');
        if (!container) return;
        container.innerHTML = '';
        const count = Math.min(totalPages, CONFIG.THUMB_MAX_PAGES);
        for (let i = 1; i <= count; i++) {
            const el = document.createElement('div');
            el.className = 'reader-thumb';
            el.dataset.thumbPage = String(i);
            el.innerHTML = `<div class="reader-thumb-skeleton"></div><span class="reader-thumb-number">${i}</span>`;
            el.addEventListener('click', () => goToPage(i));
            container.appendChild(el);
        }
        if ('IntersectionObserver' in window) {
            thumbsObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        const el = entry.target;
                        const page = parseInt(el.dataset.thumbPage, 10);
                        if (!thumbsRendered.has(page)) renderThumb(page, el);
                        thumbsObserver.unobserve(el);
                    }
                });
            }, { root: container, rootMargin: '200px' });
            container.querySelectorAll('.reader-thumb').forEach((el) => thumbsObserver.observe(el));
        } else {
            container.querySelectorAll('.reader-thumb').forEach((el) => {
                renderThumb(parseInt(el.dataset.thumbPage, 10), el);
            });
        }
        updateThumbActive(currentPage);
    }

    async function renderThumb(pageNum, el) {
        if (!pdfDoc || thumbsRendered.has(pageNum)) return;
        thumbsRendered.add(pageNum);
        try {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: CONFIG.THUMB_SCALE });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;
            const skeleton = el.querySelector('.reader-thumb-skeleton');
            if (skeleton) skeleton.remove();
            el.insertBefore(canvas, el.firstChild);
        } catch (err) {
            console.warn('[Reader] Thumb render failed:', pageNum, err);
        }
    }

    function updateThumbActive(pageNum) {
        document.querySelectorAll('.reader-thumb').forEach((el) => {
            el.classList.toggle('active', parseInt(el.dataset.thumbPage, 10) === pageNum);
        });
    }

    // ============================================
    // RESUME TOAST
    // ============================================
    function showResumeToast() {
        if (resumeShown) return;
        if (resumeTargetPage <= 1) return;
        resumeShown = true;
        const toast = $('readerResumeToast');
        const text = $('readerResumeText');
        if (text) text.textContent = `Resuming from page ${resumeTargetPage}`;
        if (toast) {
            toast.hidden = false;
            setTimeout(() => { toast.hidden = true; }, 6000);
        }
    }

    // ============================================
    // SIDEBAR
    // ============================================
    function setupSidebar() {
        const sidebar = $('readerSidebar');
        const toggle = $('readerSidebarToggle');
        const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
        if (isMobile()) sidebar?.classList.add('collapsed');
        toggle?.addEventListener('click', () => {
            if (isMobile()) sidebar?.classList.toggle('mobile-open');
            else sidebar?.classList.toggle('collapsed');
        });
        document.querySelectorAll('.reader-sidebar-tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.sidebarTab;
                document.querySelectorAll('.reader-sidebar-tab').forEach((t) => {
                    t.classList.toggle('active', t === tab);
                    t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
                });
                document.querySelectorAll('.reader-sidebar-panel').forEach((p) => {
                    p.classList.toggle('active', p.dataset.sidebarPanel === target);
                });
            });
        });
    }

    // ============================================
    // MOBILE SWIPE (only active in single mode — continuous handles via native scroll)
    // ============================================
    function setupSwipe() {
        const main = $('readerMain');
        if (!main) return;
        const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
        if (!isMobile()) return;

        main.addEventListener('touchstart', (e) => {
            if (readingMode !== 'single') return;
            if (e.touches.length !== 1) return;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = nowMs();
            touchActive = true;
        }, { passive: true });

        main.addEventListener('touchend', (e) => {
            if (!touchActive) return;
            touchActive = false;
            if (readingMode !== 'single') return;
            if (!e.changedTouches.length) return;
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            const dx = endX - touchStartX;
            const dy = endY - touchStartY;
            const dt = nowMs() - touchStartTime;
            if (dt > 800) return;
            if (Math.abs(dx) < CONFIG.SWIPE_THRESHOLD_PX) return;
            if (Math.abs(dy) > CONFIG.SWIPE_MAX_VERTICAL_PX) return;
            if (Math.abs(dx) < Math.abs(dy) * 1.2) return;
            if (dx < 0) {
                main.classList.add('swipe-next');
                setTimeout(() => main.classList.remove('swipe-next'), 260);
                nextPage();
            } else {
                main.classList.add('swipe-prev');
                setTimeout(() => main.classList.remove('swipe-prev'), 260);
                prevPage();
            }
        }, { passive: true });
    }

    function showSwipeHintOnce() {
        if (readingMode !== 'single') return;
        try {
            if (localStorage.getItem('cu_reader_swipe_hint') === 'shown') return;
            localStorage.setItem('cu_reader_swipe_hint', 'shown');
        } catch (_) { return; }
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (!isMobile) return;
        const hint = document.createElement('div');
        hint.className = 'reader-swipe-hint';
        hint.innerHTML = `<span class="material-icons">swipe</span><span>Swipe to turn pages</span>`;
        document.body.appendChild(hint);
        setTimeout(() => {
            hint.style.opacity = '0';
            hint.style.transition = 'opacity 0.4s ease';
            setTimeout(() => hint.remove(), 400);
        }, 3500);
    }

    // ============================================
    // WIRE CONTROLS
    // ============================================
    function wireControls() {
        $('readerBackBtn')?.addEventListener('click', () => {
            flushProgressSave();
            flushHistory(true);
            window.location.href = 'library.html';
        });
        $('readerPrevBtn')?.addEventListener('click', prevPage);
        $('readerNextBtn')?.addEventListener('click', nextPage);
        $('readerPageInput')?.addEventListener('change', (e) => {
            const n = parseInt(e.target.value, 10);
            if (!isNaN(n)) goToPage(n);
        });
        $('readerZoomInBtn')?.addEventListener('click', zoomIn);
        $('readerZoomOutBtn')?.addEventListener('click', zoomOut);
        $('readerFullscreenBtn')?.addEventListener('click', toggleFullscreen);
        $('readerBookmarkBtn')?.addEventListener('click', () => toggleBookmark(currentPage));
        $('readerNoteBtn')?.addEventListener('click', () => openNoteEditor(currentPage));

        const panel = $('readerSettingsPanel');
        $('readerSettingsBtn')?.addEventListener('click', () => {
            if (panel) panel.hidden = !panel.hidden;
        });
        $('readerSettingsClose')?.addEventListener('click', () => {
            if (panel) panel.hidden = true;
        });
        document.querySelectorAll('.reader-mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => applyReadingMode(btn.dataset.mode));
        });
        document.querySelectorAll('.reader-theme-btn').forEach((btn) => {
            btn.addEventListener('click', () => applyTheme(btn.dataset.readerTheme));
        });
        document.querySelectorAll('.reader-zoom-btn').forEach((btn) => {
            btn.addEventListener('click', () => setZoomMode(btn.dataset.zoomMode));
        });
        const brightSlider = $('readerBrightness');
        if (brightSlider) {
            brightSlider.addEventListener('input', (e) => {
                applyBrightness(parseInt(e.target.value, 10));
            });
        }
        $('readerNoteModalClose')?.addEventListener('click', closeNoteEditor);
        $('readerNoteCancelBtn')?.addEventListener('click', closeNoteEditor);
        $('readerNoteSaveBtn')?.addEventListener('click', saveNote);
        $('readerNoteDeleteBtn')?.addEventListener('click', async () => {
            if (editingNotePage != null) {
                await deleteNote(editingNotePage);
                closeNoteEditor();
            }
        });
        $('readerNoteText')?.addEventListener('input', (e) => {
            const charCount = $('readerNoteCharCount');
            if (charCount) charCount.textContent = `${e.target.value.length} / ${CONFIG.NOTE_MAX_CHARS}`;
        });
        $('readerResumeGoBtn')?.addEventListener('click', () => {
            goToPage(resumeTargetPage);
            const toast = $('readerResumeToast');
            if (toast) toast.hidden = true;
        });
        $('readerResumeStartBtn')?.addEventListener('click', () => {
            goToPage(1);
            const toast = $('readerResumeToast');
            if (toast) toast.hidden = true;
        });

        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (!$('readerNoteModal')?.hidden) return;
            switch (e.key) {
                case 'ArrowLeft': case 'ArrowUp': e.preventDefault(); prevPage(); break;
                case 'ArrowRight': case 'ArrowDown': e.preventDefault(); nextPage(); break;
                case '+': case '=': e.preventDefault(); zoomIn(); break;
                case '-': e.preventDefault(); zoomOut(); break;
                case 'f': case 'F': e.preventDefault(); toggleFullscreen(); break;
                case 'b': case 'B': e.preventDefault(); toggleBookmark(currentPage); break;
                case 'n': case 'N': e.preventDefault(); openNoteEditor(currentPage); break;
                case 't': case 'T': e.preventDefault(); $('readerSidebarToggle')?.click(); break;
            }
        });

        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (!pdfDoc) return;
                if (readingMode === 'continuous') rebuildContinuousAtCurrentPage();
                else renderPage(currentPage);
            }, 300);
        });

        window.addEventListener('beforeunload', () => {
            flushProgressSave();
            flushHistory(true);
        });
    }

    // ============================================
    // BOOT
    // ============================================
async function bootstrap() {
    const params = new URLSearchParams(window.location.search);
    bookId = params.get('book');
    if (!bookId) {
        window.location.replace('library.html');
        return;
    }

    loadPrefs();
    applyTheme(readerTheme);
    applyBrightness(brightness);
    const brightSlider = $('readerBrightness');
    if (brightSlider) brightSlider.value = brightness;
    document.querySelectorAll('.reader-zoom-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.zoomMode === zoomMode);
    });
    document.querySelectorAll('.reader-mode-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.mode === readingMode);
    });
    mainEl()?.setAttribute('data-mode', readingMode);

    setupToolbarCustomization();
    applyToolbarVisibility();
    wireControls();
    setupSidebar();
    setupSwipe();

    auth.onAuthStateChanged(async (user) => {
        // If we somehow reach here twice, don't double-boot
        if (window.__readerBooted) return;

        let gateHidden = false;
        const safeHideGate = () => {
            if (gateHidden) return;
            gateHidden = true;
            try { hideAuthGate(); } catch (_) {}
        };

        try {
            if (!user) {
                window.location.replace('index.html');
                return;
            }
            currentUser = user;
            currentUserId = user.uid;
            window.__readerBooted = true;

            // --- 1. whitelist ---
            try {
                const email = (user.email || '').toLowerCase();
                const doc = await db.collection(CONFIG.COLLECTIONS.WHITELIST).doc(email).get();
                if (!doc.exists || doc.data().active !== true) {
                    await auth.signOut();
                    window.location.replace('index.html');
                    return;
                }
            } catch (err) {
                console.warn('[Reader] Whitelist check failed:', err.code);
                window.location.replace('index.html');
                return;
            }

            // --- 2. book doc ---
            try {
                const bookDoc = await db.collection(CONFIG.COLLECTIONS.BOOKS).doc(bookId).get();
                if (!bookDoc.exists) {
                    $('readerError').hidden = false;
                    safeHideGate();
                    return;
                }
                bookData = bookDoc.data();
                const titleEl = $('readerBookTitle');
                if (titleEl) titleEl.textContent = bookData.title || 'Untitled';
                if (!bookData.pdfUrl) {
                    $('readerError').hidden = false;
                    safeHideGate();
                    return;
                }
            } catch (err) {
                console.warn('[Reader] Book fetch failed:', err.code);
                $('readerError').hidden = false;
                safeHideGate();
                return;
            }

            // --- 3. HIDE GATE NOW — critical fix ---
            // The gate should not wait for progress or PDF loading.
            safeHideGate();

            // --- 4. progress: fire-and-forget ---
            loadProgress()
                .then(() => updatePageIndicator())
                .catch((err) => console.warn('[Reader] Progress init failed:', err));

            // --- 5. session/history start immediately ---
            try { startSessionTimer(); } catch (_) {}
            try { setupHistory(); } catch (_) {}
            try { showResumeToast(); } catch (_) {}
            try { showSwipeHintOnce(); } catch (_) {}

            // --- 6. PDF load (uses its own spinner) ---
            try {
                await loadPdf(bookData.pdfUrl);
            } catch (err) {
                console.warn('[Reader] PDF load failed:', err);
            }

        } catch (err) {
            console.error('[Reader] Bootstrap crashed:', err);
            safeHideGate();
        }
    }, (err) => {
        console.warn('[Reader] Auth error:', err);
        window.location.replace('index.html');
    });
}

    document.addEventListener('DOMContentLoaded', () => {
        startAuthGateAnimation();
        if (typeof pdfjsLib === 'undefined') {
            console.error('[Reader] pdf.js failed to load');
            $('readerError').hidden = false;
            const loading = $('readerLoading');
            if (loading) loading.hidden = true;
            return;
        }
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.js';
        if (typeof firebase !== 'undefined' && firebase.auth) bootstrap();
    });
})();
