// User Preferences Management System

// Font Family Options
const FONT_FAMILIES = {
    inter: { name: 'Inter', fontFamily: "'Inter', sans-serif", icon: 'text_fields' },
    playfair: { name: 'Playfair', fontFamily: "'Playfair Display', serif", icon: 'format_quote' },
    poppins: { name: 'Poppins', fontFamily: "'Poppins', sans-serif", icon: 'sort_by_alpha' },
    roboto: { name: 'Roboto', fontFamily: "'Roboto', sans-serif", icon: 'article' },
    lora: { name: 'Lora', fontFamily: "'Lora', serif", icon: 'menu_book' }
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
    
    updatePreferenceButtons();
}

// Apply Layout
function applyLayout(layoutName) {
    if (!LAYOUTS[layoutName]) return;
    
    const contentArea = document.getElementById('contentArea');
    if (!contentArea) return;
    
    if (layoutName === 'grid') {
        contentArea.classList.remove('list-view');
        contentArea.classList.add('grid-view');
    } else {
        contentArea.classList.remove('grid-view');
        contentArea.classList.add('list-view');
    }
    
    localStorage.setItem('enlighten_layout', layoutName);
    updatePreferenceButtons();
    
    // Reload content if data exists
    if (cachedData && cachedData.length > 0) {
        displayedCount = 0;
        contentArea.innerHTML = '';
        appendContent();
    }
}

// Toggle Preferences Menu
function togglePreferencesMenu() {
    let menu = document.getElementById('preferencesMenu');
    
    if (!menu) {
        menu = createPreferencesMenu();
    }
    
    if (menu.classList.contains('show')) {
        menu.classList.remove('show');
        document.removeEventListener('click', closePreferencesOutside);
    } else {
        menu.classList.add('show');
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
    menu.className = 'preferences-menu';
    
    const currentFont = localStorage.getItem('enlighten_font_family') || 'inter';
    const currentLayout = localStorage.getItem('enlighten_layout') || 'grid';
    
    let html = '<div class="preferences-menu-header">Preferences</div>';
    
    // Font Family Section
    html += '<div class="preferences-section-label">Font Family</div>';
    Object.keys(FONT_FAMILIES).forEach(fontKey => {
        const font = FONT_FAMILIES[fontKey];
        const isActive = currentFont === fontKey;
        
        html += `
            <div class="preference-option" onclick="selectFontFamily('${fontKey}', this)">
                <span class="material-icons preference-icon">${font.icon}</span>
                <span class="preference-text">${font.name}</span>
                ${isActive ? '<span class="material-icons preference-check">check</span>' : ''}
            </div>
        `;
    });
    
    // Divider
    html += '<div class="preferences-divider"></div>';
    
    // Layout Section
    html += '<div class="preferences-section-label">Card Layout</div>';
    Object.keys(LAYOUTS).forEach(layoutKey => {
        const layout = LAYOUTS[layoutKey];
        const isActive = currentLayout === layoutKey;
        
        html += `
            <div class="preference-option" onclick="selectLayout('${layoutKey}', this)">
                <span class="material-icons preference-icon">${layout.icon}</span>
                <span class="preference-text">${layout.name}</span>
                ${isActive ? '<span class="material-icons preference-check">check</span>' : ''}
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
    
    const menu = document.getElementById('preferencesMenu');
    if (menu) {
        menu.querySelectorAll('.preference-check').forEach(icon => icon.remove());
        
        if (element) {
            const checkIcon = document.createElement('span');
            checkIcon.className = 'material-icons preference-check';
            checkIcon.textContent = 'check';
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
        menu.querySelectorAll('.preference-check').forEach(icon => icon.remove());
        
        if (element) {
            const checkIcon = document.createElement('span');
            checkIcon.className = 'material-icons preference-check';
            checkIcon.textContent = 'check';
            element.appendChild(checkIcon);
        }
    }
    
    setTimeout(() => closePreferencesMenu(), 300);
}

// Close Preferences Menu
function closePreferencesMenu() {
    const menu = document.getElementById('preferencesMenu');
    if (menu) {
        menu.classList.remove('show');
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

// Update preference buttons UI
function updatePreferenceButtons() {
    // Update icons if needed
}

// Initialize
document.addEventListener('DOMContentLoaded', loadPreferences);
