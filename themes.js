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
}

// Apply theme to document
function applyTheme(themeName) {
    if (!THEMES[themeName]) return;
    
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem('enlighten_theme', themeName);
    
    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon) {
        themeIcon.textContent = THEMES[themeName].icon;
    }
    
    // Update meta theme-color
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
        const bgColor = getComputedStyle(document.body).backgroundColor;
        metaThemeColor.setAttribute('content', bgColor);
    }
}

// Toggle theme menu visibility
function toggleThemeMenu() {
    let menu = document.getElementById('themeMenu');
    
    if (!menu) {
        menu = createThemeMenu();
    }
    
    menu.classList.toggle('active');
    
    // Close menu when clicking outside
    if (menu.classList.contains('active')) {
        setTimeout(() => {
            document.addEventListener('click', closeThemeMenuOutside);
        }, 100);
    }
}

// Create theme menu dynamically
function createThemeMenu() {
    const menu = document.createElement('div');
    menu.id = 'themeMenu';
    menu.className = 'theme-menu';
    
    let html = '<div class="theme-menu-header">Choose Theme</div>';
    
    Object.keys(THEMES).forEach(themeKey => {
        const theme = THEMES[themeKey];
        const isActive = localStorage.getItem('enlighten_theme') === themeKey;
        
        html += `
            <div class="theme-option" onclick="selectTheme('${themeKey}')">
                <span class="material-icons">${theme.icon}</span>
                <span>${theme.name}</span>
                ${isActive ? '<span class="material-icons">check</span>' : ''}
            </div>
        `;
    });
    
    menu.innerHTML = html;
    document.body.appendChild(menu);
    return menu;
}

// Select a theme
function selectTheme(themeName) {
    applyTheme(themeName);
    closeThemeMenu();
    
    // Show brief feedback
    const themeNameDisplay = THEMES[themeName].name;
    console.log('Theme changed to:', themeNameDisplay);
}

// Close theme menu
function closeThemeMenu() {
    const menu = document.getElementById('themeMenu');
    if (menu) {
        menu.classList.remove('active');
    }
}

// Close theme menu when clicking outside
function closeThemeMenuOutside(e) {
    const menu = document.getElementById('themeMenu');
    const themeBtn = document.querySelector('.theme-btn');
    
    if (menu && themeBtn && !menu.contains(e.target) && !themeBtn.contains(e.target)) {
        menu.classList.remove('active');
        document.removeEventListener('click', closeThemeMenuOutside);
    }
}

// Initialize theme on page load
document.addEventListener('DOMContentLoaded', loadTheme);
