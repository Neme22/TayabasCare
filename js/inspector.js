// API Configuration — relative path works on localhost and any live server
const API_BASE_URL = 'php';

// CSRF token management — auto-attach to all mutating requests
let _csrfToken = null;
async function _fetchCsrfToken() {
    if (_csrfToken) return _csrfToken;
    try {
        const r = await fetch(`${API_BASE_URL}/csrf_token.php`, { credentials: 'include' });
        const j = await r.json();
        _csrfToken = j?.data?.token || j?.csrf_token || null;
        return _csrfToken;
    } catch (e) { return null; }
}
// Initialize token on load
_fetchCsrfToken();

// Monkey-patch fetch to auto-attach CSRF header on POST/PUT/DELETE/PATCH
const _origFetch = window.fetch.bind(window);
window.fetch = async function(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        const token = _csrfToken || await _fetchCsrfToken();
        if (token) {
            opts.headers = { ...opts.headers, 'X-CSRF-Token': token };
        }
    }
    return _origFetch(url, opts);
};

// Shared table "Load more" paging (mirrors admin.js)
const TablePaging = {
    _limits: {},
    getLimit(key, def = 10) {
        return this._limits[key] ?? def;
    },
    showMore(key, def = 10, by = 10) {
        this._limits[key] = this.getLimit(key, def) + by;
    },
    reset(key) {
        delete this._limits[key];
    },
    slice(list, key, def = 10) {
        const limit = this.getLimit(key, def);
        return {
            displayed: list.slice(0, limit),
            hasMore: list.length > limit,
            remaining: Math.max(0, list.length - limit)
        };
    },
    moreRow(key, remaining, colSpan, def = 10) {
        return `<tr class="load-more-row"><td colspan="${colSpan}" style="text-align:center;padding:10px;border-top:1px solid #e5e7eb;">
            <button type="button" class="btn btn-sm btn-outline" data-testid="load-more-${key}"
                onclick="TablePaging.showMore('${key}', ${def}); TablePaging._rerender('${key}')">
                Load more (${remaining} more)
            </button>
        </td></tr>`;
    },
    _handlers: {},
    register(key, fn) {
        this._handlers[key] = fn;
    },
    _rerender(key) {
        const fn = this._handlers[key];
        if (typeof fn === 'function') fn();
    }
};

// --- Role guard: inspector only ---
(async function() {
    try {
        const resp = await fetch(`${API_BASE_URL}/auth.php`);
        const data = await resp.json();
        if (!data.success || (data.data && data.data.role !== 'inspector')) {
            window.location.href = 'index.html';
        }
    } catch (e) {
        window.location.href = 'index.html';
    }
})();

