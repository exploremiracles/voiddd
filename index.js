// Enlighten Login Page Script

let verifiedEmail = null;
let verifiedStudentData = null;

// Login Theme Toggle
function toggleLoginTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'default' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('enlighten_theme', newTheme);
    
    const themeIcon = document.getElementById('loginThemeIcon');
    if (themeIcon) {
        themeIcon.textContent = newTheme === 'dark' ? 'dark_mode' : 'light_mode';
    }
}

// Load saved theme
function loadLoginTheme() {
    const savedTheme = localStorage.getItem('enlighten_theme') || 'default';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    const themeIcon = document.getElementById('loginThemeIcon');
    if (themeIcon) {
        themeIcon.textContent = savedTheme === 'dark' ? 'dark_mode' : 'light_mode';
    }
}

// Copy UPI ID
function copyUPI(btn) {
    navigator.clipboard.writeText('enlighten@upi').then(() => {
        const originalText = btn.innerHTML;
        btn.innerHTML = '<span class="material-icons">check</span> Copied!';
        setTimeout(() => {
            btn.innerHTML = originalText;
        }, 2000);
    }).catch(() => {
        alert('Failed to copy');
    });
}

// Show Error
function showError(message) {
    document.getElementById('errorText').textContent = message;
    document.getElementById('errorMessage').classList.add('show');
    document.getElementById('successMessage').classList.remove('show');
}

// Show Success
function showSuccess(message) {
    document.getElementById('successText').textContent = message;
    document.getElementById('successMessage').classList.add('show');
    document.getElementById('errorMessage').classList.remove('show');
}

// Reset Email Step
function resetEmailStep() {
    document.getElementById('emailStep').style.display = 'block';
    document.getElementById('googleStep').style.display = 'none';
    verifiedEmail = null;
    verifiedStudentData = null;
    document.getElementById('errorMessage').classList.remove('show');
    document.getElementById('successMessage').classList.remove('show');
}

// Check Email
async function checkEmail() {
    const emailInput = document.getElementById('emailInput');
    const email = emailInput.value.trim().toLowerCase();
    const checkBtn = document.getElementById('checkEmailBtn');
    const checkText = document.getElementById('checkEmailText');
    const checkSpinner = document.getElementById('checkEmailSpinner');
    
    document.getElementById('errorMessage').classList.remove('show');
    document.getElementById('successMessage').classList.remove('show');
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showError('Please enter a valid Gmail address');
        return;
    }
    
    if (!email.endsWith('@gmail.com')) {
        showError('Please use a Gmail address (@gmail.com)');
        return;
    }
    
    checkBtn.disabled = true;
    checkText.textContent = 'Checking...';
    checkSpinner.style.display = 'block';
    
    try {
        const whitelistRef = db.collection('whitelist').doc(email);
        const doc = await whitelistRef.get();
        
        if (!doc.exists) {
            showError('This email is not authorized. Please complete payment.');
            checkBtn.disabled = false;
            checkText.textContent = 'Verify Email';
            checkSpinner.style.display = 'none';
            return;
        }
        
        const whitelistData = doc.data();
        
        if (whitelistData.active !== true) {
            showError('Your access has been deactivated. Contact support.');
            checkBtn.disabled = false;
            checkText.textContent = 'Verify Email';
            checkSpinner.style.display = 'none';
            return;
        }
        
        if (whitelistData.expiresAt) {
            const expiryDate = whitelistData.expiresAt.toDate();
            if (expiryDate < new Date()) {
                showError('Your access has expired. Contact us to renew.');
                checkBtn.disabled = false;
                checkText.textContent = 'Verify Email';
                checkSpinner.style.display = 'none';
                return;
            }
        }
        
        verifiedEmail = email;
        verifiedStudentData = whitelistData;
        
        showSuccess('Email verified successfully!');
        
        setTimeout(() => {
            document.getElementById('emailStep').style.display = 'none';
            document.getElementById('googleStep').style.display = 'block';
        }, 500);
        
    } catch (error) {
        console.error('Error checking email:', error);
        showError('Error checking email. Please try again.');
    } finally {
        checkBtn.disabled = false;
        checkText.textContent = 'Verify Email';
        checkSpinner.style.display = 'none';
    }
}

// Sign In with Google
async function signInWithGoogle() {
    if (!verifiedEmail) {
        showError('Please verify your email first');
        return;
    }
    
    const btn = document.getElementById('googleSignInBtn');
    const btnText = document.getElementById('googleBtnText');
    const spinner = document.getElementById('googleSpinner');
    
    btn.disabled = true;
    btnText.textContent = 'Signing in...';
    spinner.style.display = 'block';
    
    try {
        const googleProvider = new firebase.auth.GoogleAuthProvider();
        googleProvider.setCustomParameters({
            prompt: 'select_account',
            login_hint: verifiedEmail
        });
        
        const result = await auth.signInWithPopup(googleProvider);
        const user = result.user;
        
        if (user.email.toLowerCase() !== verifiedEmail) {
            await auth.signOut();
            showError('Please sign in with the same email you verified.');
            btn.disabled = false;
            btnText.textContent = 'Sign in with Google';
            spinner.style.display = 'none';
            return;
        }
        
        const whitelistRef = db.collection('whitelist').doc(user.email.toLowerCase());
        const whitelistDoc = await whitelistRef.get();
        
        if (!whitelistDoc.exists || whitelistDoc.data().active !== true) {
            await auth.signOut();
            showError('Your email is not authorized.');
            btn.disabled = false;
            btnText.textContent = 'Sign in with Google';
            spinner.style.display = 'none';
            return;
        }
        
        const whitelistData = whitelistDoc.data();
        
        const sessionData = {
            uid: user.uid,
            email: user.email.toLowerCase(),
            displayName: whitelistData.studentName || user.displayName || 'Student',
            photoURL: user.photoURL || '',
            allowedClasses: whitelistData.allowedClasses || [],
            expiresAt: whitelistData.expiresAt ? whitelistData.expiresAt.toDate().toISOString() : null,
            loginTime: Date.now()
        };
        
        localStorage.setItem('session', JSON.stringify(sessionData));
        
        btnText.textContent = 'Success!';
        spinner.style.display = 'none';
        
        // Show transition
        showPageTransition(whitelistData.studentName || user.displayName || 'Student');
        
    } catch (error) {
        console.error('Google Sign-In error:', error);
        
        if (error.code === 'auth/popup-closed-by-user') {
            showError('Sign-in cancelled. Please try again.');
        } else if (error.code === 'auth/popup-blocked') {
            showError('Popup blocked. Please allow popups.');
        } else {
            showError('Sign-in failed. Please try again.');
        }
        
        btn.disabled = false;
        btnText.textContent = 'Sign in with Google';
        spinner.style.display = 'none';
    }
}

// Show Page Transition
function showPageTransition(studentName) {
    const transition = document.getElementById('pageTransition');
    transition.classList.add('active');
    
    setTimeout(() => {
        window.location.href = 'dashboard.html';
    }, 1500);
}

// Check Session
function checkSession() {
    const session = localStorage.getItem('session');
    if (session) {
        try {
            const sessionData = JSON.parse(session);
            if (sessionData.loginTime) {
                const elapsedTime = Date.now() - sessionData.loginTime;
                const twoHours = 2 * 60 * 60 * 1000;
                if (elapsedTime < twoHours) {
                    window.location.href = 'dashboard.html';
                } else {
                    localStorage.removeItem('session');
                }
            }
        } catch (error) {
            localStorage.removeItem('session');
        }
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    loadLoginTheme();
    checkSession();
});
