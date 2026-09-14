
// Global flag for user readiness
let isUserReady = false;

// Add this function to check when user is ready
function onUserReady(callback) {
    if (isUserReady) {
        callback();
        return;
    }
    
    const checkInterval = setInterval(() => {
        if (isUserReady) {
            clearInterval(checkInterval);
            callback();
        }
    }, 100);
    
    // Timeout after 10 seconds
    setTimeout(() => clearInterval(checkInterval), 10000);
}



let currentUser = null;
let currentTab = 'videos';
let selectedClass = null;
let selectedSubject = null;
let cachedData = [];
let displayedCount = 0;
const PAGE_SIZE = 5;
let currentImageUrl = '';
let currentImageTitle = '';
let statusCheckInterval = null;
let deferredPrompt = null;

// Utility Functions
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Screenshot Protection
function preventScreenshot() {
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showScreenshotWarning();
        return false;
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'PrintScreen' || 
            (e.ctrlKey && e.key === 'p') || 
            (e.ctrlKey && e.key === 's') || 
            (e.ctrlKey && e.shiftKey && e.key === 'I') || 
            e.key === 'F12') {
            e.preventDefault();
            showScreenshotWarning();
            return false;
        }
    });
}

function showScreenshotWarning() {
    const warning = document.createElement('div');
    warning.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #DC2626;
        color: white;
        padding: 15px 25px;
        border-radius: 12px;
        font-weight: 600;
        font-size: 0.9rem;
        z-index: 99999;
        box-shadow: 0 10px 30px rgba(220,38,38,0.4);
        text-align: center;
    `;
    warning.innerHTML = `
        <span class="material-icons" style="font-size:2rem;display:block;margin-bottom:0.5rem;">block</span>
        Screenshots are not allowed on this page
    `;
    document.body.appendChild(warning);
    setTimeout(() => { warning.remove(); }, 2000);
}

// Image Download
async function downloadCurrentImage() {
    if (!currentImageUrl) return;
    
    const downloadBtn = document.getElementById('imageDownloadBtn');
    const originalText = downloadBtn.innerHTML;
    
    try {
        downloadBtn.innerHTML = '<span class="material-icons">hourglass_empty</span> Downloading...';
        downloadBtn.disabled = true;
        
        const response = await fetch(currentImageUrl);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = (currentImageTitle || 'image') + '.jpg';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
        
        downloadBtn.innerHTML = originalText;
        downloadBtn.disabled = false;
        
    } catch (error) {
        console.error('Download error:', error);
        window.open(currentImageUrl, '_blank');
        downloadBtn.innerHTML = originalText;
        downloadBtn.disabled = false;
    }
}

// Status Monitoring
function startStatusMonitoring() {
    if (statusCheckInterval) clearInterval(statusCheckInterval);
    
    statusCheckInterval = setInterval(async () => {
        const user = auth.currentUser;
        if (!user) return;
        
        try {
            const whitelistRef = db.collection('whitelist').doc(user.email.toLowerCase());
            const doc = await whitelistRef.get();
            
            if (!doc.exists || doc.data().active !== true) {
                clearInterval(statusCheckInterval);
                showAccessRevoked();
            }
        } catch (error) {
            console.error('Status check error:', error);
        }
    }, 5000);
}

function showAccessRevoked() {
    document.getElementById('accessRevokedOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    
    setTimeout(async () => {
        localStorage.removeItem('session');
        await auth.signOut();
        window.location.replace('index.html');
    }, 3000);
}

// Refresh Content
async function refreshAllContent() {
    const refreshBtn = document.getElementById('refreshBtn');
    const campusLoader = document.getElementById('campusLoader');
    
    refreshBtn.disabled = true;
    refreshBtn.classList.add('spinning');
    campusLoader.classList.add('active');
    
    try {
        cachedData = [];
        displayedCount = 0;
        
        if (selectedClass) {
            await loadAvailableSubjects(selectedClass);
            await loadContent();
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
    } catch (error) {
        console.error('Refresh error:', error);
    } finally {
        campusLoader.classList.remove('active');
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('spinning');
    }
}

// Logout Functions
function showLogoutDialog() {
    document.getElementById('logoutDialogOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeLogoutDialog() {
    document.getElementById('logoutDialogOverlay').classList.remove('active');
    document.body.style.overflow = 'auto';
}

async function confirmLogout() {
    try {
        if (statusCheckInterval) clearInterval(statusCheckInterval);
        localStorage.removeItem('session');
        await auth.signOut();
        window.location.replace('index.html');
        history.pushState(null, null, 'index.html');
    } catch (error) {
        console.error('Logout error:', error);
        closeLogoutDialog();
    }
}

// Sidebar Functions
function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('active');
    document.body.style.overflow = 'auto';
}

function handleMobileTabClick(tab) {
    if (window.innerWidth <= 768) closeSidebar();
    switchTab(tab);
}

// PWA Install
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('installBtn').style.display = 'flex';
});

async function installApp() {
    if (!deferredPrompt) {
        alert('To install: Use browser menu → Install App');
        return;
    }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.getElementById('installBtn').style.display = 'none';
}

window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    document.getElementById('installBtn').style.display = 'none';
});

if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
    document.getElementById('installBtn').style.display = 'none';
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}

// Auth Check
function checkAuth() {
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            localStorage.removeItem('session');
            window.location.replace('index.html');
            return;
        }
        
        // Get session from localStorage
        let session = localStorage.getItem('session');
        
        // If no session, try to create one from Firestore
        if (!session) {
            console.log('No session in localStorage, fetching from Firestore...');
            try {
                const whitelistDoc = await db.collection('whitelist').doc(user.email.toLowerCase()).get();
                
                if (!whitelistDoc.exists || whitelistDoc.data().active !== true) {
                    await auth.signOut();
                    window.location.replace('index.html');
                    return;
                }
                
                const whitelistData = whitelistDoc.data();
                
                const newSession = {
                    uid: user.uid,
                    email: user.email.toLowerCase(),
                    displayName: whitelistData.studentName || user.displayName || 'Student',
                    photoURL: user.photoURL || '',
                    allowedClasses: whitelistData.allowedClasses || [],
                    expiresAt: whitelistData.expiresAt ? whitelistData.expiresAt.toDate().toISOString() : null,
                    loginTime: Date.now()
                };
                
                localStorage.setItem('session', JSON.stringify(newSession));
                session = JSON.stringify(newSession);
                
            } catch (error) {
                console.error('Error fetching session:', error);
                window.location.replace('index.html');
                return;
            }
        }
        
        try {
            currentUser = JSON.parse(session);
            
            // Verify email matches
            if (currentUser.email !== user.email.toLowerCase()) {
                localStorage.removeItem('session');
                auth.signOut();
                window.location.replace('index.html');
                return;
            }
            
            // Check session expiry
            if (currentUser.loginTime) {
                const elapsedTime = Date.now() - currentUser.loginTime;
                const twoHours = 2 * 60 * 60 * 1000;
                if (elapsedTime > twoHours) {
                    localStorage.removeItem('session');
                    auth.signOut();
                    window.location.replace('index.html');
                    return;
                }
            }
            
            // Get student name
            let studentName = currentUser.displayName || 'Student';
            if (studentName === 'undefined' || studentName === 'null' || !studentName) {
                studentName = currentUser.email.split('@')[0].replace(/[._]/g, ' ');
                studentName = studentName.replace(/\b\w/g, c => c.toUpperCase());
            }
            
            console.log('👤 Student:', studentName);
            console.log('📚 Classes:', currentUser.allowedClasses);
            
            // Set welcome text
            const welcomeNameEl = document.getElementById('welcomeName');
            const welcomeSubtitleEl = document.getElementById('welcomeSubtitle');
            
            if (welcomeNameEl) {
                welcomeNameEl.textContent = `Welcome, ${studentName}!`;
            }
            if (welcomeSubtitleEl) {
                welcomeSubtitleEl.textContent = currentUser.email || '';
            }
            
            // Set expiry date
            if (currentUser.expiresAt) {
                const expiry = new Date(currentUser.expiresAt);
                const expiryDateValueEl = document.getElementById('expiryDateValue');
                if (expiryDateValueEl) {
                    expiryDateValueEl.textContent = 
                        expiry.toLocaleDateString('en-IN', {day:'numeric', month:'long', year:'numeric'});
                }
            }
            
            // Load class chips
            loadClassChips();
            showClassSelectionPrompt();
            startStatusMonitoring();
            
            // Trigger search re-init now that we have user data
            if (typeof crossSearch !== 'undefined' && crossSearch) {
                console.log('✅ User loaded, search is ready');
            }
            
        } catch (error) {
            console.error('Session parse error:', error);
            localStorage.removeItem('session');
            window.location.replace('index.html');
        }
    });
}

// Load Class Chips
function loadClassChips() {
    const chipsDiv = document.getElementById('classChips');
    const classes = currentUser.allowedClasses || [];
    
    if (!classes.length) {
        chipsDiv.innerHTML = '<p style="color:var(--text-secondary);">No classes assigned.</p>';
        return;
    }
    
    let html = '';
    classes.forEach(cls => {
        html += `<div class="chip" onclick="selectClass('${escapeHtml(cls)}')">${escapeHtml(cls)}</div>`;
    });
    chipsDiv.innerHTML = html;
}

function showClassSelectionPrompt() {
    document.getElementById('contentArea').innerHTML = `
        <div class="empty-state">
            <span class="material-icons">touch_app</span>
            <h3>Select Your Class</h3>
            <p>Choose a class above to view content</p>
        </div>
    `;
}

// Select Class
async function selectClass(cls) {
    selectedClass = cls;
    selectedSubject = null;
    cachedData = [];
    displayedCount = 0;
    
    document.querySelectorAll('.class-chips .chip').forEach(chip => {
        chip.classList.remove('active');
        if (chip.textContent === cls) chip.classList.add('active');
    });
    
    document.getElementById('subjectLabel').style.display = 'block';
    const subjectChipsDiv = document.getElementById('subjectChips');
    subjectChipsDiv.style.display = 'flex';
    subjectChipsDiv.innerHTML = '<span style="color:var(--text-secondary);font-size:0.8rem;">Loading...</span>';
    
    // Reset progress bar
    const progressContainer = document.getElementById('videoProgressContainer');
    if (progressContainer) {
        progressContainer.style.display = currentTab === 'videos' ? 'block' : 'none';
    }
    
    await loadAvailableSubjects(cls);
    loadContent();
}

// Load Subjects
async function loadAvailableSubjects(cls) {
    const subjectChipsDiv = document.getElementById('subjectChips');
    try {
        const [videosSnap, pdfsSnap, imagesSnap, postsSnap] = await Promise.all([
            db.collection('videos').where('class','==',cls).get(),
            db.collection('pdfs').where('class','==',cls).get(),
            db.collection('images').where('class','==',cls).get(),
            db.collection('posts').where('class','array-contains',cls).get()
        ]);
        
        const subjectsSet = new Set();
        videosSnap.forEach(d => { if(d.data().subject) subjectsSet.add(d.data().subject); });
        pdfsSnap.forEach(d => { if(d.data().subject) subjectsSet.add(d.data().subject); });
        imagesSnap.forEach(d => { if(d.data().subject) subjectsSet.add(d.data().subject); });
        postsSnap.forEach(d => { if(d.data().subject) subjectsSet.add(d.data().subject); });
        
        const subjects = Array.from(subjectsSet).sort();
        if (subjects.length === 0) {
            subjectChipsDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:0.8rem;">No subjects yet.</p>';
            return;
        }
        
        let html = `<div class="chip active" onclick="selectSubject(null)">All (${subjects.length})</div>`;
        subjects.forEach(s => { 
            html += `<div class="chip" onclick="selectSubject('${escapeHtml(s)}')">${escapeHtml(s)}</div>`; 
        });
        subjectChipsDiv.innerHTML = html;
    } catch (error) {
        console.error('Error loading subjects:', error);
        subjectChipsDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:0.8rem;">Error loading subjects.</p>';
    }
}

// Select Subject
function selectSubject(subject) {
    selectedSubject = subject;
    cachedData = [];
    displayedCount = 0;
    document.querySelectorAll('.subject-chips .chip').forEach(chip => {
        chip.classList.remove('active');
        if ((subject === null && chip.textContent.startsWith('All')) || 
            (subject !== null && chip.textContent === subject)) {
            chip.classList.add('active');
        }
    });
    loadContent();
}

// Load Content
async function loadContent() {
    if (!selectedClass) return;
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text);">Loading...</div>';
    
    try {
        let allData = [];
        
        switch(currentTab) {
            case 'videos': allData = await fetchCollection('videos', 'class', selectedClass); break;
            case 'pdfs': allData = await fetchCollection('pdfs', 'class', selectedClass); break;
            case 'images': allData = await fetchCollection('images', 'class', selectedClass); break;
            case 'posts': allData = await fetchPosts(selectedClass); break;
        }
        
        if (selectedSubject) {
            allData = allData.filter(item => item.subject === selectedSubject);
        }
        
        allData.sort((a, b) => {
            const timeA = a.uploadedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
            const timeB = b.uploadedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
            return timeB - timeA;
        });
        
        cachedData = allData;
displayedCount = 0;
contentArea.innerHTML = '';
appendContent();

// Update progress bar
updateVideoProgress(allData);
        
    } catch (error) {
        console.error('Error loading content:', error);
        contentArea.innerHTML = `
            <div class="empty-state">
                <span class="material-icons">error_outline</span>
                <h3>Error Loading Content</h3>
                <p>Please try again.</p>
            </div>
        `;
    }
}

// Fetch Functions
async function fetchCollection(collectionName, field, value) {
    const snapshot = await db.collection(collectionName).where(field, '==', value).get();
    return snapshot.docs.map(d => ({id: d.id, ...d.data()}));
}

async function fetchPosts(cls) {
    const snapshot = await db.collection('posts').where('class', 'array-contains', cls).get();
    return snapshot.docs.map(d => ({id: d.id, ...d.data()}));
}

// Generate Card HTML
function generateCardHtml(item) {
    const title = escapeHtml(item.title || '');
    const subject = escapeHtml(item.subject || '');
    const description = escapeHtml(item.description || '');
    
    if (currentTab === 'videos') {
    const vid = extractYouTubeId(item.videoUrl);
    const thumb = vid ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg` : '';
    const duration = escapeHtml(item.duration || '');
    const videoUrl = escapeHtml(item.videoUrl || '');
    const isItemWatched = typeof isVideoWatched === 'function' ? isVideoWatched(item.id) : false;
    const escapedTitle = title.replace(/'/g, "\\'");
    
    return `
        <div class="card ${isItemWatched ? 'watched-card' : ''}" 
             data-item-id="${item.id}" 
             data-item-title="${title}"
             onclick="playVideo('${videoUrl}','${escapedTitle}','${description.replace(/'/g, "\\'")}')">
            <div class="video-thumbnail">
                ${thumb ? `<img src="${thumb}" style="width:100%;height:100%;object-fit:cover;">` : ''}
                ${duration ? `<span class="video-duration">${duration}</span>` : ''}
            </div>
            <div class="card-info">
                <div class="card-title">${title}</div>
                ${subject ? `<div class="card-description">${subject}</div>` : ''}
                
                <div class="watched-indicator ${isItemWatched ? 'watched' : ''}" 
                     onclick="event.stopPropagation(); event.preventDefault(); toggleWatched('${item.id}', '${escapedTitle}', this); return false;">
                    <span class="material-icons">${isItemWatched ? 'check_circle' : 'check_circle_outline'}</span>
                    <span>${isItemWatched ? 'Watched' : 'Mark as watched'}</span>
                </div>
            </div>
        </div>
    `;
} else if (currentTab === 'pdfs') {
    const pdfUrl = escapeHtml(item.pdfUrl || '#');
    
    return `
        <div class="card pdf-card" 
             data-item-id="${item.id}" 
             data-item-title="${title}">
            <span class="material-icons pdf-icon">picture_as_pdf</span>
            <div class="card-title">${title}</div>
            ${subject ? `<div class="card-description">${subject}</div>` : ''}
            <a href="${pdfUrl}" target="_blank" rel="noopener noreferrer" class="pdf-download-btn">Download PDF</a>
        </div>
    `;
} else if (currentTab === 'images') {
    const imageUrl = escapeHtml(item.imageUrl || '');
    
    return `
        <div class="card" 
             data-item-id="${item.id}" 
             data-item-title="${title}"
             onclick="viewImage('${imageUrl}','${title}','${description}','${subject}')">
            <img src="${imageUrl}" class="image-thumbnail" alt="${title}" loading="lazy">
            <div class="card-info">
                <div class="card-title">${title}</div>
                ${subject ? `<div class="card-description">${subject}</div>` : ''}
            </div>
        </div>
    `;
} else if (currentTab === 'posts') {
    const content = escapeHtml(item.content || '');
    const postUrl = escapeHtml(item.url || '');
    
    return `
        <div class="post-card" data-item-id="${item.id}">
            <div class="post-title">${title}</div>
            ${subject ? `<div class="card-description">${subject}</div>` : ''}
            <p class="post-content">${content}</p>
            ${item.url ? `<a href="${postUrl}" target="_blank" rel="noopener noreferrer" class="post-link">Read More →</a>` : ''}
        </div>
    `;
}

// Append Content
function appendContent() {
    const contentArea = document.getElementById('contentArea');
    const allData = cachedData;
    
    if (!allData.length) {
        const emptyMessages = {
            videos: { icon: 'video_library', title: 'No Videos Yet', desc: 'New videos will appear here.' },
            pdfs: { icon: 'picture_as_pdf', title: 'No PDFs Yet', desc: 'New PDFs will appear here.' },
            images: { icon: 'image', title: 'No Images Yet', desc: 'New images will appear here.' },
            posts: { icon: 'article', title: 'No Posts Yet', desc: 'Announcements will appear here.' }
        };
        const msg = emptyMessages[currentTab];
        contentArea.innerHTML = `
            <div class="empty-state">
                <span class="material-icons">${msg.icon}</span>
                <h3>${msg.title}</h3>
                <p>${msg.desc}</p>
            </div>
        `;
        return;
    }
    
    const existingLoadMore = contentArea.querySelector('.load-more-btn');
    if (existingLoadMore) existingLoadMore.remove();
    
    let container;
    if (currentTab === 'posts') {
        container = contentArea.querySelector('.posts-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'posts-container';
            contentArea.appendChild(container);
        }
    } else {
        container = contentArea.querySelector('.content-grid');
        if (!container) {
            container = document.createElement('div');
            container.className = 'content-grid';
            contentArea.appendChild(container);
        }
    }
    
    const startIndex = displayedCount;
    const endIndex = Math.min(startIndex + PAGE_SIZE, allData.length);
    const batchData = allData.slice(startIndex, endIndex);
    
    const fragment = document.createDocumentFragment();
    const tempDiv = document.createElement('div');
    
    batchData.forEach(item => {
        tempDiv.innerHTML = generateCardHtml(item);
        while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
        }
    });
    
    container.appendChild(fragment);
    displayedCount = endIndex;
    
    if (displayedCount < allData.length) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.className = 'load-more-btn';
        loadMoreBtn.textContent = `Load More (${allData.length - displayedCount} remaining)`;
        loadMoreBtn.onclick = appendContent;
        contentArea.appendChild(loadMoreBtn);
    }
    // ... all your existing code ...
    // At the very end of the function, add:
    if (typeof refreshWatchedBadges === 'function') {
        setTimeout(refreshWatchedBadges, 100);
    }
}


