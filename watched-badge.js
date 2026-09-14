// ============================================
// Watched Badge System - Videos Only
// Real-time Sync with Firebase - FIXED
// ============================================

class WatchedBadgeSystem {
    constructor() {
        this.watchedVideos = new Set();
        this.userId = null;
        this.unsubscribe = null;
        this.isInitialized = false;
        this.initRetries = 0;
        this.maxRetries = 10;
    }
    
    async initialize() {
        console.log('🎬 WatchedBadge: Initializing...');
        
        // Wait for auth to be ready
        const user = await this.waitForAuth();
        
        if (!user) {
            console.log('❌ WatchedBadge: No user found');
            return;
        }
        
        this.userId = user.uid;
        console.log('✅ WatchedBadge: User found:', this.userId);
        
        await this.loadWatchedVideos();
        this.setupRealtimeListener();
        this.isInitialized = true;
        
        console.log(`✅ WatchedBadge: Ready (${this.watchedVideos.size} videos)`);
        
        // Update all existing badges on page
        this.refreshAllBadges();
    }
    
    // Wait for auth to be ready
    waitForAuth() {
        return new Promise((resolve) => {
            // Check if already logged in
            if (auth.currentUser) {
                resolve(auth.currentUser);
                return;
            }
            
            // Wait for auth state change
            const unsubscribe = auth.onAuthStateChanged((user) => {
                unsubscribe();
                resolve(user);
            });
            
            // Timeout after 10 seconds
            setTimeout(() => resolve(null), 10000);
        });
    }
    
    // Load all watched videos from Firestore
    async loadWatchedVideos() {
        try {
            console.log('📥 WatchedBadge: Loading videos...');
            
            const snapshot = await db.collection('watchedVideos')
                .where('userId', '==', this.userId)
                .get();
            
            snapshot.forEach(doc => {
                this.watchedVideos.add(doc.data().videoId);
            });
            
            console.log(`📥 Loaded ${this.watchedVideos.size} watched videos`);
            
        } catch (error) {
            console.error('❌ Error loading watched videos:', error);
        }
    }
    
    // Real-time listener
    setupRealtimeListener() {
        if (this.unsubscribe) this.unsubscribe();
        
        console.log('🔄 WatchedBadge: Setting up realtime listener...');
        
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
        console.log('🎯 Marking as watched:', videoId);
        
        if (!this.userId) {
            console.error('❌ No user ID');
            this.showToast('Please wait, loading...', 'error');
            return;
        }
        
        if (this.watchedVideos.has(videoId)) {
            console.log('Already watched');
            return;
        }
        
        // Ripple effect
        if (buttonElement) {
            buttonElement.classList.add('ripple');
            setTimeout(() => buttonElement.classList.remove('ripple'), 600);
        }
        
        // Optimistic update
        this.watchedVideos.add(videoId);
        this.updateBadgeUI(videoId, true);
        
        try {
            await db.collection('watchedVideos').add({
                userId: this.userId,
                videoId: videoId,
                videoTitle: videoTitle || '',
                watchedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            console.log('✅ Saved to Firestore');
            this.showToast('✓ Marked as watched');
            
        } catch (error) {
            console.error('❌ Error:', error);
            
            // Rollback
            this.watchedVideos.delete(videoId);
            this.updateBadgeUI(videoId, false);
            this.showToast('Failed to save', 'error');
        }
    }
    
    // Remove watched status
    async removeWatched(videoId, buttonElement) {
        console.log('🔄 Removing watched:', videoId);
        
        if (!this.userId) return;
        if (!this.watchedVideos.has(videoId)) return;
        
        if (buttonElement) {
            buttonElement.classList.add('ripple');
            setTimeout(() => buttonElement.classList.remove('ripple'), 600);
        }
        
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
            console.error('❌ Error:', error);
            
            // Rollback
            this.watchedVideos.add(videoId);
            this.updateBadgeUI(videoId, true);
        }
    }
    
    // Update badge UI
    updateBadgeUI(videoId, isWatched) {
        const card = document.querySelector(`[data-item-id="${videoId}"]`);
        if (!card) {
            console.log('Card not found for:', videoId);
            return;
        }
        
        const indicator = card.querySelector('.watched-indicator');
        if (!indicator) {
            console.log('Indicator not found');
            return;
        }
        
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
    
    // Refresh all badges on page
    refreshAllBadges() {
        document.querySelectorAll('[data-item-id]').forEach(card => {
            const videoId = card.dataset.itemId;
            const isWatched = this.watchedVideos.has(videoId);
            this.updateBadgeUI(videoId, isWatched);
        });
    }
    
    // Show toast
    showToast(message, type = 'success') {
        const existingToast = document.querySelector('.watched-toast-mini');
        if (existingToast) existingToast.remove();
        
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
// Global Instance
// ============================================

let watchedBadgeSystem = null;

// Initialize function that can be called multiple times
function initWatchedBadge() {
    if (watchedBadgeSystem && watchedBadgeSystem.isInitialized) {
        console.log('WatchedBadge already initialized');
        watchedBadgeSystem.refreshAllBadges();
        return;
    }
    
    watchedBadgeSystem = new WatchedBadgeSystem();
    watchedBadgeSystem.initialize();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initWatchedBadge, 500);
    });
} else {
    setTimeout(initWatchedBadge, 500);
}

// ============================================
// Global Helper Functions
// ============================================

function isVideoWatched(videoId) {
    return watchedBadgeSystem && watchedBadgeSystem.isWatched(videoId);
}

// Toggle watched status
window.toggleWatched = async function(videoId, videoTitle, element) {
    console.log('toggleWatched called:', videoId);
    console.log('watchedBadgeSystem exists:', !!watchedBadgeSystem);
    
    // If system not ready, initialize it first
    if (!watchedBadgeSystem) {
        console.log('Initializing watched badge system...');
        initWatchedBadge();
        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (!watchedBadgeSystem) {
        console.error('Failed to initialize');
        return;
    }
    
    if (!watchedBadgeSystem.userId) {
        console.log('Waiting for user...');
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (watchedBadgeSystem.isWatched(videoId)) {
        await watchedBadgeSystem.removeWatched(videoId, element);
    } else {
        await watchedBadgeSystem.markAsWatched(videoId, videoTitle, element);
    }
};

// Re-init after content loads
window.refreshWatchedBadges = function() {
    if (watchedBadgeSystem) {
        watchedBadgeSystem.refreshAllBadges();
    } else {
        initWatchedBadge();
    }
};
