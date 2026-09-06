// Theme Management System
const THEMES = {
    default: { name: 'Enlighten Classic', icon: 'light_mode' },
    midnight: { name: 'Midnight Blue', icon: 'dark_mode' },
    forest: { name: 'Forest Green', icon: 'forest' },
    sunset: { name: 'Sunset Orange', icon: 'wb_twilight' },
    ocean: { name: 'Ocean Blue', icon: 'waves' },
    dark: { name: 'Dark Mode', icon: 'bedtime' }
};

// Load saved theme on page load
function loadTheme() {
    const savedTheme = localStorage.getItem('enlighten_theme') || 'default';
    applyTheme(savedTheme);
    updateThemeIcon(savedTheme);
}

// Apply theme to document
function applyTheme(themeName) {
    if (!THEMES[themeName]) return;
    
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem('enlighten_theme', themeName);
    
    updateThemeIcon(themeName);
    
    // Update meta theme-color
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
        setTimeout(() => {
            const bgColor = getComputedStyle(document.body).backgroundColor;
            metaThemeColor.setAttribute('content', bgColor);
        }, 100);
    }
}

// Update theme icon in button
function updateThemeIcon(themeName) {
    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon && THEMES[themeName]) {
        themeIcon.textContent = THEMES[themeName].icon;
    }
}

// Toggle theme menu visibility
function toggleThemeMenu() {
    let menu = document.getElementById('themeMenu');
    
    if (!menu) {
        menu = createThemeMenu();
    }
    
    const isActive = menu.classList.contains('active');
    
    if (isActive) {
        closeThemeMenu();
        return;
    }
    
    menu.classList.add('active');
    
    setTimeout(() => {
        document.addEventListener('click', closeThemeMenuOutside);
    }, 100);
}

// Create theme menu dynamically with INLINE STYLES
function createThemeMenu() {
    const menu = document.createElement('div');
    menu.id = 'themeMenu';
    menu.className = 'theme-menu';
    
    // Apply inline styles to prevent theme changes
    menu.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: #FFFFFF;
        border: 1px solid #C5C3B8;
        border-radius: 12px;
        box-shadow: 0 16px 32px rgba(0,0,0,0.2);
        z-index: 6000;
        min-width: 220px;
        display: none;
        animation: slideUp 0.3s ease;
    `;
    
    const currentTheme = localStorage.getItem('enlighten_theme') || 'default';
    
    let html = '';
    html += '<div style="padding:12px 16px;font-weight:600;border-bottom:1px solid #C5C3B8;color:#233130;font-size:0.9rem;">Choose Theme</div>';
    
    Object.keys(THEMES).forEach(themeKey => {
        const theme = THEMES[themeKey];
        const isActive = currentTheme === themeKey;
        
        html += `
            <div class="theme-option" data-theme="${themeKey}" onclick="selectTheme('${themeKey}', this)" style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;transition:background-color 0.3s ease;color:#233130;font-size:0.85rem;" onmouseover="this.style.backgroundColor='#DFDDD3'" onmouseout="this.style.backgroundColor='transparent'">
                <span class="material-icons" style="color:#5a745f;font-size:20px;">${theme.icon}</span>
                <span>${theme.name}</span>
                ${isActive ? '<span class="material-icons check-icon" style="margin-left:auto;color:#059669;font-size:18px;">check</span>' : ''}
            </div>
        `;
    });
    
    menu.innerHTML = html;
    document.body.appendChild(menu);
    return menu;
}

// Select a theme with immediate visual feedback
function selectTheme(themeName, element) {
    if (!THEMES[themeName]) return;
    
    // Apply theme
    applyTheme(themeName);
    
    // Remove all checkmarks with inline styles
    const menu = document.getElementById('themeMenu');
    if (menu) {
        menu.querySelectorAll('.check-icon').forEach(icon => icon.remove());
        
        // Add checkmark to clicked element
        if (element) {
            const checkIcon = document.createElement('span');
            checkIcon.className = 'material-icons check-icon';
            checkIcon.textContent = 'check';
            checkIcon.style.cssText = 'margin-left:auto;color:#059669;font-size:18px;';
            element.appendChild(checkIcon);
        }
    }
    
    // Close menu after short delay
    setTimeout(() => {
        closeThemeMenu();
    }, 300);
    
    console.log('Theme changed to:', THEMES[themeName].name);
}

// Close theme menu
function closeThemeMenu() {
    const menu = document.getElementById('themeMenu');
    if (menu) {
        menu.classList.remove('active');
        menu.style.display = 'none';
        document.removeEventListener('click', closeThemeMenuOutside);
    }
}

// Close theme menu when clicking outside
function closeThemeMenuOutside(e) {
    const menu = document.getElementById('themeMenu');
    const themeBtn = document.querySelector('.theme-btn');
    
    if (menu && themeBtn && !menu.contains(e.target) && !themeBtn.contains(e.target)) {
        closeThemeMenu();
    }
}

// Initialize theme on page load
document.addEventListener('DOMContentLoaded', loadTheme);