// ============================================================
// Form Drafts — auto-saves in-progress form data so it survives
// auto-logout. Drafts persist in localStorage until the form is
// successfully submitted (then they're cleared).
// ============================================================
const FormDrafts = {
    KEYS: {
        inspection: 'draft_inspection',
        sanitary: 'draft_sanitary',
        burial: 'draft_burial',
        accomplishment: 'draft_accomplishment'
    },

    hasDrafts() {
        return Object.values(this.KEYS).some(k => localStorage.getItem(k));
    },

    // Save all open modal forms to localStorage
    saveAll() {
        try { this.saveInspection(); } catch(e) {}
        try { this.saveSanitary(); } catch(e) {}
        try { this.saveBurial(); } catch(e) {}
        try { this.saveAccomplishment(); } catch(e) {}
    },

    // Clear all draft keys
    clearAll() {
        Object.values(this.KEYS).forEach(k => localStorage.removeItem(k));
    },

    // ── Inspection Report ──
    saveInspection() {
        const modal = document.getElementById('inspection-modal');
        if (!modal || !modal.open) return;
        const draft = {
            establishment: (document.getElementById('inspection-establishment') || {}).value || '',
            remarksText: (document.getElementById('inspection-remarks') || {}).value || '',
            recommendationText: (document.getElementById('inspection-recommendation') || {}).value || '',
            deadline: (document.getElementById('inspection-deadline') || {}).value || '',
            checkedViolations: [...document.querySelectorAll('.violation-check:checked')].map(cb => cb.value),
            checkedRecommendations: [...document.querySelectorAll('.recommendation-check:checked')].map(cb => cb.value)
        };
        localStorage.setItem(this.KEYS.inspection, JSON.stringify(draft));
    },

    // ── Sanitary Record ──
    saveSanitary() {
        const modal = document.getElementById('sanitary-modal');
        if (!modal || !modal.open) return;
        const draft = {
            mode: (document.getElementById('sanitary-mode') || {}).value || '',
            editId: (document.getElementById('sanitary-id') || {}).value || '',
            permit3: (document.getElementById('sanitary-permit-3') || {}).value || '',
            business: (document.getElementById('sanitary-business') || {}).value || '',
            barangay: (document.getElementById('sanitary-barangay') || {}).value || '',
            buildingStreet: (document.getElementById('sanitary-building-street') || {}).value || '',
            corporation: (document.getElementById('sanitary-corporation') || {}).value || '',
            ownerFirst: (document.getElementById('owner-first') || {}).value || '',
            ownerMiddle: (document.getElementById('owner-middle') || {}).value || '',
            ownerLast: (document.getElementById('owner-last') || {}).value || '',
            sex: document.querySelector('input[name="sex"]:checked')?.value || '',
            resultXray: (document.getElementById('result-xray') || {}).checked || false,
            resultStool: (document.getElementById('result-stool') || {}).checked || false,
            personnelNo: (document.getElementById('sanitary-personnel-no') || {}).value || '',
            remarks: (document.getElementById('sanitary-remarks') || {}).value || '',
            personnel: []
        };
        document.querySelectorAll('.personnel-row').forEach(row => {
            draft.personnel.push({
                first: (row.querySelector('.first-name') || {}).value || '',
                middle: (row.querySelector('.middle-name') || {}).value || '',
                last: (row.querySelector('.last-name') || {}).value || '',
                sex: row.querySelector('.personnel-sex:checked')?.value || '',
                xray: (row.querySelector('.personnel-xray') || {}).checked || false,
                stool: (row.querySelector('.personnel-stool') || {}).checked || false
            });
        });
        localStorage.setItem(this.KEYS.sanitary, JSON.stringify(draft));
    },

    // ── Burial Record ──
    saveBurial() {
        const modal = document.getElementById('burial-modal');
        if (!modal || !modal.open) return;
        const draft = {
            mode: (document.getElementById('burial-mode') || {}).value || '',
            type: (document.getElementById('burial-type') || {}).value || '',
            editId: (document.getElementById('burial-id') || {}).value || '',
            deceased: (document.getElementById('burial-deceased') || {}).value || '',
            deathDate: (document.getElementById('burial-death-date') || {}).value || '',
            deathPlace: (document.getElementById('burial-death-place') || {}).value || '',
            informant: (document.getElementById('burial-informant') || {}).value || '',
            inspector: (document.getElementById('burial-inspector') || {}).value || '',
            originMunicipality: (document.getElementById('burial-origin-municipality') || {}).value || '',
            transferProvince: (document.getElementById('burial-transfer-province') || {}).value || '',
            transferMunicipality: (document.getElementById('burial-transfer-municipality') || {}).value || '',
            funeral: ((document.getElementById('burial-funeral') || document.getElementById('burial-funeral-skeletal')) || {}).value || '',
            orNumber: ((document.getElementById('burial-or') || document.getElementById('burial-or-skeletal')) || {}).value || ''
        };
        localStorage.setItem(this.KEYS.burial, JSON.stringify(draft));
    },

    // ── Accomplishment ──
    saveAccomplishment() {
        const modal = document.getElementById('accomplishment-modal');
        if (!modal || !modal.open) return;
        const fields = {};
        for (let i = 1; i <= 24; i++) {
            const el = document.getElementById('acc-f' + i);
            if (el) fields['f' + i] = el.value;
        }
        const draft = {
            editId: (document.getElementById('acc-record-id') || {}).value || '',
            month: (document.getElementById('acc-month') || {}).value || '',
            monthDisplay: (document.getElementById('acc-month-display') || {}).value || '',
            year: (document.getElementById('acc-year') || {}).value || '',
            fields: fields
        };
        localStorage.setItem(this.KEYS.accomplishment, JSON.stringify(draft));
    },

    // ── Restore: open modals and repopulate fields ──
    restoreInspection() {
        const raw = localStorage.getItem(this.KEYS.inspection);
        if (!raw) return;
        const d = JSON.parse(raw);
        if (!d.establishment) { localStorage.removeItem(this.KEYS.inspection); return; }

        openInspectionModal();

        // Restore text fields
        const estab = document.getElementById('inspection-establishment');
        if (estab) { estab.value = d.establishment; estab.dispatchEvent(new Event('input', {bubbles:true})); }
        if (d.remarksText) document.getElementById('inspection-remarks').value = d.remarksText;
        if (d.recommendationText) document.getElementById('inspection-recommendation').value = d.recommendationText;
        if (d.deadline) { document.getElementById('inspection-deadline').value = d.deadline; document.getElementById('inspection-deadline').dispatchEvent(new Event('input')); }

        // Wait for dynamic violation/recommendation lists to load after establishment auto-detect, then restore checkboxes
        if (d.checkedViolations.length > 0 || d.checkedRecommendations.length > 0) {
            const violList = document.getElementById('violation-radio-list');
            const restoreChecks = () => {
                if (d.checkedViolations) d.checkedViolations.forEach(val => {
                    const cb = document.querySelector('.violation-check[value="' + CSS.escape(val) + '"]');
                    if (cb) cb.checked = true;
                });
                if (d.checkedRecommendations) d.checkedRecommendations.forEach(val => {
                    const cb = document.querySelector('.recommendation-check[value="' + CSS.escape(val) + '"]');
                    if (cb) cb.checked = true;
                });
                localStorage.removeItem(FormDrafts.KEYS.inspection);
            };
            if (violList) {
                const observer = new MutationObserver((mutations, obs) => {
                    if (violList.querySelectorAll('.violation-check').length > 0) {
                        obs.disconnect();
                        restoreChecks();
                    }
                });
                observer.observe(violList, { childList: true });
                // Fallback timeout in case observer misses
                setTimeout(() => { observer.disconnect(); restoreChecks(); }, 3000);
            } else {
                localStorage.removeItem(this.KEYS.inspection);
            }
        } else {
            localStorage.removeItem(this.KEYS.inspection);
        }

        showNotification('Inspection draft restored. File attachment was not saved — please re-upload if needed.', 'info');
    },

    restoreSanitary() {
        const raw = localStorage.getItem(this.KEYS.sanitary);
        if (!raw) return;
        const d = JSON.parse(raw);
        if (!d.business) { localStorage.removeItem(this.KEYS.sanitary); return; }

        openSanitaryModal(d.mode === 'edit' ? 'edit' : 'add', d.editId || undefined);

        setTimeout(() => {
            if (d.permit3) document.getElementById('sanitary-permit-3').value = d.permit3;
            if (d.business) document.getElementById('sanitary-business').value = d.business;
            if (d.barangay) document.getElementById('sanitary-barangay').value = d.barangay;
            if (d.buildingStreet) document.getElementById('sanitary-building-street').value = d.buildingStreet;
            if (d.corporation) document.getElementById('sanitary-corporation').value = d.corporation;
            if (d.ownerFirst) document.getElementById('owner-first').value = d.ownerFirst;
            if (d.ownerMiddle) document.getElementById('owner-middle').value = d.ownerMiddle;
            if (d.ownerLast) document.getElementById('owner-last').value = d.ownerLast;
            if (d.sex) { const r = document.querySelector('input[name="sex"][value="' + d.sex + '"]'); if (r) r.checked = true; }
            if (d.resultXray) document.getElementById('result-xray').checked = true;
            if (d.resultStool) document.getElementById('result-stool').checked = true;
            if (d.remarks) document.getElementById('sanitary-remarks').value = d.remarks;

            // Restore personnel
            if (d.personnelNo) {
                const noInput = document.getElementById('sanitary-personnel-no');
                noInput.value = d.personnelNo;
                noInput.dispatchEvent(new Event('input', {bubbles:true}));
                setTimeout(() => {
                    const rows = document.querySelectorAll('.personnel-row');
                    (d.personnel || []).forEach((p, i) => {
                        if (!rows[i]) return;
                        if (p.first) rows[i].querySelector('.first-name').value = p.first;
                        if (p.middle) rows[i].querySelector('.middle-name').value = p.middle;
                        if (p.last) rows[i].querySelector('.last-name').value = p.last;
                        if (p.sex) { const sr = rows[i].querySelector('.personnel-sex[value="' + p.sex + '"]'); if (sr) sr.checked = true; }
                        if (p.xray) rows[i].querySelector('.personnel-xray').checked = true;
                        if (p.stool) rows[i].querySelector('.personnel-stool').checked = true;
                    });
                }, 500);
            }
        }, 300);

        localStorage.removeItem(this.KEYS.sanitary);
        showNotification('Sanitary record draft restored.', 'info');
    },

    restoreBurial() {
        const raw = localStorage.getItem(this.KEYS.burial);
        if (!raw) return;
        const d = JSON.parse(raw);
        if (!d.deceased) { localStorage.removeItem(this.KEYS.burial); return; }

        openBurialModal(d.mode === 'edit' ? 'edit' : 'add', d.type || 'cadaver', d.editId || undefined);

        setTimeout(() => {
            if (d.deceased) document.getElementById('burial-deceased').value = d.deceased;
            if (d.deathDate) document.getElementById('burial-death-date').value = d.deathDate;
            if (d.deathPlace) document.getElementById('burial-death-place').value = d.deathPlace;
            if (d.informant) document.getElementById('burial-informant').value = d.informant;
            if (d.inspector) document.getElementById('burial-inspector').value = d.inspector;
            if (d.originMunicipality) { const el = document.getElementById('burial-origin-municipality'); if (el) el.value = d.originMunicipality; }
            if (d.transferProvince) { const el = document.getElementById('burial-transfer-province'); if (el) el.value = d.transferProvince; }
            if (d.transferMunicipality) { const el = document.getElementById('burial-transfer-municipality'); if (el) el.value = d.transferMunicipality; }
            if (d.funeral) { const el = document.getElementById('burial-funeral') || document.getElementById('burial-funeral-skeletal'); if (el) el.value = d.funeral; }
            if (d.orNumber) { const el = document.getElementById('burial-or') || document.getElementById('burial-or-skeletal'); if (el) el.value = d.orNumber; }
        }, 300);

        localStorage.removeItem(this.KEYS.burial);
        showNotification('Burial record draft restored. Death certificate was not saved — please re-upload if needed.', 'info');
    },

    restoreAccomplishment() {
        const raw = localStorage.getItem(this.KEYS.accomplishment);
        if (!raw) return;
        const d = JSON.parse(raw);

        openAccomplishmentModal(d.editId || undefined);

        setTimeout(() => {
            if (d.monthDisplay) document.getElementById('acc-month-display').value = d.monthDisplay;
            if (d.month) document.getElementById('acc-month').value = d.month;
            if (d.year) document.getElementById('acc-year').value = d.year;
            if (d.fields) {
                for (let i = 1; i <= 24; i++) {
                    const el = document.getElementById('acc-f' + i);
                    if (el && d.fields['f' + i] !== undefined) el.value = d.fields['f' + i];
                }
            }
        }, 300);

        localStorage.removeItem(this.KEYS.accomplishment);
        showNotification('Accomplishment draft restored.', 'info');
    },

    // Prompt user to restore all saved drafts (called on page load)
    promptRestore() {
        if (!this.hasDrafts()) return;
        setTimeout(() => {
            const toast = document.createElement('div');
            toast.id = 'draft-restore-toast';
            toast.className = 'fixed bottom-4 right-4 bg-amber-500 text-white px-6 py-4 rounded-lg shadow-2xl z-[9999] transition-all transform';
            toast.style.animation = 'slideInRight 0.3s ease-out';
            toast.style.maxWidth = '420px';
            toast.innerHTML = `
                <div style="display:flex;align-items:flex-start;gap:12px;">
                    <i class="fas fa-save" style="font-size:20px;margin-top:2px;"></i>
                    <div style="flex:1;">
                        <p style="margin:0 0 10px 0;font-weight:600;">You have unsaved form drafts from your previous session.</p>
                        <div style="display:flex;gap:8px;">
                            <button id="draft-restore-btn" style="padding:4px 14px;background:#ffffff;color:#92400e;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Restore Drafts</button>
                            <button id="draft-discard-btn" style="padding:4px 14px;background:rgba(255,255,255,0.2);color:#ffffff;border:1px solid rgba(255,255,255,0.4);border-radius:6px;cursor:pointer;font-size:13px;">Discard</button>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(toast);

            document.getElementById('draft-restore-btn').addEventListener('click', () => {
                FormDrafts.restoreAll();
                toast.style.animation = 'slideOutRight 0.3s ease-in';
                setTimeout(() => toast.remove(), 300);
            });
            document.getElementById('draft-discard-btn').addEventListener('click', () => {
                FormDrafts.clearAll();
                toast.style.animation = 'slideOutRight 0.3s ease-in';
                setTimeout(() => toast.remove(), 300);
            });
        }, 1500);
    },

    restoreAll() {
        this.restoreInspection();
        this.restoreSanitary();
        this.restoreBurial();
        this.restoreAccomplishment();
        showNotification('All available drafts have been restored.', 'success');
    },

    // Auto-save listeners (debounced, attached once)
    _attached: false,
    attachAutoSave() {
        if (this._attached) return;
        this._attached = true;
        let timer = null;
        const debounced = () => { clearTimeout(timer); timer = setTimeout(() => FormDrafts.saveAll(), 2000); };

        ['inspection-form', 'sanitary-form', 'burial-form', 'accomplishment-form'].forEach(id => {
            const form = document.getElementById(id);
            if (form) form.addEventListener('input', debounced);
        });
        // Personnel count generates dynamic rows
        const pNo = document.getElementById('sanitary-personnel-no');
        if (pNo) pNo.addEventListener('change', () => setTimeout(debounced, 600));
    }
};

// Fetch Tayabas City barangays through PHP proxy
async function populateBarangayFromAPI() {
    const select = document.getElementById('sanitary-barangay');
    const filterSelect = document.getElementById('sanitary-barangay-filter');
    
    if (!select) return;

    // Show loading state
    select.innerHTML = '<option value="">Loading barangays...</option>';
    if (filterSelect) {
        filterSelect.innerHTML = '<option value="">Loading...</option>';
    }

    try {
        // Call PHP proxy to fetch barangays
        const response = await fetch(`${API_BASE_URL}/get_barangays.php`);
        
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }
        
        const result = await response.json();
        
        // Check if request was successful
        if (!result.success) {
            throw new Error(result.message || 'Failed to load barangays');
        }
        
        let barangays = result.data;
        
        // Handle different response formats
        if (!barangays) {
            throw new Error('No barangay data received');
        }
        
        // If data is an object with a data property, extract it
        if (barangays.data && Array.isArray(barangays.data)) {
            barangays = barangays.data;
        }
        
        // If it's not an array, try to convert it
        if (!Array.isArray(barangays)) {
            // Check if it's a single object
            if (typeof barangays === 'object') {
                barangays = [barangays];
            } else {
                throw new Error('Invalid data format received from API');
            }
        }
        
        // Sort barangays alphabetically by name
        barangays.sort((a, b) => {
            const nameA = a.name || '';
            const nameB = b.name || '';
            return nameA.localeCompare(nameB);
        });
        
        // Populate main dropdown
        select.innerHTML = '<option value="">Select Barangay</option>';
        barangays.forEach(brgy => {
            const opt = document.createElement('option');
            const brgyName = brgy.name || brgy.barangay_name || brgy;
            opt.value = brgyName;
            opt.textContent = brgyName;
            if (brgy.code) {
                opt.setAttribute('data-code', brgy.code);
            }
            select.appendChild(opt);
        });
        
        // Populate filter dropdown
        if (filterSelect) {
            filterSelect.innerHTML = '<option value="">All Barangays</option>';
            barangays.forEach(brgy => {
                const opt = document.createElement('option');
                const brgyName = brgy.name || brgy.barangay_name || brgy;
                opt.value = brgyName;
                opt.textContent = brgyName;
                if (brgy.code) {
                    opt.setAttribute('data-code', brgy.code);
                }
                filterSelect.appendChild(opt);
            });
        }
        
    } catch (error) {
        console.error('Failed to load barangays:', error);
        
        // Show error state
        select.innerHTML = '<option value="">Failed to load barangays</option>';
        if (filterSelect) {
            filterSelect.innerHTML = '<option value="">Failed to load</option>';
        }
        
        // Show notification to user
        showNotification('Failed to load barangays: ' + error.message, 'error');
    }
}

document.addEventListener('DOMContentLoaded', populateBarangayFromAPI);

let cachedSanitaryRecords = [];
let cachedBurialRecords = { cadaver: [], skeletal: [], exhumation: [] };
let cachedInspectionReports = [];
let cachedSchedules = [];
let cachedEvents = [];

function setRealtimeDatesAdvanced() {
    const now = new Date();
    const formatted = now.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const sanitaryDate = document.getElementById('sanitary-date');
    if (sanitaryDate && !sanitaryDate.value) {
        sanitaryDate.value = formatted;
    }
}

document.addEventListener('DOMContentLoaded', setRealtimeDatesAdvanced);

// Auto-generate sequential numbers for Sanitary Permit Box 1 and Box 2
async function generatePermitSequentialNumber() {
    try {
        const response = await fetch(`${API_BASE_URL}/sanitary.php`);
        const result = await response.json();

        let maxBox1 = 0;
        let maxBox2 = 0;

        if (result.success && result.data) {
            result.data.forEach(record => {
                if (record.permitNo) {
                    const parts = record.permitNo.split('-');
                    const num1 = parseInt(parts[0]) || 0;
                    if (num1 > maxBox1) maxBox1 = num1;
                    const num2 = parseInt(parts[1]) || 0;
                    if (num2 > maxBox2) maxBox2 = num2;
                }
            });
        }

        const next1 = maxBox1 + 1;
        const next2 = maxBox2 + 1;

        const formatted1 = Math.min(next1, 999).toString().padStart(3, '0');
        const formatted2 = Math.min(next2, 999).toString().padStart(2, '0');

        const permit1Field = document.getElementById('sanitary-permit-1');
        if (permit1Field) permit1Field.value = formatted1;

        const permit2Field = document.getElementById('sanitary-permit-2');
        if (permit2Field) permit2Field.value = formatted2;

    } catch (error) {
        console.error('Error generating permit number:', error);
        const permit1Field = document.getElementById('sanitary-permit-1');
        if (permit1Field) permit1Field.value = '001';
        const permit2Field = document.getElementById('sanitary-permit-2');
        if (permit2Field) permit2Field.value = '01';
    }
}

function addPersonnel() {
    const container = document.getElementById('personnelContainer');
    const personnelCount = container.querySelectorAll('.personnel-row').length + 1;

    const personnelRow = document.createElement('div');
    personnelRow.className = "personnel-row border border-gray-300 p-3 rounded-lg";

    personnelRow.innerHTML = `
        <div class="grid grid-cols-3 gap-2 mb-2">
            <input type="text" class="input input-bordered input-success input-sm first-name" placeholder="First Name"
                oninput="this.value = this.value.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ\\s\\-]/g, ''); this.value = this.value.replace(/(?:^|\\s|-)\\S/g, c => c.toUpperCase());" />
            <input type="text" class="input input-bordered input-success input-sm middle-name" placeholder="M.I." maxlength="1"
                oninput="this.value = this.value.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ]/g, '').toUpperCase();" />
            <input type="text" class="input input-bordered input-success input-sm last-name" placeholder="Last Name"
                oninput="this.value = this.value.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ\\s\\-]/g, ''); this.value = this.value.replace(/(?:^|\\s|-)\\S/g, c => c.toUpperCase());" />
        </div>
        <div class="grid grid-cols-2 gap-2 items-center">
            <div>
                <label class="label-text text-xs font-semibold">Sex:</label>
                <div class="flex gap-3 mt-1">
                    <label class="label cursor-pointer">
                        <input type="radio" name="personnel-sex-${personnelCount}" value="Male" class="radio radio-xs radio-success personnel-sex" />
                        <span class="label-text ml-1 text-xs">Male</span>
                    </label>
                    <label class="label cursor-pointer">
                        <input type="radio" name="personnel-sex-${personnelCount}" value="Female" class="radio radio-xs radio-success personnel-sex" />
                        <span class="label-text ml-1 text-xs">Female</span>
                    </label>
                </div>
            </div>
            <div>
                <label class="label-text text-xs font-semibold">Result:</label>
                <div class="flex gap-3 mt-1">
                    <label class="label cursor-pointer">
                        <input type="checkbox" class="checkbox checkbox-xs checkbox-success personnel-xray" />
                        <span class="label-text ml-1 text-xs">X-ray</span>
                    </label>
                    <label class="label cursor-pointer">
                        <input type="checkbox" class="checkbox checkbox-xs checkbox-success personnel-stool" />
                        <span class="label-text ml-1 text-xs">Stool</span>
                    </label>
                </div>
            </div>
        </div>
    `;

    container.appendChild(personnelRow);
}

// Dynamic personnel generation based on number input
function generatePersonnelFields() {
    const rawVal = document.getElementById('sanitary-personnel-no').value.replace(/[^0-9]/g, '');
    const personnelNo = rawVal !== '' ? parseInt(rawVal, 10) : 0;
    const container = document.getElementById('personnelContainer');
    const section = document.getElementById('personnelSection');

    if (!container) return;

    if (personnelNo <= 0) {
        container.innerHTML = '';
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    
    // Clear existing fields
    container.innerHTML = '';
    
    // Generate the specified number of personnel fields
    for (let i = 1; i <= personnelNo; i++) {
        const personnelRow = document.createElement('div');
        personnelRow.className = "personnel-row border border-gray-300 p-3 rounded-lg mb-3";
        
        personnelRow.innerHTML = `
            <div class="mb-2">
                <label class="label-text text-sm font-semibold text-emerald-700">Personnel #${i}</label>
            </div>
            <div class="grid grid-cols-3 gap-2 mb-2">
                <input type="text" class="input input-bordered input-success input-sm first-name" placeholder="First Name"
                    oninput="this.value = this.value.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ\\s\\-]/g, ''); this.value = this.value.replace(/(?:^|\\s|-)\\S/g, c => c.toUpperCase());" />
                <input type="text" class="input input-bordered input-success input-sm middle-name" placeholder="M.I." maxlength="1"
                    oninput="this.value = this.value.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ]/g, '').toUpperCase();" />
                <input type="text" class="input input-bordered input-success input-sm last-name" placeholder="Last Name"
                    oninput="this.value = this.value.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ\\s\\-]/g, ''); this.value = this.value.replace(/(?:^|\\s|-)\\S/g, c => c.toUpperCase());" />
            </div>
            <div class="grid grid-cols-2 gap-2 items-center">
                <div>
                    <label class="label-text text-xs font-semibold">Sex:</label>
                    <div class="flex gap-3 mt-1">
                        <label class="label cursor-pointer">
                            <input type="radio" name="personnel-sex-${i}" value="Male" class="radio radio-xs radio-success personnel-sex" />
                            <span class="label-text ml-1 text-xs">Male</span>
                        </label>
                        <label class="label cursor-pointer">
                            <input type="radio" name="personnel-sex-${i}" value="Female" class="radio radio-xs radio-success personnel-sex" />
                            <span class="label-text ml-1 text-xs">Female</span>
                        </label>
                    </div>
                </div>
                <div>
                    <label class="label-text text-xs font-semibold">Result:</label>
                    <div class="flex gap-3 mt-1">
                        <label class="label cursor-pointer">
                            <input type="checkbox" class="checkbox checkbox-xs checkbox-success personnel-xray" />
                            <span class="label-text ml-1 text-xs">X-ray</span>
                        </label>
                        <label class="label cursor-pointer">
                            <input type="checkbox" class="checkbox checkbox-xs checkbox-success personnel-stool" />
                            <span class="label-text ml-1 text-xs">Stool</span>
                        </label>
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(personnelRow);
    }
}

// Load data on page load
document.addEventListener('DOMContentLoaded', function() {
    loadSanitaryRecords();
    loadBurialRecords('cadaver');
    updateSanitaryStatistics();
    updateBurialStatistics();
    loadInspectionReports();
    InspSchedule.fetchAll();

    // Dynamic inspector column map (replaces hardcoded names)
    buildInspectorColumnMap().then(() => {
        populateInspectorReportHeaders();
        populateBurialInspectorDropdown();
    });

    // Migrate any localStorage accomplishment records to server
    migrateAccomplishmentToServer();

    // Setup form handlers
    document.getElementById('sanitary-form').addEventListener('submit', handleSanitarySubmit);
    document.getElementById('burial-form').addEventListener('submit', handleBurialSubmit);
    document.getElementById('inspection-form').onsubmit = handleInspectionSubmit;

    // Set welcome name in navbar
    const inspNameDisplay = document.getElementById('insp-username-display');
    if (inspNameDisplay) {
        const savedName = localStorage.getItem('inspectorDisplayName') ||
            localStorage.getItem('inspectorFullName') ||
            localStorage.getItem('username') || 'Inspector';
        inspNameDisplay.textContent = savedName;
    }
});

// ==================== MODULE NAVIGATION ====================

function showModule(moduleName) {
    // Hide all modules
    const modules = document.querySelectorAll('.module-content');
    modules.forEach(module => module.classList.add('hidden'));
    
    // Show selected module
    document.getElementById(`${moduleName}-module`).classList.remove('hidden');
    
    // Update active sidebar
    const sidebarItems = document.querySelectorAll('.sidebar-item');
    sidebarItems.forEach(item => item.classList.remove('active'));
    const activeItem = document.querySelector(`.sidebar-item[onclick="showModule('${moduleName}')"]`);
    if (activeItem) activeItem.classList.add('active');
    
    // Load data for the module
    if (moduleName === 'sanitary') {
        loadSanitaryRecords();
        updateSanitaryStatistics();
    } else if (moduleName === 'burial') {
        // Reset to cadaver tab when entering burial module
        showBurialTab('cadaver', document.querySelector('#burial-tabs [data-testid="tab-cadaver"]'));
        updateBurialStatistics();
    } else if (moduleName === 'accomplishment') {
        loadAccomplishmentRecords();
    } else if (moduleName === 'reports') {
        makeReportTableReadOnly();
        document.getElementById('accomplishment-report').classList.add('hidden');
        showReportTab('monthly', document.getElementById('tab-monthly'));
    } else if (moduleName === 'inspection') {
        loadSanitaryRecords();
        loadInspectionReports();
    } else if (moduleName === 'inspection-history') {
        loadIHEstablishments();
    } else if (moduleName === 'schedule') {
        InspSchedule.render();
    }
}

// ==================== INSPECTOR SCHEDULE VIEWER ====================
// Read-only calendar: inspectors can see their assigned schedules but cannot edit.

const InspSchedule = {
    calYear:  new Date().getFullYear(),
    calMonth: new Date().getMonth(),

    // Get all schedules (from API cache, fetched on init)
    getAll: () => {
        return cachedSchedules;
    },

    // Fetch schedules from API and cache
    fetchAll: async () => {
        try {
            const [schedResp, eventResp] = await Promise.all([
                fetch(`${API_BASE_URL}/inspection_schedules.php`),
                fetch(`${API_BASE_URL}/calendar_events.php`)
            ]);
            const schedJson = await schedResp.json();
            const eventJson = await eventResp.json();
            if (schedJson.success && Array.isArray(schedJson.data)) {
                cachedSchedules = schedJson.data;
            }
            if (eventJson.success && Array.isArray(eventJson.data)) {
                cachedEvents = eventJson.data;
            }
        } catch (e) {
            console.warn('Could not fetch schedules/events:', e);
        }
        return cachedSchedules;
    },

    // Returns ALL possible name variants this inspector might be stored under
    getMyNames: () => {
        const fullName = (localStorage.getItem('inspectorFullName') || '').toLowerCase().trim();
        const username = (localStorage.getItem('username') || '').toLowerCase().trim();
        // Also try first name only (e.g. "mel" from "Mel Segrou")
        const firstName = fullName.split(' ')[0];
        return [fullName, username, firstName].filter(n => n.length > 0);
    },

    render: () => {
        InspSchedule.renderCalendar();
    },

    renderCalendar: () => {
        const all    = InspSchedule.getAll();
        const events = cachedEvents || [];
        const myNames = InspSchedule.getMyNames();
        const year   = InspSchedule.calYear;
        const month  = InspSchedule.calMonth;
        const label  = document.getElementById('inspCalMonthLabel');
        const grid   = document.getElementById('inspCalendarGrid');
        if (!grid) return;

        label.textContent = new Date(year, month, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });

        const firstDay    = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today       = new Date(); today.setHours(0,0,0,0);

        const schedMap = {};
        all.forEach(s => {
            const inspLower = (s.inspector || '').toLowerCase();
            const isMe = myNames.some(n => n && (
                inspLower === n ||
                inspLower.startsWith(n) ||
                n.startsWith(inspLower)
            ));
            if (!isMe || !s.schedDate) return;
            if (!schedMap[s.schedDate]) schedMap[s.schedDate] = [];
            schedMap[s.schedDate].push(s);
        });

        const eventMap = {};
        events.forEach(e => {
            if (e.event_date) {
                if (!eventMap[e.event_date]) eventMap[e.event_date] = [];
                eventMap[e.event_date].push(e);
            }
        });

        const formatTime = (t) => {
            if (!t) return '';
            const [h, m] = t.split(':');
            const hr = parseInt(h);
            const ampm = hr >= 12 ? 'PM' : 'AM';
            const hr12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
            return `${hr12}:${m} ${ampm}`;
        };

        let html = '';

        for (let i = 0; i < firstDay; i++) {
            html += `<div class="schedule-cell-empty"></div>`;
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const mm       = String(month + 1).padStart(2, '0');
            const dd       = String(d).padStart(2, '0');
            const dateKey  = `${year}-${mm}-${dd}`;
            const cellDate = new Date(year, month, d); cellDate.setHours(0,0,0,0);
            const isToday  = cellDate.getTime() === today.getTime();
            const scheds   = schedMap[dateKey] || [];
            const dayEvents = eventMap[dateKey] || [];
            const hasScheds = scheds.length > 0;
            const hasItems  = hasScheds || dayEvents.length > 0;

            const cellClasses = ['schedule-cell'];
            if (isToday) cellClasses.push('is-today');
            if (hasScheds) cellClasses.push('has-schedule');

            let dotsHtml = '';
            if (dayEvents.length > 0) {
                dotsHtml += `<div style="margin-top:4px;">` +
                    dayEvents.slice(0, 2).map(ev => {
                        const tip = `${esc(ev.title)}${ev.start_time ? '\\n🕐 ' + formatTime(ev.start_time) + (ev.end_time ? ' - ' + formatTime(ev.end_time) : '') : ''}${ev.place ? '\\n📍 ' + esc(ev.place) : ''}${ev.notes ? '\\n📝 ' + esc(ev.notes) : ''}`;
                        return `<span class="cal-tooltip schedule-status-badge" style="background:#f59e0b;color:#fff;cursor:pointer;">Event<span class="cal-tooltip-text">${tip.replace(/\\n/g, '<br>')}</span></span>`;
                    }).join('') +
                    `</div>`;
            }
            if (hasScheds) {
                dotsHtml += `<div style="margin-top:4px;">` +
                    scheds.slice(0, 2).map(s => {
                        const badgeClass = s.done ? 'done' : 'scheduled';
                        const label = s.done ? 'Done' : 'Scheduled';
                        const tip = `${esc(s.inspector)}${s.establishment ? '\\n🏢 ' + esc(s.establishment) : ''}${s.riskLevel ? '\\n⚠️ Risk: ' + s.riskLevel : ''}${s.notes ? '\\n📝 ' + esc(s.notes) : ''}`;
                        return `<span class="cal-tooltip schedule-status-badge ${badgeClass}" style="cursor:pointer;">${label}<span class="cal-tooltip-text">${tip.replace(/\\n/g, '<br>')}</span></span>`;
                    }).join('') +
                    `</div>`;
            }

            html += `
            <div onclick="InspSchedule.showDay('${dateKey}')" data-date="${dateKey}" class="${cellClasses.join(' ')}" style="cursor:${hasItems ? 'pointer' : 'default'}">
                <div class="day-number">${d}</div>
                ${dotsHtml}
            </div>`;
        }

        grid.innerHTML = html;
    },

    showDay: (dateKey) => {
        const all    = InspSchedule.getAll();
        const myNames = InspSchedule.getMyNames();
        const scheds = all.filter(s => {
            const inspLower = (s.inspector || '').toLowerCase();
            return s.schedDate === dateKey && myNames.some(n => n && (
                inspLower === n ||
                inspLower.startsWith(n) ||
                n.startsWith(inspLower)
            ));
        });
        const dayEvents = (cachedEvents || []).filter(e => e.event_date === dateKey);

        const formatTime = (t) => {
            if (!t) return '';
            const [h, m] = t.split(':');
            const hr = parseInt(h);
            const ampm = hr >= 12 ? 'PM' : 'AM';
            const hr12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
            return `${hr12}:${m} ${ampm}`;
        };

        const panel = document.getElementById('inspCalDayPanel');
        const title = document.getElementById('inspCalDayTitle');
        const list  = document.getElementById('inspCalDayList');
        if (!panel) return;

        const dateFmt = new Date(dateKey + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        title.textContent = dateFmt;

        let html = '';

        // Show events first
        if (dayEvents.length > 0) {
            html += `<div style="margin-bottom:12px;"><div class="text-xs font-bold text-amber-700 uppercase tracking-wide mb-2">Events</div>`;
            html += dayEvents.map(ev => `
                <div class="schedule-task-item" style="border-color:#fde68a;background:#fffbeb;">
                    <div class="schedule-task-dot scheduled" style="background:#f59e0b;"></div>
                    <div style="flex:1;min-width:0;">
                        <div class="font-semibold text-sm text-amber-900">${esc(ev.title)}</div>
                        ${ev.start_time || ev.end_time ? `<div class="text-xs text-amber-700 mt-1">🕐 ${formatTime(ev.start_time)}${ev.end_time ? ' - ' + formatTime(ev.end_time) : ''}</div>` : ''}
                        ${ev.place ? `<div class="text-xs text-amber-700 mt-1">📍 ${esc(ev.place)}</div>` : ''}
                        ${ev.notes ? `<div class="text-xs text-gray-600 mt-1">${esc(ev.notes)}</div>` : ''}
                    </div>
                </div>
            `).join('') + `</div>`;
        }

        // Show schedules
        if (scheds.length === 0 && dayEvents.length === 0) {
            html += '<p class="text-center text-sm text-gray-400 py-3">You have no scheduled inspection or events on this day.</p>';
        } else if (scheds.length > 0) {
            html += `<div class="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">Inspections</div>`;
            html += scheds.map(s => {
                const today = new Date(); today.setHours(0,0,0,0);
                const due   = new Date(s.schedDate); due.setHours(0,0,0,0);
                const status = s.done ? 'Done' : (due < today ? 'Overdue' : 'Pending');
                const statusClass = status.toLowerCase();
                const riskBadgeClass = s.riskLevel === 'HIGH' ? 'risk-high' : s.riskLevel === 'MODERATE' ? 'risk-moderate' : 'risk-low';

                return `
                <div class="schedule-task-item">
                    <div class="schedule-task-dot ${statusClass}"></div>
                    <div style="flex:1;min-width:0;">
                        <div class="font-semibold text-sm text-gray-900">${esc(s.inspector)}</div>
                        ${s.rank ? `<div class="text-xs text-gray-500">${esc(s.rank)}</div>` : ''}
                        <div class="text-xs text-blue-600 mt-1">${esc(s.establishment) || 'No establishment set'}${s.riskLevel ? ` <span class="risk-badge ${riskBadgeClass}">${s.riskLevel}</span>` : ''}</div>
                        ${s.notes ? `<div class="text-xs text-gray-600 mt-1">${esc(s.notes)}</div>` : ''}
                    </div>
                    <span class="risk-badge risk-${statusClass}">${status}</span>
                </div>`;
            }).join('');
        }

        list.innerHTML = html;
        panel.style.display = 'block';
    },

    prevMonth: () => {
        InspSchedule.calMonth--;
        if (InspSchedule.calMonth < 0) { InspSchedule.calMonth = 11; InspSchedule.calYear--; }
        InspSchedule.renderCalendar();
    },

    nextMonth: () => {
        InspSchedule.calMonth++;
        if (InspSchedule.calMonth > 11) { InspSchedule.calMonth = 0; InspSchedule.calYear++; }
        InspSchedule.renderCalendar();
    },
};
// ==================== END INSPECTOR SCHEDULE VIEWER ====================

function autoDetectBarangay(typedName) {
    const suggestionsBox = document.getElementById('establishment-suggestions');
    const barangayRow = document.getElementById('barangay-detected-row');
    const barangayInput = document.getElementById('inspection-barangay');

    // Clear previous
    suggestionsBox.innerHTML = '';
    barangayRow.style.display = 'none';
    barangayInput.textContent = '';

    if (!typedName || typedName.trim().length < 2) return;

    const sanitaryRecords = cachedSanitaryRecords || [];
    const search = typedName.trim().toLowerCase();

    // Find matching establishments from sanitary records
    const matches = sanitaryRecords.filter(r =>
        r.businessName && r.businessName.toLowerCase().includes(search)
    );

    if (matches.length === 0) {
        suggestionsBox.innerHTML = `<div style="padding:8px 12px;font-size:13px;color:#9ca3af;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-top:4px;">No matching establishment found in Sanitary Records</div>`;
        return;
    }

    // Check for exact match first (auto-fill barangay silently)
    const exactMatch = sanitaryRecords.find(r =>
        r.businessName && r.businessName.toLowerCase() === search
    );
    if (exactMatch) {
        barangayInput.textContent = exactMatch.barangay || '';
        barangayRow.style.display = '';
        const exactCategory = (exactMatch.permitNo || '').split('-')[2] || '';
        loadViolationsByCategory(exactCategory);
        return;
    }

    // Show dropdown suggestions
    const uniqueMatches = [...new Map(matches.map(r => [r.businessName, r])).values()];
    suggestionsBox.innerHTML = `
        <div style="position:absolute;width:100%;background:#fff;border:1px solid #d1fae5;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);margin-top:4px;max-height:200px;overflow-y:auto;z-index:999;">
            ${uniqueMatches.map(r => `
                <div onclick="selectEstablishment('${esc(r.businessName).replace(/'/g, "\\'")}', '${esc(r.barangay||'').replace(/'/g, "\\'")}', '${esc((r.permitNo||'').split('-')[2]||'').replace(/'/g, "\\'")}' )"
                     style="padding:10px 14px;cursor:pointer;font-size:14px;border-bottom:1px solid #f0fdf4;"
                     onmouseover="this.style.background='#f0fdf4'" onmouseout="this.style.background='#fff'">
                    <span style="font-weight:600;color:#065f46;">${esc(r.businessName)}</span>
                    <span style="font-size:12px;color:#6b7280;margin-left:8px;">📍 ${esc(r.barangay) || 'No barangay on record'}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function selectEstablishment(businessName, barangay, category) {
    document.getElementById('inspection-establishment').value = businessName;
    document.getElementById('inspection-barangay').textContent = barangay;
    document.getElementById('establishment-suggestions').innerHTML = '';
    const barangayRow = document.getElementById('barangay-detected-row');
    barangayRow.style.display = barangay ? '' : 'none';
    loadViolationsByCategory(category || '');
}

// ==================== VIOLATION & RECOMMENDATION LISTS BY CATEGORY ====================

const VIOLATIONS_BY_CATEGORY = {
    'FR': [
        'No valid sanitary permit displayed',
        'Food handlers without health certificates',
        'Improper storage of food items (no cover, not elevated)',
        'Presence of pests (rodents, cockroaches, flies)',
        'Dirty food contact surfaces and utensils',
        'No handwashing facility with soap',
        'Improper labeling of food products',
        'Expired food items found on shelves',
        'Absence of food thermometer for temperature monitoring',
        'Improper waste segregation and disposal'
    ],
    'FS': [
        'No valid sanitary permit displayed',
        'Food handlers without health certificates',
        'Food prepared without proper hair restraints/protective clothing',
        'Raw and cooked foods stored together (cross-contamination)',
        'Improper dishwashing procedure (no 3-basin system)',
        'Presence of pests in food preparation area',
        'No potable water supply',
        'Inadequate ventilation in kitchen area',
        'Improper waste disposal and no covered trash bins',
        'Comfort rooms not clean or non-functional',
        'No soap and single-use towels at handwashing area',
        'Food stored directly on the floor'
    ],
    'FM': [
        'No valid sanitary permit displayed',
        'Workers without health certificates and pre-employment medical exams',
        'No HACCP or food safety plan in place',
        'Improper personal protective equipment (PPE) for food handlers',
        'Presence of physical, chemical or biological contaminants',
        'Equipment and machinery not regularly cleaned and sanitized',
        'Improper storage of raw materials and finished products',
        'Absence of pest control program',
        'No potable water supply or water quality test result',
        'Improper disposal of food manufacturing waste',
        'No separate areas for raw material handling and finished product packaging',
        'Product labeling does not comply with FDA requirements'
    ],
    'RFV': [
        'No valid sanitary permit displayed',
        'Vendor without health certificate',
        'Raw food displayed without proper covering or container',
        'No handwashing facility at the vending area',
        'Improper storage of raw food items (not chilled/frozen when required)',
        'Presence of flies and other pests at the vending area',
        'No potable water for washing produce',
        'Improper waste disposal',
        'Selling area not clean and sanitary',
        'Raw food in contact with contaminated surfaces'
    ],
    'SFV': [
        'No valid sanitary permit displayed',
        'Street food vendor without health certificate',
        'Food prepared and sold in unsanitary location',
        'No clean water supply for washing',
        'Food not covered and exposed to dust and flies',
        'Use of non-food grade containers or utensils',
        'Improper waste disposal at the vending site',
        'No handwashing facility',
        'Food handler not wearing proper attire (hairnet, apron)',
        'Reuse of single-use utensils'
    ],
    'WRS': [
        'No valid sanitary permit displayed',
        'Water refilling equipment not regularly cleaned and sanitized',
        'No water quality test result (bacteriological/physical/chemical)',
        'Water containers not properly washed and sanitized before refilling',
        'Absence of UV sterilizer or other disinfection system',
        'Workers without health certificates',
        'Cross-connection between potable and non-potable water lines',
        'No standard operating procedure (SOP) for water treatment posted',
        'Containers with visible dirt or damage accepted for refilling',
        'No record of equipment maintenance and water testing'
    ],
    'PPI': [
        'No valid sanitary permit displayed',
        'Comfort rooms not clean, non-functional, or insufficient',
        'No handwashing facilities with soap and water',
        'Improper waste management and disposal',
        'Poor ventilation and lighting',
        'Presence of pests',
        'No garbage receptacles in public areas',
        'Walls, floors, and ceilings in poor condition',
        'No health and sanitation officer on duty'
    ],
    'PPR': [
        'No valid sanitary permit displayed',
        'Swimming pool water not tested for chlorine/pH levels',
        'No pool safety signage or lifeguard present',
        'Comfort rooms and shower areas not clean',
        'Improper waste disposal in recreational areas',
        'No first aid kit available',
        'Presence of pests',
        'Drinking water supply not potable'
    ],
    'PPL': [
        'No valid sanitary permit displayed',
        'Bed linens and towels not regularly changed and sanitized',
        'Comfort rooms not clean or insufficient for number of guests',
        'No potable drinking water supply in rooms',
        'Presence of pests (bed bugs, cockroaches, rodents)',
        'Poor ventilation and lighting in rooms',
        'No garbage receptacles in rooms and common areas',
        'Improper waste disposal'
    ],
    'PPT': [
        'No valid sanitary permit displayed',
        'Barbers/beauticians without health certificates',
        'Reuse of disposable razors or blades',
        'Instruments not properly sterilized between customers',
        'No proper handwashing facility',
        'Towels and capes not properly laundered after each use',
        'No disinfectant solution for tools',
        'Waiting area not clean and sanitary'
    ],
    'IE': [
        'No valid sanitary permit displayed',
        'Workers without required health examinations',
        'Improper disposal of industrial waste and effluents',
        'No proper ventilation or exhaust system for hazardous fumes',
        'Absence of personal protective equipment (PPE) for workers',
        'No potable water supply in work areas',
        'Comfort rooms insufficient or not maintained',
        'No occupational health and safety officer',
        'Chemical storage does not comply with safety standards',
        'No first aid facilities on site'
    ],
    'IS': [
        'No valid sanitary permit displayed',
        'Service workers without health certificates',
        'No handwashing facility with soap',
        'Equipment and tools not properly cleaned and sanitized',
        'Improper waste disposal',
        'Poor ventilation and lighting in work area'
    ],
    'PPTD': [
        'No valid sanitary permit displayed',
        'Comfort rooms not clean or non-functional',
        'No handwashing facilities with soap',
        'Improper waste management in terminal area',
        'No potable drinking water for passengers',
        'Presence of pests',
        'Poor ventilation and lighting',
        'No garbage receptacles in passenger areas'
    ],
    'PPO': [
        'No valid sanitary permit displayed',
        'Comfort rooms not clean or insufficient',
        'No handwashing facilities',
        'Improper waste disposal',
        'Poor sanitation of premises',
        'Presence of pests'
    ],
    'NFC': [
        'No valid sanitary permit displayed',
        'No proper waste segregation and disposal',
        'Comfort rooms not clean or non-functional',
        'No handwashing facility with soap',
        'Poor housekeeping practices',
        'Presence of pests'
    ],
    'PDD': [
        'No valid sanitary permit displayed',
        'Improper handling or storage of cadavers',
        'No proper disinfection procedures for preparation area',
        'Workers without health certificates',
        'No proper waste disposal for biological waste',
        'Preparation area not maintained in clean and sanitary condition',
        'Absence of PPE for workers handling remains',
        'No potable water supply in preparation area'
    ]
};

const RECOMMENDATIONS_BY_CATEGORY = {
    'FR': [
        'Secure and prominently display a valid sanitary permit',
        'Require all food handlers to obtain and renew health certificates',
        'Ensure all food items are properly covered, labeled, and stored above floor level',
        'Implement a regular pest control program',
        'Clean and sanitize all food contact surfaces and utensils daily',
        'Install a proper handwashing station with soap and water',
        'Remove all expired products from shelves immediately',
        'Provide food thermometers and train staff on temperature monitoring',
        'Follow proper waste segregation and schedule regular disposal'
    ],
    'FS': [
        'Secure and display a valid sanitary permit',
        'Ensure all food handlers have current health certificates',
        'Require staff to wear hairnets and clean uniforms at all times',
        'Strictly separate raw and cooked food storage and preparation areas',
        'Implement proper 3-basin dishwashing system (wash, rinse, sanitize)',
        'Conduct regular pest control treatments',
        'Ensure continuous supply of potable water',
        'Improve kitchen ventilation to remove smoke and odors',
        'Provide covered trash bins and implement waste segregation',
        'Maintain clean and functional comfort rooms with adequate supplies',
        'Ensure soap, clean water, and single-use towels at all handwashing areas'
    ],
    'FM': [
        'Secure and display a valid sanitary permit',
        'Require all workers to complete pre-employment medical exams and obtain health certificates',
        'Develop and implement a HACCP-based food safety management plan',
        'Provide and enforce use of appropriate PPE for all food handlers',
        'Conduct regular microbiological and chemical testing of products',
        'Establish a scheduled cleaning and sanitizing program for all equipment',
        'Separate raw material and finished product storage areas',
        'Implement an integrated pest management program',
        'Ensure regular water quality testing and maintain records',
        'Comply with proper industrial waste disposal regulations',
        'Ensure all product labels meet FDA requirements'
    ],
    'RFV': [
        'Secure and display a valid sanitary permit',
        'Obtain and renew health certificate regularly',
        'Keep all raw food items covered and in food-grade containers',
        'Provide a portable handwashing station with soap and water',
        'Ensure proper cold chain storage for raw meats and seafood',
        'Install fly screens or covers to prevent pest contamination',
        'Provide potable water for washing raw produce',
        'Use designated waste bins and dispose regularly',
        'Clean and sanitize selling area daily'
    ],
    'SFV': [
        'Secure and display a valid sanitary permit',
        'Obtain a health certificate and renew annually',
        'Relocate vending to a cleaner, approved location',
        'Provide or access a nearby clean water supply for washing',
        'Keep all food covered and protected from dust and pests',
        'Use only food-grade containers and utensils',
        'Provide a waste bin and dispose of garbage properly after each vending session',
        'Maintain proper hand hygiene and wear clean protective clothing'
    ],
    'WRS': [
        'Secure and display a valid sanitary permit',
        'Conduct regular bacteriological, physical, and chemical water testing and post results',
        'Clean and sanitize all filling equipment, tanks, and dispensers on schedule',
        'Inspect and sanitize containers before refilling; refuse damaged or dirty containers',
        'Ensure UV sterilization or equivalent disinfection system is functioning',
        'Require all workers to have health certificates',
        'Post and follow standard operating procedures for water treatment',
        'Maintain a logbook of maintenance activities and test results'
    ],
    'PPI': [
        'Secure and display a valid sanitary permit',
        'Clean and maintain all comfort rooms; repair non-functional fixtures',
        'Install and maintain handwashing facilities with soap in all restrooms',
        'Implement a waste management plan with proper segregation and disposal',
        'Improve ventilation and lighting in all areas',
        'Conduct regular pest control',
        'Provide adequate garbage receptacles throughout the premises',
        'Repair damaged walls, floors, and ceilings'
    ],
    'PPR': [
        'Secure and display a valid sanitary permit',
        'Conduct regular pool water testing and maintain proper chlorine/pH levels',
        'Post pool safety rules and assign a trained lifeguard',
        'Clean and sanitize comfort rooms and shower areas daily',
        'Implement proper waste disposal in all recreational areas',
        'Maintain a complete first aid kit and post emergency procedures',
        'Conduct regular pest control',
        'Ensure potable drinking water is available for guests'
    ],
    'PPL': [
        'Secure and display a valid sanitary permit',
        'Change and launder all bed linens and towels after every guest',
        'Clean and sanitize comfort rooms daily',
        'Provide potable drinking water in all rooms',
        'Conduct regular pest control (bed bugs, cockroaches, rodents)',
        'Improve room ventilation and lighting',
        'Provide trash bins in all rooms and common areas and dispose regularly'
    ],
    'PPT': [
        'Secure and display a valid sanitary permit',
        'Require all barbers/beauticians to have health certificates',
        'Use only disposable razors and blades; discard after each customer',
        'Sterilize all instruments (scissors, combs, clippers) between customers using autoclaving or chemical disinfection',
        'Install and maintain a handwashing station with soap',
        'Launder all towels, capes, and linens after each use',
        'Maintain a container with disinfectant solution for soaking tools'
    ],
    'IE': [
        'Secure and display a valid sanitary permit',
        'Require all workers to undergo occupational health examinations',
        'Comply with DENR and LGU requirements for industrial waste disposal',
        'Install and maintain adequate ventilation or exhaust systems',
        'Provide appropriate PPE to all workers and enforce its use',
        'Ensure continuous supply of potable water in work areas',
        'Build and maintain sufficient comfort rooms relative to workforce size',
        'Designate and train an occupational health and safety officer',
        'Comply with chemical storage safety standards (MSDS, proper labeling)',
        'Maintain a fully equipped first aid station'
    ],
    'IS': [
        'Secure and display a valid sanitary permit',
        'Require all service workers to obtain health certificates',
        'Provide proper handwashing facilities with soap',
        'Clean and sanitize all equipment and tools after each use',
        'Follow proper waste disposal procedures',
        'Improve ventilation and lighting in work area'
    ],
    'PPTD': [
        'Secure and display a valid sanitary permit',
        'Clean and maintain all comfort rooms; repair non-functional fixtures',
        'Install handwashing facilities with soap throughout the terminal',
        'Implement proper waste management with regular collection',
        'Provide potable drinking water stations for passengers',
        'Conduct regular pest control',
        'Improve ventilation and lighting',
        'Provide sufficient garbage receptacles in passenger areas'
    ],
    'PPO': [
        'Secure and display a valid sanitary permit',
        'Clean and maintain comfort rooms',
        'Install and maintain handwashing facilities',
        'Implement proper waste segregation and disposal',
        'Maintain overall cleanliness of the premises',
        'Conduct regular pest control'
    ],
    'NFC': [
        'Secure and display a valid sanitary permit',
        'Implement and follow waste segregation and disposal procedures',
        'Clean and maintain comfort rooms',
        'Provide handwashing facility with soap',
        'Maintain good housekeeping practices daily',
        'Conduct regular pest control'
    ],
    'PDD': [
        'Secure and display a valid sanitary permit',
        'Follow proper protocols for the handling and storage of cadavers per PD 856',
        'Disinfect and sanitize preparation area after each use',
        'Require all workers to have health certificates and regular medical exams',
        'Dispose of all biological waste in sealed, labeled biohazard bags',
        'Maintain preparation area in clean and sanitary condition at all times',
        'Provide and enforce use of full PPE (gloves, gown, mask, face shield)',
        'Ensure continuous supply of potable water and disinfectants in the area'
    ]
};

function loadViolationsByCategory(category) {
    const violPlaceholder = document.getElementById('violation-placeholder');
    const recPlaceholder = document.getElementById('recommendation-placeholder');
    const violList = document.getElementById('violation-radio-list');
    const recList = document.getElementById('recommendation-radio-list');

    // Reset
    if (violList) violList.innerHTML = '';
    if (recList) recList.innerHTML = '';

    if (!category || (!VIOLATIONS_BY_CATEGORY[category] && !RECOMMENDATIONS_BY_CATEGORY[category])) {
        if (violPlaceholder) { violPlaceholder.classList.remove('hidden'); violPlaceholder.textContent = 'No common violations for this type. Type manually below.'; }
        if (recPlaceholder) { recPlaceholder.classList.remove('hidden'); recPlaceholder.textContent = 'No common recommendations for this type. Type manually below.'; }
        if (violList) violList.classList.add('hidden');
        if (recList) recList.classList.add('hidden');
        return;
    }

    const violations = VIOLATIONS_BY_CATEGORY[category] || [];
    const recommendations = RECOMMENDATIONS_BY_CATEGORY[category] || [];

    // Build violation checklist
    if (violPlaceholder) violPlaceholder.classList.add('hidden');
    if (violList) {
        violList.classList.remove('hidden');
        violList.innerHTML = violations.map((v, i) =>
            `<label class="flex items-start gap-2 cursor-pointer text-sm py-1">
                <input type="checkbox" class="checkbox checkbox-success checkbox-sm mt-0.5 violation-check" value="${v.replace(/"/g, '&quot;')}">
                <span>${v}</span>
            </label>`
        ).join('');
    }

    // Build recommendation checklist
    if (recPlaceholder) recPlaceholder.classList.add('hidden');
    if (recList) {
        recList.classList.remove('hidden');
        recList.innerHTML = recommendations.map((r, i) =>
            `<label class="flex items-start gap-2 cursor-pointer text-sm py-1">
                <input type="checkbox" class="checkbox checkbox-success checkbox-sm mt-0.5 recommendation-check" value="${r.replace(/"/g, '&quot;')}">
                <span>${r}</span>
            </label>`
        ).join('');
    }
}

function addViolationFromDropdown(selectEl) {
    const value = selectEl.value;
    if (!value) return;
    const container = document.getElementById('selected-violations');
    // Prevent duplicates
    const existing = [...container.querySelectorAll('[data-value]')].map(el => el.dataset.value);
    if (existing.includes(value)) { selectEl.value = ''; return; }
    const tag = document.createElement('span');
    tag.dataset.value = value;
    tag.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;border-radius:6px;padding:3px 8px;font-size:12px;';
    tag.innerHTML = `${value} <button type="button" onclick="removeViolationTag(this)" style="background:none;border:none;cursor:pointer;color:#065f46;font-size:14px;line-height:1;">&times;</button>`;
    container.appendChild(tag);
    selectEl.value = '';
}

function removeViolationTag(btn) {
    btn.parentElement.remove();
}

function addViolationTag(selectEl, containerId) {
    const value = selectEl.value;
    if (!value) return;
    const container = document.getElementById(containerId);
    if (!container) return;
    // Prevent duplicates
    const existing = [...container.querySelectorAll('[data-value]')].map(el => el.dataset.value);
    if (existing.includes(value)) { selectEl.value = ''; return; }
    const tag = document.createElement('span');
    tag.dataset.value = value;
    tag.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;border-radius:20px;padding:4px 10px;font-size:12px;max-width:100%;';
    tag.innerHTML = `<span style="flex:1;">${value}</span><button type="button" onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:#065f46;font-weight:bold;font-size:14px;line-height:1;padding:0;">&times;</button>`;
    container.appendChild(tag);
    selectEl.value = '';
}

function getCollectedRemarks() {
    const checked = [...document.querySelectorAll('.violation-check:checked')].map(cb => cb.value);
    const manual = document.getElementById('inspection-remarks').value.trim();
    return [...checked, ...(manual ? [manual] : [])].join('; ');
}

function getCollectedViolationCodes() {
    const checked = [...document.querySelectorAll('.violation-check:checked')].map(cb => cb.value.toLowerCase());
    const codeKeywords = {
        'PERMIT': ['sanitary permit', 'no permit', 'permit'],
        'CERT': ['health certificate', 'medical certificate', 'certificate'],
        'FOOD': ['food handling', 'food handler', 'cross-contamination', 'food storage', 'food prepared', 'food stored', 'food contact', 'food thermometer', 'dishwashing'],
        'PEST': ['pest', 'rodent', 'cockroach', 'flies', 'infestation'],
        'HYGIENE': ['hair restraint', 'protective clothing', 'ppe', 'handwashing', 'soap', 'towels', 'personal'],
        'WASTE': ['waste', 'garbage', 'trash', 'disposal', 'segregation'],
        'WATER': ['water supply', 'potable water', 'water quality'],
        'DRAIN': ['drainage', 'sewage', 'comfort room', 'ventilation'],
        'STRUCT': ['structural', 'crack', 'leak', 'repair', 'elevated', 'cover'],
        'EXPIRED': ['expired', 'stale'],
        'CONTAM': ['contaminant', 'contamination', 'clean', 'sanitiz'],
        'OTHER': []
    };
    const codes = new Set();
    for (const text of checked) {
        let matched = false;
        for (const [code, keywords] of Object.entries(codeKeywords)) {
            if (keywords.some(kw => text.includes(kw))) {
                codes.add(code);
                matched = true;
                break;
            }
        }
        if (!matched && text.length > 5) codes.add('OTHER');
    }
    return [...codes];
}

function getCollectedRecommendations() {
    const checked = [...document.querySelectorAll('.recommendation-check:checked')].map(cb => cb.value);
    const manual = document.getElementById('inspection-recommendation').value.trim();
    return [...checked, ...(manual ? [manual] : [])].join('; ');
}

function showBurialTab(type, tabEl) {
    // Hide all burial sections
    document.querySelectorAll('.burial-section').forEach(section => {
        section.classList.add('hidden');
    });
    
    // Show selected section
    document.getElementById(`${type}-section`).classList.remove('hidden');
    
    // Update active tab — scope to burial-tabs only to avoid affecting other tabs
    const burialTabs = document.querySelectorAll('#burial-tabs .tab');
    burialTabs.forEach(tab => tab.classList.remove('tab-active'));
    if (tabEl && tabEl.classList) {
        tabEl.classList.add('tab-active');
    } else {
        // Fallback: find the matching tab by data-testid
        const match = document.querySelector(`#burial-tabs [data-testid="tab-${type}"]`);
        if (match) match.classList.add('tab-active');
    }
    
    // Load data
    loadBurialRecords(type);
}

// ==================== REPORTS MODULE ====================

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

const QUARTER_MONTHS = { 1: [1,2,3], 2: [4,5,6], 3: [7,8,9], 4: [10,11,12] };
// ==================== ACCOMPLISHMENT MODULE ====================

// Dynamic inspector column map — built from database via inspector_accounts API
let INSPECTOR_COL_MAP = {};
let _inspectorNamesList = []; // First 5 inspector full_names, ordered by id

async function buildInspectorColumnMap() {
    try {
        const resp = await fetch(`${API_BASE_URL}/inspector.php`);
        const json = await resp.json();
        if (json.success && Array.isArray(json.data)) {
            const inspectors = json.data.slice(0, 5); // Max 5 columns
            _inspectorNamesList = inspectors.map(i => i.fullName);
            INSPECTOR_COL_MAP = {};
            inspectors.forEach((insp, idx) => {
                // Only map full name — first name aliases would cause double-counting in report totals
                INSPECTOR_COL_MAP[insp.fullName] = idx;
            });
        }
    } catch (e) {
        console.warn('Failed to build inspector column map:', e);
    }
}

// Accomplishment records — now stored in database via API
async function getAllAccomplishmentRecords() {
    try {
        const resp = await fetch(`${API_BASE_URL}/accomplishment.php`);
        const json = await resp.json();
        return json.success ? (json.data || []) : [];
    } catch (e) {
        console.warn('Failed to fetch accomplishment records:', e);
        return [];
    }
}

// Legacy migration: import any localStorage records to server on first load
async function migrateAccomplishmentToServer() {
    const raw = localStorage.getItem('accomplishmentRecords');
    if (!raw) return;
    try {
        const localRecords = JSON.parse(raw);
        if (!Array.isArray(localRecords) || localRecords.length === 0) {
            localStorage.removeItem('accomplishmentRecords');
            return;
        }
        for (const rec of localRecords) {
            await fetch(`${API_BASE_URL}/accomplishment.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inspector: rec.inspector,
                    month: rec.month,
                    year: rec.year,
                    fields: rec.fields
                })
            });
        }
        localStorage.removeItem('accomplishmentRecords');

    } catch (e) {
        console.warn('Accomplishment migration failed:', e);
    }
}

// Populate inspector report headers and signatures dynamically from database
function populateInspectorReportHeaders() {
    if (!_inspectorNamesList || _inspectorNamesList.length === 0) return;

    // Update table headers
    const headers = document.querySelectorAll('.inspector-col-header');
    headers.forEach((th, i) => {
        if (i < _inspectorNamesList.length) {
            // Show first name (or abbreviated name) as header
            const fullName = _inspectorNamesList[i];
            const firstName = fullName.split(' ')[0];
            th.textContent = firstName.toUpperCase();
        }
    });

    // Update "Submitted By" signatures
    const sigContainer = document.getElementById('inspector-signatures');
    if (sigContainer) {
        sigContainer.innerHTML = _inspectorNamesList.map(name =>
            `<td class="text-center px-2 pb-1">
                <div style="border-bottom: 1px solid black; margin-bottom:4px; padding-bottom: 20px;"></div>
                <p class="font-semibold">${esc(name)}</p>
                <p style="font-size:11px;color:#6b7280;">Sanitary Inspector</p>
            </td>`
        ).join('');
    }
}

// Populate burial modal inspector dropdown from database
function populateBurialInspectorDropdown() {
    const container = document.getElementById('burial-inspector-options');
    if (!container || !_inspectorNamesList || _inspectorNamesList.length === 0) return;

    let html = `<div class="custom-option" onclick="selectInspector('', 'Select Inspector', '')">
        <span class="option-name">Select Inspector</span>
    </div>`;

    _inspectorNamesList.forEach(name => {
        const safeName = name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        html += `<div class="custom-option" onclick="selectInspector('${safeName}', '${safeName}', 'Sanitary Inspector')">
            <span class="option-name">${esc(name)}</span>
            <span class="option-rank">Sanitary Inspector</span>
        </div>`;
    });

    container.innerHTML = html;
}

async function openAccomplishmentModal(recordId = null) {
    const modal = document.getElementById('accomplishment-modal');
    const title = document.getElementById('accomplishment-modal-title');
    const form  = document.getElementById('accomplishment-form');
    form.reset();
    document.getElementById('acc-record-id').value = '';

    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-based
    const currentYear  = now.getFullYear();

    if (recordId) {
        title.textContent = 'Edit Accomplishment Record';
        const records = await getAllAccomplishmentRecords();
        const rec = records.find(r => String(r.id) === String(recordId));
        if (rec) {
            document.getElementById('acc-record-id').value = rec.id;
            document.getElementById('acc-inspector').value = rec.inspector;
            // Fill hidden month value and display name
            document.getElementById('acc-month').value = rec.month;
            document.getElementById('acc-month-display').value = rec.month;
            document.getElementById('acc-year').value = rec.year;
            for (let i = 1; i <= 24; i++) {
                const el = document.getElementById(`acc-f${i}`);
                if (el) el.value = rec.fields[i-1] || 0;
            }
        }
    } else {
        title.textContent = 'Add Accomplishment Record';
        // Auto-fill current month and year
        document.getElementById('acc-month').value = currentMonth;
        document.getElementById('acc-month-display').value = currentMonth;
        document.getElementById('acc-year').value = currentYear;
        for (let i = 1; i <= 24; i++) {
            const el = document.getElementById(`acc-f${i}`);
            if (el) el.value = 0;
        }
    }

    // Always auto-fill inspector from logged-in user (both add and edit)
    const loggedName = localStorage.getItem('inspectorFullName') || localStorage.getItem('username') || '';
    const inspHidden  = document.getElementById('acc-inspector');
    const inspDisplay = document.getElementById('acc-inspector-display');
    if (inspHidden)  inspHidden.value  = loggedName;
    if (inspDisplay) inspDisplay.value = loggedName;

    modal.showModal();
}

function closeAccomplishmentModal() {
    document.getElementById('accomplishment-modal').close();
}

document.addEventListener('DOMContentLoaded', function() {
    const accForm = document.getElementById('accomplishment-form');
    if (accForm) {
        accForm.addEventListener('submit', function(e) {
            e.preventDefault();
            saveAccomplishmentRecord();
        });
    }
    makeReportTableReadOnly();
});

async function saveAccomplishmentRecord() {
    const inspector = localStorage.getItem('inspectorFullName') || localStorage.getItem('username') || document.getElementById('acc-inspector').value;
    const month     = document.getElementById('acc-month').value;
    const year      = document.getElementById('acc-year').value;

    if (!inspector || !month || !year) {
        showNotification('Could not determine inspector. Please re-login.', 'error');
        return;
    }

    const fields = [];
    for (let i = 1; i <= 24; i++) {
        const el = document.getElementById(`acc-f${i}`);
        fields.push(el ? (parseFloat(el.value) || 0) : 0);
    }

    const existingId = document.getElementById('acc-record-id').value;

    try {
        if (existingId) {
            // Update existing record
            const resp = await fetch(`${API_BASE_URL}/accomplishment.php`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: parseInt(existingId), fields })
            });
            const result = await resp.json();
            if (!result.success) throw new Error(result.message);
            showNotification(`✅ Record updated for ${inspector} — ${MONTH_NAMES[parseInt(month)]} ${year}`, 'success');
        } else {
            // Create or upsert (server handles ON DUPLICATE KEY UPDATE)
            const resp = await fetch(`${API_BASE_URL}/accomplishment.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inspector, month: parseInt(month), year: parseInt(year), fields })
            });
            const result = await resp.json();
            if (!result.success) throw new Error(result.message);
            showNotification(`✅ Record saved for ${inspector} — ${MONTH_NAMES[parseInt(month)]} ${year}`, 'success');
        }
    } catch (e) {
        showNotification('Error saving record: ' + e.message, 'error');
        return;
    }

    closeAccomplishmentModal();
    localStorage.removeItem(FormDrafts.KEYS.accomplishment);
    loadAccomplishmentRecords();
}

