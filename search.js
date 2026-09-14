// ============================================
// Cross-Search Feature
// Search across videos, PDFs, images, posts
// With auto-load pagination support
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
    }
    
    initialize() {
        // Check if search UI already exists in HTML
        const existingSearch = document.getElementById('searchInput');
        if (!existingSearch) {
            this.createSearchUI();
        } else {
            console.log('🔍 Using existing search UI from HTML');
        }
        
        // Wait for user to be ready before attaching listeners
        this.waitForUserReady();
        
        console.log('🔍 Cross-Search initialized');
    }
    
    // Wait until currentUser is loaded and ready
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
                console.log('✅ Search: User ready, attaching listeners');
                this.attachListeners();
                return;
            }
            
            if (attempts < maxAttempts) {
                setTimeout(check, 200);
            } else {
                console.log('⚠️ Search: User not ready after 10s, attaching anyway');
                this.attachListeners();
            }
        };
        
        check();
    }
    
    // Create search UI
    createSearchUI() {
        if (document.getElementById('searchContainer')) {
            console.log('Search UI already exists, skipping');
            return;
        }
        
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
    
    // Attach listeners (only once)
    attachListeners() {
        if (this.listenersAttached) {
            console.log('Search listeners already attached');
            return;
        }
        
        this.searchInput = document.getElementById('searchInput');
        this.searchResults = document.getElementById('searchResults');
        this.clearBtn = document.getElementById('searchClear');
        this.spinner = document.getElementById('searchSpinner');
        
        if (!this.searchInput) {
            console.error('❌ Search input not found');
            return;
        }
        
        // Input listener with debounce
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
            }, 250);
        });
        
        // Enter key
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
        
        // Clear button
        this.clearBtn.addEventListener('click', () => {
            this.clearSearch();
        });
        
        // Click outside to close
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#searchContainer')) {
                this.hideResults();
            }
        });
        
        this.listenersAttached = true;
        console.log('✅ Search listeners attached');
    }
    
    // Get allowed classes with multiple fallbacks
    async getAllowedClasses() {
        // Try 1: Global currentUser
        if (typeof currentUser !== 'undefined' && currentUser && 
            currentUser.allowedClasses && currentUser.allowedClasses.length > 0) {
            return currentUser.allowedClasses;
        }
        
        // Try 2: localStorage session
        try {
            const session = JSON.parse(localStorage.getItem('session') || '{}');
            if (session.allowedClasses && session.allowedClasses.length > 0) {
                return session.allowedClasses;
            }
        } catch (e) {
            console.log('Session parse failed');
        }
        
        // Try 3: Fetch from Firestore directly
        try {
            const user = auth.currentUser;
            if (user) {
                const whitelistDoc = await db.collection('whitelist').doc(user.email.toLowerCase()).get();
                if (whitelistDoc.exists) {
                    const data = whitelistDoc.data();
                    if (data.allowedClasses && data.allowedClasses.length > 0) {
                        return data.allowedClasses;
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching classes from Firestore:', error);
        }
        
        return [];
    }
    
    // Perform search across all collections
    async performSearch(query) {
        if (!query || query.length < 2) {
            this.hideResults();
            return;
        }
        
        this.currentQuery = query.toLowerCase();
        this.searchStartTime = Date.now();
        
        this.spinner.classList.add('visible');
        
        try {
            const allowedClasses = await this.getAllowedClasses();
            
            console.log('🔍 Searching with classes:', allowedClasses);
            
            if (allowedClasses.length === 0) {
                this.spinner.classList.remove('visible');
                this.showError('Please wait, loading your content...');
                return;
            }
            
            // Search all collections in parallel
            const [videos, pdfs, images, posts] = await Promise.all([
                this.searchCollection('videos', allowedClasses),
                this.searchCollection('pdfs', allowedClasses),
                this.searchCollection('images', allowedClasses),
                this.searchPosts(allowedClasses)
            ]);
            
            console.log(`📊 Found: ${videos.length} videos, ${pdfs.length} PDFs, ${images.length} images, ${posts.length} posts`);
            
            const allResults = [
                ...videos.map(v => ({...v, type: 'video'})),
                ...pdfs.map(p => ({...p, type: 'pdf'})),
                ...images.map(i => ({...i, type: 'image'})),
                ...posts.map(p => ({...p, type: 'post'}))
            ];
            
            const filtered = this.filterResults(allResults, this.currentQuery);
            const sorted = this.sortByRelevance(filtered, this.currentQuery);
            
            this.allResults = sorted;
            this.displayedCount = 0;
            
            const elapsed = Date.now() - this.searchStartTime;
            const minTime = 300;
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
    
    // Search a collection by class
    async searchCollection(collectionName, allowedClasses) {
        try {
            const classesToQuery = allowedClasses.slice(0, 10);
            
            const snapshot = await db.collection(collectionName)
                .where('class', 'in', classesToQuery)
                .limit(50)
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
    
    // Search posts (array-contains)
    async searchPosts(allowedClasses) {
        try {
            const promises = allowedClasses.slice(0, 10).map(cls => 
                db.collection('posts')
                    .where('class', 'array-contains', cls)
                    .limit(30)
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
    
    // Filter results by query
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
    
    // Sort by relevance
    sortByRelevance(results, query) {
        return results.sort((a, b) => {
            const aTitle = (a.title || '').toLowerCase();
            const bTitle = (b.title || '').toLowerCase();
            
            const aExact = aTitle === query ? 2 : 0;
            const bExact = bTitle === query ? 2 : 0;
            if (aExact !== bExact) return bExact - aExact;
            
            const aStarts = aTitle.startsWith(query) ? 1 : 0;
            const bStarts = bTitle.startsWith(query) ? 1 : 0;
            if (aStarts !== bStarts) return bStarts - aStarts;
            
            const aContains = aTitle.includes(query) ? 1 : 0;
            const bContains = bTitle.includes(query) ? 1 : 0;
            if (aContains !== bContains) return bContains - aContains;
            
            return aTitle.localeCompare(bTitle);
        });
    }
    
    // Display results with pagination
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
        
        batch.forEach(item => {
            const itemEl = this.createResultElement(item);
            this.searchResults.appendChild(itemEl);
        });
        
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
    
    // Create result element
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
        if (item.class) metaParts.push({ icon: 'school', text: item.class });
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
        
        el.addEventListener('click', () => {
            this.handleResultClick(item);
        });
        
        return el;
    }
    
    // Highlight search terms
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
    
    // Handle result click
    async handleResultClick(item) {
        this.hideResults();
        
        const tabMap = {
            video: 'videos',
            pdf: 'pdfs',
            image: 'images',
            post: 'posts'
        };
        
        const targetTab = tabMap[item.type];
        
        // Switch tab
        if (typeof switchTab === 'function') {
            switchTab(targetTab);
        }
        
        // Wait for tab switch
        await new Promise(resolve => setTimeout(resolve, 400));
        
        // Ensure class is selected
        if (item.class && typeof selectClass === 'function') {
            const classChips = document.querySelectorAll('.class-chips .chip');
            let classAlreadySelected = false;
            
            classChips.forEach(chip => {
                if (chip.textContent === item.class && chip.classList.contains('active')) {
                    classAlreadySelected = true;
                }
            });
            
            if (!classAlreadySelected) {
                let found = false;
                classChips.forEach(chip => {
                    if (chip.textContent === item.class) {
                        found = true;
                        chip.click();
                    }
                });
                
                if (!found) {
                    this.showToast('You do not have access to this class', 'error');
                    return;
                }
            }
        }
        
        // Wait for content to load
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Scroll and highlight (auto-loads pages if needed)
        this.scrollToAndHighlight(item);
        
        // Clear search
        this.searchInput.value = '';
        this.clearBtn.classList.remove('visible');
    }
    
    // Scroll to and highlight item (auto-loads pages until found)
    scrollToAndHighlight(item) {
        let attempts = 0;
        const maxAttempts = 30;
        let autoLoadsDone = 0;
        const maxAutoLoads = 20;
        
        // Show loading toast
        this.showLoadingToast('Loading content...');
        
        const tryFind = () => {
            attempts++;
            
            // Try to find the card
            const card = document.querySelector(`[data-item-id="${item.id}"]`);
            
            if (card) {
                // Found it! Hide loading toast and highlight
                this.hideLoadingToast();
                this.highlightCard(card, item);
                return true;
            }
            
            // Not found - try to load more content
            if (autoLoadsDone < maxAutoLoads) {
                const loadMoreBtn = document.querySelector('.load-more-btn');
                
                if (loadMoreBtn) {
                    autoLoadsDone++;
                    console.log(`📥 Auto-loading page ${autoLoadsDone}...`);
                    loadMoreBtn.click();
                    
                    setTimeout(tryFind, 200);
                    return false;
                } else {
                    // No load more button - item not in current data
                    console.log('❌ No more pages to load');
                    this.hideLoadingToast();
                    this.showToast('Content not available', 'error');
                    return false;
                }
            }
            
            // Max attempts reached
            if (attempts >= maxAttempts) {
                console.log('❌ Could not find item after loading all pages');
                this.hideLoadingToast();
                this.showToast('Content not found', 'error');
                return false;
            }
            
            setTimeout(tryFind, 200);
            return false;
        };
        
        // Start after short delay
        setTimeout(tryFind, 400);
    }
    
    // Highlight a specific card
    highlightCard(card, item) {
        // Remove existing highlights
        document.querySelectorAll('.golden-highlight').forEach(el => {
            el.classList.remove('golden-highlight');
        });
        
        // Scroll to card
        card.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
        });
        
        // Add golden highlight
        setTimeout(() => {
            card.classList.add('golden-highlight');
            
            setTimeout(() => {
                card.classList.remove('golden-highlight');
            }, 3200);
        }, 500);
        
        console.log('✅ Highlighted:', item.title);
        this.showToast('Content found!', 'success');
    }
    
    // Loading toast
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

// Global helper
window.clearSearch = function() {
    if (crossSearch) {
        crossSearch.clearSearch();
    }
};
