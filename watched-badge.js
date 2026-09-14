// ============================================
// Watched Badge System - Real-time Sync
// ============================================

class WatchedBadgeSystem {
    constructor() {
        this.watchedItems = new Set();
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
        await this.loadWatchedItems();
        this.setupRealtimeListener();
        this.isInitialized = true;
        
        console.log(`✅ Watched Badge System initialized (${this.watchedItems.size} items)`);
    }
    
    // Load all watched items from Firestore
    async loadWatchedItems() {
        try {
            const snapshot = await db.collection('watched')
                .where('userId', '==', this.userId)
                .get();
            
            snapshot.forEach(doc => {
                this.watchedItems.add(doc.data().itemId);
            });
            
        } catch (error) {
            console.error('Error loading watched items:', error);
        }
    }
    
    // Real-time listener for cross-device sync
    setupRealtimeListener() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        
        this.unsubscribe = db.collection('watched')
            .where('userId', '==', this.userId)
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    const data = change.doc.data();
                    
                    if (change.type === 'added') {
                        if (!this.watchedItems.has(data.itemId)) {
                            this.watchedItems.add(data.itemId);
                            this.updateBadgeUI(data.itemId, true);
                        }
                    }
                    
                    if (change.type === 'removed') {
                        this.watchedItems.delete(data.itemId);
                        this.updateBadgeUI(data.itemId, false);
                    }
                });
            }, (error) => {
                console.error('Realtime listener error:', error);
            });
    }
    
    // Check if item is watched
    isWatched(itemId) {
        return this.watchedItems.has(itemId);
    }
    
    // Mark as watched with smooth animation
    async markAsWatched(itemId, itemTitle, itemType, buttonElement) {
        if (this.watchedItems.has(itemId)) {
            return; // Already watched
        }
        
        // Add ripple effect
        if (buttonElement) {
            buttonElement.classList.add('ripple');
            setTimeout(() => buttonElement.classList.remove('ripple'), 600);
        }
        
        // Optimistic update (instant UI feedback)
        this.watchedItems.add(itemId);
        this.updateBadgeUI(itemId, true);
        
        try {
            await db.collection('watched').add({
                userId: this.userId,
                itemId: itemId,
                itemTitle: itemTitle || '',
                itemType: itemType || 'videos',
                watchedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            this.showToast('✓ Marked as watched');
            
        } catch (error) {
            console.error('Error marking as watched:', error);
            
            // Rollback on error
            this.watchedItems.delete(itemId);
            this.updateBadgeUI(itemId, false);
            this.showToast('Failed to save. Try again.', 'error');
        }
    }
    
    // Remove watched status
    async removeWatched(itemId, buttonElement) {
        if (!this.watchedItems.has(itemId)) return;
        
        // Add ripple
        if (buttonElement) {
            buttonElement.classList.add('ripple');
            setTimeout(() => buttonElement.classList.remove('ripple'), 600);
        }
        
        // Optimistic update
        this.watchedItems.delete(itemId);
        this.updateBadgeUI(itemId, false);
        
        try {
            const snapshot = await db.collection('watched')
                .where('userId', '==', this.userId)
                .where('itemId', '==', itemId)
                .get();
            
            const batch = db.batch();
            snapshot.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            
            this.showToast('Removed from watched', 'info');
            
        } catch (error) {
            console.error('Error removing watched status:', error);
            
            // Rollback
            this.watchedItems.add(itemId);
            this.updateBadgeUI(itemId, true);
        }
    }
    
    // Update badge UI on a card
    updateBadgeUI(itemId, isWatched) {
        const card = document.querySelector(`[data-item-id="${itemId}"]`);
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
    
    // Get watched count
    getWatchedCount() {
        return this.watchedItems.size;
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
// Global Helper Functions (for onclick handlers)
// ============================================

function isWatched(itemId) {
    return watchedBadgeSystem ? watchedBadgeSystem.isWatched(itemId) : false;
}

async function toggleWatched(itemId, itemTitle, itemType, element) {
    if (!watchedBadgeSystem) return;
    
    if (watchedBadgeSystem.isWatched(itemId)) {
        await watchedBadgeSystem.removeWatched(itemId, element);
    } else {
        await watchedBadgeSystem.markAsWatched(itemId, itemTitle, itemType, element);
    }
}