async function deleteAccomplishmentRecord(recordId) {
    if (!confirm('Delete this accomplishment record?')) return;
    try {
        const resp = await fetch(`${API_BASE_URL}/accomplishment.php?id=${recordId}`, { method: 'DELETE' });
        const result = await resp.json();
        if (!result.success) throw new Error(result.message);
        loadAccomplishmentRecords();
        showNotification('Record deleted.', 'success');
    } catch (e) {
        showNotification('Error deleting record: ' + e.message, 'error');
    }
}

async function loadAccomplishmentRecords() {
    const tbody = document.getElementById('accomplishment-table-body');
    if (!tbody) return;

    // Always lock to the logged-in inspector
    const loggedName = localStorage.getItem('inspectorFullName') || localStorage.getItem('username') || '';

    // Sync filter display label and hidden value
    const filterDisplay = document.getElementById('acc-filter-inspector-display');
    const filterHidden  = document.getElementById('acc-filter-inspector');
    if (filterDisplay) filterDisplay.textContent = loggedName || 'Unknown';
    if (filterHidden)  filterHidden.value = loggedName;

    let records = await getAllAccomplishmentRecords();

    // Always filter to logged-in inspector only
    if (loggedName) records = records.filter(r => r.inspector === loggedName);

    // Apply month/year filters
    const filterMonth = document.getElementById('acc-filter-month')?.value || '';
    const filterYear  = document.getElementById('acc-filter-year')?.value || '';
    if (filterMonth) records = records.filter(r => r.month === parseInt(filterMonth));
    if (filterYear)  records = records.filter(r => r.year === parseInt(filterYear));

    if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-gray-400">No accomplishment records found</td></tr>`;
        return;
    }

    // Sort by year desc, month desc, inspector
    records.sort((a, b) => b.year - a.year || b.month - a.month || a.inspector.localeCompare(b.inspector));

    tbody.innerHTML = records.map(r => `
        <tr>
            <td class="font-semibold text-emerald-700">${esc(r.inspector)}</td>
            <td>${MONTH_NAMES[r.month]}</td>
            <td>${r.year}</td>
            <td>${r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</td>
            <td class="text-center">
                <button class="btn btn-xs btn-info text-white mr-1" onclick="openAccomplishmentModal('${r.id}')">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-xs btn-error text-white" onclick="deleteAccomplishmentRecord('${r.id}')">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// ==================== REPORTS MODULE (Read-only, from Accomplishment) ====================

function makeReportTableReadOnly() {
    document.querySelectorAll('#accomplishment-report .report-input').forEach(inp => {
        inp.readOnly = true;
        inp.style.backgroundColor = '#f9fafb';
        inp.style.cursor = 'default';
        inp.style.border = 'none';
        inp.style.textAlign = 'center';
    });
}

function clearReportInputs() {
    document.querySelectorAll('#accomplishment-report .report-input')
        .forEach(inp => inp.value = '');
}

// Maps inspector name to their column index in the report table
// In the report table, each row has inputs grouped by inspector column (Mel=0, Michael=1, Olive=2, Wendy=3, Zaldy=4)
// For rows with colspan=2 (rows 1-8, total): each inspector takes 1 input
// For rows with M/F (rows 9,10): each inspector takes 2 inputs
// Field mapping (acc-f1 to acc-f24) to report-input index per inspector:
// The report-inputs array (all inputs in order):
// Rows 1–8 (8 rows × 5 inspectors × 1 + total=1 per row): inputs 0–47 (6 per row × 8 rows)
// But rows 3,7,8 header rows have NO inputs — only child rows have inputs
// Let me map by inspector index (0=Mel) and field index (1–24):

function buildInspectorFieldMap(inspectorIdx) {
    // Returns an array of report-input indices for this inspector
    // Based on the actual report-input array order in the DOM
    // Rows with colspan-2 (1 input per inspector per row): rows 1,2,2b,2c,3.1,3.2,4,5,6,7.1,7.2,7.3,8.1,8.2 = 14 rows
    // Each of these rows: [Mel, Michael, Olive, Wendy, Zaldy, TOTAL] = 6 inputs
    // Row index in the DOM: row_n * 6 + inspectorIdx
    // Rows with M+F (2 inputs per inspector per row): 9.1,9.2,10.1,10.2,10.3 = 5 rows
    // Each of these rows: [MelM, MelF, MichaelM, MichaelF, ..., ZaldyF, (no total)] = 11 inputs
    // These come AFTER the 14 simple rows: offset = 14 * 6 = 84
    // Row index: 84 + row_n * 11 + inspectorIdx*2 (for M), +inspectorIdx*2+1 (for F)

    const simpleRows = 14; // rows with 1 input per inspector
    const mfRows = 5;      // rows with 2 inputs (M+F) per inspector

    const indices = [];

    // Fields 1–14 → simple rows (1 input per inspector per row)
    for (let r = 0; r < simpleRows; r++) {
        indices.push(r * 6 + inspectorIdx); // 6 inputs per row (5 inspectors + total)
    }

    // Fields 15–24 → M/F rows (2 inputs per inspector per row: M then F)
    for (let r = 0; r < mfRows; r++) {
        const rowOffset = simpleRows * 6 + r * 11; // 11 inputs per row (5×2 + 1 total not included actually)
        indices.push(rowOffset + inspectorIdx * 2);     // M
        indices.push(rowOffset + inspectorIdx * 2 + 1); // F
    }

    return indices; // length = 14 + 10 = 24 indices
}

async function getAccomplishmentDataForPeriod(months, year) {
    // Returns totals array (length = total report-inputs count) from saved accomplishment records
    const records = await getAllAccomplishmentRecords();
    const totalInputs = document.querySelectorAll('#accomplishment-report .report-input').length;
    const totals = new Array(totalInputs).fill(0);

    months.forEach(month => {
        Object.entries(INSPECTOR_COL_MAP).forEach(([inspectorName, colIdx]) => {
            const rec = records.find(r =>
                r.inspector === inspectorName &&
                r.month === month &&
                r.year === parseInt(year)
            );
            if (!rec) return;

            const fieldIndices = buildInspectorFieldMap(colIdx);
            rec.fields.forEach((val, fi) => {
                if (fieldIndices[fi] !== undefined) {
                    totals[fieldIndices[fi]] += (val || 0);
                }
            });
        });
    });

    // Calculate per-row totals (last input in each row)
    // Simple rows: totals[row*6+5] = sum of col 0..4
    for (let r = 0; r < 14; r++) {
        let sum = 0;
        for (let c = 0; c < 5; c++) sum += totals[r * 6 + c];
        totals[r * 6 + 5] = sum;
    }

    return totals;
}

async function loadReportFromAccomplishment() {
    const monthVal = document.getElementById('report-month').value;
    const year     = document.getElementById('report-year').value;
    if (!monthVal || !year) {
        showNotification('Please select a Month and Year.', 'error');
        return;
    }

    const totals = await getAccomplishmentDataForPeriod([parseInt(monthVal)], year);
    const hasData = totals.some(v => v > 0);

    if (!hasData) {
        showNotification(`No accomplishment data found for ${MONTH_NAMES[parseInt(monthVal)]} ${year}. Add records in the Accomplishment module first.`, 'error');
        clearReportInputs();
        document.getElementById('accomplishment-report').classList.add('hidden');
        return;
    }

    setReportValuesFromArray(totals);

    const display = document.getElementById('report-period-display');
    if (display) display.textContent = `${MONTH_NAMES[parseInt(monthVal)].toUpperCase()} ${year}`;
    const labelEl = document.getElementById('report-type-label');
    if (labelEl) labelEl.textContent = 'ACCOMPLISHMENT REPORT FOR THE MONTH OF';

    document.getElementById('accomplishment-report').classList.remove('hidden');
    showNotification(`✅ Report loaded for ${MONTH_NAMES[parseInt(monthVal)]} ${year}`, 'success');
}

async function loadQuarterlyReportFromAccomplishment() {
    const fromMonth = parseInt(document.getElementById('report-quarter-from').value);
    const toMonth   = parseInt(document.getElementById('report-quarter-to').value);
    const year      = document.getElementById('report-quarter-year').value;

    if (!year) {
        showNotification('Please enter a Year.', 'error');
        return;
    }

    if (fromMonth > toMonth) {
        showNotification('The "From Month" must be before or equal to the "To Month".', 'error');
        return;
    }

    // Build array of all months in the selected range
    const months = [];
    for (let m = fromMonth; m <= toMonth; m++) months.push(m);

    const totals = await getAccomplishmentDataForPeriod(months, year);
    const hasData = totals.some(v => v > 0);

    if (!hasData) {
        showNotification(`No accomplishment data found for ${MONTH_NAMES[fromMonth]} – ${MONTH_NAMES[toMonth]} ${year}.`, 'error');
        clearReportInputs();
        document.getElementById('accomplishment-report').classList.add('hidden');
        return;
    }

    setReportValuesFromArray(totals);

    const rangeLabel = fromMonth === toMonth
        ? MONTH_NAMES[fromMonth]
        : `${MONTH_NAMES[fromMonth]} – ${MONTH_NAMES[toMonth]}`;

    const display = document.getElementById('report-period-display');
    if (display) display.textContent = `${rangeLabel} ${year}`;
    const labelEl = document.getElementById('report-type-label');
    if (labelEl) labelEl.textContent = 'QUARTERLY ACCOMPLISHMENT REPORT —';

    document.getElementById('accomplishment-report').classList.remove('hidden');
    showNotification(`✅ Report loaded for ${rangeLabel} ${year}`, 'success');
}

function selectAllAnnualMonths() {
    document.querySelectorAll('.annual-month-check').forEach(cb => cb.checked = true);
}

function clearAllAnnualMonths() {
    document.querySelectorAll('.annual-month-check').forEach(cb => cb.checked = false);
}

async function loadAnnualReportFromAccomplishment() {
    const year = document.getElementById('report-annual-year').value;
    if (!year) {
        showNotification('Please enter a Year.', 'error');
        return;
    }

    // Collect only the checked months
    const checkedMonths = [...document.querySelectorAll('.annual-month-check:checked')]
        .map(cb => parseInt(cb.value))
        .sort((a, b) => a - b);

    if (checkedMonths.length === 0) {
        showNotification('Please select at least one month.', 'error');
        return;
    }

    const totals = await getAccomplishmentDataForPeriod(checkedMonths, year);
    const hasData = totals.some(v => v > 0);

    if (!hasData) {
        showNotification(`No accomplishment data found for the selected months in ${year}.`, 'error');
        clearReportInputs();
        document.getElementById('accomplishment-report').classList.add('hidden');
        return;
    }

    setReportValuesFromArray(totals);

    // Build a readable label from selected months
    const monthLabel = checkedMonths.length === 12
        ? `YEAR ${year}`
        : checkedMonths.map(m => MONTH_NAMES[m]).join(', ') + ` ${year}`;

    const display = document.getElementById('report-period-display');
    if (display) display.textContent = monthLabel;
    const labelEl = document.getElementById('report-type-label');
    if (labelEl) labelEl.textContent = 'ANNUAL ACCOMPLISHMENT REPORT —';

    document.getElementById('accomplishment-report').classList.remove('hidden');
    showNotification(`✅ Annual report loaded for selected months in ${year}`, 'success');
}

function setReportValuesFromArray(values) {
    const inputs = [...document.querySelectorAll('#accomplishment-report .report-input')];
    inputs.forEach((inp, i) => {
        inp.value = (values[i] && values[i] > 0) ? values[i] : '';
    });
}

function showReportTab(type, tabEl) {
    // Update active tab highlight
    document.querySelectorAll('#reports-module .tab').forEach(tab => {
        tab.classList.remove('tab-active');
    });
    if (tabEl) tabEl.classList.add('tab-active');

    // Show/hide the correct controls panel
    ['monthly', 'quarterly', 'annual'].forEach(t => {
        document.getElementById(`${t}-controls`).classList.add('hidden');
    });
    document.getElementById(`${type}-controls`).classList.remove('hidden');

    // Update printed report type label
    const labels = {
        monthly:   'ACCOMPLISHMENT REPORT FOR THE MONTH OF',
        quarterly: 'QUARTERLY ACCOMPLISHMENT REPORT —',
        annual:    'ANNUAL ACCOMPLISHMENT REPORT —'
    };
    const labelEl = document.getElementById('report-type-label');
    if (labelEl) labelEl.textContent = labels[type];

    // Reset table and period display, and HIDE the report template
    clearReportInputs();
    const display = document.getElementById('report-period-display');
    if (display) display.textContent = '_________________________________';
    document.getElementById('accomplishment-report').classList.add('hidden');
}

function updateReportPeriod() {
    const monthVal = document.getElementById('report-month').value;
    const year     = document.getElementById('report-year').value;
    const display  = document.getElementById('report-period-display');
    if (!display) return;
    const monthName = monthVal ? MONTH_NAMES[parseInt(monthVal)] : '';
    if (monthName && year)  display.textContent = `${monthName.toUpperCase()} ${year}`;
    else if (monthName)     display.textContent = monthName.toUpperCase();
    else if (year)          display.textContent = year;
    else                    display.textContent = '_________________________________';
}


// ==================== LOGOUT ====================

function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        FormDrafts.saveAll();
        const draftKeys = Object.values(FormDrafts.KEYS);
        const savedDrafts = {};
        draftKeys.forEach(k => { const v = localStorage.getItem(k); if (v) savedDrafts[k] = v; });
        fetch(`${API_BASE_URL}/auth.php`, {
            method: 'DELETE',
            credentials: 'include'
        }).finally(() => {
            localStorage.clear();
            Object.entries(savedDrafts).forEach(([k, v]) => localStorage.setItem(k, v));
            window.location.href = 'index.html';
        });
    }
}

// ============================================================
// Idle Auto-Logout (30 minutes)
// Tracks user activity and shows a 60-second warning modal
// before automatically logging the user out.
// ============================================================
(function() {
    const IDLE_TIMEOUT = 30 * 60 * 1000;   // 30 minutes
    const WARNING_DURATION = 60;            // 60 seconds countdown
    const CHECK_INTERVAL = 30 * 1000;       // check every 30 seconds

    let lastActivityTime = Date.now();
    let warningShown = false;
    let countdownTimer = null;
    let countdownSeconds = WARNING_DURATION;

    // Track user activity
    function resetActivity() {
        lastActivityTime = Date.now();
    }

    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(event => {
        document.addEventListener(event, resetActivity, { passive: true });
    });

    // Inject warning modal HTML
    function injectModal() {
        if (document.getElementById('idle-timeout-modal')) return;
        const modal = document.createElement('div');
        modal.id = 'idle-timeout-modal';
        modal.innerHTML = `
            <div id="idle-overlay" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;backdrop-filter:blur(4px);">
                <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#ffffff;border-radius:16px;padding:32px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center;">
                    <div style="width:56px;height:56px;background:#fef3c7;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;">
                        <span style="font-size:28px;">&#9200;</span>
                    </div>
                    <h2 style="margin:0 0 8px 0;font-size:20px;font-weight:700;color:#1e293b;">Session Timeout</h2>
                    <p style="margin:0 0 8px 0;font-size:14px;color:#64748b;">You have been inactive for 30 minutes.</p>
                    <p style="margin:0 0 24px 0;font-size:14px;color:#64748b;">You will be logged out in <strong id="idle-countdown" style="color:#dc2626;font-size:18px;">60</strong> seconds.</p>
                    <div style="display:flex;gap:12px;justify-content:center;">
                        <button id="idle-stay-btn" style="padding:10px 28px;background:#1e40af;color:#ffffff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Stay Logged In</button>
                        <button id="idle-logout-btn" style="padding:10px 28px;background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;cursor:pointer;">Logout Now</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);

        document.getElementById('idle-stay-btn').addEventListener('click', dismissWarning);
        document.getElementById('idle-logout-btn').addEventListener('click', performAutoLogout);
    }

    // Show the warning modal
    function showWarning() {
        if (warningShown) return;
        warningShown = true;
        countdownSeconds = WARNING_DURATION;

        injectModal();
        const overlay = document.getElementById('idle-overlay');
        const counter = document.getElementById('idle-countdown');
        overlay.style.display = 'block';
        counter.textContent = countdownSeconds;

        countdownTimer = setInterval(() => {
            countdownSeconds--;
            counter.textContent = countdownSeconds;
            if (countdownSeconds <= 0) {
                clearInterval(countdownTimer);
                performAutoLogout();
            }
        }, 1000);
    }

    // Dismiss warning and reset timer
    function dismissWarning() {
        warningShown = false;
        clearInterval(countdownTimer);
        lastActivityTime = Date.now();
        const overlay = document.getElementById('idle-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    // Perform the actual logout
    function performAutoLogout() {
        warningShown = false;
        clearInterval(countdownTimer);
        // Save any in-progress form data before logout
        FormDrafts.saveAll();
        fetch(`${API_BASE_URL}/auth.php`, {
            method: 'DELETE',
            credentials: 'include'
        }).finally(() => {
            // Clear all localStorage EXCEPT draft keys
            const draftKeys = Object.values(FormDrafts.KEYS);
            const savedDrafts = {};
            draftKeys.forEach(k => { const v = localStorage.getItem(k); if (v) savedDrafts[k] = v; });
            localStorage.clear();
            Object.entries(savedDrafts).forEach(([k, v]) => localStorage.setItem(k, v));
            window.location.href = 'index.html?reason=idle';
        });
    }

    // Periodic check for idle timeout
    setInterval(() => {
        if (warningShown) return;
        const idleTime = Date.now() - lastActivityTime;
        if (idleTime >= IDLE_TIMEOUT) {
            showWarning();
        }
    }, CHECK_INTERVAL);
})();

