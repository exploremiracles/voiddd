/**
 * Campus Unfolded — Watched Badge System
 * Uses onUserReady() from dashboard.js — no independent auth polling.
 * Deterministic doc IDs (userId_videoId) → idempotent writes.
 * Field name: createdAt (matches Firestore rules).
 */

(function () {
  'use strict';

  const COLLECTION = 'watchedVideos';
  const DOC_ID_SEPARATOR = '__';

  class WatchedBadgeSystem {
    constructor() {
      this.watchedVideos = new Set();
      this.userId = null;
      this.unsubscribe = null;
      this.isInitialized = false;
    }

    async initialize() {
      // Wait for dashboard to confirm auth + whitelist
      await new Promise((resolve) => {
        if (typeof window.onUserReady === 'function') {
          window.onUserReady(resolve);
        } else {
          // Fallback: poll for currentUser, but bounded
          const t0 = Date.now();
          const tick = setInterval(() => {
            if (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) {
              clearInterval(tick); resolve();
            } else if (Date.now() - t0 > 10000) {
              clearInterval(tick); resolve();
            }
          }, 150);
        }
      });

      const user = auth.currentUser;
      if (!user) {
        console.warn('[WatchedBadge] No user after ready — skipping');
        return;
      }

      this.userId = user.uid;
      await this.loadWatchedVideos();
      this.setupRealtimeListener();
      this.isInitialized = true;

      this.refreshAllBadges();
      this.triggerProgressUpdate();
    }

    async loadWatchedVideos() {
      try {
        const snapshot = await db.collection(COLLECTION)
          .where('userId', '==', this.userId)
          .get();
        snapshot.forEach((doc) => {
          const v = doc.data().videoId;
          if (v) this.watchedVideos.add(v);
        });
      } catch (err) {
        console.warn('[WatchedBadge] Load failed:', err.code);
        if (err.code === 'permission-denied') {
          // Whitelist was revoked; dashboard listener will handle redirect
        }
      }
    }

    setupRealtimeListener() {
      if (this.unsubscribe) this.unsubscribe();

      this.unsubscribe = db.collection(COLLECTION)
        .where('userId', '==', this.userId)
        .onSnapshot((snapshot) => {
          let changed = false;
          snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            if (!data || !data.videoId) return;

            if (change.type === 'added') {
              if (!this.watchedVideos.has(data.videoId)) {
                this.watchedVideos.add(data.videoId);
                this.updateBadgeUI(data.videoId, true);
                changed = true;
              }
            }
            if (change.type === 'removed') {
              if (this.watchedVideos.has(data.videoId)) {
                this.watchedVideos.delete(data.videoId);
                this.updateBadgeUI(data.videoId, false);
                changed = true;
              }
            }
          });
          // Once per snapshot, not per doc
          if (changed) this.triggerProgressUpdate();
        }, (err) => {
          if (err.code === 'permission-denied') {
            console.warn('[WatchedBadge] Access revoked');
            if (typeof window.showAccessRevoked === 'function') {
              window.showAccessRevoked('Access revoked.');
            }
          } else {
            console.warn('[WatchedBadge] Listener error:', err.code);
          }
        });
    }

    isWatched(videoId) {
      return this.watchedVideos.has(videoId);
    }

    docIdFor(videoId) {
      return `${this.userId}${DOC_ID_SEPARATOR}${videoId}`;
    }

    async markAsWatched(videoId, videoTitle, buttonElement) {
      if (!this.userId) {
        this.showToast('Please wait, loading...', 'error');
        return;
      }
      if (this.watchedVideos.has(videoId)) return;

      if (buttonElement) {
        buttonElement.classList.add('ripple');
        setTimeout(() => buttonElement.classList.remove('ripple'), 600);
      }

      // Optimistic update
      this.watchedVideos.add(videoId);
      this.updateBadgeUI(videoId, true);
      this.triggerProgressUpdate();

      try {
        await db.collection(COLLECTION).doc(this.docIdFor(videoId)).set({
          userId: this.userId,
          videoId: videoId,
          videoTitle: videoTitle || '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        this.showToast('✓ Marked as watched');
      } catch (err) {
        console.error('[WatchedBadge] Save failed:', err.code, err.message);
        // Rollback
        this.watchedVideos.delete(videoId);
        this.updateBadgeUI(videoId, false);
        this.triggerProgressUpdate();
        this.showToast('Failed to save', 'error');
      }
    }

    async removeWatched(videoId, buttonElement) {
      if (!this.userId) return;
      if (!this.watchedVideos.has(videoId)) return;

      if (buttonElement) {
        buttonElement.classList.add('ripple');
        setTimeout(() => buttonElement.classList.remove('ripple'), 600);
      }

      // Optimistic
      this.watchedVideos.delete(videoId);
      this.updateBadgeUI(videoId, false);
      this.triggerProgressUpdate();

      try {
        // Deterministic ID — single doc delete, no query needed
        await db.collection(COLLECTION).doc(this.docIdFor(videoId)).delete();
        this.showToast('Removed from watched', 'info');
      } catch (err) {
        // Handle already-deleted case gracefully
        if (err.code === 'not-found') return;

        console.error('[WatchedBadge] Delete failed:', err.code);
        // Rollback
        this.watchedVideos.add(videoId);
        this.updateBadgeUI(videoId, true);
        this.triggerProgressUpdate();
      }
    }

    updateBadgeUI(videoId, isWatched) {
      // Use attribute-safe selector (IDs may contain special chars)
      let card;
      try {
        card = document.querySelector(`[data-item-id="${CSS.escape(videoId)}"]`);
      } catch (_) {
        card = document.querySelector(`[data-item-id="${videoId}"]`);
      }
      if (!card) return;

      const indicator = card.querySelector('.watched-indicator');
      if (!indicator) return;

      if (isWatched) {
        indicator.classList.add('watched');
        indicator.innerHTML = `
          <span class="material-icons">check_circle</span>
          <span>Watched</span>
        `;
        card.classList.add('watched-card');
      } else {
        indicator.classList.remove('watched');
        indicator.innerHTML = `
          <span class="material-icons">check_circle_outline</span>
          <span>Mark as watched</span>
        `;
        card.classList.remove('watched-card');
      }
    }

    refreshAllBadges() {
      document.querySelectorAll('[data-item-id]').forEach((card) => {
        const videoId = card.dataset.itemId;
        if (!videoId) return;
        this.updateBadgeUI(videoId, this.watchedVideos.has(videoId));
      });
    }

    triggerProgressUpdate() {
      if (typeof window.onVideoWatched === 'function') {
        window.onVideoWatched();
      } else if (typeof updateVideoProgress === 'function' &&
                 typeof cachedData !== 'undefined' &&
                 cachedData && cachedData.length) {
        updateVideoProgress(cachedData);
      }
    }

    getWatchedCount() {
      return this.watchedVideos.size;
    }

    getWatchedCountFromList(videos) {
      if (!Array.isArray(videos)) return 0;
      return videos.filter((v) => this.watchedVideos.has(v.id)).length;
    }

    showToast(message, type = 'success') {
      document.querySelector('.watched-toast-mini')?.remove();
      const toast = document.createElement('div');
      toast.className = 'watched-toast-mini';
      if (type === 'error') {
        toast.style.background = 'linear-gradient(135deg, #DC2626, #ef4444)';
        toast.style.boxShadow = '0 10px 30px rgba(220, 38, 38, 0.4)';
      } else if (type === 'info') {
        toast.style.background = 'linear-gradient(135deg, #6b7280, #9ca3af)';
        toast.style.boxShadow = '0 10px 30px rgba(107, 114, 128, 0.4)';
      }
      toast.innerHTML = `
        <span class="material-icons">${type === 'error' ? 'error' : type === 'info' ? 'info' : 'check_circle'}</span>
        <span>${message}</span>
      `;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2500);
    }

    destroy() {
      if (this.unsubscribe) this.unsubscribe();
    }
  }

  // ============================================
  // GLOBAL INSTANCE
  // ============================================
  let watchedBadgeSystem = null;

  function initWatchedBadge() {
    if (watchedBadgeSystem && watchedBadgeSystem.isInitialized) {
      watchedBadgeSystem.refreshAllBadges();
      watchedBadgeSystem.triggerProgressUpdate();
      return;
    }
    watchedBadgeSystem = new WatchedBadgeSystem();
    watchedBadgeSystem.initialize();
  }

  // Kick off after DOMContentLoaded (dashboard.js boots on the same event)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWatchedBadge);
  } else {
    initWatchedBadge();
  }

  // ============================================
  // GLOBAL HELPERS
  // ============================================
  window.isVideoWatched = (videoId) => {
    return watchedBadgeSystem ? watchedBadgeSystem.isWatched(videoId) : false;
  };

  window.getWatchedCountForList = (videos) => {
    return watchedBadgeSystem ? watchedBadgeSystem.getWatchedCountFromList(videos) : 0;
  };

  window.toggleWatched = async (videoId, videoTitle, element) => {
    if (!watchedBadgeSystem || !watchedBadgeSystem.isInitialized) {
      window.showToast?.('Please wait, loading...', 'error');
      return;
    }
    if (!watchedBadgeSystem.userId) {
      window.showToast?.('Please wait, loading...', 'error');
      return;
    }
    if (watchedBadgeSystem.isWatched(videoId)) {
      await watchedBadgeSystem.removeWatched(videoId, element);
    } else {
      await watchedBadgeSystem.markAsWatched(videoId, videoTitle, element);
    }
  };

  window.refreshWatchedBadges = () => {
    if (watchedBadgeSystem) {
      watchedBadgeSystem.refreshAllBadges();
      watchedBadgeSystem.triggerProgressUpdate();
    } else {
      initWatchedBadge();
    }
  };

  window.getWatchedProgress = () => {
    if (!watchedBadgeSystem) return { watched: 0, total: 0, percentage: 0 };
    const total = (typeof cachedData !== 'undefined' && cachedData) ? cachedData.length : 0;
    const watched = watchedBadgeSystem.getWatchedCountFromList(cachedData);
    const percentage = total > 0 ? Math.round((watched / total) * 100) : 0;
    return { watched, total, percentage };
  };
})();