// YouTube Functions
function extractYouTubeId(url) {
    if (!url) return null;
    let id = null;
    if (url.includes('youtu.be/')) id = url.split('youtu.be/')[1].split('?')[0];
    else if (url.includes('youtube.com/watch')) id = url.split('v=')[1]?.split('&')[0];
    else if (url.includes('youtube.com/embed/')) id = url.split('embed/')[1].split('?')[0];
    else if (url.includes('youtube.com/shorts/')) id = url.split('shorts/')[1].split('?')[0];
    return id;
}

function getEmbedUrl(url) {
    const id = extractYouTubeId(url);
    return id ? `https://www.youtube.com/embed/${id}?rel=0` : url;
}

// Video Functions
function playVideo(url, title, desc) {
    document.getElementById('modalVideo').src = getEmbedUrl(url);
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalDescription').textContent = desc;
    document.getElementById('videoModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function toggleFullscreen() {
    const container = document.getElementById('videoPlayerContainer');
    if (!document.fullscreenElement) {
        container.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen();
    }
}

function closeVideoModal() {
    if (document.fullscreenElement) document.exitFullscreen();
    document.getElementById('videoModal').style.display = 'none';
    document.getElementById('modalVideo').src = '';
    document.body.style.overflow = 'auto';
}

// Image Functions
function viewImage(url, title, desc, subject) {
    currentImageUrl = url;
    currentImageTitle = title;
    document.getElementById('modalImage').src = url;
    document.getElementById('imageModalTitle').textContent = title;
    document.getElementById('imageModalDescription').textContent = `${subject ? subject : ''}${desc ? ' • ' + desc : ''}`;
    document.getElementById('imageModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeImageModal() {
    document.getElementById('imageModal').style.display = 'none';
    document.getElementById('modalImage').src = '';
    currentImageUrl = '';
    currentImageTitle = '';
    document.body.style.overflow = 'auto';
}

// Tab Switching
function switchTab(tab) {
    currentTab = tab;
    cachedData = [];
    displayedCount = 0;
    document.querySelectorAll('.sidebar-item').forEach(item => item.classList.remove('active'));
    const tabs = ['videos','pdfs','images','posts'];
    const index = tabs.indexOf(tab);
    if (index !== -1) document.querySelectorAll('.sidebar-item')[index].classList.add('active');
    
    // Hide progress bar if not videos tab
    const progressContainer = document.getElementById('videoProgressContainer');
    if (progressContainer && tab !== 'videos') {
        progressContainer.style.display = 'none';
    }
    
    if (selectedClass) {
        loadContent();
    }
}

// Event Listeners
document.getElementById('videoModal').addEventListener('click', function(e) {
    if (e.target === this) closeVideoModal();
});

document.getElementById('imageModal').addEventListener('click', function(e) {
    if (e.target === this) closeImageModal();
});

document.getElementById('logoutDialogOverlay').addEventListener('click', function(e) {
    if (e.target === this) closeLogoutDialog();
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeLogoutDialog();
        closeVideoModal();
        closeImageModal();
    }
});

// Back button prevention
window.addEventListener('pageshow', function(event) {
    if (event.persisted) {
        const session = localStorage.getItem('session');
        if (!session) {
            window.location.replace('index.html');
        }
    }
});

window.addEventListener('popstate', function() {
    const session = localStorage.getItem('session');
    if (!session) {
        window.location.replace('index.html');
    }
});

history.pushState(null, null, location.href);

// Initialize
preventScreenshot();
// ============================================
// Video Progress Tracker
// ============================================

let totalVideos = 0;
let watchedCount = 0;

// Update progress when videos are loaded
function updateVideoProgress(allVideos) {
    // Only show for videos tab
    const progressContainer = document.getElementById('videoProgressContainer');
    
    if (currentTab !== 'videos' || !allVideos || allVideos.length === 0) {
        if (progressContainer) progressContainer.style.display = 'none';
        return;
    }
    
    if (progressContainer) progressContainer.style.display = 'block';
    
    // Count total videos for the selected class + subject
    totalVideos = allVideos.length;
    
    // Count watched videos
    watchedCount = allVideos.filter(video => isVideoWatched(video.id)).length;
    
    // Calculate percentage
    const percentage = totalVideos > 0 ? Math.round((watchedCount / totalVideos) * 100) : 0;
    
    // Update UI
    document.getElementById('watchedCount').textContent = watchedCount;
    document.getElementById('totalCount').textContent = totalVideos;
    document.getElementById('videoProgressFill').style.width = percentage + '%';
    document.getElementById('videoProgressPercentage').textContent = percentage + '%';
    
    // Update message based on progress
    updateProgressMessage(watchedCount, totalVideos, percentage);
    
    // Celebrate milestones
    if (percentage === 25 || percentage === 50 || percentage === 75 || percentage === 100) {
        celebrateMilestone(percentage);
    }
}

// Update message based on progress
function updateProgressMessage(watched, total, percentage) {
    const messageEl = document.getElementById('videoProgressMessage');
    if (!messageEl) return;
    
    let message = '';
    
    if (watched === 0) {
        message = ' Start watching to track your progress!';
    } else if (percentage < 25) {
        message = ` Great start! ${total - watched} more lectures to go!`;
    } else if (percentage < 50) {
        message = ` You're ${percentage}% done. Keep going!`;
    } else if (percentage < 75) {
        message = ` Halfway there! ${total - watched} lectures remaining.`;
    } else if (percentage < 100) {
        message = ` Almost there! Just ${total - watched} left!`;
    } else {
        message = ' Congratulations! You completed all lectures!';
    }
    
    messageEl.textContent = message;
}

// Celebrate milestones
function celebrateMilestone(percentage) {
    const container = document.getElementById('videoProgressContainer');
    if (!container) return;
    
    container.classList.add('milestone');
    setTimeout(() => container.classList.remove('milestone'), 600);
    
    // Show toast
    const messages = {
        25: ' 25% Complete! Great progress!',
        50: ' Halfway there! Amazing!',
        75: ' 75% Done! Almost finished!',
        100: ' All lectures completed! Legendary!'
    };
    
    if (messages[percentage]) {
        showProgressToast(messages[percentage]);
    }
}

// Progress toast
function showProgressToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 100px;
        left: 50%;
        transform: translateX(-50%) translateY(-100px);
        background: linear-gradient(135deg, #059669, #10b981);
        color: white;
        padding: 14px 28px;
        border-radius: 25px;
        font-weight: 600;
        font-size: 0.9rem;
        box-shadow: 0 10px 30px rgba(5, 150, 105, 0.4);
        z-index: 99999;
        animation: progressToastIn 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55) forwards;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Add keyframes if not exists
    if (!document.getElementById('progressToastStyles')) {
        const style = document.createElement('style');
        style.id = 'progressToastStyles';
        style.textContent = `
            @keyframes progressToastIn {
                0% { transform: translateX(-50%) translateY(-100px); opacity: 0; }
                100% { transform: translateX(-50%) translateY(0); opacity: 1; }
            }
            @keyframes progressToastOut {
                0% { transform: translateX(-50%) translateY(0); opacity: 1; }
                100% { transform: translateX(-50%) translateY(-100px); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
    
    setTimeout(() => {
        toast.style.animation = 'progressToastOut 0.5s ease-out forwards';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

// Hook into the watched badge system
function onVideoWatched(videoId) {
    // Recalculate progress
    if (cachedData && cachedData.length > 0) {
        updateVideoProgress(cachedData);
    }
}

function onVideoUnwatched(videoId) {
    if (cachedData && cachedData.length > 0) {
        updateVideoProgress(cachedData);
    }
}
checkAuth();
