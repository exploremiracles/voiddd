// ============================================
// Watched Badge System - Videos Only
// Real-time Sync with Firebase
// ============================================

class WatchedBadgeSystem {
    constructor() {
        this.watchedVideos = new Set();
        this.userId = null;
        this.unsubscribe = null;
        this.isInitialized = false;
    }
    
    async initialize() {
        const user = auth.currentUser;
        if (!user) {
            console.log('No user logged in');
            return;
        }
        
        this.userId = user.uid;
        await this.loadWatchedVideos();
        this.setupRealtimeListener();
        this.isInitialized = true;
        
        console.log(`✅ Watched Badge System ready (${this.watchedVideos.size} videos)`);
    }
    
    // Load all watched videos from Firestore
    async loadWatchedVideos() {
        try {
            const snapshot = await db.collection('watchedVideos')
                .where('userId', '==', this.userId)
                .get();
            
            snapshot.forEach(doc => {
                this.watchedVideos.add(doc.data().videoId);
            });
            
        } catch (error) {
            console.error('Error loading watched videos:', error);
        }
    }
    
    // Real-time listener for cross-device sync
    setupRealtimeListener() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        
        this.unsubscribe = db.collection('watchedVideos')
            .where('userId', '==', this.userId)
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    const data = change.doc.data();
                    
                    if (change.type === 'added') {
                        if (!this.watchedVideos.has(data.videoId)) {
                            this.watchedVideos.add(data.videoId);
                            this.updateBadgeUI(data.videoId, true);
                        }
                    }
                    
                    if (change.type === 'removed') {
                        this.watchedVideos.delete(data.videoId);
                        this.updateBadgeUI(data.videoId, false);
                    }
                });
            }, (error) => {
                console.error('Realtime listener error:', error);
            });
    }
    
    // Check if video is watched
    isWatched(videoId) {
        return this.watchedVideos.has(videoId);
    }
    
    // Mark video as watched
    async markAsWatched(videoId, videoTitle, buttonElement) {
        if (this.watchedVideos.has(videoId)) {
            return; // Already watched
        }
        
        // Add ripple effect
        if (buttonElement) {
            buttonElement.classList.add('ripple');
            setTimeout(() => buttonElement.classList.remove('ripple'), 600);
        }
        
        // Optimistic update (instant UI feedback)
        this.watchedVideos.add(videoId);
        this.updateBadgeUI(videoId, true);
        
        try {
            await db.collection('watchedVideos').add({
                userId: this.userId,
                videoId: videoId,
                videoTitle: videoTitle || '',
                watchedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            this.showToast('✓ Marked as watched');
            
        } catch (error) {
            console.error('Error marking as watched:', error);
            
            // Rollback on error
            this.watchedVideos.delete(videoId);
            this.updateBadgeUI(videoId, false);
            this.showToast('Failed to save', 'error');
        }
    }
    
    // Remove watched status
    async removeWatched(videoId, buttonElement) {
        if (!this.watchedVideos.has(videoId)) return;
        
        // Add ripple
        if (buttonElement) {
            buttonElement.classList.add('ripple');
            setTimeout(() => buttonElement.classList.remove('ripple'), 600);
        }
        
        // Optimistic update
        this.watchedVideos.delete(videoId);
        this.updateBadgeUI(videoId, false);
        
        try {
            const snapshot = await db.collection('watchedVideos')
                .where('userId', '==', this.userId)
                .where('videoId', '==', videoId)
                .get();
            
            const batch = db.batch();
            snapshot.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            
            this.showToast('Removed from watched', 'info');
            
        } catch (error) {
            console.error('Error removing watched status:', error);
            
            // Rollback
            this.watchedVideos.add(videoId);
            this.updateBadgeUI(videoId, true);
        }
    }
    
    // Update badge UI on a video card
    updateBadgeUI(videoId, isWatched) {
        const card = document.querySelector(`[data-item-id="${videoId}"]`);
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
    
    // Show smooth toast
    showToast(message, type = 'success') {
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
    
    // Cleanup
    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
    }
}

// ============================================
// Global Instance
// ============================================

let watchedBadgeSystem;

// Initialize when auth is ready
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        watchedBadgeSystem = new WatchedBadgeSystem();
        watchedBadgeSystem.initialize();
    }, 1000);
});

// ============================================
// Global Helper Functions
// ============================================

function isVideoWatched(videoId) {
    return watchedBadgeSystem ? watchedBadgeSystem.isWatched(videoId) : false;
}

async function toggleWatched(videoId, videoTitle, element) {
    if (!watchedBadgeSystem) return;
    
    if (watchedBadgeSystem.isWatched(videoId)) {
        await watchedBadgeSystem.removeWatched(videoId, element);
    } else {
        await watchedBadgeSystem.markAsWatched(videoId, videoTitle, element);
    }
}
