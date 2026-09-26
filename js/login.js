document.addEventListener("DOMContentLoaded", () => {
    // ============================================
    // Load real statistics for landing page
    // ============================================
    const API_ORIGIN = 'php';
    fetch(`${API_ORIGIN}/sanitary.php`)
        .then(r => r.json())
        .then(result => {
            if (result.success && result.data) {
                const el = document.getElementById('liveEstabCount');
                if (el) el.textContent = result.data.length + '+';
            }
        })
        .catch(() => {});
    fetch(`${API_ORIGIN}/inspection.php`)
        .then(r => r.json())
        .then(result => {
            if (result.success && result.data) {
                const el = document.getElementById('liveInspCount');
                if (el) el.textContent = result.data.length + '+';
            }
        })
        .catch(() => {});

    // ============================================
    // Mobile Menu Toggle
    // ============================================
    const menuToggle = document.getElementById("menuToggle");
    const navLinks = document.getElementById("navLinks");

    if (menuToggle && navLinks) {
        menuToggle.addEventListener("click", () => {
            menuToggle.classList.toggle("active");
            navLinks.classList.toggle("active");
        });

        // Close menu when clicking a link
        navLinks.querySelectorAll(".nav-link").forEach(link => {
            link.addEventListener("click", () => {
                menuToggle.classList.remove("active");
                navLinks.classList.remove("active");
            });
        });
    }

    // ============================================
    // Header Scroll Effect
    // ============================================
    const header = document.getElementById("header");
    if (header) {
        window.addEventListener("scroll", () => {
            if (window.scrollY > 50) {
                header.classList.add("scrolled");
            } else {
                header.classList.remove("scrolled");
            }
        });
    }

    // ============================================
    // Smooth Scroll for Anchor Links
    // ============================================
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener("click", function(e) {
            const href = this.getAttribute("href");
            if (href === "#") return;
            
            e.preventDefault();
            const target = document.querySelector(href);
            if (target) {
                const headerHeight = header ? header.offsetHeight : 0;
                const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerHeight;
                window.scrollTo({
                    top: targetPosition,
                    behavior: "smooth"
                });
            }
        });
    });

    // ============================================
    // Active Navigation Link
    // ============================================
    const sections = document.querySelectorAll("section[id]");
    const navLinksAll = document.querySelectorAll(".nav-link");

    function updateActiveLink() {
        const scrollPosition = window.scrollY + 200;

        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.offsetHeight;
            const sectionId = section.getAttribute("id");

            if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
                navLinksAll.forEach(link => {
                    link.classList.remove("active");
                    if (link.getAttribute("href") === `#${sectionId}`) {
                        link.classList.add("active");
                    }
                });
            }
        });
    }

    window.addEventListener("scroll", updateActiveLink);

    // ============================================
    // Login Modal
    // ============================================
    const modal = document.getElementById("loginModal");
    const openLogin = document.getElementById("openLogin");
    const openLoginBtn = document.getElementById("openLoginBtn");
    const closeLogin = document.getElementById("closeLogin");
    const toggleEye = document.getElementById("togglePassword");
    const passwordInput = document.getElementById("password");
    const form = document.getElementById("loginForm");

    // Open modal
    if (openLogin) {
        openLogin.addEventListener("click", (e) => {
            e.preventDefault();
            modal.classList.add("active");
        });
    }

    if (openLoginBtn) {
        openLoginBtn.addEventListener("click", (e) => {
            e.preventDefault();
            modal.classList.add("active");
        });
    }

    // Close modal
    if (closeLogin) {
        closeLogin.addEventListener("click", () => {
            modal.classList.remove("active");
        });
    }

    window.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.classList.remove("active");
        }
    });

    // Close modal on Escape key
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.classList.contains("active")) {
            modal.classList.remove("active");
        }
    });

    // Show/hide password
    if (toggleEye && passwordInput) {
        toggleEye.addEventListener("click", () => {
            passwordInput.type = passwordInput.type === "password" ? "text" : "password";
        });
    }

    // Login form submit
    if (form) {
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            login();
        });
    }

    // Forgot Password link
    const forgotPasswordLink = document.getElementById("forgotPasswordLink");
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener("click", (e) => {
            e.preventDefault();
            showForgotStep1();
        });
    }

});


