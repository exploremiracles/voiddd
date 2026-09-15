// ============================================
// Cross-Search Feature - OPTIMIZED
// Real-time with caching + smart pagination
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
        this.RESULTS_PER_PAGE = 8;
        this.searchStartTime = 0;
        this.listenersAttached = false;
        
        // ✅ NEW: Cache system
        this.cache = new Map();           // Query cache
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        this.classesCache = null;         // User classes cache
        
        // ✅ NEW: Search history tracking
        this.lastSearchQuery = '';
        this.searchAbortController = null; // Cancel previous searches
    }
    
    initialize() {
        const existingSearch = document.getElementById('searchInput');
        if (!existingSearch) {
            this.createSearchUI();
        }
        
        this.waitForUserReady();
        console.log('🔍 Cross-Search initialized');
    }
    
    waitForUserReady() {
        let attempts = 0;
        const maxAttempts = 50;
        
        const check = () => {
            attempts++;
            
            const userReady = typeof currentUser !== 'undefined' && 
                             currentUser !== null && 
                             currentUser.allowedClasses && 
                             currentUser.allowedClasses.length > 0;
            
            if (userReady) {
                this.classesCache = currentUser.allowedClasses;
                console.log('✅ Search: User ready, attaching listeners');
                this.attachListeners();
                return;
            }
            
            if (attempts < maxAttempts) {
                setTimeout(check, 200);
            } else {
                this.attachListeners();
            }
        };
        
        check();
    }
    
    createSearchUI() {
        if (document.getElementById('searchContainer')) return;
        
        const searchHTML = `
            <div class="search-container" id="searchContainer">
                <div class="search-bar">
                    <span class="material-icons search-icon">search</span>
                    <input 
                        type="text" 
                        class="search-input" 
                        id="searchInput" 
                        placeholder="Search videos, PDFs, images, posts..."
                        autocomplete="off">
                    <div class="search-spinner" id="searchSpinner"></div>
                    <button class="search-clear" id="searchClear" aria-label="Clear search">
                        <span class="material-icons">close</span>
                    </button>
                </div>
                <div class="search-results" id="searchResults"></div>
            </div>
        `;
        
        const filtersSection = document.querySelector('.filters-section');
        if (filtersSection && filtersSection.parentNode) {
            filtersSection.parentNode.insertBefore(
                this.createSearchElement(searchHTML),
                filtersSection
            );
        }
    }
    
    createSearchElement(html) {
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return temp.firstElementChild;
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
            
            if (query.length > 0) {
                this.clearBtn.classList.add('visible');
            } else {
                this.clearBtn.classList.remove('visible');
                this.hideResults();
                return;
            }
            
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                this.performSearch(query);
            }, 300); // Increased to 300ms for smoother typing
        });
        
        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(this.debounceTimer);
                this.performSearch(e.target.value.trim());
            }
            
            if (e.key === 'Escape') {
                this.clearSearch();
            }
        });
        
        this.clearBtn.addEventListener('click', () => this.clearSearch());
        
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#searchContainer')) {
                this.hideResults();
            }
        });
        
        this.listenersAttached = true;
        console.log('✅ Search listeners attached');
    }
    
    // ============================================
    // ✅ NEW: Cache helpers
    // ============================================
    
    getCachedResult(query) {
        const cached = this.cache.get(query);
        if (!cached) return null;
        
        // Check if cache is still valid
        if (Date.now() - cached.timestamp > this.cacheTimeout) {
            this.cache.delete(query);
            return null;
        }
        
        console.log(`⚡ Cache HIT for: "${query}"`);
        return cached.data;
    }
    
    setCachedResult(query, data) {
        // Limit cache size to prevent memory issues
        if (this.cache.size >= 20) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        this.cache.set(query, {
            data: data,
            timestamp: Date.now()
        });
        
        console.log(`💾 Cached result for: "${query}"`);
    }
    
    clearCache() {
        this.cache.clear();
        console.log('🗑️ Search cache cleared');
    }
    
    // ============================================
    // Get user's allowed classes (with cache)
    // ============================================
    
    async getAllowedClasses() {
        // Use cached classes if available
        if (this.classesCache && this.classesCache.length > 0) {
            return this.classesCache;
        }
        
        if (typeof currentUser !== 'undefined' && currentUser && 
            currentUser.allowedClasses && currentUser.allowedClasses.length > 0) {
            this.classesCache = currentUser.allowedClasses;
            return this.classesCache;
        }
        
        try {
            const session = JSON.parse(localStorage.getItem('session') || '{}');
            if (session.allowedClasses && session.allowedClasses.length > 0) {
                this.classesCache = session.allowedClasses;
                return this.classesCache;
            }
        } catch (e) {}
        
        try {
            const user = auth.currentUser;
            if (user) {
                const whitelistDoc = await db.collection('whitelist').doc(user.email.toLowerCase()).get();
                if (whitelistDoc.exists) {
                    const data = whitelistDoc.data();
                    if (data.allowedClasses && data.allowedClasses.length > 0) {
                        this.classesCache = data.allowedClasses;
                        return this.classesCache;
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching classes:', error);
        }
        
        return [];
    }
    
    // ============================================
    // ✅ OPTIMIZED: Perform search with caching
    // ============================================
    
    async performSearch(query) {
        if (!query || query.length < 2) {
            this.hideResults();
            return;
        }
        
        const lowerQuery = query.toLowerCase();
        
        // ✅ Prevent duplicate searches
        if (lowerQuery === this.lastSearchQuery && this.allResults.length > 0) {
            console.log('⏭️ Skipping duplicate search');
            this.displayResults(this.allResults, false);
            return;
        }
        
        this.lastSearchQuery = lowerQuery;
        this.currentQuery = lowerQuery;
        this.searchStartTime = Date.now();
        
        // ✅ Check cache first
        const cachedResults = this.getCachedResult(lowerQuery);
        if (cachedResults) {
            this.allResults = cachedResults;
            this.displayedCount = 0;
            this.displayResults(cachedResults, false);
            return;
        }
        
        // Show spinner
        this.spinner.classList.add('visible');
        
        try {
            const allowedClasses = await this.getAllowedClasses();
            
            if (allowedClasses.length === 0) {
                this.spinner.classList.remove('visible');
                this.showError('Please wait, loading your content...');
                return;
            }
            
            // ✅ Reduced limits for faster search
            const [videos, pdfs, images, posts] = await Promise.all([
                this.searchCollection('videos', allowedClasses),
                this.searchCollection('pdfs', allowedClasses),
                this.searchCollection('images', allowedClasses),
                this.searchPosts(allowedClasses)
            ]);
            
            const allResults = [
                ...videos.map(v => ({...v, type: 'video'})),
                ...pdfs.map(p => ({...p, type: 'pdf'})),
                ...images.map(i => ({...i, type: 'image'})),
                ...posts.map(p => ({...p, type: 'post'}))
            ];
            
            const filtered = this.filterResults(allResults, lowerQuery);
            const sorted = this.sortByRelevance(filtered, lowerQuery);
            
            // ✅ Cache the result
            this.setCachedResult(lowerQuery, sorted);
            
            this.allResults = sorted;
            this.displayedCount = 0;
            
            // Minimum display time for smoothness
            const elapsed = Date.now() - this.searchStartTime;
            const minTime = 200; // Reduced for snappier feel
            if (elapsed < minTime) {
                await new Promise(resolve => setTimeout(resolve, minTime - elapsed));
            }
            
            this.spinner.classList.remove('visible');
            this.displayResults(sorted, false);
            
        } catch (error) {
            console.error('Search error:', error);
            this.spinner.classList.remove('visible');
            this.showError('Search failed. Please try again.');
        }
    }
    
    // ✅ Reduced limit for faster loading
    async searchCollection(collectionName, allowedClasses) {
        try {
            const classesToQuery = allowedClasses.slice(0, 10);
            
            const snapshot = await db.collection(collectionName)
                .where('class', 'in', classesToQuery)
                .limit(30) // ✅ Reduced from 50 to 30
                .get();
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error(`Error searching ${collectionName}:`, error);
            return [];
        }
    }
    
    async searchPosts(allowedClasses) {
        try {
            const promises = allowedClasses.slice(0, 10).map(cls => 
                db.collection('posts')
                    .where('class', 'array-contains', cls)
                    .limit(20) // ✅ Reduced from 30 to 20
                    .get()
            );
            
            const snapshots = await Promise.all(promises);
            const posts = [];
            const seenIds = new Set();
            
            snapshots.forEach(snap => {
                snap.docs.forEach(doc => {
                    if (!seenIds.has(doc.id)) {
                        seenIds.add(doc.id);
                        posts.push({ id: doc.id, ...doc.data() });
                    }
                });
            });
            
            return posts;
        } catch (error) {
            console.error('Error searching posts:', error);
            return [];
        }
    }
    
    filterResults(results, query) {
        return results.filter(item => {
            const searchFields = [
                item.title,
                item.subject,
                item.description,
                item.content,
                item.class,
                item.studentName
            ].filter(Boolean).map(f => String(f).toLowerCase());
            
            return searchFields.some(field => field.includes(query));
        });
    }
    
    sortByRelevance(results, query) {
        return results.sort((a, b) => {
            const aTitle = (a.title || '').toLowerCase();
            const bTitle = (b.title || '').toLowerCase();
            
            const aExact = aTitle === query ? 3 : 0;
            const bExact = bTitle === query ? 3 : 0;
            if (aExact !== bExact) return bExact - aExact;
            
            const aStarts = aTitle.startsWith(query) ? 2 : 0;
            const bStarts = bTitle.startsWith(query) ? 2 : 0;
            if (aStarts !== bStarts) return bStarts - aStarts;
            
            const aContains = aTitle.includes(query) ? 1 : 0;
            const bContains = bTitle.includes(query) ? 1 : 0;
            if (aContains !== bContains) return bContains - aContains;
            
            return aTitle.localeCompare(bTitle);
        });
    }
    
    displayResults(results, append = false) {
        if (!append) {
            this.searchResults.innerHTML = '';
            this.searchResults.classList.add('visible');
        }
        
        if (results.length === 0) {
            this.showEmpty();
            return;
        }
        
        const existingBtn = this.searchResults.querySelector('.search-show-more');
        if (existingBtn) existingBtn.remove();
        
        const start = this.displayedCount;
        const end = Math.min(start + this.RESULTS_PER_PAGE, results.length);
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
        
        // ✅ Use DocumentFragment for smoother rendering
        const fragment = document.createDocumentFragment();
        batch.forEach(item => {
            const itemEl = this.createResultElement(item);
            fragment.appendChild(itemEl);
        });
        this.searchResults.appendChild(fragment);
        
        this.displayedCount = end;
        
        if (this.displayedCount < results.length) {
            const showMoreBtn = document.createElement('button');
            showMoreBtn.className = 'search-show-more';
            showMoreBtn.innerHTML = `
                <span class="material-icons">expand_more</span>
                <span>Show more (${results.length - this.displayedCount} remaining)</span>
            `;
            showMoreBtn.onclick = (e) => {
                e.stopPropagation();
                this.displayResults(results, true);
            };
            this.searchResults.appendChild(showMoreBtn);
        }
    }
    
    createResultElement(item) {
        const typeConfig = {
            video: { icon: 'play_circle', label: 'Video', class: 'video' },
            pdf: { icon: 'picture_as_pdf', label: 'PDF', class: 'pdf' },
            image: { icon: 'image', label: 'Image', class: 'image' },
            post: { icon: 'article', label: 'Post', class: 'post' }
        };
        
        const config = typeConfig[item.type] || typeConfig.video;
        const title = this.highlightText(item.title || 'Untitled', this.currentQuery);
        const metaParts = [];
        
        if (item.subject) metaParts.push({ icon: 'menu_book', text: item.subject });
        
        if (item.class) {
            const classText = Array.isArray(item.class) ? item.class.join(', ') : item.class;
            metaParts.push({ icon: 'school', text: classText });
        }
        
        if (item.duration) metaParts.push({ icon: 'schedule', text: item.duration });
        
        const el = document.createElement('div');
        el.className = 'search-result-item';
        el.innerHTML = `
            <div class="result-badge ${config.class}">
                <span class="material-icons">${config.icon}</span>
                <span>${config.label}</span>
            </div>
            <div class="result-content">
                <div class="result-title">${title}</div>
                <div class="result-meta">
                    ${metaParts.map(p => `
                        <span class="meta-item">
                            <span class="material-icons">${p.icon}</span>
                            ${this.escapeHtml(p.text)}
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
        
        const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
        return escaped.replace(regex, '<span class="search-highlight">$1</span>');
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    async handleResultClick(item) {
        this.hideResults();
        
        const tabMap = {
            video: 'videos',
            pdf: 'pdfs',
            image: 'images',
            post: 'posts'
        };
        
        const targetTab = tabMap[item.type];
        
        if (typeof switchTab === 'function') {
            switchTab(targetTab);
        }
        
        await new Promise(resolve => setTimeout(resolve, 400));
        
        let targetClass = null;
        
        if (item.class) {
            const studentClasses = currentUser?.allowedClasses || 
                                  JSON.parse(localStorage.getItem('session') || '{}').allowedClasses || 
                                  [];
            
            if (Array.isArray(item.class)) {
                targetClass = item.class.find(c => studentClasses.includes(c)) || item.class[0];
            } else {
                targetClass = item.class;
            }
        }
        
        if (targetClass && typeof selectClass === 'function') {
            const classChips = document.querySelectorAll('.class-chips .chip');
            let classAlreadySelected = false;
            let found = false;
            
            classChips.forEach(chip => {
                if (chip.textContent === targetClass) {
                    found = true;
                    if (chip.classList.contains('active')) {
                        classAlreadySelected = true;
                    }
                }
            });
            
            if (!classAlreadySelected && found) {
                classChips.forEach(chip => {
                    if (chip.textContent === targetClass) {
                        chip.click();
                    }
                });
            } else if (!found) {
                this.showToast('You do not have access to this class', 'error');
                return;
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.scrollToAndHighlight(item);
        
        this.searchInput.value = '';
        this.clearBtn.classList.remove('visible');
    }
    
    scrollToAndHighlight(item) {
        let attempts = 0;
        const maxAttempts = 30;
        let autoLoadsDone = 0;
        const maxAutoLoads = 20;
        
        this.showLoadingToast('Loading content...');
        
        const tryFind = () => {
            attempts++;
            
            const card = document.querySelector(`[data-item-id="${item.id}"]`);
            
            if (card) {
                this.hideLoadingToast();
                this.highlightCard(card, item);
                return true;
            }
            
            if (autoLoadsDone < maxAutoLoads) {
                const loadMoreBtn = document.querySelector('.load-more-btn');
                
                if (loadMoreBtn) {
                    autoLoadsDone++;
                    loadMoreBtn.click();
                    setTimeout(tryFind, 200);
                    return false;
                } else {
                    this.hideLoadingToast();
                    this.showToast('Content not available', 'error');
                    return false;
                }
            }
            
            if (attempts >= maxAttempts) {
                this.hideLoadingToast();
                this.showToast('Content not found', 'error');
                return false;
            }
            
            setTimeout(tryFind, 200);
            return false;
        };
        
        setTimeout(tryFind, 400);
    }
    
    highlightCard(card, item) {
        document.querySelectorAll('.golden-highlight').forEach(el => {
            el.classList.remove('golden-highlight');
        });
        
        card.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
        });
        
        setTimeout(() => {
            card.classList.add('golden-highlight');
            setTimeout(() => {
                card.classList.remove('golden-highlight');
            }, 3200);
        }, 500);
        
        this.showToast('Content found!', 'success');
    }
    
    showLoadingToast(message) {
        this.hideLoadingToast();
        
        const toast = document.createElement('div');
        toast.className = 'search-loading-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%) translateY(0);
            background: linear-gradient(135deg, #5a745f, #7c967a);
            color: white;
            padding: 14px 24px;
            border-radius: 25px;
            font-weight: 600;
            font-size: 0.85rem;
            box-shadow: 0 10px 30px rgba(90, 116, 95, 0.4);
            z-index: 99999;
            display: flex;
            align-items: center;
            gap: 10px;
            font-family: inherit;
        `;
        toast.innerHTML = `
            <div style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.6s linear infinite;"></div>
            <span>${message}</span>
        `;
        document.body.appendChild(toast);
    }
    
    hideLoadingToast() {
        const toast = document.querySelector('.search-loading-toast');
        if (toast) toast.remove();
    }
    
    showEmpty() {
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
        this.searchResults.innerHTML = `
            <div class="search-empty">
                <span class="material-icons">error_outline</span>
                <div class="search-empty-title">${message}</div>
            </div>
        `;
        this.searchResults.classList.add('visible');
    }
    
    showToast(message, type = 'info') {
        const existingToast = document.querySelector('.search-toast');
        if (existingToast) existingToast.remove();
        
        let bgColor = 'linear-gradient(135deg, #6b7280, #9ca3af)';
        let icon = 'info';
        
        if (type === 'error') {
            bgColor = 'linear-gradient(135deg, #DC2626, #ef4444)';
            icon = 'error';
        } else if (type === 'success') {
            bgColor = 'linear-gradient(135deg, #059669, #10b981)';
            icon = 'check_circle';
        }
        
        const toast = document.createElement('div');
        toast.className = 'search-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%) translateY(100px);
            background: ${bgColor};
            color: white;
            padding: 12px 22px;
            border-radius: 25px;
            font-weight: 600;
            font-size: 0.85rem;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            z-index: 99999;
            transition: transform 0.4s ease;
            font-family: inherit;
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        toast.innerHTML = `
            <span class="material-icons" style="font-size:18px;">${icon}</span>
            <span>${message}</span>
        `;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.transform = 'translateX(-50%) translateY(0)';
        }, 50);
        
        setTimeout(() => {
            toast.style.transform = 'translateX(-50%) translateY(100px)';
            setTimeout(() => toast.remove(), 400);
        }, 2500);
    }
    
    hideResults() {
        if (this.searchResults) {
            this.searchResults.classList.remove('visible');
        }
    }
    
    clearSearch() {
        if (this.searchInput) this.searchInput.value = '';
        if (this.clearBtn) this.clearBtn.classList.remove('visible');
        this.hideResults();
        this.currentQuery = '';
        this.lastSearchQuery = '';
        this.allResults = [];
        this.displayedCount = 0;
    }
}

// ============================================
// Initialize
// ============================================

let crossSearch = null;

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        crossSearch = new CrossSearch();
        crossSearch.initialize();
    }, 800);
});

// Global helpers
window.clearSearch = function() {
    if (crossSearch) crossSearch.clearSearch();
};

window.clearSearchCache = function() {
    if (crossSearch) crossSearch.clearCache();
};