// Look up AI risk data for a business name from prediction engine results
let _cachedPredictions = null;

function getRiskForEstablishment(businessName) {
    if (!businessName) return null;
    //优先使用 prediction engine 的数据
    if (_cachedPredictions && _cachedPredictions.length > 0) {
        const match = _cachedPredictions.find(p =>
            p.businessName && p.businessName.trim().toLowerCase() === businessName.trim().toLowerCase()
        );
        if (match) return match;
    }
    // Fallback to inspection report aiAnalysis
    const reports = cachedInspectionReports.length > 0 ? cachedInspectionReports : (window._inspectionReports || []);
    const match = reports.find(r =>
        r.establishment && r.establishment.trim().toLowerCase() === businessName.trim().toLowerCase()
    );
    return (match && match.aiAnalysis) ? match.aiAnalysis : null;
}

async function fetchPredictions() {
    try {
        const resp = await fetch(`${API_BASE_URL}/predict.php`);
        const result = await resp.json();
        if (result.success && result.data) {
            _cachedPredictions = result.data;
        }
    } catch (e) {
        console.warn('Could not fetch predictions:', e);
    }
}

// ==================== RISK SCORING HELPER ====================

// Renders a risk badge HTML string from an aiAnalysis object (or null)
function renderRiskBadge(ai) {
    if (!ai) {
        return `<span class="badge badge-ghost badge-sm">Not Inspected</span>`;
    }
    const riskStyles = {
        HIGH:     { badge: 'badge-error text-white',  text: 'text-red-500',    icon: '🔴' },
        MODERATE: { badge: 'badge-warning text-white', text: 'text-yellow-600', icon: '🟡' },
        LOW:      { badge: 'badge-success text-white',  text: 'text-green-600',  icon: '🟢' },
    };
    const s = riskStyles[ai.riskLevel] || riskStyles.LOW;
    return `
        <div class="flex flex-col gap-1">
            <span class="badge badge-sm ${s.badge}">
                ${s.icon} ${ai.riskLevel} RISK
            </span>
            <span class="text-xs ${s.text} font-semibold">
                Score: ${ai.riskScore}/100
            </span>
        </div>
    `;
}

// ==================== SANITARY MODULE ====================

async function loadSanitaryRecords() {
    const tbody = document.getElementById('sanitary-table-body');
    if (!tbody) return;

    // Fetch prediction data in parallel
    if (!_cachedPredictions) await fetchPredictions();

    try {
        const response = await fetch(`${API_BASE_URL}/sanitary.php`);
        const result = await response.json();
        
        if (!result.success) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-red-500">Error: ${esc(result.message)}</td></tr>`;
            return;
        }
        
        // SAVE TO CACHE HERE
        cachedSanitaryRecords = result.data; 

        if (cachedSanitaryRecords.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-500">No records found.</td></tr>`;
            return;
        }

        filterSanitaryRecords();
        updateSanitaryStatistics();
    } catch (error) {
        console.error('Error loading records:', error);
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-red-500">⚠️ Could not connect to the server. Make sure XAMPP/MySQL is running.</td></tr>`;
    }
}