// ============================================
// LOGIN AUTH
// ============================================
async function login() {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const btn = document.querySelector('.btn-login');

    if (!username || !password) {
        alert("Please enter both username and password");
        return;
    }

    // Show loading state
    if (btn) {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.textContent = 'Logging in...';
        btn.style.opacity = '0.7';
    }

    try {
        const response = await fetch(`${window.location.origin}/TayabasCare/php/auth.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username, password })
        });

        const result = await response.json();

        // Reset button state
        if (btn) {
            btn.disabled = false;
            btn.textContent = btn.dataset.originalText || 'Login';
            btn.style.opacity = '1';
        }

        if (result.success) {
            localStorage.setItem("role", result.data.role);
            localStorage.setItem("username", result.data.username);
            localStorage.setItem("user_id", result.data.user_id);
            localStorage.setItem("inspectorFullName", result.data.fullName || result.data.username);

            if (result.data.role === 'admin') {
                localStorage.setItem("adminLoggedIn", "true");
            } else {
                localStorage.setItem("inspectorLoggedIn", "true");
            }

            window.location.href = result.data.redirect;
        } else {
            alert(result.message || "Invalid username or password");
        }
    } catch (error) {
        console.error('Login error:', error);
        alert("Login failed. Please check your connection and try again.");
        // Reset button state
        if (btn) {
            btn.disabled = false;
            btn.textContent = btn.dataset.originalText || 'Login';
            btn.style.opacity = '1';
        }
    }
}


// ============================================
// FORGOT PASSWORD FLOW
// ============================================

let fpUsername = '';

function removeFPModal() {
    const existing = document.getElementById("fpModal");
    if (existing) existing.remove();
}

function injectModal(innerHTML) {
    removeFPModal();
    const wrapper = document.createElement('div');
    wrapper.id = 'fpModal';
    wrapper.className = 'fp-modal';
    wrapper.innerHTML = `
        <div class="fp-box">
            <button class="fp-close" onclick="removeFPModal()">&times;</button>
            <div class="fp-header">
                ${innerHTML}
            </div>
        </div>
    `;
    document.body.appendChild(wrapper);
}

// STEP 1: Ask username + email
function showForgotStep1() {
    injectModal(`
        <h2>Forgot Password</h2>
        <p>Enter your username and registered email address.</p>

        <div class="fp-form">
            <label>Username</label>
            <input type="text" id="fp_username" placeholder="Your username">

            <label>Registered Email</label>
            <input type="email" id="fp_email" placeholder="Your registered email">

            <p id="fp_step1_error" class="fp-error"></p>

            <div class="fp-actions">
                <button onclick="handleFPStep1()" class="btn-fp-primary">Send OTP</button>
                <button onclick="removeFPModal()" class="btn-fp-secondary">Cancel</button>
            </div>
        </div>
    `);
}

async function handleFPStep1() {
    const username = document.getElementById('fp_username').value.trim();
    const email = document.getElementById('fp_email').value.trim();
    const errEl = document.getElementById('fp_step1_error');

    errEl.textContent = '';

    if (!username || !email) {
        errEl.textContent = 'Both fields are required.';
        return;
    }

    const btn = document.querySelector('#fpModal .btn-fp-primary');
    btn.textContent = 'Sending...';
    btn.disabled = true;

    try {
        const res = await fetch(`${window.location.origin}/TayabasCare/php/forgot_password.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ action: 'send_otp', username, email })
        });

        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (parseErr) {
            console.error('Raw response:', text);
            errEl.textContent = 'Server error. Check console for details.';
            btn.textContent = 'Send OTP';
            btn.disabled = false;
            return;
        }

        if (data.success) {
            fpUsername = username;
            showForgotStep2();
        } else {
            errEl.textContent = data.message || 'Failed to send OTP.';
            btn.textContent = 'Send OTP';
            btn.disabled = false;
        }
    } catch (err) {
        console.error('Fetch error:', err);
        errEl.textContent = 'Connection error. Please try again.';
        btn.textContent = 'Send OTP';
        btn.disabled = false;
    }
}

