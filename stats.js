/**
 * Campus Unfolded — Reading Stats
 * Shows daily goal, streak, weekly chart, recent books.
 */

(function () {
    'use strict';

    const CONFIG = Object.freeze({
        COLLECTIONS: {
            WHITELIST: 'whitelist',
            READING_PROGRESS: 'readingProgress',
            READING_HISTORY: 'readingHistory',
            BOOKS: 'books',
            USERS: 'users'
        },
        AUTH_GATE_MIN_MS: 1800,
        DEFAULT_GOAL_MIN: 30,
        HISTORY_DAYS: 7
    });

    let currentUser = null;
    let currentUserId = null;
    let dailyGoalMin = CONFIG.DEFAULT_GOAL_MIN;
    let authGateStartedAt = 0;
    let historyDocs = [];     // last 7 days
    let recentProgress = [];  // sorted by lastReadAt
    let booksCache = {};

    const $ = (id) => document.getElementById(id);

    function dateKey(d = new Date()) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function shiftDays(d, n) {
        const copy = new Date(d);
        copy.setDate(copy.getDate() + n);
        return copy;
    }

    function formatMinutes(ms) {
        const min = Math.round(ms / 60000);
        if (min < 60) return `${min}m`;
        const h = Math.floor(min / 60);
        const m = min % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
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
            { text: 'Loading your stats', delay: 0,    progress: 30 },
            { text: 'Fetching history',    delay: 500,  progress: 60 },
            { text: 'Crunching numbers',   delay: 1000, progress: 85 },
            { text: 'Almost ready',        delay: 1400, progress: 95 }
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
        $('statsRoot')?.removeAttribute('hidden');
        document.body.style.overflow = 'auto';
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
    // GOAL (stored on users doc)
    // ============================================
    async function loadGoal() {
        try {
            const doc = await db.collection(CONFIG.COLLECTIONS.USERS).doc(currentUserId).get();
            if (doc.exists) {
                const data = doc.data();
                if (typeof data.dailyGoalMin === 'number' && data.dailyGoalMin > 0) {
                    dailyGoalMin = data.dailyGoalMin;
                }
            }
        } catch (_) {}
    }

    async function saveGoal(minutes) {
        try {
            await db.collection(CONFIG.COLLECTIONS.USERS).doc(currentUserId).set({
                dailyGoalMin: minutes,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            dailyGoalMin = minutes;
        } catch (err) {
            console.warn('[Stats] Goal save failed:', err.code);
        }
    }

    // ============================================
    // HISTORY (last 7 days)
    // ============================================
    async function loadHistory() {
        try {
            const snap = await db.collection(CONFIG.COLLECTIONS.READING_HISTORY)
                .where('userId', '==', currentUserId)
                .orderBy('dateKey', 'desc')
                .limit(200)
                .get();
            historyDocs = snap.docs.map((d) => d.data());
        } catch (err) {
            console.warn('[Stats] History load failed:', err.code);
            historyDocs = [];
        }
    }

    function aggregateByDate(days) {
        const buckets = {};
        days.forEach((d) => { buckets[dateKey(d)] = { readingMs: 0, pagesRead: 0 }; });
        historyDocs.forEach((doc) => {
            if (buckets[doc.dateKey]) {
                buckets[doc.dateKey].readingMs += doc.readingMs || 0;
                buckets[doc.dateKey].pagesRead += doc.pagesRead || 0;
            }
        });
        return buckets;
    }

    // ============================================
    // PROGRESS (recent books)
    // ============================================
    async function loadRecentProgress() {
        try {
            const snap = await db.collection(CONFIG.COLLECTIONS.READING_PROGRESS)
                .where('userId', '==', currentUserId)
                .orderBy('lastReadAt', 'desc')
                .limit(10)
                .get();
            recentProgress = snap.docs.map((d) => d.data()).filter((p) => (p.lastPage || 0) > 1);
        } catch (err) {
            console.warn('[Stats] Progress load failed:', err.code);
            recentProgress = [];
        }
    }

    async function loadBooks(ids) {
        const unique = [...new Set(ids)].filter((id) => !booksCache[id]);
        if (!unique.length) return;
        try {
            const docs = await Promise.all(unique.map((id) =>
                db.collection(CONFIG.COLLECTIONS.BOOKS).doc(id).get().catch(() => null)
            ));
            docs.forEach((doc) => {
                if (doc && doc.exists) booksCache[doc.id] = doc.data();
            });
        } catch (_) {}
    }

    // ============================================
    // RENDER: GOAL RING
    // ============================================
    function renderGoal() {
        const today = aggregateByDate([new Date()])[dateKey(new Date())];
        const todayMs = today ? today.readingMs : 0;
        const goalMs = dailyGoalMin * 60000;
        const percent = Math.min(100, Math.round((todayMs / goalMs) * 100));

        const ring = $('statsGoalRing');
        const circumference = 326.73;
        if (ring) {
            const offset = circumference - (percent / 100) * circumference;
            ring.style.strokeDashoffset = String(offset);
        }

        const percentEl = $('statsGoalPercent');
        if (percentEl) percentEl.textContent = percent + '%';

        const minEl = $('statsGoalMinutes');
        if (minEl) {
            minEl.textContent = `${Math.round(todayMs / 60000)} / ${dailyGoalMin} min`;
        }

        const msgEl = $('statsGoalMsg');
        if (msgEl) {
            if (percent >= 100) msgEl.textContent = '🎉 Goal reached! Keep going.';
            else if (percent >= 60) msgEl.textContent = "You're close — finish strong!";
            else if (percent > 0) msgEl.textContent = `${dailyGoalMin - Math.round(todayMs / 60000)} min left to hit your goal.`;
            else msgEl.textContent = 'Start reading to reach your daily goal.';
        }
    }

    // ============================================
    // RENDER: MINI STATS
    // ============================================
    function renderMiniStats() {
        const now = new Date();
        const todayKey = dateKey(now);

        // Today
        const todayBucket = aggregateByDate([now])[todayKey];
        const todayMs = todayBucket ? todayBucket.readingMs : 0;
        const todayEl = $('statsTodayMin');
        if (todayEl) todayEl.textContent = formatMinutes(todayMs);

        // Week
        const weekDays = [];
        for (let i = 6; i >= 0; i--) weekDays.push(shiftDays(now, -i));
        const weekBuckets = aggregateByDate(weekDays);
        let weekMs = 0;
        weekDays.forEach((d) => { weekMs += weekBuckets[dateKey(d)].readingMs; });
        const weekEl = $('statsWeekMin');
        if (weekEl) weekEl.textContent = formatMinutes(weekMs);

        // Books started
        const booksEl = $('statsBooksCount');
        if (booksEl) booksEl.textContent = String(recentProgress.length);

        // Streak
        const streakEl = $('statsStreak');
        if (streakEl) streakEl.textContent = String(computeStreak());
    }

    function computeStreak() {
        const now = new Date();
        let streak = 0;
        for (let i = 0; i < 365; i++) {
            const d = shiftDays(now, -i);
            const key = dateKey(d);
            const dayMs = historyDocs
                .filter((doc) => doc.dateKey === key)
                .reduce((s, doc) => s + (doc.readingMs || 0), 0);
            if (dayMs >= 60000) streak++;
            else if (i === 0) continue; // today not counted yet, but doesn't break streak
            else break;
        }
        return streak;
    }

    // ============================================
    // RENDER: WEEK CHART
    // ============================================
    function renderWeekChart() {
        const chart = $('statsWeekChart');
        if (!chart) return;

        const now = new Date();
        const todayKey = dateKey(now);
        const days = [];
        for (let i = 6; i >= 0; i--) days.push(shiftDays(now, -i));
        const buckets = aggregateByDate(days);

        const maxMs = Math.max(...days.map((d) => buckets[dateKey(d)].readingMs), 60000);

        chart.innerHTML = days.map((d) => {
            const key = dateKey(d);
            const ms = buckets[key].readingMs;
            const heightPct = (ms / maxMs) * 100;
            const isToday = key === todayKey;
            const label = d.toLocaleDateString(undefined, { weekday: 'short' });
            const displayMin = Math.round(ms / 60000);
            return `
                <div class="stats-week-col${isToday ? ' is-today' : ''}">
                    <div class="stats-week-bar-wrap">
                        <div class="stats-week-bar${isToday ? ' is-today' : ''}" style="height: ${Math.max(4, heightPct)}%">
                            ${displayMin > 0 ? `<span class="stats-week-value">${displayMin}m</span>` : ''}
                        </div>
                    </div>
                    <div class="stats-week-label">${label}</div>
                </div>
            `;
        }).join('');
    }

    // ============================================
    // RENDER: RECENT
    // ============================================
    function renderRecent() {
        const list = $('statsRecentList');
        const empty = $('statsRecentEmpty');
        if (!list) return;

        if (!recentProgress.length) {
            list.innerHTML = '';
            if (empty) empty.hidden = false;
            return;
        }
        if (empty) empty.hidden = true;

        list.innerHTML = recentProgress.map((p) => {
            const book = booksCache[p.bookId];
            const title = book ? book.title : `Book ${p.bookId.slice(0, 6)}`;
            const cover = book && book.coverImageUrl
                ? `<img src="${book.coverImageUrl}" class="stats-recent-cover" alt="">`
                : `<div class="stats-recent-cover"><span class="material-icons">menu_book</span></div>`;
            const percent = Math.round(p.progressPercent || 0);
            const lastRead = p.lastReadAt && p.lastReadAt.toDate
                ? timeAgo(p.lastReadAt.toDate())
                : '';
            return `
                <a href="reader.html?book=${encodeURIComponent(p.bookId)}" class="stats-recent-item">
                    ${cover}
                    <div class="stats-recent-info">
                        <div class="stats-recent-title">${escapeHtml(title)}</div>
                        <div class="stats-recent-meta">
                            <span>Page ${p.lastPage || 1} / ${p.totalPages || '?'}</span>
                            ${lastRead ? `<span>· ${lastRead}</span>` : ''}
                        </div>
                    </div>
                    <div class="stats-recent-progress">${percent}%</div>
                </a>
            `;
        }).join('');
    }

    function timeAgo(date) {
        const diff = Date.now() - date.getTime();
        const min = Math.floor(diff / 60000);
        if (min < 1) return 'just now';
        if (min < 60) return `${min}m ago`;
        const h = Math.floor(min / 60);
        if (h < 24) return `${h}h ago`;
        const d = Math.floor(h / 24);
        if (d < 7) return `${d}d ago`;
        return date.toLocaleDateString();
    }

    function escapeHtml(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    // ============================================
    // GOAL MODAL
    // ============================================
    function setupGoalModal() {
        const modal = $('statsGoalModal');
        const input = $('statsGoalInput');

        $('statsEditGoalBtn')?.addEventListener('click', () => {
            if (input) input.value = dailyGoalMin;
            if (modal) modal.hidden = false;
            setTimeout(() => input?.focus(), 50);
        });
        $('statsGoalModalClose')?.addEventListener('click', () => { if (modal) modal.hidden = true; });
        $('statsGoalCancelBtn')?.addEventListener('click', () => { if (modal) modal.hidden = true; });
        $('statsGoalSaveBtn')?.addEventListener('click', async () => {
            let val = parseInt(input?.value, 10);
            if (isNaN(val)) val = CONFIG.DEFAULT_GOAL_MIN;
            val = Math.max(5, Math.min(300, val));
            await saveGoal(val);
            renderGoal();
            if (modal) modal.hidden = true;
        });
    }

    // ============================================
    // BOOT
    // ============================================
    async function bootstrap() {
        setupGoalModal();

        auth.onAuthStateChanged(async (user) => {
            if (!user) {
                window.location.replace('index.html');
                return;
            }
            currentUser = user;
            currentUserId = user.uid;

            try {
                const email = (user.email || '').toLowerCase();
                const doc = await db.collection(CONFIG.COLLECTIONS.WHITELIST).doc(email).get();
                if (!doc.exists || doc.data().active !== true) {
                    await auth.signOut();
                    window.location.replace('index.html');
                    return;
                }
            } catch (err) {
                console.warn('[Stats] Whitelist check failed:', err.code);
                window.location.replace('index.html');
                return;
            }

            await Promise.all([loadGoal(), loadHistory(), loadRecentProgress()]);
            await loadBooks(recentProgress.map((p) => p.bookId));

            renderGoal();
            renderMiniStats();
            renderWeekChart();
            renderRecent();

            hideAuthGate();
        }, (err) => {
            console.warn('[Stats] Auth error:', err);
            window.location.replace('index.html');
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        startAuthGateAnimation();
        if (typeof firebase !== 'undefined' && firebase.auth) bootstrap();
    });
})();
