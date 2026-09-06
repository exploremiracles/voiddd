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

// Toggle theme menu
function toggleThemeMenu() {
    let menu = document.getElementById('themeMenu');
    
    if (!menu) {
        menu = createThemeMenu();
    }
    
    if (menu.classList.contains('show')) {
        menu.classList.remove('show');
        document.removeEventListener('click', closeThemeMenuOutside);
    } else {
        menu.classList.add('show');
        setTimeout(() => {
            document.addEventListener('click', closeThemeMenuOutside);
        }, 100);
    }
}

// Create theme menu
function createThemeMenu() {
    // Remove existing menu
    const existingMenu = document.getElementById('themeMenu');
    if (existingMenu) {
        existingMenu.remove();
    }
    
    const menu = document.createElement('div');
    menu.id = 'themeMenu';
    menu.className = 'theme-menu';
    
    const currentTheme = localStorage.getItem('enlighten_theme') || 'default';
    
    let html = '<div class="theme-menu-header">Choose Theme</div>';
    
    Object.keys(THEMES).forEach(themeKey => {
        const theme = THEMES[themeKey];
        const isActive = currentTheme === themeKey;
        
        html += `
            <div class="theme-option" onclick="selectTheme('${themeKey}', this)">
                <span class="material-icons theme-option-icon">${theme.icon}</span>
                <span class="theme-option-text">${theme.name}</span>
                ${isActive ? '<span class="material-icons theme-check">check</span>' : ''}
            </div>
        `;
    });
    
    menu.innerHTML = html;
    document.body.appendChild(menu);
    return menu;
}

// Select theme
function selectTheme(themeName, element) {
    if (!THEMES[themeName]) return;
    
    applyTheme(themeName);
    
    const menu = document.getElementById('themeMenu');
    if (menu) {
        // Remove all checkmarks
        menu.querySelectorAll('.theme-check').forEach(icon => icon.remove());
        
        // Add checkmark to selected
        if (element) {
            const checkIcon = document.createElement('span');
            checkIcon.className = 'material-icons theme-check';
            checkIcon.textContent = 'check';
            element.appendChild(checkIcon);
        }
    }
    
    // Close menu after delay
    setTimeout(() => {
        const menu = document.getElementById('themeMenu');
        if (menu) {
            menu.classList.remove('show');
            document.removeEventListener('click', closeThemeMenuOutside);
        }
    }, 300);
    
    console.log('Theme changed to:', THEMES[themeName].name);
}

// Close menu when clicking outside
function closeThemeMenuOutside(e) {
    const menu = document.getElementById('themeMenu');
    const themeBtn = document.querySelector('.theme-btn');
    
    if (menu && themeBtn && !menu.contains(e.target) && !themeBtn.contains(e.target)) {
        menu.classList.remove('show');
        document.removeEventListener('click', closeThemeMenuOutside);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', loadTheme);