// Search, Sort and Filter Sanitary Records
function filterSanitaryRecords() {
    const searchTerm = (document.getElementById('sanitary-search')?.value || '').toLowerCase();
    const barangayFilter = document.getElementById('sanitary-barangay-filter')?.value || '';
    const sortBy = document.getElementById('sanitary-sort')?.value || 'newest';
    const countEl = document.getElementById('sanitary-count');
    
    const records = cachedSanitaryRecords || [];
    const hasFilter = searchTerm || barangayFilter;
    
    let filtered = records.filter(record => {
        const ownerName = record.owner 
            ? `${record.owner.first || ''} ${record.owner.middle || ''} ${record.owner.last || ''}`.toLowerCase()
            : '';
        
        const matchesSearch = !searchTerm ||
            (record.businessName && record.businessName.toLowerCase().includes(searchTerm)) ||
            (record.permitNo && record.permitNo.toLowerCase().includes(searchTerm)) ||
            ownerName.includes(searchTerm);
        
        const matchesBarangay = !barangayFilter || 
            (record.barangay && record.barangay.trim().toLowerCase() === barangayFilter.trim().toLowerCase());
        
        return matchesSearch && matchesBarangay;
    });
    
    // Sort
    filtered = [...filtered].sort((a, b) => {
        switch (sortBy) {
            case 'newest': return new Date(b.date || 0) - new Date(a.date || 0);
            case 'oldest': return new Date(a.date || 0) - new Date(b.date || 0);
            case 'name-az': return (a.businessName || '').localeCompare(b.businessName || '');
            case 'name-za': return (b.businessName || '').localeCompare(a.businessName || '');
            case 'risk': {
                const aRisk = getRiskForEstablishment(a.businessName);
                const bRisk = getRiskForEstablishment(b.businessName);
                return (bRisk?.riskScore || 0) - (aRisk?.riskScore || 0);
            }
            default: return new Date(b.date || 0) - new Date(a.date || 0);
        }
    });
    
    // Show latest N when no filter active
    const page = hasFilter ? { displayed: filtered, hasMore: false, remaining: 0 } : TablePaging.slice(filtered, 'insp-sanitary', 10);
    const displayed = page.displayed;
    if (countEl) countEl.textContent = hasFilter ? `${displayed.length} matching records` : `Showing ${displayed.length} of ${records.length} records`;

    const tbody = document.getElementById('sanitary-table-body');
    if (!tbody) return;

    if (displayed.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-500">No matching records found.</td></tr>';
        return;
    }
    
    tbody.innerHTML = displayed.map((record) => {
        const ownerName = record.owner
            ? `${record.owner.first || ''} ${record.owner.middle || ''} ${record.owner.last || ''}`
            : '';
        const ai        = getRiskForEstablishment(record.businessName);
        const riskBadge = renderRiskBadge(ai);

        return `
            <tr>
                <td>${formatDate(record.date) || ''}</td>
                <td>${esc(record.permitNo) || ''}</td>
                <td>${esc(record.businessName) || ''}</td>
                <td>${esc(ownerName)}</td>
                <td>${esc(record.barangay) || ''}</td>
                <td>${riskBadge}</td>
                <td>
                   <div class="flex gap-2">
                        <button class="btn btn-sm btn-info text-white" onclick="viewSanitary(${record.id})">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-sm btn-success text-white" onclick="printSanitary(${record.id})">
                            <i class="fas fa-print"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('') + (page.hasMore ? TablePaging.moreRow('insp-sanitary', page.remaining, 7, 10) : '');
}

// Update Sanitary Statistics
function updateSanitaryStatistics() {
    const records = cachedSanitaryRecords || [];
    
    // Total records
    document.getElementById('sanitary-total').textContent = records.length;
    
    // This month
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    const thisMonth = records.filter(record => {
    const recordDate = new Date(record.date);
    if (isNaN(recordDate.getTime())) return false;
    return recordDate.getMonth() === currentMonth && 
           recordDate.getFullYear() === currentYear;
}).length;
    
    document.getElementById('sanitary-month').textContent = thisMonth;
    
    // This year
    const thisYear = records.filter(record => {
        const recordDate = new Date(record.date);
        return recordDate.getFullYear() === currentYear;
    }).length;
    
    document.getElementById('sanitary-year').textContent = thisYear;
    
    // Barangays covered (unique)
    const barangays = new Set(records.map(r => r.barangay).filter(Boolean));
    document.getElementById('sanitary-barangay-count').textContent = barangays.size;
}

// Update Burial Statistics
function updateBurialStatistics() {
    const burialData = cachedBurialRecords;
    
    document.getElementById('burial-cadaver-count').textContent = burialData.cadaver?.length || 0;
    document.getElementById('burial-skeletal-count').textContent = burialData.skeletal?.length || 0;
    document.getElementById('burial-exhumation-count').textContent = burialData.exhumation?.length || 0;
}

// Display Sanitary Records (helper function)
function displaySanitaryRecords(records) {
    const tbody = document.getElementById('sanitary-table-body');
    
    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-500">No records found.</td></tr>';
        return;
    }
    
    tbody.innerHTML = records.map((record, index) => `
        <tr data-testid="sanitary-row-${index}">
            <td>${formatDate(record.date)}</td>
            <td>${esc(record.permitNo)}</td>
            <td>${esc(record.businessName)}</td>
            <td>${esc(record.owner.first)} ${esc(record.owner.middle)} ${esc(record.owner.last)}</td>
            <td>${esc(record.barangay)}</td>
            <td>
                <div class="flex gap-2">
                    <button class="btn btn-sm btn-info text-white" data-testid="view-sanitary-${index}" onclick="viewSanitary(${index})">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-sm btn-success text-white" data-testid="print-sanitary-${index}" onclick="printSanitary(${index})">
                        <i class="fas fa-print"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Search and Filter Burial Records
function filterBurialRecords(type) {
    const searchTerm = (document.getElementById(`${type}-search`)?.value || '').toLowerCase();
    const sortBy = document.getElementById(`${type}-sort`)?.value || 'newest';
    const countEl = document.getElementById(`${type}-count`);
    const records = cachedBurialRecords[type] || [];
    const hasFilter = !!searchTerm;
    
    let filtered = records;
    if (searchTerm) {
        filtered = records.filter(record => {
            return (record.deceased && record.deceased.toLowerCase().includes(searchTerm)) ||
                   (record.informant && record.informant.toLowerCase().includes(searchTerm)) ||
                   (record.cemeteryOrigin && record.cemeteryOrigin.toLowerCase().includes(searchTerm)) ||
                   (record.cemeteryTransfer && record.cemeteryTransfer.toLowerCase().includes(searchTerm));
        });
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
        switch (sortBy) {
            case 'newest': return new Date(b.datetime || b.deathDate || 0) - new Date(a.datetime || a.deathDate || 0);
            case 'oldest': return new Date(a.datetime || a.deathDate || 0) - new Date(b.datetime || b.deathDate || 0);
            case 'name-az': return (a.deceased || '').localeCompare(b.deceased || '');
            default: return new Date(b.datetime || b.deathDate || 0) - new Date(a.datetime || a.deathDate || 0);
        }
    });

    const page = hasFilter ? { displayed: filtered, hasMore: false, remaining: 0 } : TablePaging.slice(filtered, `insp-burial-${type}`, 10);
    const displayed = page.displayed;
    if (countEl) countEl.textContent = hasFilter ? `${displayed.length} matching records` : `Showing ${displayed.length} of ${records.length} records`;

    displayBurialRecords(type, displayed);
    if (page.hasMore) {
        const tbody = document.getElementById(`${type}-table-body`);
        if (tbody) tbody.insertAdjacentHTML('beforeend', TablePaging.moreRow(`insp-burial-${type}`, page.remaining, type === 'cadaver' ? 5 : 6, 10));
    }
}

// Display Burial Records (helper function)
function displayBurialRecords(type, records) {
    const tbody = document.getElementById(`${type}-table-body`);
    
    if (records.length === 0) {
        const colspan = type === 'cadaver' ? 5 : 6;
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-8 text-gray-500">No records found.</td></tr>`;
        return;
    }
    
    if (type === 'cadaver') {
        tbody.innerHTML = records.map((record, index) => `
            <tr data-testid="${type}-row-${index}">
                <td>${formatDateTime(record.datetime)}</td>
                <td>${esc(record.deceased)}</td>
                <td>${formatDate(record.deathDate)}</td>
                <td>${esc(record.informant)}</td>
                <td>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-info text-white" data-testid="view-${type}-${index}" onclick="viewBurial('${type}', ${record.id})">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-sm btn-warning text-white" data-testid="edit-${type}-${index}" onclick="editBurial('${type}', ${record.id})">
                            <i class="fas fa-edit"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    } else {
        tbody.innerHTML = records.map((record, index) => `
            <tr data-testid="${type}-row-${index}">
                <td>${formatDateTime(record.datetime)}</td>
                <td>${esc(record.deceased)}</td>
                <td>${formatDate(record.deathDate)}</td>
                <td>${esc(record.cemeteryOrigin)}</td>
                <td>${esc(record.cemeteryTransfer)}</td>
                <td>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-info text-white" data-testid="view-${type}-${index}" onclick="viewBurial('${type}', ${record.id})">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-sm btn-warning text-white" data-testid="edit-${type}-${index}" onclick="editBurial('${type}', ${record.id})">
                            <i class="fas fa-edit"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }
}

function openSanitaryModal(mode, index = null) {
    const modal = document.getElementById('sanitary-modal');
    const form = document.getElementById('sanitary-form');
    const title = document.getElementById('sanitary-modal-title');
    const submitBtn = document.getElementById('sanitary-submit-btn');
    const printBtn = document.getElementById('sanitary-print-btn');
    
    form.reset();
    const now = new Date();
    const dateInput = document.getElementById('sanitary-date');
    

    dateInput.value = now.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    dateInput.setAttribute('data-db-date', now.toISOString().split('T')[0]);


    document.getElementById('sanitary-mode').value = mode;

    if (mode === 'add') {
        title.textContent = 'Add Sanitary Record';
        submitBtn.style.display = 'inline-flex';
        printBtn.style.display = 'none';
        disableFormInputs(false);
        generatePermitSequentialNumber();
    } else if (mode === 'edit') {
        title.textContent = 'Edit Sanitary Record';
        submitBtn.style.display = 'inline-flex';
        printBtn.style.display = 'none';
        disableFormInputs(false);
        loadSanitaryData(index);
    } else if (mode === 'view') {
        title.textContent = 'View Sanitary Record';
        submitBtn.style.display = 'none';
        printBtn.style.display = 'none';
        loadSanitaryData(index);
        disableFormInputs(true);
    }
    
    modal.showModal();
}

function loadSanitaryData(id) {
    // Find by ID in the cache instead of index in localStorage
    const record = cachedSanitaryRecords.find(r => r.id == id);
    
    if (!record) {
        showNotification('Record not found', 'error');
        return;
    }
    
    document.getElementById('sanitary-id').value = id;
    document.getElementById('sanitary-date').value = record.date || '';
    document.getElementById('sanitary-personnel-no').value = record.personnelNo || '';
    document.getElementById('sanitary-corporation').value = record.corporationName || '';
    document.getElementById('sanitary-business').value = record.businessName || '';
    
    // Split permit number into 3 parts
    if (record.permitNo) {
        const parts = record.permitNo.split('-');
        document.getElementById('sanitary-permit-1').value = parts[0] || '';
        document.getElementById('sanitary-permit-2').value = parts[1] || '';
        document.getElementById('sanitary-permit-3').value = parts[2] || '';
    }

    // Handle owner data
    if (record.owner) {
        document.getElementById('owner-first').value = record.owner.first || '';
        document.getElementById('owner-middle').value = record.owner.middle || '';
        document.getElementById('owner-last').value = record.owner.last || '';
    }
    
    // Handle sex
    if (record.sex) {
        const sexRadio = document.querySelector(`input[name="sex"][value="${record.sex}"]`);
        if (sexRadio) sexRadio.checked = true;
    }
    
    // Handle results
    if (record.result) {
        document.getElementById('result-xray').checked = record.result.xray || false;
        document.getElementById('result-stool').checked = record.result.stool || false;
    }
    
    document.getElementById('sanitary-barangay').value = record.barangay || '';
    document.getElementById('sanitary-building-street').value = record.buildingStreet || '';
    document.getElementById('sanitary-remarks').value = record.remarks || '';
    
    // Handle personnel data
    const container = document.getElementById('personnelContainer');
    container.innerHTML = '';

    if (record.personnel && Array.isArray(record.personnel)) {
        record.personnel.forEach((person, index) => {
            const row = document.createElement('div');
            row.className = "personnel-row border border-gray-300 p-3 rounded-lg";
        
            const sexMaleChecked = person.sex === 'Male' ? 'checked' : '';
            const sexFemaleChecked = person.sex === 'Female' ? 'checked' : '';
            const xrayChecked = person.result?.xray ? 'checked' : '';
            const stoolChecked = person.result?.stool ? 'checked' : '';
        
        row.innerHTML = `
            <div class="grid grid-cols-3 gap-2 mb-2">
                <input type="text" class="input input-bordered input-success input-sm first-name" value="${esc(person.first) || ''}" placeholder="First Name"
                    oninput="this.value = this.value.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ\\s\\-]/g, ''); this.value = this.value.replace(/(?:^|\\s|-)\\S/g, c => c.toUpperCase());" />
                <input type="text" class="input input-bordered input-success input-sm middle-name" value="${esc((person.middle || '').replace(/\\.$/,'').toUpperCase())}" placeholder="M.I." maxlength="1"
                    oninput="this.value = this.value.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ]/g, '').toUpperCase();" />
                <input type="text" class="input input-bordered input-success input-sm last-name" value="${esc(person.last) || ''}" placeholder="Last Name"
                    oninput="this.value = this.value.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ\\s\\-]/g, ''); this.value = this.value.replace(/(?:^|\\s|-)\\S/g, c => c.toUpperCase());" />
            </div>
            <div class="grid grid-cols-2 gap-2 items-center">
                <div>
                    <label class="label-text text-xs font-semibold">Sex:</label>
                    <div class="flex gap-3 mt-1">
                        <label class="label cursor-pointer">
                            <input type="radio" name="personnel-sex-${index + 1}" value="Male" class="radio radio-xs radio-success personnel-sex" ${sexMaleChecked} />
                            <span class="label-text ml-1 text-xs">Male</span>
                        </label>
                        <label class="label cursor-pointer">
                            <input type="radio" name="personnel-sex-${index + 1}" value="Female" class="radio radio-xs radio-success personnel-sex" ${sexFemaleChecked} />
                            <span class="label-text ml-1 text-xs">Female</span>
                        </label>
                    </div>
                </div>
                <div>
                    <label class="label-text text-xs font-semibold">Result:</label>
                    <div class="flex gap-3 mt-1">
                        <label class="label cursor-pointer">
                            <input type="checkbox" class="checkbox checkbox-xs checkbox-success personnel-xray" ${xrayChecked} />
                            <span class="label-text ml-1 text-xs">X-ray</span>
                        </label>
                        <label class="label cursor-pointer">
                            <input type="checkbox" class="checkbox checkbox-xs checkbox-success personnel-stool" ${stoolChecked} />
                            <span class="label-text ml-1 text-xs">Stool</span>
                        </label>
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(row);
    });
    } else {
    // Add default empty row if no personnel
    const row = document.createElement('div');
    row.className = "personnel-row border border-gray-300 p-3 rounded-lg";
    row.innerHTML = `
        <div class="grid grid-cols-3 gap-2 mb-2">
            <input type="text" class="input input-bordered input-success input-sm first-name" placeholder="First Name"
                oninput="this.value = this.value.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ\\s\\-]/g, ''); this.value = this.value.replace(/(?:^|\\s|-)\\S/g, c => c.toUpperCase());" />
            <input type="text" class="input input-bordered input-success input-sm middle-name" placeholder="M.I." maxlength="1"
                oninput="this.value = this.value.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ]/g, '').toUpperCase();" />
            <input type="text" class="input input-bordered input-success input-sm last-name" placeholder="Last Name"
                oninput="this.value = this.value.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ\\s\\-]/g, ''); this.value = this.value.replace(/(?:^|\\s|-)\\S/g, c => c.toUpperCase());" />
        </div>
        <div class="grid grid-cols-2 gap-2 items-center">
            <div>
                <label class="label-text text-xs font-semibold">Sex:</label>
                <div class="flex gap-3 mt-1">
                    <label class="label cursor-pointer">
                        <input type="radio" name="personnel-sex-1" value="Male" class="radio radio-xs radio-success personnel-sex" />
                        <span class="label-text ml-1 text-xs">Male</span>
                    </label>
                    <label class="label cursor-pointer">
                        <input type="radio" name="personnel-sex-1" value="Female" class="radio radio-xs radio-success personnel-sex" />
                        <span class="label-text ml-1 text-xs">Female</span>
                    </label>
                </div>
            </div>
            <div>
                <label class="label-text text-xs font-semibold">Result:</label>
                <div class="flex gap-3 mt-1">
                    <label class="label cursor-pointer">
                        <input type="checkbox" class="checkbox checkbox-xs checkbox-success personnel-xray" />
                        <span class="label-text ml-1 text-xs">X-ray</span>
                    </label>
                    <label class="label cursor-pointer">
                        <input type="checkbox" class="checkbox checkbox-xs checkbox-success personnel-stool" />
                        <span class="label-text ml-1 text-xs">Stool</span>
                    </label>
                </div>
            </div>
        </div>
    `;
    container.appendChild(row);
    }
}

async function handleSanitarySubmit(e) {
    e.preventDefault();

    // Validate required fields
    const permit1 = document.getElementById('sanitary-permit-1').value.trim();
    const permit2 = document.getElementById('sanitary-permit-2').value.trim();
    const permit3 = document.getElementById('sanitary-permit-3').value.trim();
    const businessName = document.getElementById('sanitary-business').value.trim();
    const barangay = document.getElementById('sanitary-barangay').value;
    const buildingStreet = document.getElementById('sanitary-building-street').value.trim() || 'N/A';
    const ownerFirst = document.getElementById('owner-first').value.trim();
    const ownerLast = document.getElementById('owner-last').value.trim();

    const personnelNo = document.getElementById('sanitary-personnel-no').value.replace(/[^0-9]/g, '').trim();
    const ownerSex = document.querySelector('input[name="sex"]:checked')?.value || '';

    if (!permit1 || !permit2 || !permit3 || !businessName || !barangay || !ownerFirst || !ownerLast || !ownerSex || !personnelNo || parseInt(personnelNo, 10) <= 0) {
        alert('Please fill in all required fields!');
        return;
    }

    const personnelRows = document.querySelectorAll('.personnel-row');
    const personnelList = [];
    // Combine permit parts into format: 001-00-FR
    const permitNo = `${permit1}-${permit2}-${permit3}`;

    let personnelValid = true;
    personnelRows.forEach((row, rowIndex) => {
        const first = row.querySelector('.first-name').value.trim();
        const middle = row.querySelector('.middle-name').value.trim();
        const last = row.querySelector('.last-name').value.trim();
        const sex = row.querySelector('.personnel-sex:checked')?.value || '';
        const xray = row.querySelector('.personnel-xray').checked;
        const stool = row.querySelector('.personnel-stool').checked;

        if (!first || !middle || !last || !sex) {
            personnelValid = false;
        }

        personnelList.push({ 
            first, 
            middle, 
            last,
            sex,
            result: { xray, stool }
        });
    });

    if (!personnelValid) {
        alert('Please fill up the details for all personnel!');
        return;
    }

    const mode = document.getElementById('sanitary-mode').value;
    const index = document.getElementById('sanitary-id').value;
    const dateInput = document.getElementById('sanitary-date');
    
    const record = {
        date: dateInput.getAttribute('data-db-date') || dateInput.value,
        permitNo: permitNo,
        businessName: businessName,
        barangay: barangay,
        buildingStreet: buildingStreet,
        corporationName: document.getElementById('sanitary-corporation').value,
        owner: {
            first: ownerFirst,
            middle: document.getElementById('owner-middle').value,
            last: ownerLast
        },
        
        sex: document.querySelector('input[name="sex"]:checked')?.value || '',
        result: {
            xray: document.getElementById('result-xray').checked,
            stool: document.getElementById('result-stool').checked
        },
        personnelNo: personnelNo,
        personnel: personnelList,
        remarks: document.getElementById('sanitary-remarks').value
    };
    
    try {
        let url = `${API_BASE_URL}/sanitary.php`;
        let method = 'POST';
        
        if (mode === 'edit') {
            method = 'PUT';
            record.id = parseInt(index);
        }
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(record)
        });
        
        const result = await response.json();
        
        if (result.success) {
            closeSanitaryModal();
            await loadSanitaryRecords();
            updateSanitaryStatistics();
            showNotification(mode === 'edit' ? 'Record updated successfully!' : 'Record added successfully!', 'success');
            localStorage.removeItem(FormDrafts.KEYS.sanitary);
        } else {
            alert('Error: ' + (result.message || 'Failed to save record'));
        }
    } catch (error) {
        console.error('Error saving record:', error);
        alert('Error saving record: ' + error.message);
    }
}

function viewSanitary(index) {
    openSanitaryModal('view', index);
}

function editSanitary(index) {
    openSanitaryModal('edit', index);
}

function closeSanitaryModal() {
    document.getElementById('sanitary-modal').close();
}

function printSanitary(id) {
    const record = cachedSanitaryRecords.find(r => r.id == id);
    if (!record) {
        showNotification('Record not found', 'error');
        return;
    }

    const ownerName = record.owner
        ? `${record.owner.first || ''} ${record.owner.middle ? record.owner.middle + ' ' : ''}${record.owner.last || ''}`.trim()
        : 'N/A';

    const issuanceDate = record.date
        ? new Date(record.date).toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' }).toUpperCase()
        : new Date().toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' }).toUpperCase();

    const currentYear = new Date().getFullYear();
    const expirationDate = `DECEMBER 31, ${currentYear}`;
    const address = `${record.barangay || ''}, City of Tayabas, Quezon`.toUpperCase();

    const permitWin = window.open('', '_blank', 'width=794,height=1123');
    permitWin.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Sanitary Permit - ${esc(record.businessName) || ''}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 794px;
    height: 1123px;
    overflow: hidden;
    background: #fff;
  }
  .permit-wrapper {
    position: relative;
    width: 794px;
    height: 1123px;
    overflow: hidden;
  }
  .permit-wrapper img.bg {
    position: absolute;
    top: 0; left: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
    z-index: 0;
  }
  .f-owner {
    position: absolute;
    z-index: 2;
    font-family: 'Times New Roman', Times, serif;
    font-weight: 900;
    font-size: 40px;
    text-decoration: underline;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: #111;
    white-space: nowrap;
    left: 50%;
    transform: translateX(-50%);
    top: 35%;
  }
  .f-business {
    position: absolute;
    z-index: 2;
    font-family: 'Times New Roman', Times, serif;
    font-weight: 900;
    font-size: 30px;
    text-decoration: underline;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: #111;
    white-space: nowrap;
    left: 50%;
    transform: translateX(-50%);
    top: 48%;
  }
  .f-address {
    position: absolute;
    z-index: 2;
    font-family: 'Times New Roman', Times, serif;
    font-weight: bold;
    font-size: 24px;
    text-decoration: underline;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #111;
    white-space: nowrap;
    left: 50%;
    transform: translateX(-50%);
    top: 57.3%;
  }
  @media print {
    @page {
      size: A4 portrait;
      margin: 0;
    }
    html, body {
      width: 210mm;
      height: 297mm;
      overflow: hidden;
      margin: 0;
      padding: 0;
    }
    .permit-wrapper {
      width: 210mm;
      height: 297mm;
    }
  }
</style>
</head>
<body>
<div class="permit-wrapper">
  <img class="bg" src="${window.location.origin}${window.location.pathname.replace(/\/[^/]*$/, '')}/images/Sanitary_Permit.jpg" />

  <div class="f-owner">${esc(ownerName)}</div>
  <div class="f-business">${esc(record.businessName) || 'N/A'}</div>
  <div class="f-address">${esc(address)}</div>

  <div style="position:absolute;z-index:2;top:74%;left:39%;font-family:'Times New Roman',Times,serif;font-size:12px;font-weight:bold;text-decoration:underline;text-transform:uppercase;color:#111;white-space:nowrap;">${esc(record.permitNo) || 'N/A'}</div>
  <div style="position:absolute;z-index:2;top:75.5%;left:39%;font-family:'Times New Roman',Times,serif;font-size:12px;font-weight:bold;text-decoration:underline;text-transform:uppercase;color:#111;white-space:nowrap;">${issuanceDate}</div>
  <div style="position:absolute;z-index:2;top:77.3%;left:39%;font-family:'Times New Roman',Times,serif;font-size:12px;font-weight:bold;text-decoration:underline;text-transform:uppercase;color:#cc0000;white-space:nowrap;">${expirationDate}</div>
</div>
<script>
  const img = document.querySelector('.bg');
  img.onload = function() { window.print(); };
  img.onerror = function() {
    alert('Template image not found!\\nPlease make sure Sanitary_Permit.jpg is inside:\\nC:\\\\xampp\\\\htdocs\\\\TayabasCare\\\\images\\\\');
  };
</script>
</body>
</html>`);
    permitWin.document.close();
}

function disableFormInputs(disable) {
    const form = document.getElementById('sanitary-form');
    const inputs = form.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
        input.disabled = disable;
    });
}

// ==================== INSPECTION REPORT MODULE ====================

async function handleInspectionSubmit(e) {
    e.preventDefault();

    const establishment = document.getElementById('inspection-establishment').value.trim();
    const remarks = getCollectedRemarks();
    const recommendation = getCollectedRecommendations();

    if (!establishment) {
        showNotification('Please enter the Establishment Name.', 'warning');
        return;
    }
    if (!remarks) {
        showNotification('Please enter the Remarks (violations found).', 'warning');
        return;
    }
    if (!recommendation) {
        showNotification('Please enter the Recommendation.', 'warning');
        return;
    }

    // Auto-get barangay from sanitary records
    const sanitaryRecords = cachedSanitaryRecords || [];
    const matched = sanitaryRecords.find(r =>
        r.businessName && r.businessName.toLowerCase() === establishment.toLowerCase()
    );
    const barangay = matched ? (matched.barangay || 'N/A') : document.getElementById('inspection-barangay').textContent.trim() || 'N/A';

    const inspector = localStorage.getItem('inspectorFullName') || localStorage.getItem('username') || 'Inspector';

    // Check if a record already exists for this establishment (from loaded reports)
    const existingReports = window._inspectionReports || [];
    const alreadyExists = existingReports.find(r =>
        (r.establishment || '').toLowerCase() === establishment.toLowerCase()
    );

    const deadline = document.getElementById('inspection-deadline').value || '';

    const report = {
        establishment: establishment,
        location: barangay,
        inspector: inspector,
        file: '',
        remarks: remarks,
        recommendation: recommendation,
        status: 'Submitted',
        complied: false,
        compliance_deadline: deadline,
        date: new Date().toISOString(),
    };

    const fileInput = document.getElementById('inspection-file');
    const fileObj = fileInput.files[0];

    const saveAndFinish = async (fileName) => {
        report.file = fileName || '';

        try {
            const formData = new FormData();
            formData.append('recommendation', report.recommendation || '');
            formData.append('remarks', report.remarks || '');
            formData.append('complied', report.complied ? '1' : '0');
            formData.append('inspector', report.inspector || '');
            formData.append('establishment', report.establishment || '');
            formData.append('location', report.location || '');
            formData.append('status', report.status || 'Submitted');
            formData.append('compliance_deadline', report.compliance_deadline || '');
            formData.append('date', report.date || new Date().toISOString());
            const violationCodes = getCollectedViolationCodes();
            if (violationCodes.length > 0) formData.append('violation_codes', JSON.stringify(violationCodes));
            if (fileObj) formData.append('attachment', fileObj);

            const dbResponse = await fetch(`${API_BASE_URL}/inspection.php`, {
                method: 'POST',
                body: formData
            });
            const dbResult = await dbResponse.json();
            if (!dbResult.success) {
                showNotification('Error saving to database: ' + (dbResult.message || 'Unknown error'), 'error');
                return;
            }
        } catch (err) {
            showNotification('Could not connect to server. Make sure XAMPP is running.', 'error');
            console.error('DB save failed:', err);
            return;
        }

        const message = alreadyExists
            ? 'Inspection report updated successfully!'
            : 'Inspection report saved successfully!';
        showNotification(message, 'success');
        localStorage.removeItem(FormDrafts.KEYS.inspection);

        // AUTO-SCHEDULE: push to admin calendar if a deadline was set
        if (report.compliance_deadline) {
            autoScheduleToAdminCalendar(
                report.inspector,
                report.compliance_deadline,
                report.establishment
            );
        }

        closeInspectionModal();
        loadInspectionReports();
    };

    saveAndFinish(fileObj ? fileObj.name : '');
}

function openInspectionModal() {
    document.getElementById('inspection-modal-title').innerHTML = '<i class="fas fa-file-medical mr-2"></i>Add Inspection Report';
    document.getElementById('inspection-form').reset();
    document.getElementById('inspection-preview').innerHTML = '';
    const barangayEl = document.getElementById('inspection-barangay');
    if (barangayEl) barangayEl.textContent = '';
    const suggestionsBox = document.getElementById('establishment-suggestions');
    if (suggestionsBox) suggestionsBox.innerHTML = '';
    const barangayRow = document.getElementById('barangay-detected-row');
    if (barangayRow) barangayRow.style.display = 'none';
    const selectedViol = document.getElementById('selected-violations');
    if (selectedViol) selectedViol.innerHTML = '';
    const selectedRec = document.getElementById('selected-recommendations');
    if (selectedRec) selectedRec.innerHTML = '';
    const violList = document.getElementById('violation-radio-list');
    if (violList) { violList.classList.add('hidden'); violList.innerHTML = ''; }
    const recList = document.getElementById('recommendation-radio-list');
    if (recList) { recList.classList.add('hidden'); recList.innerHTML = ''; }
    document.querySelectorAll('.violation-check, .recommendation-check').forEach(cb => cb.checked = false);
    const violPlaceholder = document.getElementById('violation-placeholder');
    if (violPlaceholder) { violPlaceholder.classList.remove('hidden'); violPlaceholder.textContent = 'Select an establishment first to load violations.'; }
    const recPlaceholder = document.getElementById('recommendation-placeholder');
    if (recPlaceholder) { recPlaceholder.classList.remove('hidden'); recPlaceholder.textContent = 'Select an establishment first to load recommendations.'; }

    // Set up compliance deadline calendar for Add Report
    const deadlineInput = document.getElementById('inspection-deadline');
    const deadlinePreview = document.getElementById('deadline-preview');
    if (deadlineInput) {
        const today = new Date().toISOString().split('T')[0];
        deadlineInput.min = today;
        deadlineInput.value = '';
        if (deadlinePreview) deadlinePreview.textContent = '';

        deadlineInput.oninput = function() {
            if (!this.value) { deadlinePreview.textContent = ''; return; }
            const selected = new Date(this.value);
            const now = new Date();
            now.setHours(0,0,0,0);
            const diffMs = selected - now;
            const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
            let label = '';
            if (diffDays === 0) label = 'Today';
            else if (diffDays === 1) label = '1 day from today';
            else if (diffDays < 7) label = diffDays + ' days from today';
            else if (diffDays < 14) label = '1 week from today';
            else if (diffDays < 30) label = Math.floor(diffDays / 7) + ' weeks from today';
            else if (diffDays < 60) label = '1 month from today';
            else label = Math.floor(diffDays / 30) + ' months from today';
            deadlinePreview.textContent = '⏰ Deadline is ' + label;
            deadlinePreview.className = 'mt-2 text-sm font-semibold ' + (diffDays <= 7 ? 'text-red-500' : diffDays <= 30 ? 'text-orange-500' : 'text-emerald-600');
        };
    }

    document.getElementById('inspection-modal').showModal();
}

function closeInspectionModal() {
    document.getElementById('inspection-modal').close();
    document.getElementById('inspection-form').reset();
    // Restore establishment field if it was locked
    const estabInput = document.getElementById('inspection-establishment');
    if (estabInput) {
        estabInput.readOnly = false;
        estabInput.style.backgroundColor = '';
        estabInput.style.cursor = '';
        estabInput.setAttribute('oninput', 'autoDetectBarangay(this.value)');
    }
    // Hide re-inspect-only fields
    const deadlineRow = document.getElementById('compliance-deadline-row');
    if (deadlineRow) deadlineRow.style.display = 'block';
    const prevRow = document.getElementById('previous-violation-row');
    if (prevRow) prevRow.style.display = 'none';
    const deadlineInput = document.getElementById('inspection-deadline');
    if (deadlineInput) { deadlineInput.value = ''; deadlineInput.oninput = null; }
    const deadlinePreview = document.getElementById('deadline-preview');
    if (deadlinePreview) deadlinePreview.textContent = '';
    const barangayEl = document.getElementById('inspection-barangay');
    if (barangayEl) barangayEl.textContent = '';
    const suggestionsBox = document.getElementById('establishment-suggestions');
    if (suggestionsBox) suggestionsBox.innerHTML = '';
    const barangayRow = document.getElementById('barangay-detected-row');
    if (barangayRow) barangayRow.style.display = 'none';

    // Reset form submit handler and button label back to Add Report defaults
    const inspForm = document.getElementById('inspection-form');
    if (inspForm) inspForm.onsubmit = handleInspectionSubmit;
    const saveBtn = document.getElementById('inspection-save-btn');
    if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Save';
}

function resetInspectionForm() {
    closeInspectionModal();
}

// Load and display inspection reports
async function loadInspectionReports() {
    let reports = [];
    try {
        const response = await fetch(`${API_BASE_URL}/inspection.php`);
        const result = await response.json();
        if (result.success && result.data) {
            reports = result.data.map(r => ({
                id: r.id,
                establishment: r.establishment || r.location,
                location: r.location,
                inspector: r.inspector,
                remarks: r.remarks || r.recommendation,
                recommendation: r.recommendation,
                complied: r.complied,
                date: r.date,
                file: r.file,
                filePath: r.filePath,
                status: r.status,
                aiAnalysis: r.aiAnalysis || null
            }));
        }
    } catch (err) {
        console.error('Failed to load inspection reports from DB:', err);
        reports = cachedInspectionReports;
    }
    // Cache for use by view/edit/print functions
    cachedInspectionReports = reports;
    window._inspectionReports = reports;

    // Fetch sanitary records for permit lookup
    let sanitaryRecords = [];
    try {
        const sRes = await fetch(`${API_BASE_URL}/sanitary.php`);
        const sResult = await sRes.json();
        if (sResult.success && sResult.data) {
            sanitaryRecords = sResult.data;
        }
    } catch (e) {
        console.warn('Could not fetch sanitary records for permit lookup:', e);
    }
    window._sanitaryRecordsForPermit = sanitaryRecords;

    filterInspectionReports();
}

// Search, Sort and Filter Inspection Reports
function filterInspectionReports() {
    const searchTerm = (document.getElementById('inspection-search')?.value || '').toLowerCase();
    const sortBy = document.getElementById('inspection-sort')?.value || 'newest';
    const countEl = document.getElementById('inspection-count');
    const reports = cachedInspectionReports || [];
    const sanitaryRecords = window._sanitaryRecordsForPermit || [];
    const tbody = document.getElementById('inspection-table-body');
    if (!tbody) return;

    const hasFilter = !!searchTerm;

    let filtered = reports;
    if (searchTerm) {
        filtered = reports.filter(r =>
            (r.establishment || '').toLowerCase().includes(searchTerm) ||
            (r.location || '').toLowerCase().includes(searchTerm)
        );
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
        switch (sortBy) {
            case 'newest': return new Date(b.date || 0) - new Date(a.date || 0);
            case 'oldest': return new Date(a.date || 0) - new Date(b.date || 0);
            case 'name-az': return (a.establishment || '').localeCompare(b.establishment || '');
            case 'status': {
                const aC = (a.complied === true || a.complied === 'true' || a.complied === 1) ? 0 : 1;
                const bC = (b.complied === true || b.complied === 'true' || b.complied === 1) ? 0 : 1;
                return aC - bC || new Date(b.date || 0) - new Date(a.date || 0);
            }
            default: return new Date(b.date || 0) - new Date(a.date || 0);
        }
    });

    const page = hasFilter ? { displayed: filtered, hasMore: false, remaining: 0 } : TablePaging.slice(filtered, 'insp-reports', 10);
    const displayed = page.displayed;
    if (countEl) countEl.textContent = hasFilter ? `${displayed.length} matching reports` : `Showing ${displayed.length} of ${reports.length} reports`;

    if (displayed.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-gray-500">No inspection reports found</td></tr>`;
        return;
    }

    tbody.innerHTML = displayed.map((report) => {
        const complied = report.complied === true || report.complied === 'true' || report.complied === 1;
        const statusBadge = complied
            ? `<span class="badge badge-success text-white">Complied</span>`
            : `<span class="badge badge-warning text-white">Pending</span>`;

        const dateStr = report.date
            ? new Date(report.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
            : 'N/A';

        const estabName = (report.establishment || '').toLowerCase();
        const matched = sanitaryRecords.find(s =>
            (s.business_name || s.businessName || '').toLowerCase() === estabName
        );
        const permitNo = matched
            ? (matched.permit_no || matched.permitNo || matched.sanitary_permit_no || 'N/A')
            : 'N/A';

        return `
        <tr>
            <td class="text-xs text-gray-500">${esc(permitNo)}</td>
            <td class="font-semibold">${esc(report.establishment) || 'N/A'}</td>
            <td>${esc(report.location) || 'N/A'}</td>
            <td class="max-w-xs truncate text-sm">${esc(report.remarks) || 'N/A'}</td>
            <td class="max-w-xs truncate text-sm">${esc(report.recommendation) || 'N/A'}</td>
            <td>${statusBadge}</td>
            <td>${dateStr}</td>
            <td>
                <div class="flex gap-2">
                    <button class="btn btn-sm btn-info text-white"
                            onclick="viewInspectionReportById(${report.id})"
                            data-testid="view-inspection-${report.id}"
                            title="View Current Report">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-sm btn-warning text-white"
                            onclick="editInspectionReportById(${report.id})"
                            data-testid="edit-inspection-${report.id}"
                            title="Re-Inspect">
                        <i class="fas fa-edit"></i>
                    </button>
                </div>
            </td>
        </tr>
        `;
    }).join('') + (page.hasMore ? TablePaging.moreRow('insp-reports', page.remaining, 8, 10) : '');
}

// View inspection report by DB id — includes checkbox to mark complied
function viewInspectionReportById(id) {
    const reports = window._inspectionReports || [];
    const report = reports.find(r => r.id === id);
    if (!report) return;

    const isComplied = (report.complied === true || report.complied === 'true' || report.complied === 1);
    const dateStr = report.date ? new Date(report.date).toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    }) : 'N/A';

    const modal = document.createElement('dialog');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-box max-w-2xl">
            <h3 class="font-bold text-2xl text-emerald-700 mb-4">
                <i class="fas fa-file-alt mr-2"></i>Inspection Report
            </h3>
            <div class="space-y-4">
                <div>
                    <label class="font-semibold text-gray-700">Establishment:</label>
                    <p class="text-gray-600">${esc(report.establishment) || 'N/A'}</p>
                </div>
                <div>
                    <label class="font-semibold text-gray-700">Location:</label>
                    <p class="text-gray-600">${esc(report.location) || 'N/A'}</p>
                </div>
                <div>
                    <label class="font-semibold text-gray-700">Inspector:</label>
                    <p class="text-gray-600">${esc(report.inspector) || 'N/A'}</p>
                </div>
                <div>
                    <label class="font-semibold text-gray-700">Date:</label>
                    <p class="text-gray-600">${dateStr}</p>
                </div>
                <div>
                    <label class="font-semibold text-gray-700">Remarks:</label>
                    <p class="text-gray-600 whitespace-pre-wrap">${esc(report.remarks) || 'N/A'}</p>
                </div>
                <div>
                    <label class="font-semibold text-gray-700">Recommendation:</label>
                    <p class="text-gray-600 whitespace-pre-wrap">${esc(report.recommendation) || 'N/A'}</p>
                </div>
                ${report.filePath ? `
                <div>
                    <label class="font-semibold text-gray-700">Attached File:</label>
                    <div class="flex items-center gap-3 mt-1">
                        <span class="text-gray-600">${esc(report.file) || 'Attachment'}</span>
                        <a href="${API_BASE_URL}/download.php?path=${encodeURIComponent(report.filePath)}" class="btn btn-sm btn-outline btn-success">
                            <i class="fas fa-download mr-1"></i>Download
                        </a>
                    </div>
                </div>
                ` : report.file ? `
                <div>
                    <label class="font-semibold text-gray-700">Attached File:</label>
                    <p class="text-gray-600">${esc(report.file)} <span class="text-xs text-gray-400">(file not available for download)</span></p>
                </div>
                ` : ''}
                <div class="form-control border rounded-lg p-3 bg-emerald-50">
                    <label class="label cursor-pointer justify-start gap-3">
                        <input type="checkbox" class="checkbox checkbox-success" id="view-complied-check-${id}"
                               ${isComplied ? 'checked' : ''} />
                        <span class="label-text font-semibold text-emerald-800">Establishment has complied with recommendation</span>
                    </label>
                    <p class="text-xs text-gray-500 mt-1 ml-1">Check or uncheck to update compliance status, then click Save.</p>
                </div>
            </div>
            <div class="modal-action">
                <button class="btn btn-success text-white" onclick="saveCompliedStatus(${id}, 'view-complied-check-${id}', this.closest('dialog'))">
                    <i class="fas fa-save mr-2"></i>Save
                </button>
                <button class="btn btn-ghost" onclick="this.closest('dialog').remove()">Close</button>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop">
            <button>close</button>
        </form>
    `;
    document.body.appendChild(modal);
    modal.showModal();
}

// Save only the complied status from View modal
async function saveCompliedStatus(id, checkboxId, modalEl) {
    const reports = window._inspectionReports || [];
    const report = reports.find(r => r.id === id);
    if (!report) return;

    const complied = document.getElementById(checkboxId).checked ? 1 : 0;

    const updatedData = {
        id: id,
        establishment: report.establishment,
        location: report.location,
        inspector: report.inspector || localStorage.getItem('username') || 'Inspector',
        file: report.file || '',
        remarks: report.remarks || '',
        recommendation: report.recommendation || '',
        complied: complied,
        status: report.status || 'Submitted',
        date: report.date || new Date().toISOString()
    };

    try {
        const res = await fetch(`${API_BASE_URL}/inspection.php`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
        });
        const result = await res.json();
        if (result.success) {
            showNotification('Compliance status updated!', 'success');
            if (modalEl) modalEl.remove();
            loadInspectionReports();
        } else {
            showNotification('Error: ' + (result.message || 'Unknown'), 'error');
        }
    } catch (err) {
        showNotification('Could not connect to server.', 'error');
    }
}

// Edit inspection report by DB id — saves old record to history, then updates
function editInspectionReportById(id) {
    const reports = window._inspectionReports || [];
    const report = reports.find(r => r.id === id);
    if (!report) return;

    // Clear any leftover file selection/preview from a previously opened report
    const fileInput = document.getElementById('inspection-file');
    if (fileInput) fileInput.value = '';
    const filePreview = document.getElementById('inspection-preview');
    if (filePreview) filePreview.innerHTML = '';

    // Set title
    document.getElementById('inspection-modal-title').innerHTML =
        '<i class="fas fa-redo mr-2"></i>Re-Inspect: ' + (report.establishment || '');

    // Lock establishment — 1 record per establishment
    const estabInput = document.getElementById('inspection-establishment');
    estabInput.value = report.establishment || '';
    estabInput.readOnly = true;
    estabInput.style.backgroundColor = '#f0fdf4';
    estabInput.style.cursor = 'not-allowed';
    estabInput.removeAttribute('oninput'); // disable auto-detect during edit

    // Show barangay row with existing location
    const barangayRow = document.getElementById('barangay-detected-row');
    if (barangayRow) {
        barangayRow.style.display = 'flex';
        document.getElementById('inspection-barangay').textContent = report.location || '';
    }

    // Hide suggestions
    const suggestionsBox = document.getElementById('establishment-suggestions');
    if (suggestionsBox) suggestionsBox.innerHTML = '';

    // Clear remarks and recommendation — inspector fills in NEW violations
    document.getElementById('inspection-remarks').value = '';
    document.getElementById('inspection-recommendation').value = '';

    // Load the checklist for this establishment's category, then uncheck all
    const sanitaryRecords = cachedSanitaryRecords || [];
    const matchedEstab = sanitaryRecords.find(r =>
        r.businessName && r.businessName.toLowerCase() === (report.establishment || '').toLowerCase()
    );
    const category = matchedEstab ? ((matchedEstab.permitNo || '').split('-')[2] || '') : '';
    loadViolationsByCategory(category);
    document.querySelectorAll('.violation-check, .recommendation-check').forEach(cb => cb.checked = false);

    // Show previous violation as reference
    const prevRow = document.getElementById('previous-violation-row');
    if (prevRow) {
        prevRow.style.display = 'block';
        document.getElementById('prev-remarks-text').textContent = report.remarks || 'N/A';
        document.getElementById('prev-recommendation-text').textContent = report.recommendation || 'N/A';

        const prevDeadline = report.compliance_deadline
            ? new Date(report.compliance_deadline).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
            : 'No deadline set';
        document.getElementById('prev-deadline-text').textContent = prevDeadline;
    }

    // Show compliance deadline calendar — set min date to today
    const deadlineRow = document.getElementById('compliance-deadline-row');
    const deadlineInput = document.getElementById('inspection-deadline');
    if (deadlineRow && deadlineInput) {
        deadlineRow.style.display = 'block';
        const today = new Date().toISOString().split('T')[0];
        deadlineInput.min = today;
        deadlineInput.value = '';

        // Live preview: show how many days/weeks/months from today
        deadlineInput.oninput = function() {
            const preview = document.getElementById('deadline-preview');
            if (!this.value) { preview.textContent = ''; return; }
            const selected = new Date(this.value);
            const now = new Date();
            now.setHours(0,0,0,0);
            const diffMs = selected - now;
            const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
            let label = '';
            if (diffDays === 0) label = 'Today';
            else if (diffDays === 1) label = '1 day from today';
            else if (diffDays < 7) label = diffDays + ' days from today';
            else if (diffDays < 14) label = '1 week from today';
            else if (diffDays < 30) label = Math.floor(diffDays / 7) + ' weeks from today';
            else if (diffDays < 60) label = '1 month from today';
            else label = Math.floor(diffDays / 30) + ' months from today';
            preview.textContent = '⏰ Deadline is ' + label;
            preview.className = 'mt-2 text-sm font-semibold ' + (diffDays <= 7 ? 'text-red-500' : diffDays <= 30 ? 'text-orange-500' : 'text-emerald-600');
        };
    }

    // Override form submit to call PUT with new data
    const form = document.getElementById('inspection-form');
    form.onsubmit = async function(e) {
        e.preventDefault();

        const newRemarks = getCollectedRemarks();
        const newRecommendation = getCollectedRecommendations();
        const deadline = document.getElementById('inspection-deadline').value;

        if (!newRemarks) {
            showNotification('Please select or enter Remarks for the new inspection.', 'warning');
            return;
        }
        if (!newRecommendation) {
            showNotification('Please select or enter a Recommendation.', 'warning');
            return;
        }
        if (!deadline) {
            showNotification('Please set a Compliance Deadline date.', 'warning');
            return;
        }

        const newFileInput = document.getElementById('inspection-file');
        const newFileObj = newFileInput && newFileInput.files[0];

        const formData = new FormData();
        formData.append('id', id);
        formData.append('establishment', report.establishment || '');
        formData.append('location', report.location || '');
        formData.append('inspector', localStorage.getItem('username') || 'Inspector');
        formData.append('remarks', newRemarks);
        formData.append('recommendation', newRecommendation);
        formData.append('complied', '0');
        formData.append('compliance_deadline', deadline);
        formData.append('status', 'Submitted');
        formData.append('date', new Date().toISOString());
        if (newFileObj) formData.append('attachment', newFileObj);

        try {
            const res = await fetch(`${API_BASE_URL}/inspection.php`, {
                method: 'POST',
                body: formData
            });
            const result = await res.json();
            if (result.success) {
                showNotification('Re-inspection saved! Previous record moved to history.', 'success');

                // AUTO-SCHEDULE: push updated deadline to admin calendar
                const newDeadline = document.getElementById('inspection-deadline').value;
                if (newDeadline) {
                    autoScheduleToAdminCalendar(
                        localStorage.getItem('inspectorFullName') || localStorage.getItem('username') || 'Inspector',
                        newDeadline,
                        report.establishment
                    );
                }
            } else {
                showNotification('Error: ' + (result.message || 'Unknown error'), 'error');
                return;
            }
        } catch (err) {
            showNotification('Could not connect to server. Is XAMPP running?', 'error');
            console.error(err);
            return;
        }

        // Restore establishment field
        estabInput.readOnly = false;
        estabInput.style.backgroundColor = '';
        estabInput.style.cursor = '';
        estabInput.setAttribute('oninput', 'autoDetectBarangay(this.value)');

        closeInspectionModal();
        loadInspectionReports();
        form.onsubmit = handleInspectionSubmit;
    };

    // Update button label to make it clear this is a Re-Inspect, not a new save
    const saveBtn = document.getElementById('inspection-save-btn');
    if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-redo mr-2"></i>Submit Re-Inspection';

    document.getElementById('inspection-modal').showModal();
}

async function viewInspectionHistory(id) {
    const reports = window._inspectionReports || [];
    const report = reports.find(r => r.id === id);
    const estabName = report ? report.establishment : 'Establishment';

    let historyRows = '';
    try {
        const res = await fetch(`${API_BASE_URL}/inspection.php?history_id=${id}`);
        const result = await res.json();
        if (result.success && result.data && result.data.length > 0) {
            historyRows = result.data.map((h, i) => {
                const complied = h.complied === true || h.complied === 'true' || h.complied === 1;
                const dateStr = h.date ? new Date(h.date).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric'
                }) : 'N/A';
                const archivedStr = h.archived_at ? new Date(h.archived_at).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric'
                }) : 'N/A';
                return `
                <tr>
                    <td class="text-sm font-semibold text-gray-700">#${result.data.length - i}</td>
                    <td class="text-sm">${dateStr}</td>
                    <td class="text-sm max-w-xs">${esc(h.remarks) || 'N/A'}</td>
                    <td class="text-sm max-w-xs">${esc(h.recommendation) || 'N/A'}</td>
                    <td class="text-sm">
                        <span class="badge ${complied ? 'badge-success' : 'badge-warning'} text-white">
                            ${complied ? 'Complied' : 'Pending'}
                        </span>
                    </td>
                    <td class="text-sm text-gray-500">${esc(h.inspector) || 'N/A'}</td>
                    <td class="text-sm">
                        ${h.filePath
                            ? `<a href="${API_BASE_URL}/download.php?path=${encodeURIComponent(h.filePath)}" class="btn btn-xs btn-outline btn-success"><i class="fas fa-download mr-1"></i>${esc(h.file) || 'File'}</a>`
                            : (h.file ? `<span class="text-xs text-gray-400">${esc(h.file)} (unavailable)</span>` : '<span class="text-xs text-gray-300">None</span>')}
                    </td>
                </tr>`;
            }).join('');
        } else {
            historyRows = `
                <tr>
                    <td colspan="7" class="text-center py-6 text-gray-400">
                        <i class="fas fa-history mr-2"></i>No past inspections found for this establishment.
                    </td>
                </tr>`;
        }
    } catch (err) {
        historyRows = `
            <tr>
                <td colspan="7" class="text-center py-6 text-red-400">Failed to load history.</td>
            </tr>`;
    }

    const modal = document.createElement('dialog');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-box max-w-4xl">
            <h3 class="font-bold text-2xl text-emerald-700 mb-1">
                <i class="fas fa-history mr-2"></i>Inspection History
            </h3>
            <p class="text-gray-500 mb-4 text-sm">Past inspections for <strong>${esc(estabName)}</strong></p>
            <div class="overflow-x-auto">
                <table class="table table-zebra w-full text-sm">
                    <thead class="bg-emerald-100">
                        <tr>
                            <th>#</th>
                            <th>Inspection Date</th>
                            <th>Remarks</th>
                            <th>Recommendation</th>
                            <th>Status</th>
                            <th>Inspector</th>
                            <th>File</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${historyRows}
                    </tbody>
                </table>
            </div>
            <div class="modal-action">
                <button class="btn btn-ghost" onclick="this.closest('dialog').remove()">Close</button>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop">
            <button>close</button>
        </form>
    `;
    document.body.appendChild(modal);
    modal.showModal();
}

// View inspection report
function viewInspectionReport(index) {
    const reports = cachedInspectionReports.length > 0 ? cachedInspectionReports : (window._inspectionReports || []);
    const report = reports[index];
    
    if (!report) return;
    
    // Create a modal to view the report
    const modal = document.createElement('dialog');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-box max-w-2xl">
            <h3 class="font-bold text-2xl text-emerald-700 mb-4">
                <i class="fas fa-file-alt mr-2"></i>Inspection Report
            </h3>
            <div class="space-y-4">
                <div>
                    <label class="font-semibold text-gray-700">Date:</label>
                    <p class="text-gray-600">${new Date(report.date).toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })}</p>
                </div>
                <div>
                    <label class="font-semibold text-gray-700">Recommendation:</label>
                    <p class="text-gray-600 whitespace-pre-wrap">${esc(report.recommendation) || 'N/A'}</p>
                </div>
                <div>
                    <label class="font-semibold text-gray-700">Compliance Status:</label>
                    <p>
                        <span class="badge ${report.complied ? 'badge-success' : 'badge-warning'} badge-lg">
                            ${report.complied ? '✓ Complied' : '⚠ Not Complied'}
                        </span>
                    </p>
                </div>
                ${report.filePath ? `
                <div>
                    <label class="font-semibold text-gray-700">Attached File:</label>
                    <div class="flex items-center gap-3 mt-1">
                        <i class="fas ${report.file && report.file.toLowerCase().includes('.pdf') ? 'fa-file-pdf text-red-500' : 'fa-file-image text-blue-500'} text-2xl"></i>
                        <span class="text-gray-600">${esc(report.file)}</span>
                        <a href="${API_BASE_URL}/download.php?path=${encodeURIComponent(report.filePath)}" class="btn btn-sm btn-outline btn-success">
                            <i class="fas fa-download mr-1"></i>Download
                        </a>
                    </div>
                </div>
                ` : report.file ? `
                <div>
                    <label class="font-semibold text-gray-700">Attached File:</label>
                    <p class="text-gray-600">${esc(report.file)} <span class="text-xs text-gray-400">(file not available for download)</span></p>
                </div>
                ` : ''}
            </div>
            
            <div class="modal-action">
                <button class="btn btn-success text-white" onclick="printInspectionReport(${index})">
                    <i class="fas fa-print mr-2"></i>Print
                </button>
                <button class="btn btn-ghost" onclick="this.closest('dialog').remove()">Close</button>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop">
            <button>close</button>
        </form>
    `;
    
    document.body.appendChild(modal);
    modal.showModal();
}

// Edit inspection report
function editInspectionReport(index) {
    const reports = cachedInspectionReports.length > 0 ? cachedInspectionReports : (window._inspectionReports || []);
    const report = reports[index];
    
    if (!report) return;
    
    // Populate the form with existing data
    document.getElementById('inspection-recommendation').value = report.recommendation || '';
    document.getElementById('inspection-compliance').checked = report.complied || false;
    
    // Open modal pre-filled for editing
    document.getElementById('inspection-modal-title').innerHTML = '<i class="fas fa-edit mr-2"></i>Edit Inspection Report';
    document.getElementById('inspection-establishment').value = report.establishment || '';
    document.getElementById('inspection-remarks').value = report.remarks || '';
    document.getElementById('inspection-recommendation').value = report.recommendation || '';
    const sv = document.getElementById('selected-violations');
    if (sv) sv.innerHTML = '';
    const sr = document.getElementById('selected-recommendations');
    if (sr) sr.innerHTML = '';
    document.getElementById('inspection-compliance').checked = report.complied || false;

    const form = document.getElementById('inspection-form');
    form.onsubmit = function(e) {
        e.preventDefault();
        reports[index] = {
            ...report,
            establishment: document.getElementById('inspection-establishment').value.trim(),
            remarks: getCollectedRemarks(),
            recommendation: getCollectedRecommendations(),
            complied: document.getElementById('inspection-compliance').checked,
            file: report.file,
            fileData: report.fileData || '',
            fileType: report.fileType || '',
            lastModified: new Date().toISOString()
        };
        // Update cache (DB persistence happens via form submission)
        cachedInspectionReports = reports;
        window._inspectionReports = reports;
        showNotification('Inspection report updated successfully!', 'success');
        closeInspectionModal();
        loadInspectionReports();
        form.onsubmit = handleInspectionSubmit;
    };

    document.getElementById('inspection-modal').showModal();
}

// Print inspection report
function printInspectionReport(index) {
    const reports = cachedInspectionReports.length > 0 ? cachedInspectionReports : (window._inspectionReports || []);
    const report = reports[index];
    
    if (!report) return;
    
    const printWindow = window.open('', '', 'width=800,height=600');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Inspection Report</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 40px; }
                h1 { color: #059669; text-align: center; }
                .section { margin: 20px 0; }
                .label { font-weight: bold; color: #374151; }
                .value { margin: 5px 0 15px 0; color: #6B7280; }
                .badge { padding: 5px 10px; border-radius: 5px; display: inline-block; }
                .badge-success { background: #D1FAE5; color: #059669; }
                .badge-warning { background: #FEF3C7; color: #D97706; }
            </style>
        </head>
        <body>
            <h1>City Health Office - Tayabas</h1>
            <h2 style="text-align: center; color: #6B7280;">Inspection Report</h2>
            <hr style="margin: 20px 0;">
            
            <div class="section">
                <div class="label">Date:</div>
                <div class="value">${new Date(report.date).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })}</div>
            </div>
            
            <div class="section">
                <div class="label">Recommendation:</div>
                <div class="value" style="white-space: pre-wrap;">${esc(report.recommendation) || 'N/A'}</div>
            </div>
            
            <div class="section">
                <div class="label">Compliance Status:</div>
                <div class="value">
                    <span class="badge ${report.complied ? 'badge-success' : 'badge-warning'}">
                        ${report.complied ? '✓ Establishment Complied' : '⚠ Not Yet Complied'}
                    </span>
                </div>
            </div>
            
            ${report.file ? `
            <div class="section">
                <div class="label">Attached File:</div>
                <div class="value">${esc(report.file)}</div>
            </div>
            ` : ''}
            
            <div style="margin-top: 60px;">
                <div style="float: left; text-align: center; width: 45%;">
                    <div style="border-top: 2px solid #000; padding-top: 5px; margin-top: 40px;">
                        ${esc(localStorage.getItem('inspectorFullName') || report.inspector || 'Sanitary Inspector')}
                    </div>
                    <div style="font-size: 11px; color: #666;">Sanitary Inspector</div>
                </div>
                <div style="float: right; text-align: center; width: 45%;">
                    <div style="border-top: 2px solid #000; padding-top: 5px; margin-top: 40px;">
                        City Health Officer
                    </div>
                </div>
            </div>
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 250);
}

// Edit report — opens re-inspection modal via editInspectionReport(index)
function editReport() {
    showNotification('To edit a report, use the Edit button on the report list to open the re-inspection form.', 'info');
}

// ==================== BURIAL MODULE ====================

async function loadBurialRecords(type) {
    const tbody = document.getElementById(`${type}-table-body`);
    if (!tbody) return;

    try {
        const response = await fetch(`${API_BASE_URL}/burial.php`);
        const result = await response.json();

        if (!result.success) {
            const colspan = type === 'cadaver' ? 5 : 6;
            tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-8 text-red-500">Error: ${esc(result.message)}</td></tr>`;
            return;
        }

        cachedBurialRecords = {
            cadaver: result.data.cadaver || [],
            skeletal: result.data.skeletal || [],
            exhumation: result.data.exhumation || []
        };

        filterBurialRecords(type);
        updateBurialStatistics();
    } catch (error) {
        console.error('Error:', error);
    }
}

