// User Preferences Management System

// Font Family Options
const FONT_FAMILIES = {
    inter: { name: 'Inter', fontFamily: "'Inter', sans-serif", icon: 'text_fields' },
    playfair: { name: 'Playfair', fontFamily: "'Playfair Display', serif", icon: 'format_quote' },
    dancing: { name: 'Dancing Script', fontFamily: "'Dancing Script', cursive", icon: 'brush' },
    roboto: { name: 'Roboto', fontFamily: "'Roboto', sans-serif", icon: 'article' },
    caveat: { name: 'Caveat', fontFamily: "'Caveat', cursive", icon: 'edit' }
};

// Layout Options
const LAYOUTS = {
    grid: { name: 'Grid View', icon: 'grid_view' },
    list: { name: 'List View', icon: 'view_list' }
};

// Load saved preferences
function loadPreferences() {
    const savedFont = localStorage.getItem('enlighten_font_family') || 'inter';
    const savedLayout = localStorage.getItem('enlighten_layout') || 'grid';
    
    applyFontFamily(savedFont);
    applyLayout(savedLayout);
}

// Apply Font Family
function applyFontFamily(fontName) {
    if (!FONT_FAMILIES[fontName]) return;
    
    document.body.style.fontFamily = FONT_FAMILIES[fontName].fontFamily;
    localStorage.setItem('enlighten_font_family', fontName);
}

// Apply Layout
function applyLayout(layoutName) {
    if (!LAYOUTS[layoutName]) return;
    
    localStorage.setItem('enlighten_layout', layoutName);
    
    const contentArea = document.getElementById('contentArea');
    if (contentArea) {
        contentArea.classList.remove('grid-view', 'list-view');
        contentArea.classList.add(layoutName === 'grid' ? 'grid-view' : 'list-view');
        
        // Reload content if exists
        if (typeof cachedData !== 'undefined' && cachedData && cachedData.length > 0) {
            displayedCount = 0;
            contentArea.innerHTML = '';
            appendContent();
        }
    }
}

// Toggle Preferences Menu
function togglePreferencesMenu() {
    console.log('Toggle preferences menu called');
    
    let menu = document.getElementById('preferencesMenu');
    
    if (!menu) {
        menu = createPreferencesMenu();
    }
    
    if (menu.style.display === 'block') {
        menu.style.display = 'none';
        document.removeEventListener('click', closePreferencesOutside);
    } else {
        menu.style.display = 'block';
        setTimeout(() => {
            document.addEventListener('click', closePreferencesOutside);
        }, 100);
    }
}