// STEP 2: Enter OTP
function showForgotStep2() {
    injectModal(`
        <h2>Enter OTP</h2>
        <p>A 6-digit OTP has been sent to your registered email. It is valid for 10 minutes.</p>

        <div class="fp-form">
            <label>OTP Code</label>
            <input type="text" id="fp_otp" placeholder="Enter 6-digit OTP" maxlength="6" inputmode="numeric">

            <p id="fp_step2_error" class="fp-error"></p>

            <div class="fp-actions">
                <button onclick="handleFPStep2()" class="btn-fp-primary">Verify OTP</button>
                <button onclick="showForgotStep1()" class="btn-fp-secondary">Back</button>
            </div>
        </div>
    `);
}

async function handleFPStep2() {
    const otp = document.getElementById('fp_otp').value.trim();
    const errEl = document.getElementById('fp_step2_error');
    errEl.textContent = '';

    if (!otp || otp.length !== 6) {
        errEl.textContent = 'Please enter the 6-digit OTP.';
        return;
    }

    const btn = document.querySelector('#fpModal .btn-fp-primary');
    btn.textContent = 'Verifying...';
    btn.disabled = true;

    try {
        const res = await fetch(`${window.location.origin}/TayabasCare/php/forgot_password.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ action: 'verify_otp', username: fpUsername, otp })
        });
        const data = await res.json();

        if (data.success) {
            showForgotStep3();
        } else {
            errEl.textContent = data.message || 'Invalid OTP.';
            btn.textContent = 'Verify OTP';
            btn.disabled = false;
        }
    } catch (err) {
        errEl.textContent = 'Connection error. Please try again.';
        btn.textContent = 'Verify OTP';
        btn.disabled = false;
    }
}

// STEP 3: Set new password
function showForgotStep3() {
    injectModal(`
        <h2>Set New Password</h2>
        <p>OTP verified! Enter your new password (minimum 6 characters).</p>

        <div class="fp-form">
            <label>New Password</label>
            <div class="fp-password-wrapper">
                <input type="password" id="fp_newpass" placeholder="New password (min. 6 chars)">
                <span class="fp-toggle-eye" onclick="toggleFPPass('fp_newpass')">👁</span>
            </div>

            <label>Confirm Password</label>
            <div class="fp-password-wrapper">
                <input type="password" id="fp_confirmpass" placeholder="Re-enter new password">
                <span class="fp-toggle-eye" onclick="toggleFPPass('fp_confirmpass')">👁</span>
            </div>

            <p id="fp_step3_error" class="fp-error"></p>

            <button onclick="handleFPStep3()" class="btn-fp-full">Reset Password</button>
        </div>
    `);
}

function toggleFPPass(inputId) {
    const input = document.getElementById(inputId);
    input.type = input.type === 'password' ? 'text' : 'password';
}

async function handleFPStep3() {
    const newPass = document.getElementById('fp_newpass').value;
    const confirmPass = document.getElementById('fp_confirmpass').value;
    const errEl = document.getElementById('fp_step3_error');
    errEl.textContent = '';

    if (!newPass || !confirmPass) {
        errEl.textContent = 'Both fields are required.';
        return;
    }
    if (newPass.length < 6) {
        errEl.textContent = 'Password must be at least 6 characters.';
        return;
    }
    if (newPass !== confirmPass) {
        errEl.textContent = 'Passwords do not match.';
        return;
    }

    const btn = document.querySelector('#fpModal .btn-fp-full');
    btn.textContent = 'Resetting...';
    btn.disabled = true;

    try {
        const res = await fetch(`${window.location.origin}/TayabasCare/php/forgot_password.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                action: 'reset_password',
                username: fpUsername,
                new_password: newPass,
                confirm_password: confirmPass
            })
        });
        const data = await res.json();

        if (data.success) {
            removeFPModal();
            showSuccessModal();
        } else {
            errEl.textContent = data.message || 'Failed to reset password.';
            btn.textContent = 'Reset Password';
            btn.disabled = false;
        }
    } catch (err) {
        errEl.textContent = 'Connection error. Please try again.';
        btn.textContent = 'Reset Password';
        btn.disabled = false;
    }
}

// Success Screen
function showSuccessModal() {
    injectModal(`
        <div class="fp-success">
            <h2>Password Reset!</h2>
            <p>Your password has been changed successfully.<br>You can now log in with your new password.</p>
            <button onclick="removeFPModal()" class="btn-fp-primary">Back to Login</button>
        </div>
    `);
}