function openBurialModal(mode, type, id = null) {
    const modal = document.getElementById('burial-modal');
    const form = document.getElementById('burial-form');
    const title = document.getElementById('burial-modal-title');
    const submitBtn = document.getElementById('burial-submit-btn');
    const printBtn = document.getElementById('burial-print-btn');
    
    form.reset();
    document.getElementById('burial-mode').value = mode;
    document.getElementById('burial-type').value = type;
    document.getElementById('burial-id').value = id || '';

    // Show/hide fields based on burial type
    const cadaverFields = document.getElementById('cadaver-fields');
    const skeletalFields = document.getElementById('skeletal-fields');
    
    if (type === 'cadaver') {
        if (cadaverFields) cadaverFields.style.display = 'grid';
        if (skeletalFields) skeletalFields.style.display = 'none';
    } else {
        // For skeletal and exhumation
        if (cadaverFields) cadaverFields.style.display = 'none';
        if (skeletalFields) skeletalFields.style.display = 'grid';
    }

    // Handle button visibility and input states
    if (mode === 'add') {
        title.textContent = `Add ${type.charAt(0).toUpperCase() + type.slice(1)} Record`;
        submitBtn.style.display = 'inline-flex';
        printBtn.style.display = 'none';
        disableBurialInputs(false);
        startBurialRealtimeClock(); // ← Make sure this line exists!
    } else if (mode === 'edit') {
        title.textContent = `Edit ${type.charAt(0).toUpperCase() + type.slice(1)} Record`;
        submitBtn.style.display = 'inline-flex'; // Show save in edit
        printBtn.style.display = 'none';
        disableBurialInputs(false); // Enable inputs for editing
        stopBurialRealtimeClock();
        loadBurialData(type, id);
    } else if (mode === 'view') {
        title.textContent = `View ${type.charAt(0).toUpperCase() + type.slice(1)} Record`;
        submitBtn.style.display = 'none'; // REMOVE SAVE IN VIEW
        printBtn.style.display = 'inline-flex';
        disableBurialInputs(true); // Disable inputs for viewing
        stopBurialRealtimeClock();
        loadBurialData(type, id);
    }
    
    modal.showModal();
}

function loadBurialData(type, index) {
    // 1. Get the list of records from our fixed cache
    const records = cachedBurialRecords[type] || [];
    
    // 2. Find the specific record (FIXED: changed 'id' to 'index')
    const record = records.find(r => String(r.id) === String(index));

    if (!record) {
        console.error("Record not found in cache for ID:", index);
        showNotification('Record not found', 'error');
        return;
    }
    
    // 3. Fill the common fields
    document.getElementById('burial-id').value = index;
    const datetimeInput = document.getElementById('burial-datetime');
    
    // Format the date for the display
    if (record.datetime) {
        const date = new Date(record.datetime);
        if (!isNaN(date.getTime())) {
            datetimeInput.value = date.toLocaleString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
            datetimeInput.setAttribute('data-db-value', date.toISOString());
        } else {
            datetimeInput.value = record.datetime;
        }
    }

    document.getElementById('burial-deceased').value = record.deceased || '';
    document.getElementById('burial-death-date').value = record.deathDate || '';
    document.getElementById('burial-death-place').value = record.deathPlace || '';
    document.getElementById('burial-informant').value = record.informant || '';
    document.getElementById('burial-inspector').value = record.inspector || '';
    
    // 4. Fill type-specific fields
    if (type === 'cadaver') {
        // Restore saved origin barangay (now single barangay dropdown)
        const savedOriginBarangay = (record.origin || '').split(' | ').pop() || record.origin || '';
        if (savedOriginBarangay) {
            setTimeout(() => {
                const originSelect = document.getElementById('burial-origin-municipality');
                if (originSelect) originSelect.value = savedOriginBarangay;
            }, 600);
        }
        // Split saved transfer back into province and municipality
        const transferParts = (record.transfer || '').split(' | ');
        const savedTransferProvince = transferParts[0] || '';
        const savedTransferMunicipality = transferParts[1] || '';
        if (savedTransferProvince) {
            const transferProvSelect = document.getElementById('burial-transfer-province');
            transferProvSelect.value = savedTransferProvince;
            transferProvSelect.dispatchEvent(new Event('change'));
            setTimeout(() => {
                document.getElementById('burial-transfer-municipality').value = savedTransferMunicipality;
            }, 800);
        }
        document.getElementById('burial-funeral').value = record.funeral || '';
        document.getElementById('burial-or').value = record.orNumber || '';
    } else {
        // Restore saved cemetery origin barangay (now single barangay dropdown)
        const savedCemOriginBarangay = (record.cemeteryOrigin || '').split(' | ').pop() || record.cemeteryOrigin || '';
        if (savedCemOriginBarangay) {
            setTimeout(() => {
                const cemOriginSelect = document.getElementById('burial-cemetery-origin-municipality');
                if (cemOriginSelect) cemOriginSelect.value = savedCemOriginBarangay;
            }, 600);
        }

        // Split saved cemetery transfer back into province and municipality
        const cemeteryTransferParts = (record.cemeteryTransfer || '').split(' | ');
        const savedCemTransferProvince = cemeteryTransferParts[0] || '';
        const savedCemTransferMunicipality = cemeteryTransferParts[1] || '';
        if (savedCemTransferProvince) {
            const cemTransferProvSelect = document.getElementById('burial-cemetery-transfer-province');
            cemTransferProvSelect.value = savedCemTransferProvince;
            cemTransferProvSelect.dispatchEvent(new Event('change'));
            setTimeout(() => {
                document.getElementById('burial-cemetery-transfer-municipality').value = savedCemTransferMunicipality;
            }, 800);
        }
        document.getElementById('burial-funeral-skeletal').value = record.funeral || '';
        document.getElementById('burial-or-skeletal').value = record.orNumberSkeletal || record.orNumber || '';
    }

    // 5. Show download link if a death certificate file exists
    const certPreview = document.getElementById('burial-cert-preview');
    if (certPreview && record.filePath) {
        certPreview.innerHTML = `
            <div class="flex items-center gap-3 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                <i class="fas ${record.fileName && record.fileName.toLowerCase().includes('.pdf') ? 'fa-file-pdf text-red-500' : 'fa-file-image text-blue-500'} text-2xl"></i>
                <div class="flex-1">
                    <p class="font-semibold text-sm">${esc(record.fileName || 'Death Certificate')}</p>
                </div>
                <a href="${API_BASE_URL}/download.php?path=${encodeURIComponent(record.filePath)}" class="btn btn-sm btn-outline btn-success">
                    <i class="fas fa-download mr-1"></i>Download
                </a>
            </div>
        `;
    }
}

async function handleBurialSubmit(e) {
    e.preventDefault();

    const mode = document.getElementById('burial-mode').value;
    const type = document.getElementById('burial-type').value; // This is the 'cadaver', 'skeletal', or 'exhumation'
    const burialId = document.getElementById('burial-id').value;
    const datetimeInput = document.getElementById('burial-datetime');

    // Build the data object with keys matching your PHP $input names
    const record = {
        type: type, 
        datetime: datetimeInput.getAttribute('data-db-value') || datetimeInput.value,
        deceased: document.getElementById('burial-deceased').value.trim(),
        deathDate: document.getElementById('burial-death-date').value,
        deathPlace: document.getElementById('burial-death-place').value.trim(),
        informant: document.getElementById('burial-informant').value.trim(),
        inspector: document.getElementById('burial-inspector').value.trim(),
        
        // These fields are essential for Skeletal and Exhumation
        origin: (() => {
            const muni = (document.getElementById('burial-origin-municipality') || {value: ''}).value.trim();
            return muni;
        })(),
        transfer: (() => {
            const prov = (document.getElementById('burial-transfer-province') || {value: ''}).value.trim();
            const muni = (document.getElementById('burial-transfer-municipality') || {value: ''}).value.trim();
            return prov && muni ? `${prov} | ${muni}` : (prov || muni);
        })(),
        funeral: (document.getElementById(type === 'cadaver' ? 'burial-funeral' : 'burial-funeral-skeletal') || {value: ''}).value.trim(),
        cemeteryOrigin: (() => {
            const muni = (document.getElementById('burial-cemetery-origin-municipality') || {value: ''}).value.trim();
            return muni;
        })(),
        cemeteryTransfer: (() => {
            const prov = (document.getElementById('burial-cemetery-transfer-province') || {value: ''}).value.trim();
            const muni = (document.getElementById('burial-cemetery-transfer-municipality') || {value: ''}).value.trim();
            return prov && muni ? `${prov} | ${muni}` : (prov || muni);
        })(),
        orNumber: (document.getElementById(type === 'cadaver' ? 'burial-or' : 'burial-or-skeletal') || {value: ''}).value.trim()
    };

    try {
        const formData = new FormData();
        formData.append('type', record.type);
        formData.append('datetime', record.datetime);
        formData.append('deceased', record.deceased);
        formData.append('deathDate', record.deathDate);
        formData.append('deathPlace', record.deathPlace);
        formData.append('informant', record.informant);
        formData.append('inspector', record.inspector);
        formData.append('origin', record.origin);
        formData.append('transfer', record.transfer);
        formData.append('funeral', record.funeral);
        formData.append('cemeteryOrigin', record.cemeteryOrigin);
        formData.append('cemeteryTransfer', record.cemeteryTransfer);
        formData.append('orNumber', record.orNumber);
        if (mode === 'edit') formData.append('id', burialId);

        const fileInput = document.getElementById('burial-death-cert');
        if (fileInput && fileInput.files[0]) {
            formData.append('attachment', fileInput.files[0]);
        }

        const response = await fetch(`${API_BASE_URL}/burial.php`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            document.getElementById('burial-modal').close();

            // CRITICAL: Refresh the specific table where the record belongs
            await loadBurialRecords(type);
            updateBurialStatistics();

            showNotification(`${type.charAt(0).toUpperCase() + type.slice(1)} record saved!`, 'success');
            localStorage.removeItem(FormDrafts.KEYS.burial);
        } else {
            alert('Server Error: ' + result.message);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to save. Check your connection.');
    }

}

function viewBurial(type, id) {
    openBurialModal('view', type, id);
}

function editBurial(type, id) {
    openBurialModal('edit', type, id);
}

function closeBurialModal() {
    document.getElementById('burial-modal').close();
    document.getElementById('burial-cert-preview').innerHTML = '';
}

function printBurial() {
    window.print();
}

function disableBurialInputs(disable) {
    const form = document.getElementById('burial-form');
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        // Don't disable the close/cancel buttons
        if (!input.classList.contains('btn-ghost') && input.id !== 'burial-cancel-btn') {
            input.disabled = disable;
        }
    });
}

// ==================== DELETE FUNCTIONALITY ====================

let deleteContext = {};

function openDeleteModal(recordType, index, subType = null) {
    deleteContext = { recordType, index, subType };
    const modal = document.getElementById('delete-modal');
    modal.showModal();
    
    document.getElementById('confirm-delete-btn').onclick = confirmDelete;
}

async function confirmDelete() {
    const { recordType, index, subType } = deleteContext;
    
    if (recordType === 'sanitary') {
        try {
            const response = await fetch(`${API_BASE_URL}/sanitary.php?id=${index}`, {
                method: 'DELETE'
            });
            const result = await response.json();
            if (result.success) {
                showNotification('Record deleted successfully!', 'success');
            } else {
                showNotification('Error deleting record: ' + result.message, 'error');
            }
        } catch (error) {
            showNotification('Could not connect to server.', 'error');
        }
        loadSanitaryRecords();
    } else if (recordType === 'burial') {
        cachedBurialRecords[subType].splice(index, 1);
        loadBurialRecords(subType);
    }
    
    closeDeleteModal();
    showNotification('Record deleted successfully!');
}

function closeDeleteModal() {
    document.getElementById('delete-modal').close();
    deleteContext = {};
}

// ==================== FILE HANDLING ====================

function handleFilePreview(input, previewId) {

    const previewContainer = document.getElementById(previewId);
    previewContainer.innerHTML = '';

    if (input.files && input.files[0]) {
        const file = input.files[0];
        const fileItem = document.createElement('div');
        fileItem.className = 'file-preview-item flex items-center gap-3 p-3 bg-emerald-50 rounded-lg border border-emerald-200';
        const icon = file.type.includes('pdf') ? 'fa-file-pdf' : 'fa-file-image';
        const color = file.type.includes('pdf') ? 'text-red-500' : 'text-blue-500';

        fileItem.innerHTML = `
            <i class="fas ${icon} ${color} text-2xl"></i>
            <div class="flex-1">
                <p class="font-semibold text-sm">${esc(file.name)}</p>
                <p class="text-xs text-gray-500">${(file.size / 1024).toFixed(2)} KB</p>
            </div>

            <button type="button" class="btn btn-sm btn-circle btn-ghost"
                    onclick="clearFilePreview('${input.id}','${previewId}')">
                <i class="fas fa-times"></i>
            </button>
        `;
        previewContainer.appendChild(fileItem);
    }
}


function clearFilePreview(inputId, previewId) {
    document.getElementById(inputId).value = '';
    document.getElementById(previewId).innerHTML = '';
}


// ── Global reference to the original image for re-processing ─────────────
let _deathCertOriginalImg = null;

async function handleDeathCertUpload(input) {
    const previewContainer = document.getElementById('burial-cert-preview');
    previewContainer.innerHTML = '';
    document.getElementById('ai-reading-status').style.display = 'none';
    document.getElementById('ai-success-status').style.display = 'none';
    document.getElementById('ai-error-status').style.display = 'none';
    _deathCertOriginalImg = null;

    if (!input.files || !input.files[0]) return;
    const file = input.files[0];

    // ── File name/size preview ────────────────────────────────────────────
    const fileItem = document.createElement('div');
    fileItem.className = 'file-preview-item flex items-center gap-3 p-3 bg-emerald-50 rounded-lg border border-emerald-200';
    const icon  = file.type.includes('pdf') ? 'fa-file-pdf' : 'fa-file-image';
    const color = file.type.includes('pdf') ? 'text-red-500' : 'text-blue-500';
    fileItem.innerHTML = `
        <i class="fas ${icon} ${color} text-2xl"></i>
        <div class="flex-1">
            <p class="font-semibold text-sm">${esc(file.name)}</p>
            <p class="text-xs text-gray-500">${(file.size / 1024).toFixed(2)} KB</p>
        </div>
        <button type="button" class="btn btn-sm btn-circle btn-ghost"
                onclick="clearFilePreview('burial-death-cert','burial-cert-preview');">
            <i class="fas fa-times"></i>
        </button>
    `;
    previewContainer.appendChild(fileItem);
    if (file.type.includes('pdf')) return;

    // ── Load image silently ───────────────────────────────────────────────
    const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload  = () => res(i);
        i.onerror = rej;
        i.src = URL.createObjectURL(file);
    });

    _deathCertOriginalImg = img;

    // ── AI auto-enhances then immediately runs OCR ────────────────────────
    applyDeathCertEnhancement();
    runDeathCertOCR();
}

function applyDeathCertEnhancement() {
    if (!_deathCertOriginalImg) return;

    // ── Fixed optimal settings for OCR — user never touches these ────────
    const brightness = 10;      // slight brightness lift
    const contrast   = 60;      // strong contrast for crisp text
    const sharpness  = 7;       // heavy sharpening
    const scale      = 3;       // 3× upscale for fine text

    const img    = _deathCertOriginalImg;
    const canvas = document.getElementById('enhancer-canvas');
    canvas.width  = Math.round(img.width  * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');

    // Use high-quality image smoothing when upscaling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // ── Convert to grayscale + brightness + contrast ──────────────────────
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

    for (let i = 0; i < d.length; i += 4) {
        let gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
        gray += brightness;
        gray = contrastFactor * (gray - 128) + 128;
        gray = Math.min(255, Math.max(0, gray));
        d[i] = d[i+1] = d[i+2] = gray;
    }
    ctx.putImageData(imageData, 0, 0);

    // ── Sharpness via unsharp mask convolution ───────────────────────────
    const amount = sharpness * 0.15;
    const w = canvas.width, h = canvas.height;
    const src = ctx.getImageData(0, 0, w, h);
    const dst = ctx.createImageData(w, h);
    const s = src.data, o = dst.data;

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const idx = (y * w + x) * 4;
            for (let c = 0; c < 3; c++) {
                const center = s[idx + c];
                const neighbors =
                    s[((y-1)*w + x    ) * 4 + c] +
                    s[((y+1)*w + x    ) * 4 + c] +
                    s[(y    *w + x - 1) * 4 + c] +
                    s[(y    *w + x + 1) * 4 + c];
                const sharpened = center + amount * (4 * center - neighbors);
                o[idx + c] = Math.min(255, Math.max(0, sharpened));
            }
            o[idx + 3] = 255;
        }
    }
    ctx.putImageData(dst, 0, 0);
}