// Create Preferences Menu
function createPreferencesMenu() {
    const existingMenu = document.getElementById('preferencesMenu');
    if (existingMenu) existingMenu.remove();
    
    const menu = document.createElement('div');
    menu.id = 'preferencesMenu';
    
    // Apply inline styles to ensure it works
    menu.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: #FFFFFF;
        border: 1px solid #C5C3B8;
        border-radius: 12px;
        box-shadow: 0 16px 32px rgba(0,0,0,0.2);
        z-index: 6000;
        min-width: 240px;
        overflow: hidden;
        display: none;
    `;
    
    const currentFont = localStorage.getItem('enlighten_font_family') || 'inter';
    const currentLayout = localStorage.getItem('enlighten_layout') || 'grid';
    
    let html = '';
    
    // Header
    html += '<div style="padding:12px 16px;font-weight:700;border-bottom:2px solid #233130;color:#233130;font-size:1rem;background:#FFFFFF;">Preferences</div>';
    
    // Font Family Section
    html += '<div style="padding:10px 16px 5px;font-weight:600;color:#5a745f;font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;background:#FFFFFF;">Font Family</div>';
    
    Object.keys(FONT_FAMILIES).forEach(fontKey => {
        const font = FONT_FAMILIES[fontKey];
        const isActive = currentFont === fontKey;
        
        html += `
            <div onclick="selectFontFamily('${fontKey}', this)" style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;background:#FFFFFF;color:#233130;font-size:0.85rem;border-bottom:1px solid #F0F0F0;transition:background-color 0.2s ease;" onmouseover="this.style.backgroundColor='#DFDDD3'" onmouseout="this.style.backgroundColor='#FFFFFF'">
                <span class="material-icons" style="color:#5a745f;font-size:20px;">${font.icon}</span>
                <span style="color:#233130;">${font.name}</span>
                ${isActive ? '<span class="material-icons" style="margin-left:auto;color:#059669;font-size:18px;">check</span>' : ''}
            </div>
        `;
    });
    
    // Divider
    html += '<div style="height:1px;background:#C5C3B8;margin:5px 0;"></div>';
    
    // Layout Section
    html += '<div style="padding:10px 16px 5px;font-weight:600;color:#5a745f;font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;background:#FFFFFF;">Card Layout</div>';
    
    Object.keys(LAYOUTS).forEach(layoutKey => {
        const layout = LAYOUTS[layoutKey];
        const isActive = currentLayout === layoutKey;
        
        html += `
            <div onclick="selectLayout('${layoutKey}', this)" style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;background:#FFFFFF;color:#233130;font-size:0.85rem;border-bottom:1px solid #F0F0F0;transition:background-color 0.2s ease;" onmouseover="this.style.backgroundColor='#DFDDD3'" onmouseout="this.style.backgroundColor='#FFFFFF'">
                <span class="material-icons" style="color:#5a745f;font-size:20px;">${layout.icon}</span>
                <span style="color:#233130;">${layout.name}</span>
                ${isActive ? '<span class="material-icons" style="margin-left:auto;color:#059669;font-size:18px;">check</span>' : ''}
            </div>
        `;
    });
    
    menu.innerHTML = html;
    document.body.appendChild(menu);
    return menu;
}

// Select Font Family
function selectFontFamily(fontName, element) {
    if (!FONT_FAMILIES[fontName]) return;
    
    applyFontFamily(fontName);
    
    // Update checkmarks
    const menu = document.getElementById('preferencesMenu');
    if (menu) {
        menu.querySelectorAll('.material-icons[style*="margin-left:auto"]').forEach(icon => {
            if (icon.textContent === 'check') icon.remove();
        });
        
        if (element) {
            const checkIcon = document.createElement('span');
            checkIcon.className = 'material-icons';
            checkIcon.textContent = 'check';
            checkIcon.style.cssText = 'margin-left:auto;color:#059669;font-size:18px;';
            element.appendChild(checkIcon);
        }
    }
    
    setTimeout(() => closePreferencesMenu(), 300);
}

// Select Layout
function selectLayout(layoutName, element) {
    if (!LAYOUTS[layoutName]) return;
    
    applyLayout(layoutName);
    
    const menu = document.getElementById('preferencesMenu');
    if (menu) {
        menu.querySelectorAll('.material-icons[style*="margin-left:auto"]').forEach(icon => {
            if (icon.textContent === 'check') icon.remove();
        });
        
        if (element) {
            const checkIcon = document.createElement('span');
            checkIcon.className = 'material-icons';
            checkIcon.textContent = 'check';
            checkIcon.style.cssText = 'margin-left:auto;color:#059669;font-size:18px;';
            element.appendChild(checkIcon);
        }
    }
    
    setTimeout(() => closePreferencesMenu(), 300);
}

// Close Preferences Menu
function closePreferencesMenu() {
    const menu = document.getElementById('preferencesMenu');
    if (menu) {
        menu.style.display = 'none';
        document.removeEventListener('click', closePreferencesOutside);
    }
}

// Close when clicking outside
function closePreferencesOutside(e) {
    const menu = document.getElementById('preferencesMenu');
    const prefsBtn = document.querySelector('.preferences-btn');
    
    if (menu && prefsBtn && !menu.contains(e.target) && !prefsBtn.contains(e.target)) {
        closePreferencesMenu();
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    loadPreferences();
    console.log('Preferences system loaded');
});
