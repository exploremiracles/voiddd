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
    
    if (menu.style.display === 'block') {
        menu.style.display = 'none';
        document.removeEventListener('click', closeThemeMenuOutside);
    } else {
        menu.style.display = 'block';
        setTimeout(() => {
            document.addEventListener('click', closeThemeMenuOutside);
        }, 100);
    }
}

// Create theme menu dynamically
function createThemeMenu() {
    // Remove existing menu if any
    const existingMenu = document.getElementById('themeMenu');
    if (existingMenu) {
        existingMenu.remove();
    }
    
    const menu = document.createElement('div');
    menu.id = 'themeMenu';
    
    const currentTheme = localStorage.getItem('enlighten_theme') || 'default';
    
    let html = '<div style="padding:12px 16px;font-weight:600;border-bottom:1px solid #C5C3B8;color:#233130;font-size:0.9rem;background:#FFFFFF;">Choose Theme</div>';
    
    Object.keys(THEMES).forEach(themeKey => {
        const theme = THEMES[themeKey];
        const isActive = currentTheme === themeKey;
        
        html += `
            <div data-theme="${themeKey}" onclick="selectTheme('${themeKey}', this)" style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;background:#FFFFFF;color:#233130;font-size:0.85rem;border-bottom:1px solid #F0F0F0;" onmouseover="this.style.backgroundColor='#DFDDD3'" onmouseout="this.style.backgroundColor='#FFFFFF'">
                <span class="material-icons" style="color:#5a745f;font-size:20px;">${theme.icon}</span>
                <span>${theme.name}</span>
                ${isActive ? '<span class="material-icons check-icon" style="margin-left:auto;color:#059669;font-size:18px;">check</span>' : ''}
            </div>
        `;
    });
    
    menu.innerHTML = html;
    
    // Apply styles to menu container
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
        overflow: hidden;
        display: none;
    `;
    
    document.body.appendChild(menu);
    return menu;
}

// Select a theme with immediate visual feedback
function selectTheme(themeName, element) {
    if (!THEMES[themeName]) return;
    
    // Apply theme
    applyTheme(themeName);
    
    // Update checkmarks
    const menu = document.getElementById('themeMenu');
    if (menu) {
        // Remove all existing checkmarks
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
        const menu = document.getElementById('themeMenu');
        if (menu) {
            menu.style.display = 'none';
            document.removeEventListener('click', closeThemeMenuOutside);
        }
    }, 300);
    
    console.log('Theme changed to:', THEMES[themeName].name);
}

// Close theme menu when clicking outside
function closeThemeMenuOutside(e) {
    const menu = document.getElementById('themeMenu');
    const themeBtn = document.querySelector('.theme-btn');
    
    if (menu && themeBtn && !menu.contains(e.target) && !themeBtn.contains(e.target)) {
        menu.style.display = 'none';
        document.removeEventListener('click', closeThemeMenuOutside);
    }
}

// Initialize theme on page load
document.addEventListener('DOMContentLoaded', loadTheme);