async function runDeathCertOCR() {
    const canvas     = document.getElementById('enhancer-canvas');
    const statusDiv  = document.getElementById('ai-reading-status');
    const statusSpan = statusDiv.querySelector('span.text-sm');

    document.getElementById('ai-success-status').style.display = 'none';
    document.getElementById('ai-error-status').style.display   = 'none';
    statusDiv.style.display = 'block';
    statusSpan.textContent  = 'AI enhancing & reading certificate — please wait...';

    try {
        const { data: { text } } = await Tesseract.recognize(canvas, 'eng', {
            logger: m => {
                if (m.status === 'recognizing text')
                    statusSpan.textContent = `Reading certificate... ${Math.round(m.progress * 100)}%`;
            }
        });



        const raw   = text.replace(/[ \t]+/g, ' ');
        const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const full  = lines.join(' ');
        const upper = full.toUpperCase();

        // ─────────────────────────────────────────────────────────────────
        // UTILITY: find first line index containing ANY of the keywords
        // ─────────────────────────────────────────────────────────────────
        function findLine(keywords) {
            for (let i = 0; i < lines.length; i++) {
                const u = lines[i].toUpperCase();
                if (keywords.some(k => u.includes(k.toUpperCase()))) return i;
            }
            return -1;
        }

        // UTILITY: scan a window of lines for a date string
        const MONTHS = {
            jan:1,feb:2,mar:3,apr:4,may:5,jun:6,
            jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
            january:1,february:2,march:3,april:4,june:6,july:7,
            august:8,september:9,october:10,november:11,december:12
        };

        function parseDate(str) {
            // "15 June 1997" or "15 Jun 1997"
            let m = str.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
            if (m) {
                const mo = MONTHS[m[2].toLowerCase().slice(0,3)];
                if (mo) return `${m[3]}-${String(mo).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
            }
            // "June 15, 1997"
            m = str.match(/([A-Za-z]{3,9})\s+(\d{1,2})[,\s]+(\d{4})/);
            if (m) {
                const mo = MONTHS[m[1].toLowerCase().slice(0,3)];
                if (mo) return `${m[3]}-${String(mo).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
            }
            // "5/16/97" or "5/16/1997"
            m = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
            if (m) {
                let yr = m[3]; if (yr.length === 2) yr = '19' + yr;
                return `${yr}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
            }
            return '';
        }

        // ═════════════════════════════════════════════════════════════════
        // 1. NAME OF DECEASED
        //    Philippine cert format: row "1. NAME" then three separate
        //    cells for (First) (Middle) (Last) on the same or next lines.
        //    Strategy: grab up to 3 ALL-CAPS name tokens after "1. NAME"
        //    stopping before the next numbered item or keyword.
        // ═════════════════════════════════════════════════════════════════
        let deceased = '';
        const nameIdx = findLine(['1. NAME', '1.NAME', '(FIRST)', 'FIRST)']);
        if (nameIdx !== -1) {
            const nameParts = [];
            for (let i = nameIdx; i < Math.min(nameIdx + 10, lines.length); i++) {
                const l = lines[i];
                // Stop when we hit next section headers
                if (i > nameIdx && /^\d+\.|SEX|RELIGION|DATE OF|PLACE OF|CIVIL STATUS/i.test(l)) break;
                // Split line into tokens and collect name-like words
                const tokens = l.split(/\s+/);
                for (const tok of tokens) {
                    // Accept tokens that are purely uppercase letters (2+ chars), dots, hyphens
                    if (/^[A-ZÁÉÍÓÚ][A-ZÁÉÍÓÚÑ.\-]{1,}$/.test(tok) &&
                        !/^(NAME|FIRST|MIDDLE|LAST|SEX|AGE|MALE|FEMALE|RELIGION|CIVIL|DATE|PLACE|OF|THE|AND|A|AN)$/i.test(tok)) {
                        nameParts.push(tok);
                    }
                }
                if (nameParts.length >= 3) break;
            }
            if (nameParts.length >= 2) deceased = nameParts.slice(0, 4).join(' ');
        }

        // Fallback: scan full text for "JUSTA EDORA REYES" style — a run of 2-4
        // capitalised words not matching form labels, appearing near the top
        if (!deceased) {
            const SKIP = /REPUBLIC|PHILIPPINE|OFFICE|CIVIL|CERTIFICATE|DEATH|REGISTRAR|PROVINCE|MUNICIPALITY|BARANGAY|CITY|FORM|REVISED|MEDICAL|CAUSE|BURIAL|CORPSE|AUTOPSY|INFORMANT|PREPARED|RECEIVED|REGISTERED|SIGNATURE|ADDRESS|RELATIONSHIP|CERTIFICATION|REMARKS|ANNOTATION/i;
            for (let i = 0; i < Math.min(lines.length, 25); i++) {
                const l = lines[i].trim();
                const words = l.split(/\s+/);
                const nameWords = words.filter(w => /^[A-Z][A-Z.\-]{1,}$/.test(w) && w.length > 1);
                if (nameWords.length >= 2 && nameWords.length <= 5 && !SKIP.test(l)) {
                    deceased = nameWords.join(' ');
                    break;
                }
            }
        }

        // ═════════════════════════════════════════════════════════════════
        // 2. DATE OF DEATH
        //    Label is "6. DATE OF DEATH" on Philippine form (not item 3).
        //    Then day / month / year in separate boxes on the same line.
        //    Also try a broad scan for any date pattern in the full text.
        // ═════════════════════════════════════════════════════════════════
        let deathDate = '';

        // Search in the window around the label
        const dateIdx = findLine(['DATE OF DEATH', '3. DATE', '3.DATE']);
        if (dateIdx !== -1) {
            for (let i = dateIdx; i <= dateIdx + 5 && i < lines.length; i++) {
                deathDate = parseDate(lines[i]);
                if (deathDate) break;
            }
        }

        // Broad fallback: scan whole text for a month-name date
        if (!deathDate) {
            const mx = upper.match(/(\d{1,2})\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(\d{4})/);
            if (mx) {
                const mo = MONTHS[mx[2].toLowerCase().slice(0,3)];
                if (mo) deathDate = `${mx[3]}-${String(mo).padStart(2,'0')}-${String(mx[1]).padStart(2,'0')}`;
            }
        }

        // Fallback: any slash date like "6/15/97"
        if (!deathDate) {
            const mx = full.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
            if (mx) {
                let yr = mx[3]; if (yr.length === 2) yr = '19' + yr;
                deathDate = `${yr}-${String(mx[2]).padStart(2,'0')}-${String(mx[1]).padStart(2,'0')}`;
            }
        }

        // ═════════════════════════════════════════════════════════════════
        // 3. PLACE OF DEATH
        //    Label "5. PLACE OF DEATH" — value is City/Municipality +
        //    Province on the same or following line.
        //    We look for "Tayabas" / "Quezon" pattern.
        // ═════════════════════════════════════════════════════════════════
        let deathPlace = '';
        const placeIdx = findLine(['PLACE OF DEATH', '6. PLACE', '6.PLACE']);
        if (placeIdx !== -1) {
            // Collect text from the label line and next 3 lines
            const window = lines.slice(placeIdx, placeIdx + 4).join(' ');
            // Remove the label itself
            const stripped = window.replace(/5\.?\s*PLACE\s*OF\s*DEATH/i, '').replace(/\(.*?\)/g, '').trim();
            // Match "Brgy. Matiama Tayabas, Quezon" style
            const loc = stripped.match(/([A-Za-z.,\s]{3,60})/);
            if (loc) {
                deathPlace = loc[1].replace(/^\s*[,.\s]+/, '').trim();
            }
        }

        // Fallback: look for "Tayabas" + "Quezon" anywhere
        if (!deathPlace) {
            const mx = full.match(/(Brgy\.?\s+\w+[\s,]+\w[\w\s,]+(?:Quezon|Manila|Cavite|Laguna|Batangas|Rizal|Bulacan|Pampanga|Cebu|Davao))/i);
            if (mx) deathPlace = mx[1].trim();
        }

        // ═════════════════════════════════════════════════════════════════
        // 4. INFORMANT
        //    Label "25. INFORMANT" — look for "Name in Print" line which
        //    contains the clean printed name (not the signature scribble).
        // ═════════════════════════════════════════════════════════════════
        let informant = '';
        const informantIdx = findLine(['26. INFORMANT', '26.INFORMANT', 'INFORMANT']);
        if (informantIdx !== -1) {
            // Search the next several lines for "Name in Print" then grab its value
            for (let i = informantIdx; i < Math.min(informantIdx + 8, lines.length); i++) {
                const l = lines[i];
                if (/NAME\s*IN\s*PRINT/i.test(l)) {
                    // Value is either on the same line after the label, or on the next line
                    const same = l.replace(/NAME\s*IN\s*PRINT/i, '').replace(/[^A-Za-z.\s]/g,'').trim();
                    if (same.length > 3) { informant = same; break; }
                    if (i + 1 < lines.length) {
                        const next = lines[i+1].replace(/[^A-Za-z.\s]/g,'').trim();
                        if (next.length > 3 && !/RELATIONSHIP|DATE|SIGNATURE|ADDRESS/i.test(next)) {
                            informant = next; break;
                        }
                    }
                }
            }
        }

        
        if (!informant && informantIdx !== -1) {
            for (let i = informantIdx + 1; i < Math.min(informantIdx + 6, lines.length); i++) {
                const l = lines[i].replace(/[^A-Za-z.\s]/g,'').trim();
                if (l.length > 4 && /^[A-Z]/.test(l) && !/RELATIONSHIP|DATE|ADDRESS|SIGNATURE|INFORMANT|PREPARED|RECEIVED/i.test(l)) {
                    informant = l; break;
                }
            }
        }

        // ── Clean up ─────────────────────────────────────────────────────
        deceased   = deceased.replace(/\s+/g,' ').trim();
        deathPlace = deathPlace.replace(/\s+/g,' ').replace(/^[,.\s]+|[,.\s]+$/g,'').trim();
        informant  = informant.replace(/\s+/g,' ').trim();

        // ── Inject into form fields ───────────────────────────────────────
        if (deceased)   document.getElementById('burial-deceased').value    = deceased;
        if (deathDate)  document.getElementById('burial-death-date').value  = deathDate;
        if (deathPlace) document.getElementById('burial-death-place').value = deathPlace;
        if (informant)  document.getElementById('burial-informant').value   = informant;



        statusDiv.style.display = 'none';

        if (deceased || deathDate || deathPlace || informant) {
            document.getElementById('ai-success-status').style.display = 'block';
        } else {
            document.getElementById('ai-error-msg').textContent =
                'Could not extract fields. Open Console (F12) for raw OCR text, then fill manually.';
            document.getElementById('ai-error-status').style.display = 'block';
        }

    } catch (err) {
        console.error('Tesseract error:', err);
        document.getElementById('ai-reading-status').style.display = 'none';
        document.getElementById('ai-error-msg').textContent =
            'OCR error: ' + err.message + '. Check your internet connection and try again.';
        document.getElementById('ai-error-status').style.display = 'block';
    }
}

// ==================== UTILITY FUNCTIONS ====================

function esc(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/`/g, '&#96;');
}

function formatDateTime(dateTimeString) {
    if (!dateTimeString || dateTimeString === '0000-00-00 00:00:00') return 'N/A';
    const date = new Date(dateTimeString);
    return isNaN(date.getTime()) ? dateTimeString : date.toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatDate(dateString) {
    if (!dateString || dateString === '0000-00-00') return 'N/A';
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? dateString : date.toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });
}

function showNotification(message, type = 'success') {
    // Remove any existing notifications
    const existingToasts = document.querySelectorAll('.toast-notification');
    existingToasts.forEach(t => t.remove());
    
    // Define styles based on type
    const types = {
        success: { bg: 'bg-emerald-600', icon: 'fa-check-circle' },
        error: { bg: 'bg-red-600', icon: 'fa-exclamation-circle' },
        warning: { bg: 'bg-yellow-500', icon: 'fa-exclamation-triangle' },
        info: { bg: 'bg-blue-600', icon: 'fa-info-circle' }
    };
    
    const style = types[type] || types.success;
    
    // Create toast notification
    const toast = document.createElement('div');
    toast.className = `toast-notification fixed bottom-4 right-4 ${style.bg} text-white px-6 py-4 rounded-lg shadow-2xl z-[9999] transition-all transform`;
    toast.style.animation = 'slideInRight 0.3s ease-out';
    toast.innerHTML = `
        <div class="flex items-center gap-3">
            <i class="fas ${style.icon} text-xl"></i>
            <span class="font-medium">${esc(message)}</span>
            <button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-white hover:text-gray-200">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    document.body.appendChild(toast);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease-in';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Loading spinner functions
function showLoading(message = 'Processing...') {
    // Remove existing loader
    hideLoading();
    
    const loader = document.createElement('div');
    loader.id = 'loading-overlay';
    loader.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]';
    loader.innerHTML = `
        <div class="bg-white rounded-lg p-8 shadow-2xl flex flex-col items-center gap-4">
            <div class="animate-spin rounded-full h-16 w-16 border-b-4 border-emerald-600"></div>
            <p class="text-lg font-semibold text-gray-700">${esc(message)}</p>
        </div>
    `;
    
    document.body.appendChild(loader);
}

function hideLoading() {
    const loader = document.getElementById('loading-overlay');
    if (loader) loader.remove();
}

// NUMBERS ONLY INPUTS
function numbersOnly(id) {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener('input', (e) => {
        // Remove any non-numeric characters
        el.value = el.value.replace(/[^0-9]/g, '');
    });

    el.addEventListener('keypress', (e) => {
        // Only allow numbers 0-9
        const charCode = e.which ? e.which : e.keyCode;
        if (charCode > 31 && (charCode < 48 || charCode > 57)) {
            e.preventDefault();
            return false;
        }
        return true;
    });

    el.addEventListener('paste', (e) => {
        // Handle paste events
        e.preventDefault();
        const pastedText = (e.clipboardData || window.clipboardData).getData('text');
        const numbersOnly = pastedText.replace(/[^0-9]/g, '');
        document.execCommand('insertText', false, numbersOnly);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    numbersOnly('sanitary-no');
    numbersOnly('sanitary-permit');
    numbersOnly('sanitary-health-card');
    numbersOnly('burial-or');
    numbersOnly('burial-or-skeletal');
    
    // Sanitary Permit validation
    sanitaryPermitValidation();
});

// Sanitary Permit Number Validation
function sanitaryPermitValidation() {
    const permit1 = document.getElementById('sanitary-permit-1');
    if (permit1) {
        permit1.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        });
        permit1.addEventListener('keypress', (e) => {
            const charCode = e.which ? e.which : e.keyCode;
            if (charCode > 31 && (charCode < 48 || charCode > 57)) {
                e.preventDefault();
            }
        });
    }



    const permit3 = document.getElementById('sanitary-permit-3');
    if (permit3) {
        permit3.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
        });
        permit3.addEventListener('keypress', (e) => {
            const charCode = e.which ? e.which : e.keyCode;
            if (!(charCode >= 65 && charCode <= 90) && !(charCode >= 97 && charCode <= 122)) {
                e.preventDefault();
            }
        });
        permit3.addEventListener('paste', (e) => {
            e.preventDefault();
            const pastedText = (e.clipboardData || window.clipboardData).getData('text');
            const lettersOnly = pastedText.replace(/[^a-zA-Z]/g, '').toUpperCase();
            document.execCommand('insertText', false, lettersOnly);
        });
    }
}

let burialClockInterval = null;

function startBurialRealtimeClock() {
    // Update immediately
    updateBurialDateTime();
    
    // Update every second
    burialClockInterval = setInterval(updateBurialDateTime, 1000);
}

function updateBurialDateTime() {
    const datetimeInput = document.getElementById('burial-datetime');
    if (datetimeInput) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours24 = now.getHours();
        const minutes = String(now.getMinutes()).padStart(2, '0');
        
        // Convert to 12-hour format
        const hours12 = hours24 % 12 || 12;
        const ampm = hours24 >= 12 ? 'PM' : 'AM';
        
        const formattedForInput = `${month}/${day}/${year} ${hours12}:${minutes} ${ampm}`;

        datetimeInput.value = formattedForInput;
        datetimeInput.setAttribute('data-db-value', now.toISOString());
    }
}

function stopBurialRealtimeClock() {
    if (burialClockInterval) {
        clearInterval(burialClockInterval);
        burialClockInterval = null;
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', stopBurialRealtimeClock);

// ==================== PROFILE & SETTINGS FUNCTIONS ====================

// Open Profile Modal
async function openProfileModal() {
    const modal = document.getElementById('profile-modal');
    try {
        const resp = await fetch(`${API_BASE_URL}/auth.php`);
        const json = await resp.json();
        if (json.success && json.data) {
            const d = json.data;
            const fullnameEl = document.getElementById('insp-profile-fullname');
            const usernameEl = document.getElementById('insp-profile-username');
            const emailEl    = document.getElementById('insp-profile-email');
            const roleEl     = document.getElementById('insp-profile-role');
            const avatarEl   = document.getElementById('insp-profile-avatar');
            if (usernameEl) usernameEl.value = d.username || '';
            if (roleEl)     roleEl.value = 'Sanitary Inspector';
            // Get full name from session or localStorage
            let displayName = localStorage.getItem('inspectorDisplayName') || d.fullName || '';
            if (fullnameEl) fullnameEl.value = displayName;
            if (avatarEl && displayName) {
                avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=10b981&color=fff&size=200`;
            }
            // Fetch email from inspector_accounts
            try {
                const inspResp = await fetch(`${API_BASE_URL}/inspector.php`);
                const inspJson = await inspResp.json();
                if (inspJson.success && Array.isArray(inspJson.data)) {
                    const me = inspJson.data.find(i => i.username === d.username);
                    if (me && emailEl) emailEl.value = me.email || '';
                    // Use server name if no saved display name
                    if (me && me.fullName && !localStorage.getItem('inspectorDisplayName')) {
                        if (fullnameEl) fullnameEl.value = me.fullName;
                        if (avatarEl) {
                            avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(me.fullName)}&background=10b981&color=fff&size=200`;
                        }
                    }
                }
            } catch (e2) {}
        }
    } catch (e) {
        // Show defaults if fetch fails
    }
    modal.showModal();
}

// Save Inspector Profile
function handleInspSaveProfile() {
    const fullnameEl = document.getElementById('insp-profile-fullname');
    const name = (fullnameEl?.value || '').trim();

    if (!name) {
        showNotification('Display name cannot be empty.', 'error');
        return;
    }

    // Save display name to localStorage
    localStorage.setItem('inspectorDisplayName', name);
    localStorage.setItem('inspectorFullName', name);

    // Update navbar welcome name
    const nameDisplay = document.getElementById('insp-username-display');
    if (nameDisplay) nameDisplay.textContent = name;

    // Update avatar
    const avatarEl = document.getElementById('insp-profile-avatar');
    if (avatarEl) {
        avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=10b981&color=fff&size=200`;
    }

    showNotification('Profile updated successfully.', 'success');
}

// Close Profile Modal
function closeProfileModal() {
    const modal = document.getElementById('profile-modal');
    modal.close();
}

// Open Settings Modal
function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.showModal();
}

// Close Settings Modal
function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.close();
}

// ==================== THEME TOGGLE ====================
function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('tayabasTheme', next);
    updateThemeUI(next);
}

function updateThemeUI(theme) {
    const isDark = theme === 'dark';
    const toggleEl = document.getElementById('insp-theme-toggle');
    if (toggleEl) {
        toggleEl.innerHTML = isDark
            ? '<i class="bi bi-moon-stars text-blue-300 text-lg"></i>'
            : '<i class="bi bi-sun text-amber-500 text-lg"></i>';
    }
    const labelEl = document.getElementById('insp-theme-label');
    if (labelEl) {
        labelEl.textContent = isDark ? 'Dark mode is on' : 'Switch between light and dark mode';
    }
}

// Apply saved theme on load
(function applySavedTheme() {
    const saved = localStorage.getItem('tayabasTheme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeUI(saved);
})();

// Open Change Password Modal
function openChangePasswordModal() {
    // Close settings modal first
    closeSettingsModal();
    
    // Reset form
    document.getElementById('change-password-form').reset();
    
    // Open change password modal
    const modal = document.getElementById('change-password-modal');
    modal.showModal();
}

// Close Change Password Modal
function closeChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    modal.close();
    document.getElementById('change-password-form').reset();
}

// Toggle Password Visibility
function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    const icon = input.parentElement.querySelector('i');
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

// Handle Change Password Form Submission
async function handleChangePassword(e) {
    e.preventDefault();
    
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    
    // Validate passwords match
    if (newPassword !== confirmPassword) {
        alert('New password and confirm password do not match!');
        return;
    }
    
    // Validate password length
    if (newPassword.length < 6) {
        alert('Password must be at least 6 characters long!');
        return;
    }
    
    // Validate new password is different from current
    if (currentPassword === newPassword) {
        alert('New password must be different from current password!');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/change_password.php`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include', // ADD THIS LINE - Important for sending session cookies
            body: JSON.stringify({
                currentPassword: currentPassword,
                newPassword: newPassword
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('Password changed successfully!', 'success');
            closeChangePasswordModal();
            
            // Optional: Auto logout after password change
            setTimeout(() => {
                showNotification('Please login again with your new password', 'info');
                setTimeout(() => {
                    handleLogout();
                }, 2000);
            }, 1500);
        } else {
            alert('Error: ' + (result.message || 'Failed to change password'));
        }
    } catch (error) {
        console.error('Error changing password:', error);
        alert('Error changing password. Please try again.');
    }
}

// Custom Inspector Dropdown Functions
function toggleInspectorDropdown() {
    const dropdown = document.getElementById('burial-inspector-options');
    const selected = document.getElementById('inspector-dropdown-selected');
    
    dropdown.classList.toggle('show');
    selected.classList.toggle('active');
}

function selectInspector(value, name, rank) {
    const hiddenInput = document.getElementById('burial-inspector');
    const selectedDiv = document.getElementById('inspector-dropdown-selected');
    const dropdown = document.getElementById('burial-inspector-options');
    
    // Update hidden input value
    hiddenInput.value = value;
    
    // Update displayed text
    if (value === '') {
        selectedDiv.querySelector('.selected-text').textContent = 'Select Inspector';
    } else {
        selectedDiv.querySelector('.selected-text').textContent = name;
    }
    
    // Close dropdown
    dropdown.classList.remove('show');
    selectedDiv.classList.remove('active');
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const container = document.querySelector('.custom-dropdown-container');
    const dropdown = document.getElementById('burial-inspector-options');
    const selected = document.getElementById('inspector-dropdown-selected');
    
    if (container && !container.contains(event.target)) {
        if (dropdown) dropdown.classList.remove('show');
        if (selected) selected.classList.remove('active');
    }
});

// ============================================================
// Burial Place of Origin — Barangay of Tayabas City (API)
// ============================================================
async function loadBurialOriginBarangays() {
    const select = document.getElementById('burial-origin-municipality');
    if (!select) return;

    // Lock province to show Tayabas City
    const provSelect = document.getElementById('burial-origin-province');
    if (provSelect) {
        provSelect.innerHTML = '<option value="Tayabas City">Tayabas City</option>';
        provSelect.value = 'Tayabas City';
        provSelect.disabled = true;
    }

    select.innerHTML = '<option value="">Loading barangays...</option>';
    select.disabled = true;

    try {
        const response = await fetch(`${API_BASE_URL}/get_barangays.php`);
        const result = await response.json();

        if (!result.success || !result.data) throw new Error(result.message || 'Failed');

        let barangays = result.data;
        if (barangays.data && Array.isArray(barangays.data)) barangays = barangays.data;
        if (!Array.isArray(barangays)) barangays = Object.values(barangays);

        barangays.sort((a, b) => {
            const nameA = a.name || a.barangay_name || a;
            const nameB = b.name || b.barangay_name || b;
            return nameA.localeCompare(nameB);
        });

        select.innerHTML = '<option value="">-- Select Barangay --</option>';
        barangays.forEach(brgy => {
            const name = brgy.name || brgy.barangay_name || brgy;
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });
        select.disabled = false;
    } catch (err) {
        select.innerHTML = '<option value="">-- Failed to load barangays --</option>';
        console.error('Burial origin barangay load error:', err);
    }
}

// ============================================================
// Cemetery (Origin) — Barangay of Tayabas City (API)
// ============================================================
async function loadBurialCemeteryOriginBarangays() {
    const select = document.getElementById('burial-cemetery-origin-municipality');
    if (!select) return;

    // Lock province to show Tayabas City
    const provSelect = document.getElementById('burial-cemetery-origin-province');
    if (provSelect) {
        provSelect.innerHTML = '<option value="Tayabas City">Tayabas City</option>';
        provSelect.value = 'Tayabas City';
        provSelect.disabled = true;
    }

    select.innerHTML = '<option value="">Loading barangays...</option>';
    select.disabled = true;

    try {
        const response = await fetch(`${API_BASE_URL}/get_barangays.php`);
        const result = await response.json();

        if (!result.success || !result.data) throw new Error(result.message || 'Failed');

        let barangays = result.data;
        if (barangays.data && Array.isArray(barangays.data)) barangays = barangays.data;
        if (!Array.isArray(barangays)) barangays = Object.values(barangays);

        barangays.sort((a, b) => {
            const nameA = a.name || a.barangay_name || a;
            const nameB = b.name || b.barangay_name || b;
            return nameA.localeCompare(nameB);
        });

        select.innerHTML = '<option value="">-- Select Barangay --</option>';
        barangays.forEach(brgy => {
            const name = brgy.name || brgy.barangay_name || brgy;
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });
        select.disabled = false;
    } catch (err) {
        select.innerHTML = '<option value="">-- Failed to load barangays --</option>';
        console.error('Cemetery origin barangay load error:', err);
    }
}

// Auto-load barangays when page is ready
document.addEventListener('DOMContentLoaded', () => {
    loadBurialOriginBarangays();
    loadPSGCTransferProvinces();
    loadBurialCemeteryOriginBarangays();
    loadPSGCCemeteryTransferProvinces();
});

// PSGC Cemetery to be Transferred — Province + Municipality/City Loader
// ======================================================================
async function loadPSGCCemeteryTransferProvinces() {
    const provSelect = document.getElementById('burial-cemetery-transfer-province');
    if (!provSelect) return;

    try {
        const res = await fetch('https://psgc.cloud/api/provinces');
        const provinces = await res.json();

        provSelect.innerHTML = '<option value="">-- Select Province --</option>';
        provinces
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(prov => {
                const opt = document.createElement('option');
                opt.value = prov.code;
                opt.textContent = prov.name;
                provSelect.appendChild(opt);
            });

        provSelect.addEventListener('change', async function () {
            const muniSelect = document.getElementById('burial-cemetery-transfer-municipality');
            const provinceCode = this.value;

            if (!provinceCode) {
                muniSelect.innerHTML = '<option value="">-- Select Province First --</option>';
                muniSelect.disabled = true;
                return;
            }

            muniSelect.innerHTML = '<option value="">-- Loading... --</option>';
            muniSelect.disabled = true;

            try {
                const res2 = await fetch(`https://psgc.cloud/api/provinces/${provinceCode}/cities-municipalities`);
                const places = await res2.json();

                muniSelect.innerHTML = '<option value="">-- Select Municipality/City --</option>';
                places
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .forEach(place => {
                        const opt = document.createElement('option');
                        opt.value = place.name;
                        opt.textContent = place.name;
                        muniSelect.appendChild(opt);
                    });

                muniSelect.disabled = false;
            } catch (err) {
                muniSelect.innerHTML = '<option value="">-- Failed to load --</option>';
                console.error('PSGC cemetery transfer municipality fetch error:', err);
            }
        });

    } catch (err) {
        provSelect.innerHTML = '<option value="">-- Failed to load provinces --</option>';
        console.error('PSGC cemetery transfer province fetch error:', err);
    }
}

// PSGC Place to be Transferred — Province + Municipality/City Loader
// ==================================================================
async function loadPSGCTransferProvinces() {
    const provSelect = document.getElementById('burial-transfer-province');
    if (!provSelect) return;

    try {
        const res = await fetch('https://psgc.cloud/api/provinces');
        const provinces = await res.json();

        provSelect.innerHTML = '<option value="">-- Select Province --</option>';
        provinces
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(prov => {
                const opt = document.createElement('option');
                opt.value = prov.code;
                opt.textContent = prov.name;
                provSelect.appendChild(opt);
            });

        provSelect.addEventListener('change', async function () {
            const muniSelect = document.getElementById('burial-transfer-municipality');
            const provinceCode = this.value;

            if (!provinceCode) {
                muniSelect.innerHTML = '<option value="">-- Select Province First --</option>';
                muniSelect.disabled = true;
                return;
            }

            muniSelect.innerHTML = '<option value="">-- Loading... --</option>';
            muniSelect.disabled = true;

            try {
                const res2 = await fetch(`https://psgc.cloud/api/provinces/${provinceCode}/cities-municipalities`);
                const places = await res2.json();

                muniSelect.innerHTML = '<option value="">-- Select Municipality/City --</option>';
                places
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .forEach(place => {
                        const opt = document.createElement('option');
                        opt.value = place.name;
                        opt.textContent = place.name;
                        muniSelect.appendChild(opt);
                    });

                muniSelect.disabled = false;
            } catch (err) {
                muniSelect.innerHTML = '<option value="">-- Failed to load --</option>';
                console.error('PSGC transfer municipality fetch error:', err);
            }
        });

    } catch (err) {
        provSelect.innerHTML = '<option value="">-- Failed to load provinces --</option>';
        console.error('PSGC transfer province fetch error:', err);
    }
}

// ==================== INSPECTOR SELF-NOTIFICATION ENGINE ====================
// Generates automatic alerts for the logged-in inspector based on:
// 1. Schedules assigned to them that are due today or tomorrow
// 2. Establishments they inspected that are now overdue (30+ days)
// 3. Their submitted reports that were not complied with after 7+ days

const InspNotifManager = {

    // --- Pull schedule-assigned notifications from admin (existing behavior, kept) ---
    getScheduleNotifs: () => {
        const fullName = localStorage.getItem('inspectorFullName') || '';
        const username = localStorage.getItem('username') || '';
        const key = fullName ? 'inspectorNotifs_' + fullName : 'inspectorNotifs_' + username;
        try {
            return JSON.parse(localStorage.getItem(key) || '[]');
        } catch (e) {
            return [];
        }    },

    // --- Generate automatic system alerts for this inspector ---
    generateSystemAlerts: () => {
        const alerts = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const fullName = localStorage.getItem('inspectorFullName') || '';
        const username = localStorage.getItem('username') || '';

        // ALERT TYPE 1: Scheduled inspection is today or tomorrow
        const schedules = cachedSchedules.length > 0 ? cachedSchedules : InspSchedule.getAll();
        schedules.forEach(s => {
            const isMySchedule = (
                s.inspector === fullName ||
                s.inspector === username ||
                (fullName && s.inspector.toLowerCase().startsWith(fullName.toLowerCase())) ||
                (username && s.inspector.toLowerCase().includes(username.toLowerCase()))
            );
            if (!isMySchedule || s.done) return;
            const schedDate = new Date(s.schedDate);
            schedDate.setHours(0, 0, 0, 0);
            const diffDays = Math.round((schedDate - today) / (1000 * 60 * 60 * 24));
            if (diffDays === 0) {
                alerts.push({
                    id: 'sched-today-' + s.id,
                    type: 'today',
                    icon: 'bi-alarm-fill',
                    iconClr: '#ef4444',
                    bg: '#fef2f2',
                    message: `You have an inspection scheduled for today${s.establishment ? ' at ' + esc(s.establishment) : ''}. ${s.notes ? 'Note: ' + esc(s.notes) : 'Please prepare accordingly.'}`,
                    date: new Date().toISOString(),
                    schedDate: s.schedDate
                });
            } else if (diffDays === 1) {
                alerts.push({
                    id: 'sched-tomorrow-' + s.id,
                    type: 'tomorrow',
                    icon: 'bi-calendar-event-fill',
                    iconClr: '#f59e0b',
                    bg: '#fffbeb',
                    message: `Reminder: You have an inspection scheduled for tomorrow${s.establishment ? ' at ' + esc(s.establishment) : ''}. ${s.notes ? 'Note: ' + esc(s.notes) : 'Please prepare accordingly.'}`,
                    date: new Date().toISOString(),
                    schedDate: s.schedDate
                });
            }
        });

        // ALERT TYPE 2: Establishments this inspector last visited are now overdue (30+ days)
        const allReports = cachedInspectionReports.length > 0 ? cachedInspectionReports : (window._inspectionReports || []);
        const myReports = allReports.filter(r =>
            (r.inspector || '').toLowerCase() === fullName.toLowerCase() ||
            (r.inspector || '').toLowerCase() === username.toLowerCase()
        );
        // Group by establishment, find latest report per establishment
        const latestByEstab = {};
        myReports.forEach(r => {
            const estab = (r.establishment || r.location || '').trim();
            if (!estab) return;
            const d = new Date(r.date);
            if (!latestByEstab[estab] || d > new Date(latestByEstab[estab].date)) {
                latestByEstab[estab] = r;
            }
        });
        Object.entries(latestByEstab).forEach(([estab, report]) => {
            const lastDate = new Date(report.date);
            lastDate.setHours(0, 0, 0, 0);
            const daysSince = Math.round((today - lastDate) / (1000 * 60 * 60 * 24));
            if (daysSince >= 30) {
                alerts.push({
                    id: 'overdue-insp-' + estab.replace(/\s+/g, '-'),
                    type: 'overdue',
                    icon: 'bi-clock-history',
                    iconClr: '#d97706',
                    bg: '#fffbeb',
                    message: `"${estab}" has not been re-inspected in ${daysSince} day(s). A follow-up visit is recommended to verify continued compliance.`,
                    date: report.date
                });
            }
        });

        // ALERT TYPE 3: This inspector's reports that are non-complied after 7+ days
        myReports.forEach(r => {
            if (r.complied === false || r.complied === 'false') {
                const reportDate = new Date(r.date);
                reportDate.setHours(0, 0, 0, 0);
                const daysSince = Math.round((today - reportDate) / (1000 * 60 * 60 * 24));
                if (daysSince >= 7) {
                    alerts.push({
                        id: 'noncomplied-insp-' + r.id,
                        type: 'noncomplied',
                        icon: 'bi-x-circle-fill',
                        iconClr: '#ef4444',
                        bg: '#fef2f2',
                        message: `Inspection report #IR-${String(r.id).padStart(4, '0')} for "${r.establishment || r.location || 'Unknown'}" has not been complied with as of ${daysSince} day(s) ago. Please follow up with the establishment.`,
                        date: r.date
                    });
                }
            }
        });

        return alerts;
    },

// Which tab is active in the panel: 'all' | 'unread'
    activeTab: 'all',

    // In-memory lookup of the notifs currently on screen, keyed by id,
    // so the detail modal can find the one that was clicked.
    _cache: {},

    // Human-readable label + icon-wrap background per notification type,
    // used by the enlarged detail view.
    TYPE_META: {
        today:       { title: 'Inspection scheduled today' },
        tomorrow:    { title: 'Inspection reminder' },
        overdue:     { title: 'Follow-up inspection needed' },
        noncomplied: { title: 'Non-compliance follow-up' },
        assigned:    { title: 'New schedule assigned' },
        reschedule:  { title: 'Schedule updated' }
    },

    getReadIds: () => {
        try {
            return JSON.parse(localStorage.getItem('inspNotifReadIds') || '[]');
        } catch (e) {
            return [];
        }
    },

    getDismissedIds: () => {
        try {
            return JSON.parse(localStorage.getItem('inspNotifDismissedIds') || '[]');
        } catch (e) {
            return [];
        }
    },

    dismiss: (id) => {
        const ids = InspNotifManager.getDismissedIds();
        const strId = String(id);
        if (!ids.includes(strId)) {
            ids.push(strId);
            localStorage.setItem('inspNotifDismissedIds', JSON.stringify(ids));
        }
        InspNotifManager.render();
    },

    markRead: (id) => {
        const ids = InspNotifManager.getReadIds();
        const strId = String(id);
        if (!ids.includes(strId)) {
            ids.push(strId);
            localStorage.setItem('inspNotifReadIds', JSON.stringify(ids));
        }
        InspNotifManager.render();
    },

    markAllRead: () => {
        const schedNotifs = InspNotifManager.getScheduleNotifs();
        const sysAlerts   = InspNotifManager.generateSystemAlerts();
        const allIds = [
            ...schedNotifs.map(n => String(n.id)),
            ...sysAlerts.map(a => a.id)
        ];
        localStorage.setItem('inspNotifReadIds', JSON.stringify(allIds));
        InspNotifManager.render();
    },

    render: () => {
        const readIds      = InspNotifManager.getReadIds();
        const dismissedIds = InspNotifManager.getDismissedIds();
        const schedNotifs = InspNotifManager.getScheduleNotifs().map(n => ({
            id:      String(n.id),
            type:    n.type,
            icon:    n.type === 'reschedule' ? 'bi-arrow-repeat' : 'bi-calendar-check',
            iconClr: n.type === 'reschedule' ? '#f59e0b' : '#2563eb',
            bg:      n.type === 'reschedule' ? '#fffbeb' : '#eff6ff',
            message: n.message,
            date:    n.date,
            schedDate: n.schedDate,
            read:    readIds.includes(String(n.id))
        }));
        const sysAlerts = InspNotifManager.generateSystemAlerts().map(a => ({
            ...a,
            id:   a.id,
            read: readIds.includes(a.id)
        }));

        // Filter out dismissed notifications
        const allNotifs = [...sysAlerts, ...schedNotifs]
            .filter(n => !dismissedIds.includes(String(n.id)))
            .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        const unread    = allNotifs.filter(n => !n.read).length;

        // Cache by id so a click on a row can look up its full data.
        InspNotifManager._cache = {};
        allNotifs.forEach(n => { InspNotifManager._cache[String(n.id)] = n; });

        const badge  = document.getElementById('inspNotifBadge');
        const listEl = document.getElementById('inspNotifList');
        const unreadCountEl = document.getElementById('inspNotifTabUnreadCount');

        if (badge) {
            badge.textContent  = unread > 9 ? '9+' : unread;
            badge.style.display = unread > 0 ? 'inline-block' : 'none';
        }
        if (unreadCountEl) {
            unreadCountEl.textContent = unread > 0 ? ' (' + (unread > 9 ? '9+' : unread) + ')' : '';
        }

        if (!listEl) return;

        const visible = InspNotifManager.activeTab === 'unread'
            ? allNotifs.filter(n => !n.read)
            : allNotifs;

        if (visible.length === 0) {
            listEl.innerHTML = `<p style="text-align:center;color:#9ca3af;font-size:13px;padding:24px 16px;">${InspNotifManager.activeTab === 'unread' ? "You're all caught up — no unread alerts." : 'No schedule alerts'}</p>`;
            return;
        }

        listEl.innerHTML = visible.map(n => `
            <div class="insp-notif-row" onclick="InspNotifManager.openDetail('${n.id}')" style="display:flex;align-items:flex-start;gap:10px;padding:10px 16px;border-bottom:1px solid #f3f4f6;background:${n.read ? '#fff' : n.bg};cursor:pointer;">
                <i class="bi ${n.icon}" style="color:${n.iconClr};font-size:18px;flex-shrink:0;margin-top:2px;opacity:${n.read ? '0.55' : '1'};"></i>
                <div style="flex:1;min-width:0;opacity:${n.read ? '0.65' : '1'};">
                    <p style="font-size:12px;color:#374151;margin:0 0 4px;line-height:1.5;">${esc(n.message)}</p>
                    <p style="font-size:11px;color:#9ca3af;margin:0;">${new Date(n.date).toLocaleDateString('en-PH', {year:'numeric',month:'short',day:'numeric'})}${n.schedDate ? ' &middot; tap to view' : ''}</p>
                </div>
                ${!n.read ? `<button onclick="event.stopPropagation();InspNotifManager.dismiss('${n.id}')" style="flex-shrink:0;font-size:11px;color:#6b7280;background:none;border:1px solid #e5e7eb;border-radius:6px;padding:2px 8px;cursor:pointer;">Dismiss</button>` : ''}
            </div>`
        ).join('');
    },

    setTab: (tab) => {
        InspNotifManager.activeTab = tab;
        const tabAll    = document.getElementById('inspNotifTabAll');
        const tabUnread = document.getElementById('inspNotifTabUnread');
        if (tabAll)    { tabAll.classList.toggle('active', tab === 'all'); tabAll.setAttribute('aria-selected', tab === 'all'); }
        if (tabUnread) { tabUnread.classList.toggle('active', tab === 'unread'); tabUnread.setAttribute('aria-selected', tab === 'unread'); }
        InspNotifManager.render();
    },

    // Opens the enlarged detail view for one notification.
    openDetail: (id) => {
        const n = InspNotifManager._cache[String(id)];
        if (!n) return;

        const meta = InspNotifManager.TYPE_META[n.type] || { title: 'Notification' };

        document.getElementById('notifDetailTitle').textContent = meta.title;
        document.getElementById('notifDetailDate').textContent  = new Date(n.date).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        document.getElementById('notifDetailMessage').textContent = n.message;

        const iconEl   = document.getElementById('notifDetailIcon');
        const iconWrap = document.getElementById('notifDetailIconWrap');
        iconEl.className   = 'bi ' + n.icon;
        iconEl.style.color = n.iconClr;
        iconWrap.style.background = n.bg;

        const calBtn = document.getElementById('notifDetailCalendarBtn');
        calBtn.style.display = n.schedDate ? 'inline-flex' : 'none';
        InspNotifManager._pendingDate = n.schedDate || null;

        document.getElementById('inspNotifPanel').style.display = 'none';
        InspNotifManager.markRead(id);
        document.getElementById('insp-notif-detail-modal').showModal();
    },

    // "View on calendar" inside the detail modal.
    goToSchedule: () => {
        const dateKey = InspNotifManager._pendingDate;
        document.getElementById('insp-notif-detail-modal').close();
        if (dateKey) InspNotifManager.jumpToDate(dateKey);
    },

    // Switches to the Schedule module, opens the right month, opens the
    // day panel for that date, and scrolls it into view. Safe to call
    // outside of a click event (doesn't depend on the global `event`).
    jumpToDate: (dateKey) => {
        document.querySelectorAll('.module-content').forEach(m => m.classList.add('hidden'));
        const scheduleModule = document.getElementById('schedule-module');
        if (scheduleModule) scheduleModule.classList.remove('hidden');

        document.querySelectorAll('.sidebar-item').forEach(item => item.classList.remove('active'));
        const scheduleTab = document.querySelector('.sidebar-item[data-testid="nav-schedule"]');
        if (scheduleTab) scheduleTab.classList.add('active');

        const [y, m] = dateKey.split('-').map(Number);
        InspSchedule.calYear  = y;
        InspSchedule.calMonth = m - 1;
        InspSchedule.renderCalendar();
        InspSchedule.showDay(dateKey);

        setTimeout(() => {
            const panel = document.getElementById('inspCalDayPanel');
            if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
            InspNotifManager.pulseDate(dateKey);
        }, 60);
    },

    // Briefly highlights the target day cell so the inspector can see
    // exactly which date they were taken to.
    pulseDate: (dateKey) => {
        const cell = document.querySelector(`#inspCalendarGrid [data-date="${dateKey}"]`);
        if (!cell) return;
        cell.classList.add('insp-cal-highlight');
        setTimeout(() => cell.classList.remove('insp-cal-highlight'), 1800);
    },

    togglePanel: () => {
        const panel = document.getElementById('inspNotifPanel');
        if (!panel) return;
        const isOpen = panel.style.display === 'block';
        panel.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) InspNotifManager.render();
    }
};

// Auto-run on page load and refresh every 30 seconds
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('inspNotifBadge')) {
        setTimeout(() => InspNotifManager.render(), 600);
        setInterval(() => InspNotifManager.render(), 30000);
    }

    // Click outside to close notification panel
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('inspNotifBellWrapper');
        const panel   = document.getElementById('inspNotifPanel');
        if (panel && wrapper && !wrapper.contains(e.target)) {
            panel.style.display = 'none';
        }
    });
});

// Click on the dimmed backdrop (outside the card) closes the modal
document.addEventListener('DOMContentLoaded', () => {
    const notifModal = document.getElementById('insp-notif-detail-modal');
    if (notifModal) {
        notifModal.addEventListener('click', (e) => {
            if (e.target === notifModal) notifModal.close();
        });
    }
});

// ==================== END INSPECTOR NOTIFICATION ENGINE ====================

// ==================== INSPECTION HISTORY MODULE ====================

let _ihAllReports = [];
let _ihEstablishments = [];

async function loadIHEstablishments() {
    const grid = document.getElementById('ih-establishments-grid');
    if (!grid) return;
    grid.innerHTML = `<div class="text-center py-8 text-gray-400 col-span-3"><i class="fas fa-spinner fa-spin text-2xl"></i><p class="mt-2">Loading...</p></div>`;

    try {
        const res = await fetch(`${API_BASE_URL}/inspection.php`);
        const json = await res.json();
        _ihAllReports = (json.success && Array.isArray(json.data)) ? json.data : [];
    } catch (e) {
        _ihAllReports = cachedInspectionReports.length > 0 ? cachedInspectionReports : (window._inspectionReports || []);
    }

    // Build unique establishment list
    const estabMap = {};
    _ihAllReports.forEach(r => {
        const name = (r.establishment || '').trim();
        if (!name) return;
        if (!estabMap[name]) {
            estabMap[name] = {
                name,
                barangay: r.location || 'N/A',
                count: 0,
                violations: 0,
                lastDate: null
            };
        }
        estabMap[name].count++;
        if (!r.complied) estabMap[name].violations++;
        const d = new Date(r.date || r.report_date || 0);
        if (!estabMap[name].lastDate || d > estabMap[name].lastDate) {
            estabMap[name].lastDate = d;
        }
    });

    _ihEstablishments = Object.values(estabMap).sort((a, b) => (b.lastDate || 0) - (a.lastDate || 0));
    renderIHEstablishments(_ihEstablishments);
}

function renderIHEstablishments(list) {
    const grid = document.getElementById('ih-establishments-grid');
    const countEl = document.getElementById('ih-count');
    const searchEl = document.getElementById('ih-search');
    const q = (searchEl?.value || '').trim().toLowerCase();
    if (countEl) countEl.textContent = q ? `${list.length} matching establishments` : `Showing ${list.length} of ${_ihEstablishments.length} establishments`;
    if (!grid) return;

    if (list.length === 0) {
        grid.innerHTML = `<div class="text-center py-10 text-gray-400 col-span-3"><i class="fas fa-clipboard-list text-4xl mb-3 block"></i><p>No establishments with inspection records found.</p></div>`;
        return;
    }

    grid.innerHTML = list.map(e => {
        const lastInspected = e.lastDate ? e.lastDate.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
        const hasViolation = e.violations > 0;
        return `
        <div class="card bg-base-100 border border-base-200 hover:shadow-lg hover:border-emerald-400 cursor-pointer transition-all"
             onclick="openIHDetail('${esc(e.name).replace(/'/g, "\\'")}')">
            <div class="card-body p-4">
                <div class="flex items-start justify-between">
                    <h4 class="font-bold text-base text-gray-800 leading-tight">${esc(e.name)}</h4>
                    <span class="badge ${hasViolation ? 'badge-error' : 'badge-success'} text-white text-xs ml-2 shrink-0">
                        ${hasViolation ? e.violations + ' Violation' + (e.violations > 1 ? 's' : '') : 'Compliant'}
                    </span>
                </div>
                <p class="text-xs text-gray-500 mt-1"><i class="fas fa-map-marker-alt mr-1 text-emerald-500"></i>${esc(e.barangay)}</p>
                <div class="flex justify-between items-center mt-3 text-xs text-gray-500">
                    <span><i class="fas fa-clipboard-check mr-1"></i>${e.count} Inspection${e.count !== 1 ? 's' : ''}</span>
                    <span><i class="fas fa-calendar-alt mr-1"></i>${lastInspected}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

function filterIHEstablishments() {
    const q = (document.getElementById('ih-search')?.value || '').trim().toLowerCase();
    const sortBy = document.getElementById('ih-sort')?.value || 'recent';
    let filtered = q ? _ihEstablishments.filter(e => e.name.toLowerCase().includes(q) || e.barangay.toLowerCase().includes(q)) : _ihEstablishments;
    filtered = sortIHList(filtered, sortBy);
    const page = q ? { displayed: filtered, hasMore: false, remaining: 0 } : TablePaging.slice(filtered, 'insp-ih', 12);
    renderIHEstablishments(page.displayed);
    if (page.hasMore) {
        const container = document.getElementById('ih-establishment-list');
        if (container && !container.querySelector('.load-more-ih')) {
            container.insertAdjacentHTML('beforeend',
                `<div class="load-more-ih" style="text-align:center;padding:12px;">
                    <button type="button" class="btn btn-sm btn-outline" onclick="TablePaging.showMore('insp-ih', 12); filterIHEstablishments();">Load more (${page.remaining} more)</button>
                </div>`);
        }
    }
}

function sortIHEstablishments() {
    filterIHEstablishments();
}

function sortIHList(list, sortBy) {
    return [...list].sort((a, b) => {
        switch (sortBy) {
            case 'recent': return (b.lastDate || 0) - (a.lastDate || 0);
            case 'name-az': return a.name.localeCompare(b.name);
            case 'most-inspections': return b.count - a.count;
            case 'most-violations': return b.violations - a.violations;
            default: return (b.lastDate || 0) - (a.lastDate || 0);
        }
    });
}

async function openIHDetail(establishmentName) {
    const listEl = document.getElementById('ih-establishment-list');
    const detail = document.getElementById('ih-history-detail');
    const titleEl = document.getElementById('ih-detail-title');
    const tbodyEl = document.getElementById('ih-detail-tbody');
    const statsEl = document.getElementById('ih-detail-stats');
    const barangayEl = document.getElementById('ih-detail-barangay');
    if (listEl) listEl.classList.add('hidden');
    if (detail) detail.classList.remove('hidden');
    if (titleEl) titleEl.textContent = establishmentName;
    if (tbodyEl) tbodyEl.innerHTML = `<tr><td colspan="6" class="text-center py-6"><i class="fas fa-spinner fa-spin mr-2"></i>Loading history...</td></tr>`;
    if (statsEl) statsEl.innerHTML = '';

    const name = establishmentName.trim().toLowerCase();
    const estab = _ihEstablishments.find(e => e.name.toLowerCase() === name);
    if (barangayEl) barangayEl.innerHTML = estab ? `<i class="fas fa-map-marker-alt mr-1 text-emerald-500"></i>${esc(estab.barangay)}` : '';

    // Fetch archived/history records for this establishment
    let historyRows = [];
    try {
        // Try to get all reports and filter by name
        const res = await fetch(`${API_BASE_URL}/inspection.php`);
        const json = await res.json();
        const all = (json.success && Array.isArray(json.data)) ? json.data : [];
        historyRows = all.filter(r => (r.establishment || '').trim().toLowerCase() === name);
    } catch (e) {
        historyRows = _ihAllReports.filter(r => (r.establishment || '').trim().toLowerCase() === name);
    }

    // Also try fetching individual history records for each matching report id
    const allHistory = [];
    for (const r of historyRows) {
        if (r.id) {
            try {
                const hRes = await fetch(`${API_BASE_URL}/inspection.php?history_id=${r.id}`);
                const hJson = await hRes.json();
                if (hJson.success && Array.isArray(hJson.data) && hJson.data.length > 0) {
                    hJson.data.forEach(h => allHistory.push({ ...h, _fromHistory: true }));
                }
            } catch (_) {}
        }
    }

    // Merge current + history records, sort newest first
    const combined = [...historyRows, ...allHistory];
    combined.sort((a, b) => new Date(b.date || b.archived_at || 0) - new Date(a.date || a.archived_at || 0));

    if (combined.length === 0) {
        document.getElementById('ih-detail-tbody').innerHTML = `<tr><td colspan="6" class="text-center py-8 text-gray-400"><i class="fas fa-clipboard-list text-3xl block mb-2"></i>No inspection history found.</td></tr>`;
        return;
    }

    const total = combined.length;
    const violations = combined.filter(r => !r.complied).length;
    const complied = combined.filter(r => r.complied).length;
    const rate = total > 0 ? Math.round((complied / total) * 100) : 0;

    document.getElementById('ih-detail-stats').innerHTML = `
        <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
            <p class="text-2xl font-bold text-emerald-600">${total}</p>
            <p class="text-xs text-gray-500 mt-1">Total Inspections</p>
        </div>
        <div class="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
            <p class="text-2xl font-bold text-red-500">${violations}</p>
            <p class="text-xs text-gray-500 mt-1">Violations</p>
        </div>
        <div class="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
            <p class="text-2xl font-bold text-blue-500">${complied}</p>
            <p class="text-xs text-gray-500 mt-1">Complied</p>
        </div>
        <div class="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-center">
            <p class="text-2xl font-bold text-yellow-600">${rate}%</p>
            <p class="text-xs text-gray-500 mt-1">Compliance Rate</p>
        </div>`;

    document.getElementById('ih-detail-tbody').innerHTML = combined.map((r, i) => {
        const compliedStatus = r.complied === true || r.complied === 'true' || r.complied === 1;
        const dateStr = (r.date || r.archived_at) ? new Date(r.date || r.archived_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
        return `
        <tr>
            <td class="text-sm font-semibold text-gray-600">${i + 1}</td>
            <td class="text-sm">${dateStr}</td>
            <td class="text-sm max-w-xs">${esc(r.remarks) || 'N/A'}</td>
            <td class="text-sm max-w-xs">${esc(r.recommendation) || 'N/A'}</td>
            <td>
                <span class="badge ${compliedStatus ? 'badge-success' : 'badge-error'} text-white text-xs">
                    ${compliedStatus ? 'Complied' : 'Violation'}
                </span>
            </td>
            <td class="text-sm text-gray-500">${esc(r.inspector) || 'N/A'}</td>
        </tr>`;
    }).join('');
}

function ihBackToList() {
    document.getElementById('ih-history-detail').classList.add('hidden');
    document.getElementById('ih-establishment-list').classList.remove('hidden');
}

// ==================== AUTO-SCHEDULE TO ADMIN CALENDAR ====================
async function autoScheduleToAdminCalendar(inspectorName, deadlineDate, establishmentName) {
    try {
        // Create schedule via API
        const resp = await fetch(`${API_BASE_URL}/inspection_schedules.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inspector: inspectorName,
                schedDate: deadlineDate,
                establishment: establishmentName || 'Unknown Establishment',
                riskLevel: '',
                notes: 'Auto-scheduled from Inspection Report compliance deadline.'
            })
        });
        const result = await resp.json();
        if (!result.success) {
            console.warn('Auto-schedule API call failed:', result.message);
        }

        // Refresh cached schedules
        InspSchedule.fetchAll();

        // In-app bell notification
        const key  = 'inspectorNotifs_' + inspectorName.trim();
        let list = [];
        try {
            list = JSON.parse(localStorage.getItem(key) || '[]');
        } catch (e) {
            list = [];
        }
        const dateFormatted = new Date(deadlineDate).toLocaleDateString('en-PH', {
            year: 'numeric', month: 'short', day: 'numeric'
        });
        list.push({
            id:      Date.now(),
            read:    false,
            type:    'assigned',
            message: `You are scheduled to re-inspect "${establishmentName}" on ${dateFormatted} (compliance deadline).`,
            date:    new Date().toISOString(),
            schedDate: deadlineDate
        });
        localStorage.setItem(key, JSON.stringify(list));

        // Send real email to the inspector via PHP
        fetch(API_BASE_URL + '/PHPMailer/send_notification.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inspector: inspectorName.trim(),
                schedDate: deadlineDate,
                notes:     'Compliance deadline re-inspection for: ' + (establishmentName || 'Unknown Establishment'),
                type:      'assigned'
            })
        })
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                console.warn('Email notification failed:', data.message);
            }
        })
        .catch(err => console.warn('Email send error:', err));

    } catch (err) {
        console.error('autoScheduleToAdminCalendar error:', err);
    }
}
// ==================== END AUTO-SCHEDULE ====================

// Load-more re-render hooks for main inspector tables
TablePaging.register('insp-sanitary', () => filterSanitaryRecords());
TablePaging.register('insp-reports', () => filterInspectionReports());
TablePaging.register('insp-ih', () => filterIHEstablishments());
['cadaver', 'skeletal', 'exhumation'].forEach((t) => {
    TablePaging.register(`insp-burial-${t}`, () => filterBurialRecords(t));
});

// ==================== FORM DRAFTS INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    FormDrafts.attachAutoSave();
    FormDrafts.promptRestore();
});