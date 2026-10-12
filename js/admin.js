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

// Shared table "Load more" paging for list views that default to a short slice
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
    // Use when no search filter is active. When filtering, callers show all matches.
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
    // Maps paging keys to their re-render entry points
    _handlers: {},
    register(key, fn) {
        this._handlers[key] = fn;
    },
    _rerender(key) {
        const fn = this._handlers[key];
        if (typeof fn === 'function') fn();
    }
};

// Data Store — in-memory cache populated from API (no localStorage)
let _cacheInspectors = [];
let _cacheSanitaryRecords = [];
let _cacheInspectionReports = [];
let _cacheBurialRecords = { cadaver: [], skeletal: [], exhumation: [] };

const DataStore = {
    get inspectors() { return _cacheInspectors; },
    set inspectors(value) { _cacheInspectors = value; },

    get sanitaryRecords() { return _cacheSanitaryRecords; },
    set sanitaryRecords(value) { _cacheSanitaryRecords = value; },

    get burialRecords() { return _cacheBurialRecords; },
    set burialRecords(value) { _cacheBurialRecords = value; },

    get inspectionReports() { return _cacheInspectionReports; },
    set inspectionReports(value) { _cacheInspectionReports = value; },

    nextId: {
        get inspectors() {
            const inspectors = DataStore.inspectors;
            return inspectors.length > 0 ? Math.max(...inspectors.map(i => i.id)) + 1 : 1;
        },
        get sanitaryRecords() {
            const records = DataStore.sanitaryRecords;
            return records.length > 0 ? Math.max(...records.map(r => r.id || 0)) + 1 : 1;
        },
        get burialRecords() {
            const burialData = DataStore.burialRecords;
            const allIds = [
                ...burialData.cadaver.map(r => r.id || 0),
                ...burialData.skeletal.map(r => r.id || 0),
                ...burialData.exhumation.map(r => r.id || 0)
            ];
            return allIds.length > 0 ? Math.max(...allIds) + 1 : 1;
        },
        get inspectionReports() {
            const reports = DataStore.inspectionReports;
            return reports.length > 0 ? Math.max(...reports.map(r => r.id || 0)) + 1 : 1;
        }
    }
};

// Utility Functions
const Utils = {
    esc: (str) => {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/`/g, '&#96;');
    },
    formatDate: (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        if (isNaN(date)) return 'N/A';
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    },

    showToast: (message, type = 'success') => {
        const toast = document.getElementById('toast');
        const icon = toast.querySelector('.toast-icon');
        const msg = toast.querySelector('.toast-message');

        toast.className = `toast ${type}`;
        icon.className = type === 'success' ? 'toast-icon fas fa-check-circle' : 'toast-icon fas fa-exclamation-circle';
        msg.textContent = message;

        toast.style.display = 'flex';
        setTimeout(() => {
            toast.style.display = 'none';
        }, 3000);
    },

    openModal: (content) => {
        const modal = document.getElementById('modal');
        const modalContent = document.getElementById('modalContent');
        modalContent.innerHTML = content;
        modal.style.display = 'flex';
    },

    closeModal: () => {
        const modal = document.getElementById('modal');
        modal.style.display = 'none';
    },

    showConfirmDialog: (message, onConfirm) => {
        const content = `
            <div class="modal-header">
                <h3>Confirm Action</h3>
                <button class="modal-close" onclick="Utils.closeModal()" data-testid="confirm-close-btn">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <p style="font-size: 15px; color: #374151; margin-bottom: 20px;">${message}</p>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="Utils.closeModal()" data-testid="confirm-cancel-btn">Cancel</button>
                <button class="btn btn-danger" id="confirmActionBtn" data-testid="confirm-delete-btn">Delete</button>
            </div>
        `;
        Utils.openModal(content);
        document.getElementById('confirmActionBtn').onclick = () => {
            onConfirm();
            Utils.closeModal();
        };
    }
};

// Page Management
const PageManager = {
    currentPage: 'dashboard',
    
    switchPage: (pageName) => {
        // Update navigation
        document.querySelectorAll('.sidebar-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.page === pageName) {
                item.classList.add('active');
            }
        });

        // Update page title
        const titles = {
            dashboard: 'Dashboard',
            inspectors: 'Inspector Accounts',
            sanitary: 'Sanitary Records',
            burial: 'Burial Records',
            reports: 'Inspection Reports',
            'accomplishment-report': 'Accomplishment Report',
            schedule: 'Inspection Schedule',
            archive: 'Archive',
            prediction: 'Prescription',
            'inspection-history': 'Inspection History',
            'activity-log': 'Activity Log'
        };
        const pageTitleEl = document.getElementById('pageTitle');
        if (pageTitleEl) pageTitleEl.textContent = titles[pageName] || 'Dashboard';

        // Hide all views
        document.querySelectorAll('.view').forEach(view => {
            view.style.display = 'none';
        });

        // Show selected view
        const viewMap = {
            dashboard: 'dashboardView',
            inspectors: 'inspectorsView',
            sanitary: 'sanitaryView',
            burial: 'burialView',
            reports: 'reportsView',
            'accomplishment-report': 'accomplishmentReportView',
            schedule: 'scheduleView',
            archive: 'archiveView',
            prediction: 'predictionView',
            'inspection-history': 'inspectionHistoryView',
            'activity-log': 'activityLogView'
        };
        document.getElementById(viewMap[pageName]).style.display = 'block';

        // Load data when switching pages
        if (pageName === 'sanitary') {
            SanitaryManager.render();
        } else if (pageName === 'burial') {
            BurialManager.render();
        } else if (pageName === 'reports') {
            ReportsManager.loadAndRender();
        } else if (pageName === 'inspectors') {
            InspectorManager.render();
        } else if (pageName === 'accomplishment-report') {
            adminShowReportTab('monthly', document.getElementById('admin-tab-monthly'));
        } else if (pageName === 'schedule') {
            ScheduleManager.render();
        } else if (pageName === 'archive') {
            ArchiveManager.render();
        } else if (pageName === 'dashboard') {
            Dashboard.updateStats();
            Dashboard.renderActivity();
            Dashboard.initTabs();
        } else if (pageName === 'prediction') {
            PredictionEngine.run();
        } else if (pageName === 'inspection-history') {
            adminLoadIHEstablishments();
        } else if (pageName === 'activity-log') {
            ActivityLog.load();
        }
        
        PageManager.currentPage = pageName;
    }
};

// ==================== RISK SCORING HELPER (Admin) ====================

function getSanitaryPermitNoForEstablishment(establishmentName) {
    if (!establishmentName) return 'N/A';
    const records = SanitaryManager.records || [];
    const match = records.find(r =>
        r.businessName && r.businessName.toLowerCase() === (establishmentName || '').toLowerCase()
    );
    return (match && match.permitNo) ? match.permitNo : 'N/A';
}

function getAdminRiskForEstablishment(businessName) {
    if (!businessName) return null;
    if (!PredictionEngine.results || PredictionEngine.results.length === 0) return null;
    const match = PredictionEngine.results.find(r =>
        r.businessName && r.businessName.toLowerCase() === businessName.toLowerCase()
    );
    if (!match) return null;
    return {
        riskLevel:   match.riskLevel,
        riskScore:   match.totalScore,
        daysToComply: match.riskLevel === 'HIGH' ? 7 : 30
    };
}

function renderAdminRiskBadge(ai) {
    if (!ai) {
        return `<span class="status-badge" style="background:#f3f4f6;color:#9ca3af;">Not Inspected</span>`;
    }
    const riskColors = {
        HIGH:     { bg: '#fef2f2', color: '#ef4444', label: 'HIGH RISK',   icon: '🔴' },
        MODERATE: { bg: '#fffbeb', color: '#d97706', label: 'MOD RISK',    icon: '🟡' },
        LOW:      { bg: '#ecfdf5', color: '#059669', label: 'LOW RISK',    icon: '🟢' },
    };
    const r = riskColors[ai.riskLevel] || riskColors.LOW;
    return `
        <div style="display:flex;flex-direction:column;gap:3px;">
            <span class="status-badge" style="background:${r.bg};color:${r.color};font-weight:700;border:1px solid ${r.color};">
                ${r.icon} ${r.label}
            </span>
            <span style="font-size:11px;color:${r.color};">Score: ${ai.riskScore}/100</span>
        </div>
    `;
}

// Dashboard Functions
let riskChartInstance = null;
let monthlyChartInstance = null;
let riskTrendChartInstance = null;
let recordsChartInstance = null;

const Dashboard = {
    updateStats: () => {
        document.getElementById('totalInspectors').textContent = DataStore.inspectors.length;

        fetch(`${API_BASE_URL}/sanitary.php`)
        .then(r => r.json())
        .then(result => {
            const records = result.success ? (result.data || []) : [];
            document.getElementById('totalSanitary').textContent = records.length;

            let highCount = 0, modCount = 0, lowCount = 0, pendingCount = 0;
            records.forEach(record => {
                const ai = getAdminRiskForEstablishment(record.businessName);
                if (!ai)                             pendingCount++;
                else if (ai.riskLevel === 'HIGH')    highCount++;
                else if (ai.riskLevel === 'MODERATE') modCount++;
                else                                 lowCount++;
            });

            const highEl    = document.getElementById('riskHighCount');
            const modEl     = document.getElementById('riskModCount');
            const lowEl     = document.getElementById('riskLowCount');
            const pendingEl = document.getElementById('riskPendingCount');
            if (highEl)    highEl.textContent    = highCount;
            if (modEl)     modEl.textContent     = modCount;
            if (lowEl)     lowEl.textContent     = lowCount;
            if (pendingEl) pendingEl.textContent = pendingCount;

            // Draw risk doughnut chart
            const riskCtx = document.getElementById('riskChart');
            if (riskCtx) {
                if (riskChartInstance) riskChartInstance.destroy();
                riskChartInstance = new Chart(riskCtx, {
                    type: 'doughnut',
                    data: {
                        labels: ['High Risk', 'Moderate Risk', 'Low Risk', 'Not Analyzed'],
                        datasets: [{
                            data: [highCount, modCount, lowCount, pendingCount],
                            backgroundColor: ['#ef4444', '#f59e0b', '#10b981', '#9ca3af'],
                            borderWidth: 2,
                            borderColor: '#fff'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false }
                        },
                        cutout: '65%'
                    }
                });
            }

            // Draw records overview chart using latest counts
            Dashboard.drawRecordsChart();
            Dashboard.populateBarangayFilter(records);
        })
        .catch(() => {
            document.getElementById('totalSanitary').textContent = 0;
        });

        fetch(`${API_BASE_URL}/burial.php`)
            .then(r => r.json())
            .then(result => {
                if (result.success && result.data) {
                    const total = (result.data.cadaver?.length || 0) +
                                  (result.data.skeletal?.length || 0) +
                                  (result.data.exhumation?.length || 0);
                    document.getElementById('totalBurial').textContent = total;
                } else {
                    document.getElementById('totalBurial').textContent = 0;
                }
            })
            .catch(() => {
                document.getElementById('totalBurial').textContent = 0;
            });

        const reports = DataStore.inspectionReports;
        document.getElementById('totalReports').textContent = reports.length;

        // Draw monthly inspection bar chart
        Dashboard.drawMonthlyChart(reports);
    },

    drawMonthlyChart: (reports) => {
        const monthlyCtx = document.getElementById('monthlyChart');
        if (!monthlyCtx) return;

        const data = reports || DataStore.inspectionReports;
        const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const counts = new Array(12).fill(0);

        data.forEach(r => {
            const d = new Date(r.date);
            if (!isNaN(d)) counts[d.getMonth()]++;
        });

        if (monthlyChartInstance) monthlyChartInstance.destroy();
        monthlyChartInstance = new Chart(monthlyCtx, {
            type: 'bar',
            data: {
                labels: monthLabels,
                datasets: [{
                    label: 'Inspection Reports',
                    data: counts,
                    backgroundColor: '#3b82f6',
                    borderRadius: 6,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1, font: { size: 11 } },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: {
                        ticks: { font: { size: 11 } },
                        grid: { display: false }
                    }
                }
            }
        });
    },

    drawRecordsChart: () => {
        Dashboard.drawComplianceChart();
        Dashboard.drawViolationTypeChart();
        Dashboard.renderInspectorProductivity();
        Dashboard.renderComplianceRanking();
        Dashboard.loadComplianceDeadlines();
        Dashboard.drawRiskTrendChart();
    },

    loadComplianceDeadlines: async () => {
        const container = document.getElementById('complianceDeadlineList');
        const countEl = document.getElementById('complianceDeadlineCount');
        if (!container) return;

        try {
            const resp = await fetch(`${API_BASE_URL}/inspection.php`);
            const json = await resp.json();
            if (!json.success || !json.data) {
                container.innerHTML = '<p style="text-align:center;color:#9ca3af;font-size:13px;padding:20px;">No data available</p>';
                return;
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const reports = json.data.filter(r => r.compliance_deadline);

            // Sort by deadline (soonest first)
            reports.sort((a, b) => new Date(a.compliance_deadline) - new Date(b.compliance_deadline));

            const overdue = [];
            const upcoming = [];
            const future = [];

            reports.forEach(r => {
                const deadline = new Date(r.compliance_deadline);
                deadline.setHours(0, 0, 0, 0);
                const diffDays = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
                const entry = { ...r, diffDays };
                if (diffDays < 0) overdue.push(entry);
                else if (diffDays <= 14) upcoming.push(entry);
                else future.push(entry);
            });

            if (countEl) countEl.textContent = `${overdue.length} overdue · ${upcoming.length} due soon`;

            if (reports.length === 0) {
                container.innerHTML = '<p style="text-align:center;color:#9ca3af;font-size:13px;padding:20px;">No compliance deadlines set</p>';
                return;
            }

            const renderEntry = (r, type) => {
                const deadlineDate = new Date(r.compliance_deadline).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
                const bgColor = type === 'overdue' ? '#fef2f2' : type === 'upcoming' ? '#fff7ed' : '#f0fdf4';
                const borderColor = type === 'overdue' ? '#fca5a5' : type === 'upcoming' ? '#fdba74' : '#86efac';
                const textColor = type === 'overdue' ? '#dc2626' : type === 'upcoming' ? '#ea580c' : '#16a34a';
                const label = type === 'overdue' ? `${Math.abs(r.diffDays)}d overdue` : type === 'upcoming' ? `Due in ${r.diffDays}d` : `${r.diffDays}d away`;

                return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:${bgColor};border-left:3px solid ${borderColor};border-radius:6px;margin-bottom:6px;">
                    <div>
                        <div style="font-size:13px;font-weight:600;color:#111827;">${Utils.esc(r.establishment || 'Unknown')}</div>
                        <div style="font-size:11px;color:#6b7280;">${Utils.esc(r.inspector || 'Unassigned')} · ${Utils.esc(r.status || 'Pending')}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:12px;font-weight:700;color:${textColor};">${label}</div>
                        <div style="font-size:10px;color:#9ca3af;">${deadlineDate}</div>
                    </div>
                </div>`;
            };

            let html = '';
            if (overdue.length > 0) {
                html += '<div style="font-size:11px;font-weight:700;color:#dc2626;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Overdue</div>';
                html += overdue.map(r => renderEntry(r, 'overdue')).join('');
            }
            if (upcoming.length > 0) {
                html += '<div style="font-size:11px;font-weight:700;color:#ea580c;margin:10px 0 6px;text-transform:uppercase;letter-spacing:0.5px;">Due Soon (≤14 days)</div>';
                html += upcoming.map(r => renderEntry(r, 'upcoming')).join('');
            }
            if (future.length > 0) {
                html += '<div style="font-size:11px;font-weight:700;color:#16a34a;margin:10px 0 6px;text-transform:uppercase;letter-spacing:0.5px;">Upcoming</div>';
                html += future.slice(0, 5).map(r => renderEntry(r, 'future')).join('');
                if (future.length > 5) html += `<p style="text-align:center;font-size:11px;color:#9ca3af;margin-top:4px;">+${future.length - 5} more</p>`;
            }

            container.innerHTML = html;
        } catch (err) {
            container.innerHTML = '<p style="text-align:center;color:#9ca3af;font-size:13px;padding:20px;">Failed to load deadlines</p>';
        }
    },

    drawRiskTrendChart: async () => {
        const ctx = document.getElementById('riskTrendChart');
        if (!ctx) return;

        try {
            const resp = await fetch(`${API_BASE_URL}/risk_history.php?action=trend&days=30`);
            const json = await resp.json();
            if (!json.success || !json.data || json.data.length === 0) {
                const infoEl = document.getElementById('riskTrendInfo');
                if (infoEl) infoEl.textContent = 'Risk scores will appear after prescriptions are run';
                return;
            }

            const data = json.data;
            const labels = data.map(d => {
                const dt = new Date(d.date);
                return dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
            });

            if (riskTrendChartInstance) riskTrendChartInstance.destroy();
            riskTrendChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Avg Risk Score',
                            data: data.map(d => Math.round(d.avg_score)),
                            borderColor: '#7c3aed',
                            backgroundColor: 'rgba(124, 58, 237, 0.1)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 4,
                            pointBackgroundColor: '#7c3aed'
                        },
                        {
                            label: 'HIGH Risk',
                            data: data.map(d => d.high_count),
                            borderColor: '#ef4444',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            fill: false,
                            tension: 0.3,
                            pointRadius: 3,
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100,
                            title: { display: true, text: 'Avg Score', font: { size: 11 } },
                            ticks: { font: { size: 10 } },
                            grid: { color: 'rgba(0,0,0,0.05)' }
                        },
                        y1: {
                            position: 'right',
                            beginAtZero: true,
                            title: { display: true, text: 'HIGH Count', font: { size: 11 } },
                            ticks: { stepSize: 1, font: { size: 10 } },
                            grid: { display: false }
                        },
                        x: {
                            ticks: { font: { size: 10 } },
                            grid: { display: false }
                        }
                    }
                }
            });

            const infoEl = document.getElementById('riskTrendInfo');
            if (infoEl) infoEl.textContent = `${data.length} data points over 30 days`;
        } catch (err) {
            console.warn('Risk trend chart failed:', err);
        }
    },

    drawViolationTypeChart: (filteredReports) => {
        const ctx = document.getElementById('violationTypeChart');
        if (!ctx) return;

        const reports = filteredReports || DataStore.inspectionReports;
        const keywords = [
            { label: 'Pest Control',     terms: ['pest','rodent','insect','vermin','cockroach','rat'] },
            { label: 'Waste Disposal',   terms: ['waste','garbage','trash','litter','disposal','rubbish'] },
            { label: 'Water & Sanitation', terms: ['water','toilet','lavatory','handwashing','restroom','cr','comfort room'] },
            { label: 'Food Handling',    terms: ['food','cooking','kitchen','utensil','spoil','contamina'] },
            { label: 'Structural',       terms: ['structural','ceiling','floor','wall','repair','broken','damage'] },
            { label: 'Personal Hygiene', terms: ['hygiene','health card','uniform','gloves','hairnet','apron'] },
            { label: 'Drainage',         terms: ['drainage','drain','sewage','wastewater','flooding'] },
            { label: 'Others',           terms: [] }
        ];

        const counts = new Array(keywords.length).fill(0);

        reports.forEach(r => {
            const text = ((r.recommendation || '') + ' ' + (r.remarks || '')).toLowerCase();
            if (!text.trim()) return;
            let matched = false;
            for (let i = 0; i < keywords.length - 1; i++) {
                if (keywords[i].terms.some(t => text.includes(t))) {
                    counts[i]++;
                    matched = true;
                    break;
                }
            }
            if (!matched) counts[counts.length - 1]++;
        });

        const colors = ['#f59e0b','#ef4444','#3b82f6','#10b981','#8b5cf6','#ec4899','#06b6d4','#9ca3af'];

        if (window.violationTypeChartInstance) window.violationTypeChartInstance.destroy();
        window.violationTypeChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: keywords.map(k => k.label),
                datasets: [{
                    label: 'Violations',
                    data: counts,
                    backgroundColor: colors,
                    borderRadius: 6,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1, font: { size: 11 } },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: {
                        ticks: { font: { size: 10 }, maxRotation: 30 },
                        grid: { display: false }
                    }
                }
            }
        });
    },

    renderInspectorProductivity: (filteredReports) => {
        const tbody = document.getElementById('inspectorProductivityBody');
        if (!tbody) return;

        const reports = filteredReports || DataStore.inspectionReports;
        const map = {};

        reports.forEach(r => {
            const name = r.inspector || 'Unknown';
            if (!map[name]) map[name] = { total: 0, complied: 0, notComplied: 0 };
            map[name].total++;
            if (r.complied === true || r.complied === 'true' || r.complied === 1) {
                map[name].complied++;
            } else {
                map[name].notComplied++;
            }
        });

        const sorted = Object.entries(map).sort((a, b) => b[1].total - a[1].total);

        if (sorted.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:#9ca3af;">No inspection reports yet.</td></tr>';
            return;
        }

        tbody.innerHTML = sorted.map(([name, d]) => `
            <tr style="border-bottom:1px solid #f3f4f6;" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background=''">
                <td style="padding:8px 10px;color:#374151;font-weight:500;">${Utils.esc(name)}</td>
                <td style="padding:8px 10px;text-align:center;font-weight:700;color:#374151;">${d.total}</td>
                <td style="padding:8px 10px;text-align:center;font-weight:700;color:#10b981;">${d.complied}</td>
                <td style="padding:8px 10px;text-align:center;font-weight:700;color:#ef4444;">${d.notComplied}</td>
            </tr>
        `).join('');
    },

    renderComplianceRanking: (filteredReports) => {
        const tbody = document.getElementById('complianceRankingBody');
        if (!tbody) return;

        const reports = filteredReports || DataStore.inspectionReports;
        const map = {};

        reports.forEach(r => {
            const name = r.establishment || r.location || 'Unknown';
            if (!map[name]) map[name] = { total: 0, complied: 0 };
            map[name].total++;
            if (r.complied === true || r.complied === 'true' || r.complied === 1) {
                map[name].complied++;
            }
        });

        const sorted = Object.entries(map)
            .filter(([, d]) => d.total > 0)
            .map(([name, d]) => ({ name, total: d.total, complied: d.complied, rate: Math.round((d.complied / d.total) * 100) }))
            .sort((a, b) => b.rate - a.rate || b.total - a.total);

        if (sorted.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:#9ca3af;">No inspection reports yet.</td></tr>';
            return;
        }

        tbody.innerHTML = sorted.map((e, i) => {
            const rateColor = e.rate >= 80 ? '#10b981' : e.rate >= 50 ? '#f59e0b' : '#ef4444';
            return `
            <tr style="border-bottom:1px solid #f3f4f6;" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background=''">
                <td style="padding:8px 10px;color:#9ca3af;font-size:11px;">${i + 1}</td>
                <td style="padding:8px 10px;color:#374151;font-weight:500;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Utils.esc(e.name)}">${Utils.esc(e.name)}</td>
                <td style="padding:8px 10px;text-align:center;color:#6b7280;">${e.total}</td>
                <td style="padding:8px 10px;text-align:center;font-weight:700;color:${rateColor};">${e.rate}%</td>
            </tr>`;
        }).join('');
    },

    drawComplianceChart: async (filteredReports) => {
        const ctx = document.getElementById('complianceChart');
        if (!ctx) return;

        // Use historical data from export_analytics when no filter applied
        if (!filteredReports) {
            try {
                const resp = await fetch(`${API_BASE_URL}/export_analytics.php?period=annual&year=${new Date().getFullYear()}`);
                const json = await resp.json();
                if (json.success && json.data.monthlyTrend && json.data.monthlyTrend.length > 0) {
                    const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const complied = new Array(12).fill(0);
                    const nonComplied = new Array(12).fill(0);
                    json.data.monthlyTrend.forEach(row => {
                        const m = parseInt(row.month.split('-')[1]) - 1;
                        if (m >= 0 && m < 12) {
                            complied[m] = parseInt(row.complied) || 0;
                            nonComplied[m] = parseInt(row.not_complied) || 0;
                        }
                    });
                    if (recordsChartInstance) recordsChartInstance.destroy();
                    recordsChartInstance = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: monthLabels,
                            datasets: [
                                { label: 'Complied', data: complied, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', tension: 0.4, fill: true, pointBackgroundColor: '#10b981', pointRadius: 4 },
                                { label: 'Not Complied', data: nonComplied, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', tension: 0.4, fill: true, pointBackgroundColor: '#ef4444', pointRadius: 4 }
                            ]
                        },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
                    });
                    return;
                }
            } catch (err) { console.warn('Historical compliance fetch failed, falling back:', err); }
        }

        // Fallback: use current DataStore
        const reports = filteredReports || DataStore.inspectionReports;
        const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const complied    = new Array(12).fill(0);
        const nonComplied = new Array(12).fill(0);

        reports.forEach(r => {
            const d = new Date(r.date);
            if (isNaN(d)) return;
            const m = d.getMonth();
            if (r.complied === true || r.complied === 'true' || r.complied === 1) {
                complied[m]++;
            } else {
                nonComplied[m]++;
            }
        });

        if (recordsChartInstance) recordsChartInstance.destroy();
        recordsChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: monthLabels,
                datasets: [
                    {
                        label: 'Complied',
                        data: complied,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16,185,129,0.1)',
                        tension: 0.4,
                        fill: true,
                        pointBackgroundColor: '#10b981',
                        pointRadius: 4
                    },
                    {
                        label: 'Not Complied',
                        data: nonComplied,
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239,68,68,0.08)',
                        tension: 0.4,
                        fill: true,
                        pointBackgroundColor: '#ef4444',
                        pointRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { font: { size: 11 }, boxWidth: 12 }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1, font: { size: 11 } },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: {
                        ticks: { font: { size: 11 } },
                        grid: { display: false }
                    }
                }
            }
        });
    },

    applyDateFilter: () => {
        const from = document.getElementById('chartDateFrom')?.value;
        const to   = document.getElementById('chartDateTo')?.value;

        if (!from && !to) {
            alert('Please select at least a From or To date.');
            return;
        }

        const fromDate = from ? new Date(from) : null;
        const toDate   = to   ? new Date(to)   : null;
        if (toDate) toDate.setHours(23, 59, 59);

        const all = DataStore.inspectionReports;
        const filtered = all.filter(r => {
            const d = new Date(r.date);
            if (isNaN(d)) return false;
            if (fromDate && d < fromDate) return false;
            if (toDate   && d > toDate)   return false;
            return true;
        });

        Dashboard.drawMonthlyChart(filtered);
        Dashboard.drawComplianceChart(filtered);
        Dashboard.drawViolationTypeChart(filtered);
        Dashboard.renderInspectorProductivity(filtered);
        Dashboard.renderComplianceRanking(filtered);

        document.getElementById('totalReports').textContent = filtered.length;
    },

    clearDateFilter: () => {
        document.getElementById('chartDateFrom').value = '';
        document.getElementById('chartDateTo').value   = '';
        const all = DataStore.inspectionReports;
        Dashboard.drawMonthlyChart(all);
        Dashboard.drawComplianceChart();
        Dashboard.drawViolationTypeChart();
        Dashboard.renderInspectorProductivity();
        Dashboard.renderComplianceRanking();
        document.getElementById('totalReports').textContent = all.length;
    },

    filterByBarangay: () => {
        const selected = document.getElementById('barangayFilter')?.value || '';
        const statsEl  = document.getElementById('barangayStats');
        const chartCanvas = document.getElementById('barangayViolationsChart');
        if (!statsEl) return;

        if (!selected) {
            statsEl.innerHTML = '<span style="color:#9ca3af;">Select a barangay to filter</span>';
            if (chartCanvas) chartCanvas.style.display = 'none';
            return;
        }

        statsEl.innerHTML = '<span style="color:#9ca3af;">Loading...</span>';

        fetch(`${API_BASE_URL}/sanitary.php`)
            .then(r => r.json())
            .then(result => {
                const records = result.success ? (result.data || []) : [];
                const reports = DataStore.inspectionReports;

                const filtered = records.filter(r => (r.barangay || '') === selected);
                const filteredReports = reports.filter(r =>
                    filtered.some(rec => (r.establishment || r.location || '').toLowerCase().includes((rec.businessName || '').toLowerCase()))
                );
                const compliedCount    = filteredReports.filter(r => r.complied === true || r.complied === 'true').length;
                const nonCompliedCount = filteredReports.filter(r => r.complied === false || r.complied === 'false').length;

                statsEl.innerHTML = `
                    <div style="padding:6px 0;border-bottom:1px solid #f3f4f6;"><b>${selected}</b></div>
                    <div style="padding:4px 0;">Establishments: <b>${filtered.length}</b></div>
                    <div style="padding:4px 0;">Total Reports: <b>${filteredReports.length}</b></div>
                    <div style="padding:4px 0;color:#10b981;">Complied: <b>${compliedCount}</b></div>
                    <div style="padding:4px 0;color:#ef4444;">Not Complied: <b>${nonCompliedCount}</b></div>
                `;

                // Draw violations-per-barangay chart using all barangays
                Dashboard.renderBarangayViolationsChart(records, reports);
            })
            .catch(() => {
                statsEl.innerHTML = '<span style="color:#ef4444;">Failed to load data.</span>';
            });
    },

    renderBarangayViolationsChart: (sanitaryRecords, inspectionReports) => {
        const chartCanvas = document.getElementById('barangayViolationsChart');
        if (!chartCanvas) return;

        // Count non-complied (violations) per barangay
        const barangayViolations = {};
        const barangays = [...new Set(sanitaryRecords.map(r => r.barangay).filter(Boolean))].sort();

        barangays.forEach(b => {
            const estabs = sanitaryRecords.filter(r => (r.barangay || '') === b);
            const relatedReports = inspectionReports.filter(r =>
                estabs.some(rec => (r.establishment || r.location || '').toLowerCase().includes((rec.businessName || '').toLowerCase()))
            );
            barangayViolations[b] = relatedReports.filter(r => r.complied === false || r.complied === 'false').length;
        });

        const labels = Object.keys(barangayViolations);
        const values = Object.values(barangayViolations);

        chartCanvas.style.display = 'block';

        // Destroy previous chart instance if any
        if (window._barangayChartInstance) {
            window._barangayChartInstance.destroy();
        }

        window._barangayChartInstance = new Chart(chartCanvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Violations (Not Complied)',
                    data: values,
                    backgroundColor: labels.map(b => barangayViolations[b] > 0 ? '#ef4444' : '#10b981'),
                    borderRadius: 5
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => ` ${ctx.parsed.y} violation${ctx.parsed.y !== 1 ? 's' : ''}`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1, font: { size: 11 } }
                    },
                    x: {
                        ticks: { font: { size: 10 }, maxRotation: 45 }
                    }
                }
            }
        });
    },

    populateBarangayFilter: (records) => {
        const sel = document.getElementById('barangayFilter');
        if (!sel) return;
        const barangays = [...new Set(records.map(r => r.barangay).filter(Boolean))].sort();
        sel.innerHTML = '<option value="">All Barangays</option>' +
            barangays.map(b => `<option value="${b}">${b}</option>`).join('');
    },

    renderActivity: async () => {
        const activityList = document.getElementById('activityList');
        const activities = [];

        let liveSanitaryRecords = [];
        try {
            const res  = await fetch(`${API_BASE_URL}/sanitary.php`);
            const json = await res.json();
            liveSanitaryRecords = json.success ? (json.data || []) : [];
        } catch (err) {
            console.error('Error loading sanitary records for activity feed:', err);
        }

        liveSanitaryRecords.slice(-2).reverse().forEach(record => {
            activities.push({
                icon: 'fa-clipboard-check',
                text: `Sanitary record added: ${Utils.esc(record.businessName)} - ${Utils.esc(record.barangay)}`,
                time: Utils.formatDate(record.date)
            });
        });

        const allBurialRecords = [
            ...cachedBurialRecords.cadaver.map(r    => ({...r, type: 'Cadaver'})),
            ...cachedBurialRecords.skeletal.map(r   => ({...r, type: 'Skeletal Transfer'})),
            ...cachedBurialRecords.exhumation.map(r => ({...r, type: 'Exhumation'}))
        ].sort((a, b) => new Date(b.datetime || b.date) - new Date(a.datetime || a.date));

        allBurialRecords.slice(0, 2).forEach(record => {
            activities.push({
                icon: 'fa-cross',
                text: `${Utils.esc(record.type)} record added: ${Utils.esc(record.deceased)}`,
                time: Utils.formatDate(record.datetime || record.date)
            });
        });

        DataStore.inspectionReports.slice(-2).reverse().forEach(report => {
            activities.push({
                icon: 'fa-file-alt',
                text: `Inspection report: ${report.recommendation ? report.recommendation.substring(0, 50) + '...' : 'N/A'}`,
                time: Utils.formatDate(report.date)
            });
        });

        if (activities.length === 0) {
            activityList.innerHTML = '<p class="empty-state">No recent activity from inspectors</p>';
            return;
        }

        activityList.innerHTML = activities.slice(0, 5).map(activity => `
            <div class="activity-item">
                <div class="activity-icon">
                    <i class="fas ${activity.icon}"></i>
                </div>
                <div class="activity-content">
                    <p class="activity-text">${activity.text}</p>
                    <p class="activity-time">${activity.time}</p>
                </div>
            </div>
        `).join('');
    },

    initTabs: () => {
        const tabs = document.querySelectorAll('.dashboard-tab');
        const contents = document.querySelectorAll('.dashboard-tab-content');
        if (!tabs.length) return;
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const target = tab.dataset.tab;
                document.querySelector(`.dashboard-tab-content[data-tab="${target}"]`)?.classList.add('active');
                // Resize Chart.js canvases in the now-visible tab
                setTimeout(() => {
                    if (typeof Chart !== 'undefined') {
                        Object.values(Chart.instances || {}).forEach(chart => chart.resize());
                    }
                }, 50);
            });
        });
    }
};

// Inspector Management
const InspectorManager = {
    _allInspectors: [],
    render: async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/inspector.php`);
            const result = await response.json();
            
            if (!result.success) {
                const tbody = document.getElementById('inspectorsTableBody');
                tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Error loading inspectors</td></tr>';
                return;
            }
            
            InspectorManager._allInspectors = result.data || [];
            DataStore.inspectors = InspectorManager._allInspectors;
            InspectorManager._renderList(InspectorManager._allInspectors);
        } catch (error) {
            console.error('Error loading inspectors:', error);
        }
    },
    _renderList: (inspectors) => {
        const tbody = document.getElementById('inspectorsTableBody');
        const countEl = document.getElementById('admin-inspector-count');
        if (countEl) countEl.textContent = `Showing ${inspectors.length} of ${InspectorManager._allInspectors.length} inspectors`;
        if (inspectors.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No inspectors found</td></tr>';
            return;
        }
        tbody.innerHTML = inspectors.map(inspector => `
            <tr data-testid="inspector-row-${inspector.id}">
                <td>${inspector.id}</td>
                <td>${Utils.esc(inspector.fullName)}</td>
                <td>${Utils.esc(inspector.email)}</td>
                <td>${Utils.esc(inspector.username)}</td>
                <td>${Utils.esc(inspector.role)}</td>
                <td>
                    <div class="action-buttons">
                        <button class="action-btn action-btn-edit" onclick="InspectorManager.openEditModal(${inspector.id})" data-testid="edit-inspector-${inspector.id}">
                            <i class="bi bi-pencil-square"></i>
                        </button>
                        <button class="action-btn action-btn-delete" onclick="InspectorManager.deleteInspector(${inspector.id})" data-testid="delete-inspector-${inspector.id}">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    },
    filter: () => {
        const q = (document.getElementById('admin-inspector-search')?.value || '').trim().toLowerCase();
        if (!q) { InspectorManager._renderList(InspectorManager._allInspectors); return; }
        const filtered = InspectorManager._allInspectors.filter(i =>
            (i.fullName || '').toLowerCase().includes(q) ||
            (i.email || '').toLowerCase().includes(q) ||
            (i.username || '').toLowerCase().includes(q)
        );
        InspectorManager._renderList(filtered);
    },

    openAddModal: () => {
        const content = `
            <div class="modal-header">
                <h3>Add Inspector Account</h3>
                <button class="modal-close" onclick="Utils.closeModal()" data-testid="modal-close-btn">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <form id="inspectorForm" onsubmit="event.preventDefault(); InspectorManager.saveInspector();">
                    <div class="form-group">
                        <label class="form-label">Full Name <span style="color:red">*</span></label>
                        <input type="text" class="form-input" id="fullName" placeholder="e.g. Juan Dela Cruz" required data-testid="input-fullname">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Email <span style="color:red">*</span></label>
                        <input type="email" class="form-input" id="email" placeholder="e.g. juan@tayabas.gov.ph" required data-testid="input-email">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Username <span style="color:red">*</span></label>
                        <input type="text" class="form-input" id="username" placeholder="Login username" required data-testid="input-username">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Password <span style="color:red">*</span></label>
                        <input type="password" class="form-input" id="password" placeholder="Minimum 6 characters" required data-testid="input-password">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Role Title</label>
                        <input type="text" class="form-input" id="role" value="Field Inspector" data-testid="input-role">
                        <small style="color:#6B7280;">Login role is always set to <strong>inspector</strong></small>
                    </div>
                    <p id="inspectorFormError" style="color:#DC2626;font-size:13px;margin-top:8px;display:none;"></p>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="Utils.closeModal()" data-testid="cancel-btn">Cancel</button>
                <button class="btn btn-primary" onclick="InspectorManager.saveInspector()" data-testid="save-inspector-btn">
                    <i class="fas fa-save"></i> Save Inspector
                </button>
            </div>
        `;
        Utils.openModal(content);
    },

    openEditModal: async (id) => {
        try {
            const response = await fetch(`${API_BASE_URL}/inspector.php`);
            const result = await response.json();
            
            if (!result.success) {
                Utils.showToast('Error loading inspector', 'error');
                return;
            }
            
            const inspector = result.data.find(i => i.id === id);
            if (!inspector) return;

            const content = `
                <div class="modal-header">
                    <h3>Edit Inspector Account</h3>
                    <button class="modal-close" onclick="Utils.closeModal()" data-testid="modal-close-btn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="inspectorForm">
                        <input type="hidden" id="inspectorId" value="${inspector.id}">
                        <div class="form-group">
                            <label class="form-label">Full Name</label>
                            <input type="text" class="form-input" id="fullName" value="${Utils.esc(inspector.fullName)}" required data-testid="input-fullname">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Email</label>
                            <input type="email" class="form-input" id="email" value="${Utils.esc(inspector.email)}" required data-testid="input-email">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Username</label>
                            <input type="text" class="form-input" id="username" value="${Utils.esc(inspector.username)}" required data-testid="input-username">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Password</label>
                            <input type="password" class="form-input" id="password" placeholder="Leave blank to keep current password" data-testid="input-password">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Role</label>
                            <input type="text" class="form-input" id="role" value="${Utils.esc(inspector.role)}" required data-testid="input-role">
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="Utils.closeModal()" data-testid="cancel-btn">Cancel</button>
                    <button class="btn btn-primary" onclick="InspectorManager.saveInspector()" data-testid="save-inspector-btn">Update</button>
                </div>
            `;
            Utils.openModal(content);
        } catch (error) {
            console.error('Error:', error);
            Utils.showToast('Error loading inspector', 'error');
        }
    },

    saveInspector: async () => {
        const id       = document.getElementById('inspectorId')?.value || '';
        const fullName = document.getElementById('fullName')?.value.trim() || '';
        const email    = document.getElementById('email')?.value.trim() || '';
        const username = document.getElementById('username')?.value.trim() || '';
        const password = document.getElementById('password')?.value || '';
        const role     = document.getElementById('role')?.value.trim() || 'Field Inspector';

        const errEl = document.getElementById('inspectorFormError');

        const showErr = (msg) => {
            if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
            else Utils.showToast(msg, 'error');
        };

        // Validation
        if (!fullName || !email || !username) {
            showErr('Full Name, Email, and Username are required.');
            return;
        }
        if (!id && !password) {
            showErr('Password is required for new inspectors.');
            return;
        }
        if (password && password.length < 8) {
            showErr('Password must be at least 8 characters.');
            return;
        }

        const data = { fullName, email, username, role };
        if (password) data.password = password;
        if (id) data.id = parseInt(id);

        const saveBtn = document.querySelector('[data-testid="save-inspector-btn"]');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

        try {
            const response = await fetch(`${API_BASE_URL}/inspector.php`, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const text = await response.text();
            let result;
            try { result = JSON.parse(text); }
            catch(e) { throw new Error('Server returned invalid response: ' + text.substring(0, 100)); }

            if (result.success) {
                Utils.showToast(id ? 'Inspector updated successfully' : 'Inspector added successfully! They can now log in.', 'success');
                Utils.closeModal();
                await InspectorManager.render();
                Dashboard.updateStats();
            } else {
                showErr(result.message || 'Failed to save inspector.');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = id ? 'Update' : 'Save Inspector'; }
            }
        } catch (error) {
            console.error('Error saving inspector:', error);
            showErr('Connection error: ' + error.message);
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = id ? 'Update' : 'Save Inspector'; }
        }
    },

    deleteInspector: async (id) => {
        if (!confirm('Are you sure you want to delete this inspector?')) return;
        
        const reason = prompt('Reason for deletion (optional):') || 'No reason provided';
        
        try {
            const response = await fetch(`${API_BASE_URL}/inspector.php?id=${id}&reason=${encodeURIComponent(reason)}`, {
                method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (result.success) {
                Utils.showToast('Inspector deleted successfully', 'success');
                await InspectorManager.render();
                Dashboard.updateStats();
            } else {
                Utils.showToast('Failed to delete inspector', 'error');
            }
        } catch (error) {
            console.error('Error deleting inspector:', error);
            Utils.showToast('Error: ' + error.message, 'error');
        }
    }
};

const VHModal = {
    openViolationModal: async (businessName) => {
        const content = `
            <div style="
                background: #fff;
                border-radius: 12px;
                width: 100%;
                max-width: 780px;
                margin: auto;
                box-shadow: 0 20px 60px rgba(0,0,0,0.2);
                overflow: hidden;
            ">
                <div style="
                    background: linear-gradient(135deg, #1f2937 0%, #374151 100%);
                    padding: 20px 28px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                ">
                    <div>
                        <h2 style="color:#fff; font-size:18px; font-weight:700; margin:0;">
                            <i class="fas fa-history" style="margin-right:10px; color:#f59e0b;"></i>
                            Inspection & Violation History
                        </h2>
                        <p style="color:#9ca3af; font-size:13px; margin:4px 0 0 0;">${businessName}</p>
                    </div>
                    <button onclick="Utils.closeModal()" style="
                        background: rgba(255,255,255,0.1);
                        border: none; border-radius: 8px;
                        color: #fff; width:34px; height:34px;
                        cursor:pointer; font-size:16px;
                        display:flex; align-items:center; justify-content:center;
                    "><i class="fas fa-times"></i></button>
                </div>
                <div id="vh-modal-body" style="padding: 24px; max-height: 70vh; overflow-y: auto;">
                    <div style="display:flex; align-items:center; justify-content:center; padding:40px;">
                        <i class="fas fa-spinner fa-spin" style="color:#10b981; font-size:24px; margin-right:10px;"></i>
                        <span style="color:#6b7280; font-size:15px;">Loading history...</span>
                    </div>
                </div>
                <div style="padding:16px 24px; border-top:1px solid #e5e7eb; display:flex; justify-content:flex-end;">
                    <button onclick="Utils.closeModal()" style="
                        padding: 10px 28px; background: #1f2937; color:#fff;
                        border:none; border-radius:8px; font-size:14px;
                        font-weight:600; cursor:pointer;
                    ">Close</button>
                </div>
            </div>
        `;
        Utils.openModal(content);
        await VHModal.loadHistory(businessName);
    },

    loadHistory: async (businessName) => {
        const container = document.getElementById('vh-modal-body');
        if (!container) return;

        let dbReports = [];
        try {
            const res = await fetch(`${API_BASE_URL}/inspection.php`);
            const json = await res.json();
            if (json.success && Array.isArray(json.data)) dbReports = json.data;
        } catch (_) {}

        const merged = [...dbReports];
        (DataStore.inspectionReports || []).forEach(r => {
            if (!merged.find(m => String(m.id) === String(r.id))) merged.push(r);
        });

        const name = (businessName || '').trim().toLowerCase();
        const matched = merged.filter(r => {
            const est = (r.establishment || r.location || '').trim().toLowerCase();
            return est === name || est.includes(name) || name.includes(est);
        });

        matched.sort((a, b) => new Date(b.date || b.report_date || 0) - new Date(a.date || a.report_date || 0));

        if (matched.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:50px 20px;">
                    <i class="fas fa-clipboard-list" style="font-size:48px; color:#d1d5db; margin-bottom:16px; display:block;"></i>
                    <p style="color:#6b7280; font-size:16px; font-weight:600; margin:0;">No inspection history found</p>
                    <p style="color:#9ca3af; font-size:13px; margin-top:6px;">Once inspectors submit reports for this establishment, they will appear here.</p>
                </div>`;
            return;
        }

        const totalCount     = matched.length;
        const violationCount = matched.filter(r => !r.complied).length;
        const compliedCount  = matched.filter(r => r.complied).length;
        const complianceRate = totalCount > 0 ? Math.round((compliedCount / totalCount) * 100) : 0;

        const rows = matched.map((r, i) => {
            const date           = r.date || r.report_date || '';
            const formatted      = date ? new Date(date).toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' }) : 'N/A';
            const inspector      = r.inspector || r.inspector_name || 'N/A';
            const remarks        = r.remarks || 'No remarks recorded.';
            const recommendation = r.recommendation || 'No recommendation recorded.';
            const complied       = r.complied;
            const status         = r.status || 'Submitted';

            return `
                <div style="
                    border: 1px solid ${complied ? '#bbf7d0' : '#fecaca'};
                    border-left: 5px solid ${complied ? '#10b981' : '#ef4444'};
                    border-radius: 10px;
                    padding: 18px 20px;
                    margin-bottom: 16px;
                    background: ${complied ? '#f0fdf4' : '#fff5f5'};
                ">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span style="
                                background: ${complied ? '#10b981' : '#ef4444'};
                                color:#fff; font-size:12px; font-weight:700;
                                padding:5px 14px; border-radius:20px; letter-spacing:0.05em;
                            ">${complied ? '✓ COMPLIED' : '✗ VIOLATION'}</span>
                            <span style="
                                background:#f3f4f6; color:#374151;
                                font-size:12px; font-weight:500;
                                padding:4px 10px; border-radius:6px;
                            ">${status}</span>
                        </div>
                        <div style="font-size:13px; color:#6b7280; display:flex; gap:16px; flex-wrap:wrap;">
                            <span><i class="fas fa-calendar-alt" style="margin-right:5px; color:#9ca3af;"></i>${formatted}</span>
                            <span><i class="fas fa-user" style="margin-right:5px; color:#9ca3af;"></i>${inspector}</span>
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                        <div style="background:#fff; border-radius:8px; padding:14px; border:1px solid ${complied ? '#d1fae5' : '#fee2e2'};">
                            <p style="font-size:11px; font-weight:700; color:#f59e0b; text-transform:uppercase; letter-spacing:0.06em; margin:0 0 8px 0;">
                                <i class="fas fa-exclamation-triangle" style="margin-right:5px;"></i>Remarks / Violations Found
                            </p>
                            <p style="font-size:14px; color:#1f2937; line-height:1.6; margin:0;">${Utils.esc(remarks)}</p>
                        </div>
                        <div style="background:#fff; border-radius:8px; padding:14px; border:1px solid #dbeafe;">
                            <p style="font-size:11px; font-weight:700; color:#3b82f6; text-transform:uppercase; letter-spacing:0.06em; margin:0 0 8px 0;">
                                <i class="fas fa-clipboard-check" style="margin-right:5px;"></i>Recommendation
                            </p>
                            <p style="font-size:14px; color:#1f2937; line-height:1.6; margin:0;">${Utils.esc(recommendation)}</p>
                        </div>
                    </div>
                </div>`;
        }).join('');

        container.innerHTML = `
            <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:24px;">
                <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:14px; text-align:center;">
                    <p style="font-size:28px; font-weight:800; color:#10b981; margin:0;">${totalCount}</p>
                    <p style="font-size:12px; color:#6b7280; margin:4px 0 0 0;">Total Inspections</p>
                </div>
                <div style="background:#fff5f5; border:1px solid #fecaca; border-radius:10px; padding:14px; text-align:center;">
                    <p style="font-size:28px; font-weight:800; color:#ef4444; margin:0;">${violationCount}</p>
                    <p style="font-size:12px; color:#6b7280; margin:4px 0 0 0;">Violations</p>
                </div>
                <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:14px; text-align:center;">
                    <p style="font-size:28px; font-weight:800; color:#3b82f6; margin:0;">${compliedCount}</p>
                    <p style="font-size:12px; color:#6b7280; margin:4px 0 0 0;">Complied</p>
                </div>
                <div style="background:#fefce8; border:1px solid #fde68a; border-radius:10px; padding:14px; text-align:center;">
                    <p style="font-size:28px; font-weight:800; color:#d97706; margin:0;">${complianceRate}%</p>
                    <p style="font-size:12px; color:#6b7280; margin:4px 0 0 0;">Compliance Rate</p>
                </div>
            </div>
            <p style="font-size:13px; font-weight:600; color:#374151; margin:0 0 12px 0;">
                <i class="fas fa-list" style="margin-right:6px; color:#6b7280;"></i>
                Showing ${totalCount} inspection record(s) — newest first
            </p>
            ${rows}`;
    }
};

// Sanitary Records Management
const SanitaryManager = {
    records: [],
    _displayed: [],

    load: async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/sanitary.php`);
            const result = await response.json();
            if (result.success) {
                SanitaryManager.records = result.data || [];
            }
        } catch (error) {
            console.error('Error loading sanitary records:', error);
            SanitaryManager.records = [];
        }
    },

    render: async () => {
        const tbody = document.getElementById('sanitaryTableBody');
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading...</td></tr>';
        await SanitaryManager.load();
        SanitaryManager.applyFilters();
    },

    applyFilters: () => {
        const records = SanitaryManager.records;
        const tbody = document.getElementById('sanitaryTableBody');
        const countEl = document.getElementById('admin-sanitary-count');
        const searchEl = document.getElementById('admin-sanitary-search');
        const sortEl = document.getElementById('admin-sanitary-sort');
        const q = (searchEl?.value || '').trim().toLowerCase();
        const sortBy = sortEl?.value || 'newest';

        let filtered = records;
        if (q) {
            filtered = records.filter(r => {
                const ownerName = r.owner ? `${r.owner.first || ''} ${r.owner.middle || ''} ${r.owner.last || ''}`.toLowerCase() : '';
                return (r.businessName || '').toLowerCase().includes(q) ||
                       (r.permitNo || '').toLowerCase().includes(q) ||
                       ownerName.includes(q);
            });
        }

        // Sort
        const sorted = [...filtered].sort((a, b) => {
            switch (sortBy) {
                case 'newest': return new Date(b.date || 0) - new Date(a.date || 0);
                case 'oldest': return new Date(a.date || 0) - new Date(b.date || 0);
                case 'name-az': return (a.businessName || '').localeCompare(b.businessName || '');
                case 'name-za': return (b.businessName || '').localeCompare(a.businessName || '');
                case 'barangay': return (a.barangay || '').localeCompare(b.barangay || '');
                default: return new Date(b.date || 0) - new Date(a.date || 0);
            }
        });

        // Show latest N when no search active (Load more expands the window)
        const page = q ? { displayed: sorted, hasMore: false, remaining: 0 } : TablePaging.slice(sorted, 'sanitary', 10);
        const displayed = page.displayed;
        SanitaryManager._displayed = displayed;
        if (countEl) countEl.textContent = q ? `${displayed.length} matching records` : `Showing ${displayed.length} of ${records.length} records`;

        if (displayed.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No sanitary records found</td></tr>';
            return;
        }

        tbody.innerHTML = displayed.map((record, index) => {
            const ai = getAdminRiskForEstablishment(record.businessName);
            const riskBadge = renderAdminRiskBadge(ai);
            return `
            <tr data-testid="sanitary-row-${index}">
                <td>${Utils.esc(record.permitNo) || 'N/A'}</td>
                <td><span onclick="VHModal.openViolationModal('${(record.businessName || '').replace(/'/g, "\\'")}')" style="cursor:pointer; color:#10b981; font-weight:600; text-decoration:underline; text-underline-offset:3px;" title="Click to view violation history">${Utils.esc(record.businessName) || 'N/A'}</span></td>
                <td>${Utils.formatDate(record.date)}</td>
                <td>${riskBadge}</td>
                <td>
                    <div class="action-buttons">
                        <button class="action-btn action-btn-view" onclick="SanitaryManager.openViewModal(${index})" data-testid="view-sanitary-${index}">
                            <i class="bi bi-eye"></i>
                        </button>
                        <button class="action-btn action-btn-delete" onclick="SanitaryManager.deleteRecord(${record.id})" data-testid="delete-sanitary-${index}">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `}).join('') + (page.hasMore ? TablePaging.moreRow('sanitary', page.remaining, 5, 10) : '');
    },

    openViewModal: (index) => {
        const record = SanitaryManager._displayed[index];

        if (!record) {
            Utils.showToast('Record not found', 'error');
            return;
        }

        const ownerName = record.owner
            ? `${record.owner.first || ''} ${record.owner.middle || ''} ${record.owner.last || ''}`
            : 'N/A';

        const personnelList = record.personnel && Array.isArray(record.personnel)
            ? record.personnel.map(p => `${p.first || ''} ${p.middle || ''} ${p.last || ''}`).join(', ')
            : 'N/A';

        const ai = getAdminRiskForEstablishment(record.businessName);
        const riskBadge = renderAdminRiskBadge(ai);
        const ai_days = ai ? (ai.daysToComply ?? (ai.riskLevel === 'HIGH' ? 7 : 30)) : null;

        const content = `
            <div class="modal-header">
                <h3>Sanitary Record Details</h3>
                <button class="modal-close" onclick="Utils.closeModal()" data-testid="modal-close-btn">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <div class="modal-body" style="max-height:65vh; overflow-y:auto;">

                <div>
                    <div class="detail-section">
                        <h4>Basic Information</h4>
                        <div class="detail-grid">
                            <div class="detail-item">
                                <span class="detail-label">Record No.</span>
                                <span class="detail-value">${record.no || 'N/A'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Date</span>
                                <span class="detail-value">${Utils.formatDate(record.date)}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Permit No</span>
                                <span class="detail-value">${Utils.esc(record.permitNo) || 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="detail-section">
                        <h4>Establishment Details</h4>
                        <div class="detail-grid">
                            <div class="detail-item">
                                <span class="detail-label">Business Name</span>
                                <span class="detail-value">${Utils.esc(record.businessName) || 'N/A'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Owner Name</span>
                                <span class="detail-value">${ownerName}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Sex</span>
                                <span class="detail-value">${record.sex || 'N/A'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Barangay</span>
                                <span class="detail-value">${Utils.esc(record.barangay) || 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="detail-section">
                        <h4>Personnel</h4>
                        <p style="font-size:14px; color:#374151;">${personnelList}</p>
                    </div>
                    <div class="detail-section">
                        <h4>Results</h4>
                        <div class="detail-grid">
                            <div class="detail-item">
                                <span class="detail-label">Chest X-ray</span>
                                <span class="detail-value">${record.result?.xray ? '✓ Done' : '✗ Not Done'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Stool Exam</span>
                                <span class="detail-value">${record.result?.stool ? '✓ Done' : '✗ Not Done'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="detail-section">
                        <h4>Remarks</h4>
                        <p style="font-size:14px; color:#374151;">${Utils.esc(record.remarks) || 'No remarks available'}</p>
                    </div>
                </div>

            </div>

            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="Utils.closeModal()" data-testid="cancel-btn">Close</button>
                <button class="btn btn-primary" onclick="SanitaryManager.printPermit(${index})" data-testid="print-btn">
                    <i class="fas fa-print"></i> Print Permit
                </button>
            </div>
        `;
        Utils.openModal(content);
    },

    deleteRecord: async (id) => {
        const reason = prompt('Reason for archiving? (Optional)', '');
        if (reason === null) return;

        if (confirm('Are you sure you want to archive this record?')) {
            try {
                const response = await fetch(
                    `${API_BASE_URL}/sanitary.php?id=${id}&reason=${encodeURIComponent(reason || 'No reason provided')}`,
                    { method: 'DELETE' }
                );
                const result = await response.json();
                if (result.success) {
                    await SanitaryManager.render();
                    Dashboard.updateStats();
                    Utils.showToast('Record archived successfully');
                } else {
                    Utils.showToast('Failed to archive record', 'error');
                }
            } catch (error) {
                Utils.showToast('Error: ' + error.message, 'error');
            }
        }
    },

    printPermit: (index) => {
        const record = (SanitaryManager._displayed || SanitaryManager.records)[index];
        if (!record) return;

        const ownerName = record.owner
            ? `${record.owner.first || ''} ${record.owner.middle ? record.owner.middle + ' ' : ''}${record.owner.last || ''}`.trim()
            : 'N/A';

        const issuanceDate = record.date
            ? new Date(record.date).toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' }).toUpperCase()
            : new Date().toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' }).toUpperCase();

        const currentYear = new Date().getFullYear();
        const expirationDate = `DECEMBER 31, ${currentYear}`;
        const address = `${record.barangay || ''}, City of Tayabas, Quezon`.toUpperCase();

        const permitWin = window.open('', '_blank', 'width=900,height=1100');
        permitWin.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Sanitary Permit - ${Utils.esc(record.businessName) || ''}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 794px;
    height: 1050px;
    overflow: hidden;
    background: #fff;
  }
  .permit-wrapper {
    position: relative;
    width: 794px;
    height: 1050px;
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
  .field {
    position: absolute;
    z-index: 2;
    font-family: Arial, sans-serif;
    font-weight: bold;
    color: #111;
    text-align: center;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
  }
  .f-owner {
    top: 38.5%;
    font-size: 22px;
    font-weight: 900;
    text-decoration: underline;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .f-business {
    top: 50%;
    font-size: 18px;
    font-weight: 900;
    text-decoration: underline;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .f-address {
    top: 59%;
    font-size: 14px;
    font-weight: bold;
    text-decoration: underline;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .permit-fields {
    position: absolute;
    z-index: 2;
    top: 71%;
    left: 34%;
    font-family: Arial, sans-serif;
    font-size: 13px;
    line-height: 2;
  }
  .permit-fields .val {
    font-weight: bold;
    text-decoration: underline;
    color: #111;
  }
  .permit-fields .val-red {
    font-weight: bold;
    text-decoration: underline;
    color: #cc0000;
  }
  @media print {
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

  <div class="field f-owner">${ownerName}</div>
  <div class="field f-business">${Utils.esc(record.businessName) || 'N/A'}</div>
  <div class="field f-address">${address}</div>

  <div class="permit-fields">
    Sanitary Permit No. : &nbsp;<span class="val">${Utils.esc(record.permitNo) || 'N/A'}</span><br>
    Date of Issuance: &nbsp;<span class="val">${issuanceDate}</span><br>
    Date of Expiration: &nbsp;<span class="val-red">${expirationDate}</span>
  </div>
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
};

// Burial Records Management
// Burial Records Management
let cachedBurialRecords = { cadaver: [], skeletal: [], exhumation: [] };

const BurialManager = {
    _allRecords: [],
    render: async () => {
        const tbody = document.getElementById('burialTableBody');
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading...</td></tr>';

        try {
            const response = await fetch(`${API_BASE_URL}/burial.php`);
            const result = await response.json();

            if (!result.success) {
                tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Error: ${result.message}</td></tr>`;
                return;
            }

            // Cache the data
            cachedBurialRecords = {
                cadaver:    result.data.cadaver    || [],
                skeletal:   result.data.skeletal   || [],
                exhumation: result.data.exhumation || []
            };

            // Combine all into one flat list with category labels
            BurialManager._allRecords = [
                ...cachedBurialRecords.cadaver.map(r    => ({...r, category: 'Cadaver',            categoryType: 'cadaver'})),
                ...cachedBurialRecords.skeletal.map(r   => ({...r, category: 'Skeletal Transfer',  categoryType: 'skeletal'})),
                ...cachedBurialRecords.exhumation.map(r => ({...r, category: 'Exhumation',         categoryType: 'exhumation'}))
            ];

            BurialManager.applyFilters();

        } catch (error) {
            console.error('Error loading burial records:', error);
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Failed to load records. Check connection.</td></tr>';
        }
    },

    applyFilters: () => {
        const tbody = document.getElementById('burialTableBody');
        const countEl = document.getElementById('admin-burial-count');
        const searchEl = document.getElementById('admin-burial-search');
        const sortEl = document.getElementById('admin-burial-sort');
        const q = (searchEl?.value || '').trim().toLowerCase();
        const sortBy = sortEl?.value || 'newest';

        let filtered = BurialManager._allRecords;
        if (q) {
            filtered = filtered.filter(r =>
                (r.deceased || '').toLowerCase().includes(q) ||
                (r.informant || '').toLowerCase().includes(q) ||
                (r.category || '').toLowerCase().includes(q)
            );
        }

        const sorted = [...filtered].sort((a, b) => {
            switch (sortBy) {
                case 'newest': return new Date(b.datetime || b.deathDate || 0) - new Date(a.datetime || a.deathDate || 0);
                case 'oldest': return new Date(a.datetime || a.deathDate || 0) - new Date(b.datetime || b.deathDate || 0);
                case 'name-az': return (a.deceased || '').localeCompare(b.deceased || '');
                case 'category': return (a.category || '').localeCompare(b.category || '') || new Date(b.datetime || 0) - new Date(a.datetime || 0);
                default: return new Date(b.datetime || b.deathDate || 0) - new Date(a.datetime || a.deathDate || 0);
            }
        });

        const page = q ? { displayed: sorted, hasMore: false, remaining: 0 } : TablePaging.slice(sorted, 'burial', 10);
        const displayed = page.displayed;
        if (countEl) countEl.textContent = q ? `${displayed.length} matching records` : `Showing ${displayed.length} of ${BurialManager._allRecords.length} records`;

        if (displayed.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No burial records found</td></tr>';
            return;
        }

        tbody.innerHTML = displayed.map((record, index) => `
            <tr data-testid="burial-row-${index}">
                <td><span class="type-badge type-burial">${record.category}</span></td>
                <td>${Utils.esc(record.deceased) || 'N/A'}</td>
                <td>${Utils.formatDate(record.datetime || record.deathDate)}</td>
                <td>${Utils.esc(record.informant) || 'N/A'}</td>
                <td>
                    <div class="action-buttons">
                        <button class="action-btn action-btn-view" onclick="BurialManager.openViewModal('${record.categoryType}', ${record.id})" data-testid="view-burial-${index}">
                            <i class="bi bi-eye"></i>
                        </button>
                        <button class="action-btn action-btn-delete" onclick="BurialManager.deleteRecord('${record.categoryType}', ${record.id})" data-testid="delete-burial-${index}">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('') + (page.hasMore ? TablePaging.moreRow('burial', page.remaining, 5, 10) : '');
    },

    openViewModal: (categoryType, recordId) => {
        const records = cachedBurialRecords[categoryType] || [];
        const record = records.find(r => String(r.id) === String(recordId));

        if (!record) {
            Utils.showToast('Record not found', 'error');
            return;
        }

        const categoryLabel = {
            cadaver:    'Cadaver',
            skeletal:   'Skeletal Transfer',
            exhumation: 'Exhumation'
        }[categoryType] || categoryType;

        let specificFields = '';

        if (categoryType === 'cadaver') {
            specificFields = `
                <div class="detail-item">
                    <span class="detail-label">Place of Death</span>
                    <span class="detail-value">${record.deathPlace || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Place of Origin</span>
                    <span class="detail-value">${record.origin || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Place to be Transferred</span>
                    <span class="detail-value">${record.transfer || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Funeral Service</span>
                    <span class="detail-value">${record.funeral || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">OR / Burial Number</span>
                    <span class="detail-value">${record.orNumber || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Informant</span>
                    <span class="detail-value">${Utils.esc(record.informant) || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Inspector</span>
                    <span class="detail-value">${Utils.esc(record.inspector) || 'N/A'}</span>
                </div>`;
        } else {
            specificFields = `
                <div class="detail-item">
                    <span class="detail-label">Cemetery (Origin)</span>
                    <span class="detail-value">${record.cemeteryOrigin || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Cemetery to be Transferred</span>
                    <span class="detail-value">${record.cemeteryTransfer || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Funeral Service</span>
                    <span class="detail-value">${record.funeral || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">OR Number</span>
                    <span class="detail-value">${record.orNumber || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Inspector</span>
                    <span class="detail-value">${Utils.esc(record.inspector) || 'N/A'}</span>
                </div>`;
        }

        const content = `
            <div class="modal-header">
                <h3>${categoryLabel} Record Details</h3>
                <button class="modal-close" onclick="Utils.closeModal()" data-testid="modal-close-btn">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="detail-section">
                    <h4>Basic Information</h4>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span class="detail-label">Category</span>
                            <span class="detail-value">${categoryLabel}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Date & Time Attended</span>
                            <span class="detail-value">${record.datetime ? Utils.formatDate(record.datetime) : 'N/A'}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Deceased Name</span>
                            <span class="detail-value">${Utils.esc(record.deceased) || 'N/A'}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Date of Death</span>
                            <span class="detail-value">${Utils.formatDate(record.deathDate)}</span>
                        </div>
                    </div>
                </div>
                <div class="detail-section">
                    <h4>Additional Information</h4>
                    <div class="detail-grid">
                        ${specificFields}
                    </div>
                </div>
                ${record.filePath ? `
                <div class="detail-section">
                    <h4>Death Certificate</h4>
                    <p style="font-size: 14px; color: #374151;">
                        ${Utils.esc(record.fileName) || 'Attachment'}
                        <a href="${API_BASE_URL}/download.php?path=${encodeURIComponent(record.filePath)}" class="btn btn-primary" style="margin-left:10px;display:inline-block;padding:4px 10px;">
                            <i class="fas fa-download" style="margin-right:4px;"></i>Download
                        </a>
                    </p>
                </div>
                ` : record.fileName ? `
                <div class="detail-section">
                    <h4>Death Certificate</h4>
                    <p style="font-size: 14px; color: #374151;">${record.fileName} (file not available for download)</p>
                </div>
                ` : ''}
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="Utils.closeModal()" data-testid="cancel-btn">Close</button>
                <button class="btn btn-primary" onclick="window.print()" data-testid="print-btn">
                    <i class="fas fa-print"></i> Print
                </button>
            </div>
        `;
        Utils.openModal(content);
    },

    deleteRecord: async (categoryType, recordId) => {
        const reason = prompt('Reason for archiving? (Optional)', '');
        if (reason === null) return; // user cancelled

        try {
            const response = await fetch(
                `${API_BASE_URL}/burial.php?id=${recordId}&reason=${encodeURIComponent(reason || 'No reason provided')}`,
                { method: 'DELETE' }
            );
            const result = await response.json();

            if (result.success) {
                Utils.showToast('Record archived successfully', 'success');
                await BurialManager.render();
                await Dashboard.updateStats();
                Dashboard.renderActivity();
            } else {
                Utils.showToast('Failed to delete: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Delete error:', error);
            Utils.showToast('Failed to delete record', 'error');
        }
    },

    printRecord: () => {
        window.print();
    }
};

// Inspection Reports Management
const ReportsManager = {
    loadAndRender: async () => {
        const tbody = document.getElementById('reportsTableBody');
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#6b7280;"><i class="fas fa-spinner fa-spin"></i> Loading reports from database...</td></tr>';
        try {
            const resp = await fetch(`${API_BASE_URL}/inspection.php`);
            const json = await resp.json();
            if (json.success && Array.isArray(json.data)) {
                DataStore.inspectionReports = json.data;
            }
        } catch(e) {
            console.warn('Could not load reports from DB:', e);
        }
        ReportsManager.applyFilters();
    },
    applyFilters: () => {
        const tbody = document.getElementById('reportsTableBody');
        const countEl = document.getElementById('admin-reports-count');
        const searchEl = document.getElementById('admin-reports-search');
        const sortEl = document.getElementById('admin-reports-sort');
        const q = (searchEl?.value || '').trim().toLowerCase();
        const sortBy = sortEl?.value || 'newest';
        const allReports = DataStore.inspectionReports;

        if (allReports.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No inspection reports found</td></tr>';
            return;
        }

        let filtered = allReports;
        if (q) {
            filtered = filtered.filter(r =>
                (r.establishment || '').toLowerCase().includes(q) ||
                (r.inspector || '').toLowerCase().includes(q) ||
                (r.location || '').toLowerCase().includes(q)
            );
        }

        const sorted = [...filtered].sort((a, b) => {
            switch (sortBy) {
                case 'newest': return new Date(b.date || 0) - new Date(a.date || 0);
                case 'oldest': return new Date(a.date || 0) - new Date(b.date || 0);
                case 'name-az': return (a.establishment || '').localeCompare(b.establishment || '');
                case 'status': {
                    const aC = (a.complied === true || a.complied === 'true' || a.status === 'Complied') ? 0 : 1;
                    const bC = (b.complied === true || b.complied === 'true' || b.status === 'Complied') ? 0 : 1;
                    return aC - bC || new Date(b.date || 0) - new Date(a.date || 0);
                }
                default: return new Date(b.date || 0) - new Date(a.date || 0);
            }
        });

        const page = q ? { displayed: sorted, hasMore: false, remaining: 0 } : TablePaging.slice(sorted, 'reports', 10);
        const displayed = page.displayed;
        if (countEl) countEl.textContent = q ? `${displayed.length} matching reports` : `Showing ${displayed.length} of ${allReports.length} reports`;

        tbody.innerHTML = displayed.map(report => `
            <tr data-testid="report-row-${report.id}">
                <td>${getSanitaryPermitNoForEstablishment(report.establishment)}</td>
                <td>${Utils.esc(report.inspector)}</td>
                <td>${Utils.esc(report.establishment) || 'N/A'}</td>
                <td>${Utils.esc(report.location)}</td>
                <td>${Utils.formatDate(report.date)}</td>
                <td><span class="status-badge status-${Utils.esc((report.status || 'submitted').toLowerCase())}">${Utils.esc(report.status) || 'Submitted'}</span></td>
                <td>
                    <div class="action-buttons">
                        <button class="action-btn action-btn-view" onclick="ReportsManager.openViewModal(${report.id})" data-testid="view-report-${report.id}">
                            <i class="bi bi-eye"></i>
                        </button>
                        <button class="action-btn action-btn-delete" onclick="ReportsManager.deleteReport(${report.id})" data-testid="delete-report-${report.id}">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('') + (page.hasMore ? TablePaging.moreRow('reports', page.remaining, 7, 10) : '');
    },

    openViewModal: (id) => {
        const report = DataStore.inspectionReports.find(r => r.id === id);
        if (!report) return;
        currentViewedReportId = id;

       const content = `
            <div class="modal-header">
                <h3>Inspection Report Details</h3>
                <button class="modal-close" onclick="Utils.closeModal()" data-testid="modal-close-btn">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="detail-section">
                    <h4>Report Information</h4>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span class="detail-label">Report ID</span>
                            <span class="detail-value">${getSanitaryPermitNoForEstablishment(report.establishment)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Inspector</span>
                            <span class="detail-value">${Utils.esc(report.inspector)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Establishment</span>
                            <span class="detail-value">${Utils.esc(report.establishment) || 'N/A'}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Location</span>
                            <span class="detail-value">${Utils.esc(report.location)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Date</span>
                            <span class="detail-value">${Utils.formatDate(report.date)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Status</span>
                            <span class="status-badge status-${Utils.esc(report.status?.toLowerCase())}">${Utils.esc(report.status)}</span>
                        </div>
                    </div>
                </div>
                <div class="detail-section">
                    <h4>Findings / Remarks</h4>
                    <p style="font-size: 14px; color: #374151;">${Utils.esc(report.remarks) || 'N/A'}</p>
                </div>
                <div class="detail-section">
                    <h4>Recommendations</h4>
                    <p style="font-size: 14px; color: #374151;">${Utils.esc(report.recommendation) || 'N/A'}</p>
                </div>
                ${report.filePath ? `
                <div class="detail-section">
                    <h4>Attached File</h4>
                    <p style="font-size: 14px; color: #374151;">
                        ${Utils.esc(report.file) || 'Attachment'}
                        <a href="${API_BASE_URL}/download.php?path=${encodeURIComponent(report.filePath)}" class="btn btn-primary" style="margin-left:10px;display:inline-block;padding:4px 10px;">
                            <i class="fas fa-download" style="margin-right:4px;"></i>Download
                        </a>
                    </p>
                </div>
                ` : report.file ? `
                <div class="detail-section">
                    <h4>Attached File</h4>
                    <p style="font-size: 14px; color: #374151;">${Utils.esc(report.file)} (file not available for download)</p>
                </div>
                ` : ''}
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="Utils.closeModal()" data-testid="cancel-btn">Close</button>
                <button class="btn btn-primary" onclick="exportSingleReportPDF()" style="background:#7c3aed;border-color:#7c3aed;">
                    <i class="fas fa-file-pdf" style="margin-right:6px;"></i>Download PDF
                </button>
            </div>
        `;
        Utils.openModal(content);
    },

    deleteReport: async (id) => {
        const reason = prompt('Reason for archiving? (Optional)', '');
        if (reason === null) return;

        if (confirm('Are you sure you want to archive this inspection report?')) {
            try {
                const response = await fetch(
                    `${API_BASE_URL}/inspection.php?id=${id}&reason=${encodeURIComponent(reason || 'No reason provided')}`,
                    { method: 'DELETE' }
                );
                const result = await response.json();
                if (result.success) {
                    await ReportsManager.loadAndRender();
                    Dashboard.updateStats();
                    Dashboard.renderActivity();
                    Utils.showToast('Report archived successfully');
                } else {
                    Utils.showToast('Failed to archive report', 'error');
                }
            } catch (error) {
                Utils.showToast('Error: ' + error.message, 'error');
            }
        }
    },

    printReport: (id) => {
        window.print();
    }
};

// ==================== PDF EXPORT FUNCTIONS ====================

let currentViewedReportId = null;

function exportSingleReportPDF() {
    const id = currentViewedReportId;
    if (!id) return;
    const report = DataStore.inspectionReports.find(r => r.id === id);
    if (!report) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Header bar
    doc.setFillColor(16, 108, 75);
    doc.rect(0, 0, 210, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('TAYABASCARE — INSPECTION REPORT', 14, 14);

    // Report ID badge
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(getSanitaryPermitNoForEstablishment(report.establishment), 175, 14);

    // Reset text color
    doc.setTextColor(30, 30, 30);

    // Section: Report Information
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 108, 75);
    doc.text('REPORT INFORMATION', 14, 34);
    doc.setDrawColor(16, 108, 75);
    doc.line(14, 36, 196, 36);

    const fields = [
        ['Report ID',      getSanitaryPermitNoForEstablishment(report.establishment)],
        ['Inspector',      report.inspector      || 'N/A'],
        ['Establishment',  report.establishment  || 'N/A'],
        ['Location',       report.location       || 'N/A'],
        ['Date',           report.date           || 'N/A'],
        ['Status',         report.status         || 'N/A'],
        ['Complied',       (report.complied === true || report.complied === 'true') ? 'Yes' : 'No'],
    ];

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(10);

    let y = 44;
    fields.forEach(([label, value]) => {
        doc.setFont('helvetica', 'bold');
        doc.text(label + ':', 14, y);
        doc.setFont('helvetica', 'normal');
        doc.text(String(value), 65, y);
        y += 8;
    });

    // Section: Findings
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 108, 75);
    doc.setFontSize(11);
    doc.text('FINDINGS / REMARKS', 14, y);
    doc.line(14, y + 2, 196, y + 2);
    y += 10;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(10);
    const remarksLines = doc.splitTextToSize(report.remarks || 'No remarks recorded.', 180);
    doc.text(remarksLines, 14, y);
    y += remarksLines.length * 6 + 8;

    // Section: Recommendations
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 108, 75);
    doc.setFontSize(11);
    doc.text('RECOMMENDATIONS', 14, y);
    doc.line(14, y + 2, 196, y + 2);
    y += 10;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(10);
    const recoLines = doc.splitTextToSize(report.recommendation || 'No recommendations recorded.', 180);
    doc.text(recoLines, 14, y);

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('Generated by TayabasCare — City Health Office of Tayabas City', 14, 285);
    doc.text(new Date().toLocaleString('en-PH'), 150, 285);

    doc.save(`${getSanitaryPermitNoForEstablishment(report.establishment)}-${report.establishment || 'report'}.pdf`);
}

function exportAllReportsPDF() {
    const reports = DataStore.inspectionReports;
    if (!reports || reports.length === 0) {
        alert('No inspection reports to export.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    // Header bar
    doc.setFillColor(16, 108, 75);
    doc.rect(0, 0, 297, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('TAYABASCARE — ALL INSPECTION REPORTS', 14, 14);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Generated: ' + new Date().toLocaleDateString('en-PH'), 220, 14);

    // Table headers
    doc.setFillColor(240, 240, 240);
    doc.rect(0, 26, 297, 10, 'F');
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');

    const cols = [14, 35, 75, 130, 165, 200, 230, 260];
    const headers = ['ID', 'Inspector', 'Establishment', 'Location', 'Date', 'Status', 'Complied'];
    headers.forEach((h, i) => doc.text(h, cols[i], 33));

    // Table rows
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);

    let y = 44;
    reports.forEach((r, idx) => {
        if (y > 185) {
            doc.addPage();
            y = 20;
            // Repeat headers on new page
            doc.setFillColor(240, 240, 240);
            doc.rect(0, y - 8, 297, 10, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            headers.forEach((h, i) => doc.text(h, cols[i], y));
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            y += 10;
        }

        if (idx % 2 === 0) {
            doc.setFillColor(250, 250, 250);
            doc.rect(0, y - 5, 297, 9, 'F');
        }

        doc.setTextColor(30, 30, 30);
        const row = [
            getSanitaryPermitNoForEstablishment(r.establishment),
            (r.inspector || '').substring(0, 18),
            (r.establishment || 'N/A').substring(0, 22),
            (r.location || '').substring(0, 18),
            r.date || '',
            r.status || '',
            (r.complied === true || r.complied === 'true') ? 'Yes' : 'No'
        ];
        row.forEach((val, i) => doc.text(String(val), cols[i], y));
        y += 9;
    });

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('City Health Office of Tayabas City — TayabasCare System', 14, 200);

    doc.save(`all-inspection-reports-${new Date().toISOString().split('T')[0]}.pdf`);
}

// ==================== END PDF EXPORT FUNCTIONS ====================

// ==================== ADMIN ACCOMPLISHMENT REPORT MODULE ====================

const ADMIN_MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
const ADMIN_QUARTER_MONTHS = { 1: [1,2,3], 2: [4,5,6], 3: [7,8,9], 4: [10,11,12] };

// Dynamic inspector column map — built from database
let ADMIN_INSPECTOR_COL_MAP = {};
let _adminInspectorNames = [];

async function buildAdminInspectorColumnMap() {
    try {
        const resp = await fetch(`${API_BASE_URL}/inspector.php`);
        const json = await resp.json();
        if (json.success && Array.isArray(json.data)) {
            const inspectors = json.data.slice(0, 5);
            _adminInspectorNames = inspectors.map(i => i.fullName);
            ADMIN_INSPECTOR_COL_MAP = {};
            inspectors.forEach((insp, idx) => {
                // Only map full name — first name aliases would cause double-counting
                ADMIN_INSPECTOR_COL_MAP[insp.fullName] = idx;
            });
            return true;
        }
        console.warn('Failed to build admin inspector column map: invalid response');
        return false;
    } catch (e) {
        console.warn('Failed to build admin inspector column map:', e);
        return false;
    }
}

// Ensure the column map is ready before showing the accomplishment report.
// Retries once if the initial load failed or DataStore has inspectors we can reuse.
async function ensureAdminInspectorColumnMap() {
    if (_adminInspectorNames && _adminInspectorNames.length > 0) return true;

    // Reuse already-fetched inspectors if available
    const cached = DataStore.inspectors;
    if (Array.isArray(cached) && cached.length > 0) {
        const inspectors = cached.slice(0, 5);
        _adminInspectorNames = inspectors.map(i => i.fullName || i.full_name || '');
        ADMIN_INSPECTOR_COL_MAP = {};
        inspectors.forEach((insp, idx) => {
            const name = insp.fullName || insp.full_name || '';
            if (name) ADMIN_INSPECTOR_COL_MAP[name] = idx;
        });
        return _adminInspectorNames.length > 0;
    }

    return await buildAdminInspectorColumnMap();
}

// Tracks values before editing so Cancel can restore them
let adminReportSnapshot = [];

// Accomplishment records — now stored in database via API
async function adminGetAllAccomplishmentRecords() {
    try {
        const resp = await fetch(`${API_BASE_URL}/accomplishment.php`);
        const json = await resp.json();
        return json.success ? (json.data || []) : [];
    } catch (e) {
        console.warn('Failed to fetch accomplishment records:', e);
        return [];
    }
}

function adminBuildInspectorFieldMap(inspectorIdx) {
    const simpleRows = 14;
    const mfRows = 5;
    const indices = [];
    for (let r = 0; r < simpleRows; r++) indices.push(r * 6 + inspectorIdx);
    for (let r = 0; r < mfRows; r++) {
        const rowOffset = simpleRows * 6 + r * 11;
        indices.push(rowOffset + inspectorIdx * 2);
        indices.push(rowOffset + inspectorIdx * 2 + 1);
    }
    return indices;
}

async function adminGetAccomplishmentDataForPeriod(months, year) {
    const mapReady = await ensureAdminInspectorColumnMap();
    if (!mapReady) {
        Utils.showToast('Inspector list unavailable — report totals may be incomplete. Try again shortly.', 'warning');
    }
    const records = await adminGetAllAccomplishmentRecords();
    const totalInputs = document.querySelectorAll('#admin-accomplishment-report .admin-report-input').length;
    const totals = new Array(totalInputs).fill(0);

    months.forEach(month => {
        Object.entries(ADMIN_INSPECTOR_COL_MAP).forEach(([inspectorName, colIdx]) => {
            const rec = records.find(r =>
                r.inspector === inspectorName &&
                r.month === month &&
                r.year === parseInt(year)
            );
            if (!rec) return;
            const fieldIndices = adminBuildInspectorFieldMap(colIdx);
            rec.fields.forEach((val, fi) => {
                if (fieldIndices[fi] !== undefined) totals[fieldIndices[fi]] += (val || 0);
            });
        });
    });

    // Calculate row totals for simple rows
    for (let r = 0; r < 14; r++) {
        let sum = 0;
        for (let c = 0; c < 5; c++) sum += totals[r * 6 + c];
        totals[r * 6 + 5] = sum;
    }
    return totals;
}

function adminSetReportValues(values) {
    const inputs = [...document.querySelectorAll('#admin-accomplishment-report .admin-report-input')];
    inputs.forEach((inp, i) => {
        inp.value = (values[i] && values[i] > 0) ? values[i] : '';
    });
}

function adminClearReportInputs() {
    document.querySelectorAll('#admin-accomplishment-report .admin-report-input')
        .forEach(inp => inp.value = '');
}

function adminMakeReportReadOnly() {
    document.querySelectorAll('#admin-accomplishment-report .admin-report-input').forEach(inp => {
        inp.readOnly = true;
        inp.style.backgroundColor = '#f9fafb';
        inp.style.cursor = 'default';
        inp.style.border = 'none';
        inp.style.textAlign = 'center';
    });
}

function adminMakeReportEditable() {
    document.querySelectorAll('#admin-accomplishment-report .admin-report-input').forEach(inp => {
        inp.readOnly = false;
        inp.style.backgroundColor = '#fefce8';
        inp.style.cursor = 'text';
        inp.style.border = '1px solid #d1d5db';
        inp.style.textAlign = 'center';
    });
}

function adminShowReportTab(type, tabEl) {
    document.querySelectorAll('#accomplishmentReportView .tab').forEach(tab => tab.classList.remove('tab-active'));
    if (tabEl) tabEl.classList.add('tab-active');

    // Refresh inspector headers if the initial map load failed
    ensureAdminInspectorColumnMap().then(() => populateInspectorColumns()).catch(() => {});

    ['monthly', 'quarterly', 'annual'].forEach(t => {
        document.getElementById(`admin-${t}-controls`).classList.add('hidden');
    });
    document.getElementById(`admin-${type}-controls`).classList.remove('hidden');

    adminClearReportInputs();
    adminMakeReportReadOnly();
    document.getElementById('admin-accomplishment-report').classList.add('hidden');
    document.getElementById('admin-report-edit-btn').style.display = 'none';
    document.getElementById('admin-report-save-btn').style.display = 'none';
    document.getElementById('admin-report-cancel-btn').style.display = 'none';
    document.getElementById('admin-report-print-btn').style.display = 'none';
    document.getElementById('admin-edit-notice').classList.add('hidden');

    const labels = {
        monthly:   'ACCOMPLISHMENT REPORT FOR THE MONTH OF',
        quarterly: 'QUARTERLY ACCOMPLISHMENT REPORT —',
        annual:    'ANNUAL ACCOMPLISHMENT REPORT —'
    };
    const labelEl = document.getElementById('admin-report-type-label');
    if (labelEl) labelEl.textContent = labels[type];
    const display = document.getElementById('admin-report-period-display');
    if (display) display.textContent = '_________________________________';

    // Populate inspector signatures from database
    populateAccomplishmentInspectors();
}

// Dynamically populate the "Submitted By" inspector signatures
function populateAccomplishmentInspectors() {
    const row = document.getElementById('accomplishmentInspectorsRow');
    if (!row) return;

    const inspectors = DataStore.inspectors || [];
    if (inspectors.length === 0) {
        // Fallback if inspectors not yet loaded
        row.innerHTML = '<td class="text-center px-2 pb-1"><div style="border-bottom:1px solid black;margin-bottom:4px;padding-bottom:20px;"></div><p class="font-semibold">Loading...</p></td>';
        fetch(`${API_BASE_URL}/inspector.php`)
            .then(r => r.json())
            .then(result => {
                if (result.success && result.data) {
                    DataStore.inspectors = result.data;
                    renderInspectorSignatures(result.data);
                }
            })
            .catch(() => {});
        return;
    }
    renderInspectorSignatures(inspectors);
}

function renderInspectorSignatures(inspectors) {
    const row = document.getElementById('accomplishmentInspectorsRow');
    if (!row) return;

    if (inspectors.length === 0) {
        row.innerHTML = '<td class="text-center px-2 pb-1"><div style="border-bottom:1px solid black;margin-bottom:4px;padding-bottom:20px;"></div><p class="font-semibold">No Inspectors</p></td>';
        return;
    }

    row.innerHTML = inspectors.map(inspector => `
        <td class="text-center px-2 pb-1">
            <div style="border-bottom: 1px solid black; margin-bottom:4px; padding-bottom: 20px;"></div>
            <p class="font-semibold">${Utils.esc(inspector.fullName || inspector.full_name || '')}</p>
            <p>${Utils.esc(inspector.role || inspector.role_title || 'Sanitation Inspector')}</p>
        </td>
    `).join('');
}

function adminShowReportResult(totals, periodLabel, typeLabel) {
    adminSetReportValues(totals);
    adminMakeReportReadOnly();

    document.getElementById('admin-report-type-label').textContent = typeLabel;
    document.getElementById('admin-report-period-display').textContent = periodLabel;
    document.getElementById('admin-accomplishment-report').classList.remove('hidden');

    // Show action buttons
    document.getElementById('admin-report-edit-btn').style.display = 'inline-flex';
    document.getElementById('admin-report-save-btn').style.display = 'none';
    document.getElementById('admin-report-cancel-btn').style.display = 'none';
    document.getElementById('admin-report-print-btn').style.display = 'inline-flex';
    document.getElementById('admin-edit-notice').classList.add('hidden');
}

async function adminLoadMonthlyReport() {
    const monthVal = document.getElementById('admin-report-month').value;
    const year     = document.getElementById('admin-report-year').value;
    if (!monthVal || !year) { adminShowNotification('Please select a Month and Year.', 'error'); return; }

    const totals = await adminGetAccomplishmentDataForPeriod([parseInt(monthVal)], year);
    if (!totals.some(v => v > 0)) {
        adminShowNotification(`No data found for ${ADMIN_MONTH_NAMES[parseInt(monthVal)]} ${year}.`, 'error');
        adminClearReportInputs();
        document.getElementById('admin-accomplishment-report').classList.add('hidden');
        document.getElementById('admin-report-edit-btn').style.display = 'none';
        document.getElementById('admin-report-print-btn').style.display = 'none';
        return;
    }

    adminShowReportResult(
        totals,
        `${ADMIN_MONTH_NAMES[parseInt(monthVal)].toUpperCase()} ${year}`,
        'ACCOMPLISHMENT REPORT FOR THE MONTH OF'
    );
    adminShowNotification(`✅ Report loaded for ${ADMIN_MONTH_NAMES[parseInt(monthVal)]} ${year}`, 'success');
}

async function adminLoadQuarterlyReport() {
    const quarter = parseInt(document.getElementById('admin-report-quarter').value);
    const year    = document.getElementById('admin-report-quarter-year').value;
    if (!year) { adminShowNotification('Please enter a Year.', 'error'); return; }

    const months = ADMIN_QUARTER_MONTHS[quarter];
    const totals = await adminGetAccomplishmentDataForPeriod(months, year);
    if (!totals.some(v => v > 0)) {
        adminShowNotification(`No data found for Q${quarter} ${year}.`, 'error');
        adminClearReportInputs();
        document.getElementById('admin-accomplishment-report').classList.add('hidden');
        document.getElementById('admin-report-edit-btn').style.display = 'none';
        document.getElementById('admin-report-print-btn').style.display = 'none';
        return;
    }

    const qOrdinal = ['','1st Quarter','2nd Quarter','3rd Quarter','4th Quarter'][quarter];
    const qLabel   = ['','January – March','April – June','July – September','October – December'][quarter];
    adminShowReportResult(totals, `${qOrdinal} — ${qLabel} ${year}`, 'QUARTERLY ACCOMPLISHMENT REPORT —');
    adminShowNotification(`✅ Quarterly report loaded for Q${quarter} ${year}`, 'success');
}

async function adminLoadCustomRangeReport() {
    const fromMonth = parseInt(document.getElementById('admin-report-quarter-from').value);
    const toMonth   = parseInt(document.getElementById('admin-report-quarter-to').value);
    const year      = document.getElementById('admin-report-quarter-custom-year').value;
    if (!year) { adminShowNotification('Please enter a Year.', 'error'); return; }
    if (fromMonth > toMonth) { adminShowNotification('"From" month must not be later than "To" month.', 'error'); return; }

    const months = [];
    for (let m = fromMonth; m <= toMonth; m++) months.push(m);

    const totals = await adminGetAccomplishmentDataForPeriod(months, year);
    if (!totals.some(v => v > 0)) {
        adminShowNotification(`No data found for ${ADMIN_MONTH_NAMES[fromMonth]} – ${ADMIN_MONTH_NAMES[toMonth]} ${year}.`, 'error');
        adminClearReportInputs();
        document.getElementById('admin-accomplishment-report').classList.add('hidden');
        document.getElementById('admin-report-edit-btn').style.display = 'none';
        document.getElementById('admin-report-print-btn').style.display = 'none';
        return;
    }

    const rangeLabel = fromMonth === toMonth ? ADMIN_MONTH_NAMES[fromMonth] : `${ADMIN_MONTH_NAMES[fromMonth]} – ${ADMIN_MONTH_NAMES[toMonth]}`;
    adminShowReportResult(totals, `${rangeLabel} ${year}`, 'QUARTERLY ACCOMPLISHMENT REPORT —');
    adminShowNotification(`✅ Custom range report loaded: ${rangeLabel} ${year}`, 'success');
}

function adminSelectAllMonths() {
    document.querySelectorAll('.admin-annual-month-check').forEach(cb => cb.checked = true);
}

function adminClearAllMonths() {
    document.querySelectorAll('.admin-annual-month-check').forEach(cb => cb.checked = false);
}

async function adminLoadAnnualReport() {
    const year = document.getElementById('admin-report-annual-year').value;
    if (!year) { adminShowNotification('Please enter a Year.', 'error'); return; }

    const checkedMonths = [...document.querySelectorAll('.admin-annual-month-check:checked')]
        .map(cb => parseInt(cb.value)).sort((a, b) => a - b);
    if (checkedMonths.length === 0) { adminShowNotification('Please check at least one month.', 'error'); return; }

    const totals = await adminGetAccomplishmentDataForPeriod(checkedMonths, year);
    if (!totals.some(v => v > 0)) {
        adminShowNotification(`No data found for selected months in ${year}.`, 'error');
        adminClearReportInputs();
        document.getElementById('admin-accomplishment-report').classList.add('hidden');
        document.getElementById('admin-report-edit-btn').style.display = 'none';
        document.getElementById('admin-report-print-btn').style.display = 'none';
        return;
    }

    const monthLabel = checkedMonths.length === 12
        ? `YEAR ${year}`
        : checkedMonths.map(m => ADMIN_MONTH_NAMES[m]).join(', ') + ` ${year}`;

    adminShowReportResult(totals, monthLabel, 'ANNUAL ACCOMPLISHMENT REPORT —');
    adminShowNotification(`✅ Annual report loaded for selected months in ${year}`, 'success');
}

// ---- Edit / Save / Cancel ----

function adminToggleReportEdit() {
    // Snapshot current values so Cancel can restore them
    adminReportSnapshot = [...document.querySelectorAll('#admin-accomplishment-report .admin-report-input')]
        .map(inp => inp.value);

    adminMakeReportEditable();
    document.getElementById('admin-report-edit-btn').style.display = 'none';
    document.getElementById('admin-report-save-btn').style.display = 'inline-flex';
    document.getElementById('admin-report-cancel-btn').style.display = 'inline-flex';
    document.getElementById('admin-report-print-btn').style.display = 'none';
    document.getElementById('admin-edit-notice').classList.remove('hidden');
}

async function adminSaveReportEdit() {
    // Save edited values back to the matching accomplishment records via API
    const inputs = [...document.querySelectorAll('#admin-accomplishment-report .admin-report-input')];
    const newValues = inputs.map(inp => parseFloat(inp.value) || 0);

    const records = await adminGetAllAccomplishmentRecords();

    // Update each inspector's record fields based on the edited values
    const updatePromises = [];
    Object.entries(ADMIN_INSPECTOR_COL_MAP).forEach(([inspectorName, colIdx]) => {
        const fieldIndices = adminBuildInspectorFieldMap(colIdx);
        records.forEach(rec => {
            if (rec.inspector !== inspectorName) return;
            let changed = false;
            fieldIndices.forEach((inputIdx, fi) => {
                if (inputIdx !== undefined && fi < rec.fields.length) {
                    const newVal = newValues[inputIdx] || 0;
                    if (rec.fields[fi] !== newVal) {
                        rec.fields[fi] = newVal;
                        changed = true;
                    }
                }
            });
            if (changed) {
                updatePromises.push(
                    fetch(`${API_BASE_URL}/accomplishment.php`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: rec.id, fields: rec.fields })
                    })
                );
            }
        });
    });

    await Promise.all(updatePromises);

    adminMakeReportReadOnly();
    document.getElementById('admin-report-edit-btn').style.display = 'inline-flex';
    document.getElementById('admin-report-save-btn').style.display = 'none';
    document.getElementById('admin-report-cancel-btn').style.display = 'none';
    document.getElementById('admin-report-print-btn').style.display = 'inline-flex';
    document.getElementById('admin-edit-notice').classList.add('hidden');
    adminShowNotification('Report changes saved successfully!', 'success');
}

function adminCancelReportEdit() {
    // Restore snapshot values
    const inputs = [...document.querySelectorAll('#admin-accomplishment-report .admin-report-input')];
    inputs.forEach((inp, i) => { inp.value = adminReportSnapshot[i] || ''; });

    adminMakeReportReadOnly();
    document.getElementById('admin-report-edit-btn').style.display = 'inline-flex';
    document.getElementById('admin-report-save-btn').style.display = 'none';
    document.getElementById('admin-report-cancel-btn').style.display = 'none';
    document.getElementById('admin-report-print-btn').style.display = 'inline-flex';
    document.getElementById('admin-edit-notice').classList.add('hidden');
    adminShowNotification('Edit cancelled. No changes saved.', 'info');
}

function adminShowNotification(message, type = 'success') {
    const existingToasts = document.querySelectorAll('.admin-toast-notification');
    existingToasts.forEach(t => t.remove());
    const types = {
        success: { bg: 'bg-emerald-600', icon: 'fa-check-circle' },
        error:   { bg: 'bg-red-600',     icon: 'fa-exclamation-circle' },
        warning: { bg: 'bg-yellow-500',  icon: 'fa-exclamation-triangle' },
        info:    { bg: 'bg-blue-600',    icon: 'fa-info-circle' }
    };
    const style = types[type] || types.success;
    const toast = document.createElement('div');
    toast.className = `admin-toast-notification fixed bottom-4 right-4 ${style.bg} text-white px-6 py-4 rounded-lg shadow-2xl z-[9999]`;
    toast.innerHTML = `<div class="flex items-center gap-3"><i class="fas ${style.icon} text-xl"></i><span class="font-medium">${Utils.esc(message)}</span><button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-white hover:text-gray-200"><i class="fas fa-times"></i></button></div>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// ==================== END ADMIN ACCOMPLISHMENT REPORT MODULE ====================

// Populate accomplishment report inspector column headers from database
function populateInspectorColumns() {
    const headers = document.querySelectorAll('.inspector-col-header');
    if (!_adminInspectorNames || _adminInspectorNames.length === 0) {
        // Keep neutral placeholders but mark unused slots clearly
        headers.forEach((th, i) => {
            th.textContent = `Inspector ${i + 1}`;
            th.title = 'Inspector names unavailable — will refresh when the list loads';
        });
        return;
    }

    headers.forEach((th, i) => {
        if (i < _adminInspectorNames.length) {
            const fullName = _adminInspectorNames[i] || '';
            const firstName = fullName.split(' ')[0].toUpperCase() || `Inspector ${i + 1}`;
            th.textContent = firstName;
            th.title = fullName;
        } else {
            th.textContent = '—';
            th.title = '';
        }
    });
}

// Initialize App
async function initApp() {
    // --- Role guard: admin only ---
    let sessData = null;
    try {
        const sessResp = await fetch(`${API_BASE_URL}/auth.php`);
        sessData = await sessResp.json();
        if (!sessData.success || (sessData.data && sessData.data.role !== 'admin')) {
            window.location.href = 'index.html';
            return;
        }
    } catch (e) {
        window.location.href = 'index.html';
        return;
    }

    // Update header with actual username
    const usernameDisplay = document.getElementById('admin-username-display');
    if (usernameDisplay && sessData && sessData.data) {
        usernameDisplay.textContent = sessData.data.fullName || sessData.data.username || 'Admin';
    }

    // Set up navigation
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            PageManager.switchPage(page);
        });
    });

    // Menu toggle for mobile
    const menuToggle = document.getElementById('menuToggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            const sidebarEl = document.getElementById('sidebar');
            if (sidebarEl) sidebarEl.classList.toggle('active');
        });
    }

    // Modal overlay click to close
    const modalOverlay = document.getElementById('modalOverlay');
    if (modalOverlay) {
        modalOverlay.addEventListener('click', () => {
            Utils.closeModal();
        });
    }

    // Add button handlers
    document.getElementById('addInspectorBtn').addEventListener('click', InspectorManager.openAddModal);
    
    // Pre-fetch inspection reports from DB BEFORE drawing dashboard charts
    try {
        const resp = await fetch(`${API_BASE_URL}/inspection.php`);
        const json = await resp.json();
        if (json.success && Array.isArray(json.data)) {
            DataStore.inspectionReports = json.data;
        }
    } catch(e) {
        console.warn('Could not pre-fetch reports for dashboard:', e);
    }
    
    // Pre-fetch risk predictions so badges show immediately on Sanitary Records table
    try {
        const riskResp = await fetch(`${API_BASE_URL}/predict.php`, { method: 'GET' });
        const riskJson = await riskResp.json();
        if (riskJson.success && Array.isArray(riskJson.data)) {
            PredictionEngine.results = riskJson.data;
        }
    } catch(e) {
        console.warn('Could not pre-fetch risk data:', e);
    }

    // Pre-fetch schedules so the sidebar badge shows correct count
    await ScheduleManager.fetchAll().catch(() => {});
    const schedBadge = document.getElementById('scheduleBadge');
    if (schedBadge) {
        const pending = ScheduleManager._cache.filter(s => !s.done).length;
        schedBadge.textContent = pending;
        schedBadge.style.display = pending > 0 ? 'inline-block' : 'none';
    }

    // Initial render — now using real DB data
    await InspectorManager.render();
    Dashboard.updateStats();
    Dashboard.renderActivity();
    Dashboard.initTabs();
    SanitaryManager.render();
    BurialManager.render();
    ReportsManager.loadAndRender();

    // Initialize Archive
    if (typeof ArchiveManager !== 'undefined') ArchiveManager.init();

    // Initialize Notification Runner
    if (typeof NotificationRunner !== 'undefined') NotificationRunner.init();
    
    // Setup archive filter listeners
    const archiveSearch = document.getElementById('archiveSearch');
    const archiveTypeFilter = document.getElementById('archiveTypeFilter');
    const archiveDaysFilter = document.getElementById('archiveDaysFilter');
    const archiveSortFilter = document.getElementById('archiveSortFilter');
    
    if (archiveSearch)     archiveSearch.addEventListener('input',  () => ArchiveManager.renderFiltered());
    if (archiveTypeFilter) archiveTypeFilter.addEventListener('change', () => ArchiveManager.renderFiltered());
    if (archiveDaysFilter) archiveDaysFilter.addEventListener('change', () => ArchiveManager.renderFiltered());
    if (archiveSortFilter) archiveSortFilter.addEventListener('change', () => ArchiveManager.renderFiltered());

    // Build dynamic inspector column map and populate report headers
    TablePaging.register('sanitary', () => SanitaryManager.render());
    TablePaging.register('burial', () => BurialManager.render());
    TablePaging.register('reports', () => ReportsManager.loadAndRender());
    TablePaging.register('prediction', () => PredictionEngine.filter());

    buildAdminInspectorColumnMap().then((ok) => {
        populateInspectorColumns();
        if (!ok) {
            Utils.showToast('Could not load inspector names for the accomplishment report. They will refresh automatically.', 'warning');
        }
    }).catch(() => {
        populateInspectorColumns();
    });

    // Migrate any localStorage accomplishment records to server
    (async () => {
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
                    body: JSON.stringify({ inspector: rec.inspector, month: rec.month, year: rec.year, fields: rec.fields })
                });
            }
            localStorage.removeItem('accomplishmentRecords');

        } catch (e) {
            console.warn('Accomplishment migration failed:', e);
        }
    })();

}

// Start app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

const ArchiveManager = {
    ARCHIVE_KEY: 'archiveData',
    RETENTION_DAYS: 30,

    // Initialize Archive
    init: () => {
    ArchiveManager.render();
},

    // Get all archived items from server cache
    getAll: () => {
        return ArchiveManager._cache || [];
    },

    // Render archive table
    render: async () => {
        const tbody = document.getElementById('archiveTableBody');
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Loading...</td></tr>`;

        try {
            const response = await fetch(`${API_BASE_URL}/archive.php`);
            const result = await response.json();
            const allArchived = result.success ? (result.data || []) : [];

            // Store in cache for filters to use
            ArchiveManager._cache = allArchived;

            ArchiveManager.updateStats(allArchived);
            ArchiveManager.updateBadgeCount(allArchived.length);

            // Apply filters/search/sort
            ArchiveManager.renderFiltered();

        } catch (error) {
            console.error('Error loading archive:', error);
            tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Failed to load archive</td></tr>`;
        }
    },

    // Render filtered results from cache (called by filters without re-fetching)
    renderFiltered: () => {
        const tbody = document.getElementById('archiveTableBody');
        if (!tbody) return;

        const allArchived = ArchiveManager._cache || [];
        const filtered = ArchiveManager.applyFilters(allArchived);

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state">
                        <div class="empty-archive-state">
                            <i class="bi bi-archive" style="font-size: 48px; color: #9CA3AF;"></i>
                            <p>${allArchived.length === 0 ? 'No archived items' : 'No items match your filters'}</p>
                            <span>${allArchived.length === 0 ? 'Deleted items will appear here and be kept for 30 days' : 'Try adjusting your search or filters'}</span>
                        </div>
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = filtered.map((item, index) => {
            const archivedDate = new Date(item.archivedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            const expiryDate   = new Date(item.expiryDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            const daysRemaining = Math.max(0, Math.ceil((new Date(item.expiryDate) - new Date()) / (1000 * 60 * 60 * 24)));
            const statusClass   = daysRemaining > 20 ? 'safe' : daysRemaining > 10 ? 'warning' : 'critical';

            const typeLabel = {
                sanitary:   'SANITARY',
                burial:     'BURIAL',
                inspectors: 'INSPECTOR',
                reports:    'REPORT'
            }[item.type] || item.type.toUpperCase();

            const typeCssClass = {
                sanitary:   'type-sanitary',
                burial:     'type-burial',
                inspectors: 'type-inspectors',
                reports:    'type-reports'
            }[item.type] || '';

            const name = item.data?.businessName  ||
                         item.data?.business_name ||
                         item.data?.deceased_name ||
                         item.data?.deceased      ||
                         item.data?.fullName      ||
                         item.data?.name          || 'N/A';

            return `
                <tr data-archive-id="${item.id}">
                    <td><input type="checkbox" class="archive-checkbox" onchange="ArchiveManager.updateBulkActions()" data-id="${item.id}"></td>
                    <td><span class="type-badge ${typeCssClass}">${typeLabel}</span></td>
                    <td>${Utils.esc(name)}</td>
                    <td>${Utils.esc(item.reason) || 'No reason provided'}</td>
                    <td>${archivedDate}</td>
                    <td>${expiryDate}</td>
                    <td><span class="days-badge days-${statusClass}">${daysRemaining} DAYS LEFT</span></td>
                    <td>
                        <div class="action-buttons">
                            <button class="action-btn action-btn-view" onclick="ArchiveManager.restoreItem(${item.id})" title="Restore">
                                <i class="bi bi-arrow-counterclockwise"></i>
                            </button>
                            <button class="action-btn action-btn-delete" onclick="ArchiveManager.permanentDelete(${item.id})" title="Delete Permanently">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>`;
        }).join('');
    },

    // Get item description
    getItemDescription: (item) => {
        switch(item.type) {
            case 'inspectors':
                return `${item.data.fullName} (${item.data.email})`;
            case 'sanitary':
                return `${item.data.establishmentName} - ${item.data.address}`;
            case 'burial':
                return `${item.data.deceasedName} - ${item.data.cemetery}`;
            case 'reports':
                return `${item.data.location} - ${item.data.inspector}`;
            default:
                return 'Unknown item';
        }
    },

    // Apply filters/search/sort to items array
    applyFilters: (items) => {
        const searchTerm = (document.getElementById('archiveSearch')?.value || '').toLowerCase().trim();
        const typeFilter = document.getElementById('archiveTypeFilter')?.value || 'all';
        const daysFilter = document.getElementById('archiveDaysFilter')?.value || 'all';
        const sortFilter = document.getElementById('archiveSortFilter')?.value || 'newest';

        let filtered = [...items];

        // Search — matches name, reason, or type
        if (searchTerm) {
            filtered = filtered.filter(item => {
                const name = (
                    item.data?.businessName  ||
                    item.data?.business_name ||
                    item.data?.deceased_name ||
                    item.data?.deceased      ||
                    item.data?.fullName      ||
                    item.data?.name          || ''
                ).toLowerCase();
                const reason = (item.reason || '').toLowerCase();
                const type   = (item.type   || '').toLowerCase();
                return name.includes(searchTerm) || reason.includes(searchTerm) || type.includes(searchTerm);
            });
        }

        // Type filter
        if (typeFilter !== 'all') {
            filtered = filtered.filter(item => item.type === typeFilter);
        }

        // Days remaining filter (uses expiryDate from API)
        if (daysFilter !== 'all') {
            filtered = filtered.filter(item => {
                const days = Math.max(0, Math.ceil((new Date(item.expiryDate) - new Date()) / (1000 * 60 * 60 * 24)));
                if (daysFilter === 'critical') return days <= 10;
                if (daysFilter === 'warning')  return days > 10 && days <= 20;
                if (daysFilter === 'safe')     return days > 20;
                return true;
            });
        }

        // Sort
        filtered.sort((a, b) => {
            if (sortFilter === 'newest')   return new Date(b.archivedDate) - new Date(a.archivedDate);
            if (sortFilter === 'oldest')   return new Date(a.archivedDate) - new Date(b.archivedDate);
            if (sortFilter === 'expiring') {
                const daysA = Math.ceil((new Date(a.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
                const daysB = Math.ceil((new Date(b.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
                return daysA - daysB;
            }
            return 0;
        });

        return filtered;
    },

    // Calculate days remaining until expiry
    getDaysRemaining: (dateStr) => {
        return Math.max(0, Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24)));
    },

    // Update statistics
    updateStats: (items) => {
        try {
            const totalEl = document.getElementById('totalArchived');
            const expiringEl = document.getElementById('expiringSoon');
            const sizeEl = document.getElementById('archiveSize');

            if (totalEl) totalEl.textContent = items.length;

            const expiring = items.filter(item => {
                const days = ArchiveManager.getDaysRemaining(item.expiryDate);
                return days <= 7;
            }).length;

            if (expiringEl) expiringEl.textContent = expiring;

            const size = new Blob([JSON.stringify(items)]).size;
            const sizeKB = (size / 1024).toFixed(2);
            if (sizeEl) sizeEl.textContent = `${sizeKB} KB`;
        } catch (e) {
            console.error('ArchiveManager.updateStats error:', e);
        }
    },

    // Update badge count
    updateBadge: () => {
    // Badge is now updated via updateBadgeCount() after API fetch
},

updateBadgeCount: (count) => {
    const badge = document.getElementById('archiveBadge');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
},
    // Toggle item selection
    toggleSelection: (id) => {
        const archived = ArchiveManager._cache || [];
        const item = archived.find(i => i.id === id);
        if (item) {
            item.selected = !item.selected;
        }
        ArchiveManager.updateBulkActions();
    },

    // Toggle select all checkboxes
    toggleSelectAll: () => {
        const selectAllCheckbox = document.getElementById('selectAllArchive');
        const checked = selectAllCheckbox.checked;
        document.querySelectorAll('.archive-checkbox').forEach(cb => {
            cb.checked = checked;
        });
        ArchiveManager.updateBulkActions();
    },

    // Update bulk actions bar visibility
    updateBulkActions: () => {
        const checked = document.querySelectorAll('.archive-checkbox:checked');
        const bulkActions = document.getElementById('bulkActions');
        const selectedCountEl = document.getElementById('selectedCount');
        if (bulkActions && selectedCountEl) {
            if (checked.length > 0) {
                bulkActions.style.display = 'flex';
                selectedCountEl.textContent = `${checked.length} selected`;
            } else {
                bulkActions.style.display = 'none';
            }
        }
    },

    // Clear all checkboxes
    clearSelection: () => {
        document.querySelectorAll('.archive-checkbox').forEach(cb => cb.checked = false);
        const selectAll = document.getElementById('selectAllArchive');
        if (selectAll) selectAll.checked = false;
        ArchiveManager.updateBulkActions();
    },

   // Restore single item
    restoreItem: async (id, askConfirm = true) => {
    if (askConfirm && !confirm('Restore this record back to its original module?')) return;
    try {
        const response = await fetch(`${API_BASE_URL}/archive.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        const result = await response.json();
        if (result.success) {
            Utils.showToast('Record restored successfully');
            await ArchiveManager.render();
            await SanitaryManager.render();
            Dashboard.updateStats();
        } else {
            Utils.showToast('Failed to restore record', 'error');
        }
    } catch (error) {
        Utils.showToast('Error: ' + error.message, 'error');
    }
},

    // Permanent delete
    permanentDelete: async (id, askConfirm = true) => {
    if (askConfirm && !confirm('Permanently delete this record? This cannot be undone.')) return;
    try {
        const response = await fetch(`${API_BASE_URL}/archive.php?id=${id}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            Utils.showToast('Record permanently deleted');
            await ArchiveManager.render();
        } else {
            Utils.showToast('Failed to delete record', 'error');
        }
    } catch (error) {
        Utils.showToast('Error: ' + error.message, 'error');
    }
},

    // Bulk restore selected items
    bulkRestore: async () => {
        const checked = [...document.querySelectorAll('.archive-checkbox:checked')];
        if (checked.length === 0) return;
        if (!confirm(`Restore ${checked.length} item(s)?`)) return;
        for (const cb of checked) {
            await ArchiveManager.restoreItem(parseInt(cb.dataset.id), false);
        }
        Utils.showToast(`${checked.length} item(s) restored`);
        await ArchiveManager.render();
        ArchiveManager.clearSelection();
    },

    // Bulk permanently delete selected items
    bulkDelete: async () => {
        const checked = [...document.querySelectorAll('.archive-checkbox:checked')];
        if (checked.length === 0) return;
        if (!confirm(`⚠️ PERMANENTLY delete ${checked.length} item(s)? This cannot be undone!`)) return;
        for (const cb of checked) {
            await ArchiveManager.permanentDelete(parseInt(cb.dataset.id), false);
        }
        Utils.showToast(`${checked.length} item(s) permanently deleted`);
        await ArchiveManager.render();
        ArchiveManager.clearSelection();
    },

    // View expiring soon
    viewExpiring: () => {
        document.getElementById('archiveDaysFilter').value = 'critical';
        ArchiveManager.render();
        Utils.showToast('Showing items expiring in 1-10 days');
    },

    // Export archive data
    exportArchive: () => {
        const archived = ArchiveManager._cache || [];
        if (archived.length === 0) {
            Utils.showToast('No data to export', 'error');
            return;
        }

        const dataStr = JSON.stringify(archived, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `archive-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        Utils.showToast('Archive exported successfully');
    }
};

function handleLogout() {
    if (confirm('Are you sure you want to sign out?')) {
        fetch(`${API_BASE_URL}/auth.php`, {
            method: 'DELETE',
            credentials: 'include'
        }).finally(() => {
            localStorage.clear();
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
        fetch(`${API_BASE_URL}/auth.php`, {
            method: 'DELETE',
            credentials: 'include'
        }).finally(() => {
            localStorage.clear();
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

// Profile Modal Functions
async function openProfileModal() {
    const modal = document.getElementById('profile-modal');
    // Populate profile data from session
    try {
        const resp = await fetch(`${API_BASE_URL}/auth.php`);
        const json = await resp.json();
        if (json.success && json.data) {
            const d = json.data;
            const fullnameEl = document.getElementById('profile-fullname');
            const usernameEl = document.getElementById('profile-username');
            const roleEl     = document.getElementById('profile-role');
            const emailEl    = document.getElementById('profile-email');
            const avatarEl   = document.getElementById('profile-avatar');
            if (fullnameEl) fullnameEl.value = d.fullName || d.username || 'Admin';
            if (usernameEl) usernameEl.value = d.username || 'admin';
            if (roleEl)     roleEl.value = d.role === 'admin' ? 'System Administrator' : d.role;
            if (emailEl)    emailEl.value = d.email || '';
            if (avatarEl) {
                const name = encodeURIComponent(d.fullName || d.username || 'Admin');
                avatarEl.src = `https://ui-avatars.com/api/?name=${name}&background=1e40af&color=fff&size=200`;
            }
        }
    } catch (e) {
        // Show defaults if fetch fails
    }
    modal.showModal();
}

function closeProfileModal() {
    const modal = document.getElementById('profile-modal');
    modal.close();
}

async function handleSaveProfileEmail() {
    const emailEl = document.getElementById('profile-email');
    const email = (emailEl?.value || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        Utils.showToast('Please enter a valid email address.', 'error');
        return;
    }
    try {
        const resp = await fetch(`${API_BASE_URL}/admin_recovery.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update_email', email })
        });
        const json = await resp.json();
        if (json.success) {
            Utils.showToast('Email updated successfully.', 'success');
        } else {
            Utils.showToast(json.message || 'Failed to update email.', 'error');
        }
    } catch (e) {
        Utils.showToast('Failed to update email.', 'error');
    }
}

// Settings Modal Functions
function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.showModal();
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.close();
}

// Admin Recovery Codes
let _recoveryPlaintextCodes = [];
let _recoveryExpiresAt = null;

function openRecoveryCodesModal() {
    closeSettingsModal();
    const modal = document.getElementById('recovery-codes-modal');
    const statusPanel = document.getElementById('recovery-status-panel');
    const displayPanel = document.getElementById('recovery-codes-display');
    const statusText = document.getElementById('recovery-status-text');
    const storedCheck = document.getElementById('recovery-stored-check');
    const closeBtn = document.getElementById('recovery-close-btn');

    if (statusPanel) statusPanel.classList.remove('hidden');
    if (displayPanel) displayPanel.classList.add('hidden');
    if (storedCheck) storedCheck.checked = false;
    if (closeBtn) closeBtn.disabled = true;
    if (statusText) statusText.textContent = 'Loading status…';
    _recoveryPlaintextCodes = [];
    _recoveryExpiresAt = null;

    fetch(`${API_BASE_URL}/admin_recovery.php?action=status`)
        .then(r => r.json())
        .then(json => {
            if (json.success && json.data) {
                const d = json.data;
                if (!d.generated) {
                    statusText.textContent = 'No recovery codes generated yet. Generate a batch and hand the sealed printout to the Sanitary Head Officer.';
                } else {
                    const exp = d.expires_at ? new Date(d.expires_at).toLocaleDateString() : '—';
                    statusText.textContent = `${d.remaining} of ${d.total} unused · expires ${exp}. Generating new codes invalidates all previously printed codes.`;
                }
            } else {
                statusText.textContent = json.message || 'Could not load recovery status.';
            }
        })
        .catch(() => {
            if (statusText) statusText.textContent = 'Could not load recovery status.';
        });

    modal.showModal();
}

function closeRecoveryCodesModal() {
    // Clear plaintext from memory and DOM
    _recoveryPlaintextCodes = [];
    _recoveryExpiresAt = null;
    const list = document.getElementById('recovery-codes-list');
    if (list) list.innerHTML = '';
    const modal = document.getElementById('recovery-codes-modal');
    if (modal) modal.close();
}

async function handleGenerateRecoveryCodes() {
    const confirmed = confirm('Generate new recovery codes? This invalidates all previously printed codes.');
    if (!confirmed) return;

    try {
        const resp = await fetch(`${API_BASE_URL}/admin_recovery.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'generate', confirm: true })
        });
        const json = await resp.json();
        if (!json.success || !json.data || !Array.isArray(json.data.codes)) {
            Utils.showToast(json.message || 'Failed to generate recovery codes.', 'error');
            return;
        }

        _recoveryPlaintextCodes = json.data.codes;
        _recoveryExpiresAt = json.data.expires_at;

        const statusPanel = document.getElementById('recovery-status-panel');
        const displayPanel = document.getElementById('recovery-codes-display');
        const list = document.getElementById('recovery-codes-list');
        const storedCheck = document.getElementById('recovery-stored-check');
        const closeBtn = document.getElementById('recovery-close-btn');

        if (list) {
            list.innerHTML = _recoveryPlaintextCodes
                .map(c => `<div class="bg-gray-100 rounded px-3 py-2 text-center select-all">${Utils.esc(c)}</div>`)
                .join('');
        }
        if (statusPanel) statusPanel.classList.add('hidden');
        if (displayPanel) displayPanel.classList.remove('hidden');
        if (storedCheck) storedCheck.checked = false;
        if (closeBtn) closeBtn.disabled = true;
    } catch (e) {
        Utils.showToast('Failed to generate recovery codes.', 'error');
    }
}

function toggleRecoveryClose() {
    const storedCheck = document.getElementById('recovery-stored-check');
    const closeBtn = document.getElementById('recovery-close-btn');
    if (closeBtn) closeBtn.disabled = !storedCheck?.checked;
}

function _recoverySheetText() {
    const exp = _recoveryExpiresAt ? new Date(_recoveryExpiresAt).toLocaleString() : 'N/A';
    return [
        'TayabasCare — Admin Recovery Codes',
        'Generated: ' + new Date().toLocaleString(),
        'Expires: ' + exp,
        '',
        ..._recoveryPlaintextCodes.map((c, i) => `${String(i + 1).padStart(2, '0')}. ${c}`),
        '',
        'WARNING: Store this sheet in a sealed envelope with the Sanitary Head Officer.',
        'Do not photograph, copy, or email these codes. Each code is single-use.',
        'A successful redeem burns the entire batch.'
    ].join('\n');
}

function printRecoveryCodes() {
    const exp = _recoveryExpiresAt ? new Date(_recoveryExpiresAt).toLocaleString() : 'N/A';
    const codesHtml = _recoveryPlaintextCodes
        .map((c, i) => `<div class="recovery-print-code">${i + 1}. ${Utils.esc(c)}</div>`)
        .join('');
    const w = window.open('', '_blank');
    if (!w) {
        Utils.showToast('Allow pop-ups to print recovery codes.', 'error');
        return;
    }
    w.document.write(`<!DOCTYPE html><html><head><title>TayabasCare Recovery Codes</title>
        <style>
            body { font-family: 'Segoe UI', sans-serif; padding: 32px; color: #111; }
            h1 { font-size: 18px; margin-bottom: 4px; }
            .meta { font-size: 12px; color: #444; margin-bottom: 16px; }
            .recovery-print-code { font-family: Consolas, monospace; font-size: 16px; padding: 6px 0; border-bottom: 1px dotted #ccc; }
            .warn { margin-top: 20px; font-size: 12px; color: #b45309; border: 1px solid #f59e0b; padding: 12px; border-radius: 6px; }
        </style></head><body>
        <h1>TayabasCare — Admin Recovery Codes</h1>
        <div class="meta">Generated: ${Utils.esc(new Date().toLocaleString())} · Expires: ${Utils.esc(exp)}</div>
        ${codesHtml}
        <div class="warn"><strong>WARNING:</strong> Store this sheet in a sealed envelope with the Sanitary Head Officer.
        Do not photograph, copy, or email these codes. Each code is single-use. A successful redeem burns the entire batch.</div>
        </body></html>`);
    w.document.close();
    w.focus();
    w.print();
}

function downloadRecoveryCodes() {
    const blob = new Blob([_recoverySheetText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tayabascare-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Change Password Modal Functions
function openChangePasswordModal() {
    // Close settings modal first
    closeSettingsModal();
    
    // Reset form
    document.getElementById('change-password-form').reset();
    
    // Open change password modal
    const modal = document.getElementById('change-password-modal');
    modal.showModal();
}

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
        icon.classList.remove('bi-eye');
        icon.classList.add('bi-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('bi-eye-slash');
        icon.classList.add('bi-eye');
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
        Utils.showToast('New password and confirm password do not match!', 'error');
        return;
    }
    
    // Validate password length
    if (newPassword.length < 6) {
        Utils.showToast('Password must be at least 6 characters long!', 'error');
        return;
    }
    
    // Validate new password is different from current
    if (currentPassword === newPassword) {
        Utils.showToast('New password must be different from current password!', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/change_password.php`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                currentPassword: currentPassword,
                newPassword: newPassword
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            Utils.showToast('Password changed successfully!', 'success');
            closeChangePasswordModal();
            
            // Optional: Auto logout after password change
            setTimeout(() => {
                Utils.showToast('Please login again with your new password', 'info');
                setTimeout(() => {
                    handleLogout();
                }, 2000);
            }, 1500);
        } else {
            Utils.showToast('Error: ' + (result.message || 'Failed to change password'), 'error');
        }
    } catch (error) {
        console.error('Error changing password:', error);
        Utils.showToast('Error changing password. Please try again.', 'error');
    }
}

// ==================== NOTIFICATION / ALERT MANAGER ====================

const NotifManager = {

    alerts: [],
    loading: false,

    // Fetch alerts from the server-side alerts.php
    fetchAlerts: async () => {
        if (NotifManager.loading) return;
        NotifManager.loading = true;
        try {
            // First, trigger alert generation on the server
            await fetch(`${API_BASE_URL}/alerts.php?action=generate`).catch(() => {});
            // Then fetch the generated alerts
            const resp = await fetch(`${API_BASE_URL}/alerts.php?action=list`);
            const text = await resp.text();
            let json;
            try { json = JSON.parse(text); } catch (e) { json = { success: false }; }
            if (json.success) {
                NotifManager.alerts = (json.data || []).map(a => ({ ...a, serverId: a.id }));
            } else {
                // Fall back to local generation
                NotifManager.alerts = NotifManager.generateLocal();
            }
        } catch (err) {
            console.warn('Failed to fetch alerts from server:', err);
            NotifManager.alerts = NotifManager.generateLocal();
        }
        NotifManager.loading = false;
        NotifManager.render();
    },

    // Local fallback: generates alerts from in-memory data (original logic)
    generateLocal: () => {
        const alerts = [];
        const today  = new Date();
        today.setHours(0, 0, 0, 0);

        const reports = DataStore.inspectionReports || [];
        reports.forEach(report => {
            if (report.aiAnalysis && report.aiAnalysis.riskLevel === 'HIGH') {
                const reportDate = new Date(report.date);
                const daysSince  = Math.floor((today - reportDate) / (1000 * 60 * 60 * 24));
                alerts.push({
                    id:       'high-' + report.id,
                    type:     'danger',
                    icon:     'bi-exclamation-triangle-fill',
                    title:    'High Risk Establishment',
                    message:  `"${report.location || report.inspector}" has been flagged as HIGH RISK ${daysSince === 0 ? 'today' : daysSince + ' day(s) ago'}. A priority inspection is recommended.`,
                    time:     report.date,
                    read:     false
                });
            }
        });

        const riskResults = PredictionEngine.results || [];
        const VIOLATION_THRESHOLD = 3;
        riskResults.forEach(r => {
            const count = r.factors && r.factors.violations ? r.factors.violations.count : 0;
            if (count >= VIOLATION_THRESHOLD) {
                alerts.push({
                    id:      'threshold-' + (r.businessName || 'unknown').replace(/\s+/g, '-'),
                    type:    'danger',
                    icon:    'bi-exclamation-octagon-fill',
                    title:   'Repeated Violations Detected',
                    message: `"${Utils.esc(r.businessName)}" has ${count} unresolved sanitary violations requiring corrective action and re-inspection.`,
                    time:    null,
                    read:    false
                });
            }
        });

        const readIds = NotifManager.getReadIds();
        alerts.forEach(a => { if (readIds.includes(a.id)) a.read = true; });
        return alerts;
    },

    // Map server alert types to UI display properties
    mapAlert: (serverAlert) => {
        const typeMap = {
            'violation_threshold': { type: 'danger',  icon: 'bi-exclamation-octagon-fill' },
            'overdue_followup':    { type: 'warning', icon: 'bi-clock-history' },
            'high_risk':           { type: 'danger',  icon: 'bi-exclamation-triangle-fill' },
            'schedule_reminder':   { type: 'info',    icon: 'bi-calendar-check' }
        };
        const mapped = typeMap[serverAlert.alert_type] || { type: 'info', icon: 'bi-info-circle' };
        const titleMap = {
            'violation_threshold': 'Repeated Violations Detected',
            'overdue_followup':    'Follow-up Inspection Overdue',
            'high_risk':           'High Risk Establishment',
            'schedule_reminder':   'Upcoming Inspection Schedule'
        };
        return {
            id:      serverAlert.id,
            type:    mapped.type,
            icon:    mapped.icon,
            title:   titleMap[serverAlert.alert_type] || 'Alert',
            message: serverAlert.message,
            time:    serverAlert.created_at,
            read:    !!serverAlert.is_read,
            serverId: serverAlert.id
        };
    },

    getReadIds: () => {
        const raw = localStorage.getItem('notifReadIds');
        try {
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            localStorage.removeItem('notifReadIds');
            return [];
        }
    },

    markRead: async (id) => {
        // Try server-side mark
        const alert = NotifManager.alerts.find(a => String(a.id) === String(id));
        if (alert && alert.serverId) {
            try {
                await fetch(`${API_BASE_URL}/alerts.php`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: alert.serverId, action: 'read' })
                });
            } catch (e) { /* ignore */ }
        }
        // Also mark locally
        const ids = NotifManager.getReadIds();
        if (!ids.includes(id)) {
            ids.push(id);
            localStorage.setItem('notifReadIds', JSON.stringify(ids));
        }
        NotifManager.render();
    },

    markAllRead: async () => {
        // Server-side mark all
        try {
            await fetch(`${API_BASE_URL}/alerts.php`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'read_all' })
            });
        } catch (e) { /* ignore */ }
        // Local mark all
        const alerts = NotifManager.alerts;
        const ids    = alerts.map(a => a.id);
        localStorage.setItem('notifReadIds', JSON.stringify(ids));
        NotifManager.alerts.forEach(a => a.read = true);
        NotifManager.render();
    },

    dismissAll: async () => {
        const alerts = NotifManager.alerts;
        // Dismiss each on server
        for (const alert of alerts) {
            if (alert.serverId) {
                try {
                    await fetch(`${API_BASE_URL}/alerts.php`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: alert.serverId, action: 'dismiss' })
                    });
                } catch (e) { /* ignore */ }
            }
        }
        NotifManager.alerts = [];
        NotifManager.render();
    },

    dismiss: async (id) => {
        const alert = NotifManager.alerts.find(a => String(a.id) === String(id));
        if (alert && alert.serverId) {
            try {
                await fetch(`${API_BASE_URL}/alerts.php`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: alert.serverId, action: 'dismiss' })
                });
            } catch (e) { /* ignore */ }
        }
        // Remove from local list
        NotifManager.alerts = NotifManager.alerts.filter(a => String(a.id) !== String(id));
        NotifManager.render();
    },

    render: () => {
        // Map server alerts to display format
        let displayAlerts = NotifManager.alerts.map(a => a.serverId ? NotifManager.mapAlert(a) : a);
        displayAlerts.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
        const unread = displayAlerts.filter(a => !a.read);
        const badge  = document.getElementById('notifBadge');
        const listEl = document.getElementById('notifList');

        if (badge) {
            badge.textContent   = unread.length > 9 ? '9+' : unread.length;
            badge.style.display = unread.length > 0 ? 'inline-block' : 'none';
        }

        if (!listEl) return;

        if (displayAlerts.length === 0) {
            listEl.innerHTML = '<p style="text-align:center;color:#9ca3af;font-size:13px;padding:20px;">No alerts at this time</p>';
            return;
        }

        const colorMap = {
            danger:  { bg: '#fef2f2', border: '#ef4444', icon: '#ef4444', text: '#991b1b' },
            warning: { bg: '#fffbeb', border: '#f59e0b', icon: '#d97706', text: '#92400e' },
            info:    { bg: '#eff6ff', border: '#3b82f6', icon: '#2563eb', text: '#1e40af' }
        };

        listEl.innerHTML = displayAlerts.map(alert => {
            const c   = colorMap[alert.type] || colorMap.info;
            const dim = alert.read ? 'opacity:0.5;' : '';
            return `
            <div onclick="NotifManager.markRead('${alert.id}')" style="${dim}display:flex;align-items:flex-start;gap:10px;padding:10px 16px;border-bottom:1px solid #f3f4f6;background:${alert.read ? '#fff' : c.bg};cursor:pointer;transition:background 0.15s;" onmouseover="if(!${alert.read}) this.style.background='${c.bg}ee'" onmouseout="this.style.background='${alert.read ? '#fff' : c.bg}'">
                <div style="flex-shrink:0;margin-top:2px;">
                    <i class="bi ${alert.icon}" style="color:${c.icon};font-size:18px;"></i>
                </div>
                <div style="flex:1;min-width:0;">
                    <p style="font-size:12px;font-weight:700;color:${c.text};margin:0 0 2px;">${Utils.esc(alert.title)}</p>
                    <p style="font-size:12px;color:#374151;margin:0 0 4px;line-height:1.4;">${Utils.esc(alert.message)}</p>
                    ${alert.time ? `<p style="font-size:11px;color:#9ca3af;margin:0;">${new Date(alert.time).toLocaleDateString('en-PH', {year:'numeric',month:'short',day:'numeric'})}</p>` : ''}
                </div>
                ${!alert.read ? `<button onclick="event.stopPropagation();NotifManager.dismiss('${alert.id}')" style="flex-shrink:0;font-size:11px;color:#6b7280;background:none;border:1px solid #e5e7eb;border-radius:6px;padding:2px 8px;cursor:pointer;">Dismiss</button>` : `<button onclick="event.stopPropagation();NotifManager.dismiss('${alert.id}')" style="flex-shrink:0;font-size:11px;color:#9ca3af;background:none;border:1px solid #f3f4f6;border-radius:6px;padding:2px 8px;cursor:pointer;">Dismiss</button>`}
            </div>`;
        }).join('');
    },

    togglePanel: () => {
        const panel = document.getElementById('notifPanel');
        if (!panel) return;
        const isOpen = panel.style.display === 'block';
        panel.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) NotifManager.render();
    }
};

// Fetch alerts from server on load and every 2 minutes
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => NotifManager.fetchAlerts(), 1000);
    setInterval(() => NotifManager.fetchAlerts(), 120000);
});

// ==================== END NOTIFICATION / ALERT MANAGER ====================

// ==================== SCHEDULE MANAGER ====================

const ScheduleManager = {
    editingId: null,
    _cache: [],
    _loading: false,

    // Normalize API row to a consistent format used by the calendar
    _normalize: (row) => ({
        id:            row.id,
        inspector:     row.inspector_name || row.inspector || '',
        rank:          row.role_title || '',
        establishment: row.establishment || '',
        riskLevel:     row.risk_level || row.riskLevel || '',
        schedDate:     row.schedDate || '',
        notes:         row.notes || '',
        done:          !!(row.done),
        createdAt:     row.createdAt || row.created_at || ''
    }),

    // Fetch all schedules from the database API
    fetchAll: async () => {
        if (ScheduleManager._loading) return ScheduleManager._cache;
        ScheduleManager._loading = true;
        try {
            const resp = await fetch(`${API_BASE_URL}/inspection_schedules.php`);
            const json = await resp.json();
            if (json.success && Array.isArray(json.data)) {
                ScheduleManager._cache = json.data.map(ScheduleManager._normalize);
            }
        } catch (e) {
            console.warn('Could not fetch schedules:', e);
        }
        ScheduleManager._loading = false;
        return ScheduleManager._cache;
    },

    getAll: () => ScheduleManager._cache,

    getStatus: (dueDateStr, markedDone) => {
        if (markedDone) return 'Done';
        const today = new Date(); today.setHours(0,0,0,0);
        const due   = new Date(dueDateStr); due.setHours(0,0,0,0);
        return due < today ? 'Overdue' : 'Pending';
    },

    markDone: async (id) => {
        try {
            await fetch(`${API_BASE_URL}/inspection_schedules.php`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id })
            });
            // Update local cache
            const item = ScheduleManager._cache.find(s => s.id === id);
            if (item) item.done = true;
            await ScheduleManager.render();
            adminShowNotification('Marked as done!', 'success');
        } catch (e) {
            adminShowNotification('Failed to mark as done.', 'error');
        }
    },

    deleteRecord: async (id) => {
        if (!confirm('Delete this schedule entry?')) return;
        try {
            await fetch(`${API_BASE_URL}/inspection_schedules.php?id=${id}`, {
                method: 'DELETE'
            });
            const rec = ScheduleManager._cache.find(s => s.id === id);
            ScheduleManager._cache = ScheduleManager._cache.filter(s => s.id !== id);
            await ScheduleManager.render();
            const panel = document.getElementById('calDayPanel');
            if (panel && panel.style.display !== 'none' && rec) ScheduleManager.showDay(rec.schedDate);
        } catch (e) {
            adminShowNotification('Failed to delete schedule.', 'error');
        }
    },

    showAddForm: async () => {
        const form = document.getElementById('addScheduleForm');
        if (!form) return;
        form.style.display = 'block';

        // Populate inspector dropdown
        const select = document.getElementById('addSchedInspector');
        if (select && select.options.length <= 1) {
            try {
                const resp = await fetch(`${API_BASE_URL}/inspector.php`);
                const json = await resp.json();
                const inspectors = json.data || [];
                select.innerHTML = '<option value="">— Select Inspector —</option>' +
                    inspectors.map(i => `<option value="${i.fullName || i.full_name}">${i.fullName || i.full_name}</option>`).join('');
            } catch (e) {
                select.innerHTML = '<option value="">Could not load inspectors</option>';
            }
        }

        // Default date to today
        document.getElementById('addSchedDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('addSchedEstablishment').value = '';
        document.getElementById('addSchedRisk').value = '';
        document.getElementById('addSchedNotes').value = '';
        document.getElementById('addSchedStatus').innerHTML = '';
    },

    submitAdd: async () => {
        const inspector    = document.getElementById('addSchedInspector')?.value;
        const schedDate    = document.getElementById('addSchedDate')?.value;
        const establishment = document.getElementById('addSchedEstablishment')?.value || '';
        const riskLevel    = document.getElementById('addSchedRisk')?.value || '';
        const notes        = document.getElementById('addSchedNotes')?.value || '';
        const status       = document.getElementById('addSchedStatus');

        if (!inspector || !schedDate) {
            status.innerHTML = '<span style="color:#ef4444;">Inspector and date are required.</span>';
            return;
        }

        const cleanName = inspector.includes(',')
            ? inspector.split(',')[0].trim()
            : inspector.trim();

        // 1. Save schedule to database via API
        try {
            await fetch(`${API_BASE_URL}/inspection_schedules.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inspector:     cleanName,
                    establishment: establishment,
                    riskLevel:     riskLevel,
                    schedDate:     schedDate,
                    notes:         notes
                })
            });
        } catch (e) {
            console.warn('Schedule save error:', e);
        }

        // 2. Send real email to the inspector via PHP
        fetch(`${API_BASE_URL}/PHPMailer/send_notification.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inspector: cleanName,
                schedDate: schedDate,
                notes:     notes,
                type:      'assigned'
            })
        })
        .then(res => res.json())
        .then(data => {
            if (!data.success) console.warn('Email notification failed:', data.message);
        })
        .catch(err => console.warn('Email send error:', err));

        // 3. In-app notification for inspector bell
        const key  = 'inspectorNotifs_' + cleanName;
        let list = [];
        try {
            list = JSON.parse(localStorage.getItem(key) || '[]');
        } catch (e) {
            list = [];
        }
        const dateFormatted = new Date(schedDate).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
        list.push({
            id:      Date.now(),
            read:    false,
            type:    'assigned',
            message: `You are scheduled for inspection duty on ${dateFormatted}.${notes ? ' Note: ' + notes : ''}`,
            date:    new Date().toISOString(),
            schedDate: schedDate
        });
        localStorage.setItem(key, JSON.stringify(list));

        // 4. Refresh from DB and re-render
        status.innerHTML = '<span style="color:#059669;"><i class="fas fa-check"></i> Schedule saved and notification sent.</span>';
        await ScheduleManager.fetchAll();
        ScheduleManager.render();

        // Clear form after a short delay
        setTimeout(() => {
            document.getElementById('addScheduleForm').style.display = 'none';
        }, 1500);
    },

    calYear:  new Date().getFullYear(),
    calMonth: new Date().getMonth(),

    render: async () => {
        // Fetch latest from DB before rendering
        await ScheduleManager.fetchAll();

        // Update sidebar badge
        const all         = ScheduleManager.getAll();
        const urgentCount = all.filter(s => !s.done).length;
        const badge       = document.getElementById('scheduleBadge');
        if (badge) {
            badge.textContent   = urgentCount;
            badge.style.display = urgentCount > 0 ? 'inline-block' : 'none';
        }
        ScheduleManager.renderCalendar();
    },

    renderCalendar: () => {
        const all    = ScheduleManager.getAll();
        const year   = ScheduleManager.calYear;
        const month  = ScheduleManager.calMonth;
        const label  = document.getElementById('calMonthLabel');
        const grid   = document.getElementById('calendarGrid');
        if (!grid) return;

        label.textContent = new Date(year, month, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });

        const firstDay   = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today      = new Date(); today.setHours(0,0,0,0);

        // Build a map: 'YYYY-MM-DD' -> [schedules]
        const schedMap = {};
        all.forEach(s => {
            if (s.schedDate) {
                if (!schedMap[s.schedDate]) schedMap[s.schedDate] = [];
                schedMap[s.schedDate].push(s);
            }
        });

        let html = '';

        // Empty cells before first day
        for (let i = 0; i < firstDay; i++) {
            html += `<div style="min-height:80px;border-radius:8px;background:#f9fafb;"></div>`;
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const mm       = String(month + 1).padStart(2, '0');
            const dd       = String(d).padStart(2, '0');
            const dateKey  = `${year}-${mm}-${dd}`;
            const cellDate = new Date(year, month, d); cellDate.setHours(0,0,0,0);
            const isToday  = cellDate.getTime() === today.getTime();
            const scheds   = schedMap[dateKey] || [];
            const hasScheds = scheds.length > 0;

            const bgColor   = isToday ? '#ecfdf5' : '#fff';
            const border    = isToday ? '2px solid #10b981' : '1px solid #e5e7eb';
            const dayColor  = isToday ? '#059669' : '#374151';
            const cursor    = hasScheds ? 'pointer' : 'default';

            let dotsHtml = '';
            if (hasScheds) {
                const riskColors = { HIGH: '#ef4444', MODERATE: '#f59e0b', LOW: '#10b981' };
                const colors = ['#2563eb','#059669','#f59e0b','#ef4444','#8b5cf6'];
                dotsHtml = `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;">` +
                    scheds.slice(0, 3).map((s, i) => {
                        const shortName = s.inspector.split(' ')[0] + ' ' + (s.inspector.split(' ')[1] || '');
                        const dotColor = s.riskLevel ? (riskColors[s.riskLevel] || colors[i % colors.length]) : colors[i % colors.length];
                        return `<span style="font-size:10px;background:${dotColor};color:#fff;border-radius:4px;padding:1px 5px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${s.establishment || ''}${s.riskLevel ? ' [' + s.riskLevel + ']' : ''}">${shortName}</span>`;
                    }).join('') +
                    (scheds.length > 3 ? `<span style="font-size:10px;color:#6b7280;">+${scheds.length - 3}</span>` : '') +
                    `</div>`;
            }

            html += `
            <div onclick="ScheduleManager.showDay('${dateKey}')"
                style="min-height:80px;border-radius:8px;background:${bgColor};border:${border};padding:6px 8px;cursor:${cursor};transition:box-shadow 0.15s;"
                onmouseover="if(${hasScheds}) this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)'"
                onmouseout="this.style.boxShadow='none'">
                <div style="font-size:13px;font-weight:${isToday ? '700' : '500'};color:${dayColor};">${d}</div>
                ${dotsHtml}
            </div>`;
        }

        grid.innerHTML = html;
    },

    showDay: (dateKey) => {
        const all    = ScheduleManager.getAll();
        const scheds = all.filter(s => s.schedDate === dateKey);
        const panel  = document.getElementById('calDayPanel');
        const title  = document.getElementById('calDayTitle');
        const list   = document.getElementById('calDayList');
        if (!panel) return;

        const dateFmt = new Date(dateKey + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        title.textContent = dateFmt;

        if (scheds.length === 0) {
            list.innerHTML = '<p style="color:#9ca3af;font-size:13px;text-align:center;padding:12px;">No inspectors scheduled on this day.</p>';
        } else {
            const statusStyle = {
                Pending: { bg: '#eff6ff', color: '#2563eb' },
                Done:    { bg: '#d1fae5', color: '#059669' },
                Overdue: { bg: '#fee2e2', color: '#dc2626' }
            };
            list.innerHTML = scheds.map(s => {
                const status = ScheduleManager.getStatus(s.schedDate, s.done);
                const ss     = statusStyle[status] || { bg: '#f3f4f6', color: '#6b7280' };
                return `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px;background:#fafafa;">
                    <div>
                        <div style="font-weight:600;font-size:14px;color:#111827;">${Utils.esc(s.inspector)}</div>
                        <div style="font-size:12px;color:#6b7280;font-style:italic;">${s.rank || ''}</div>
                        <div style="font-size:12px;color:#2563eb;margin-top:2px;">🏢 ${s.establishment || 'No establishment set'}${s.riskLevel ? ` <span style="background:${s.riskLevel === 'HIGH' ? '#fef2f2;color:#dc2626' : s.riskLevel === 'MODERATE' ? '#fffbeb;color:#d97706' : '#ecfdf5;color:#059669'};font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:4px;">${s.riskLevel}</span>` : ''}</div>
                        ${s.notes ? `<div style="font-size:12px;color:#374151;margin-top:4px;">📝 ${s.notes}</div>` : ''}
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="background:${ss.bg};color:${ss.color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;">${status}</span>
                        ${!s.done ? `<button onclick="ScheduleManager.markDone(${s.id})" style="font-size:11px;padding:4px 10px;border:1px solid #059669;color:#059669;background:#d1fae5;border-radius:6px;cursor:pointer;">Done</button>` : ''}
                        <button onclick="ScheduleManager.deleteRecord(${s.id})" style="font-size:11px;padding:4px 10px;border:1px solid #dc2626;color:#dc2626;background:#fee2e2;border-radius:6px;cursor:pointer;">Delete</button>
                    </div>
                </div>`;
            }).join('');
        }

        panel.style.display = 'block';
    },

    prevMonth: () => {
        ScheduleManager.calMonth--;
        if (ScheduleManager.calMonth < 0) { ScheduleManager.calMonth = 11; ScheduleManager.calYear--; }
        ScheduleManager.renderCalendar();
    },

    nextMonth: () => {
        ScheduleManager.calMonth++;
        if (ScheduleManager.calMonth > 11) { ScheduleManager.calMonth = 0; ScheduleManager.calYear++; }
        ScheduleManager.renderCalendar();
    },
};

// ==================== END SCHEDULE MANAGER ====================

// ==================== AUTO-SCHEDULER (Risk-Based) ====================

const AutoScheduler = {
    recommendations: [],

    // Fetch recommendations from the server
    preview: async () => {
        const panel  = document.getElementById('autoSchedulePanel');
        const list   = document.getElementById('autoScheduleList');
        const status = document.getElementById('autoSchedStatus');
        if (!panel) return;

        panel.style.display = 'block';
        list.innerHTML = '<p style="text-align:center;padding:20px;color:#6b7280;"><i class="fas fa-spinner fa-spin"></i> Analyzing establishments...</p>';
        status.textContent = '';

        // Populate inspector dropdown
        const select = document.getElementById('autoSchedInspector');
        if (select) {
            const inspectors = await fetch(`${API_BASE_URL}/inspector.php`).then(r => r.json()).catch(() => ({ data: [] }));
            const list = inspectors.data || [];
            select.innerHTML = '<option value="">— Round-robin (all) —</option>' +
                list.map(i => `<option value="${i.fullName || i.full_name}">${i.fullName || i.full_name}</option>`).join('');
        }

        try {
            const resp = await fetch(`${API_BASE_URL}/auto_schedule.php`);
            const text = await resp.text();
            let json;
            try { json = JSON.parse(text); } catch (e) { throw new Error('Server returned invalid response. Run setup_database.php to create the required tables.'); }
            if (!json.success) throw new Error(json.message);

            AutoScheduler.recommendations = json.data || [];
            AutoScheduler.renderList();
        } catch (err) {
            list.innerHTML = `<p style="text-align:center;padding:20px;color:#ef4444;">Error: ${err.message}</p>`;
        }
    },

    renderList: () => {
        const list = document.getElementById('autoScheduleList');
        if (!list) return;

        const recs = AutoScheduler.recommendations;
        if (recs.length === 0) {
            list.innerHTML = '<p style="text-align:center;padding:20px;color:#059669;"><i class="fas fa-check-circle"></i> All establishments are up-to-date. No overdue inspections.</p>';
            return;
        }

        const riskStyle = {
            HIGH:     { bg: '#fef2f2', color: '#ef4444', border: '#fecaca', badge: '#dc2626' },
            MODERATE: { bg: '#fffbeb', color: '#d97706', border: '#fde68a', badge: '#d97706' },
            LOW:      { bg: '#ecfdf5', color: '#059669', border: '#a7f3d0', badge: '#059669' }
        };

        list.innerHTML = recs.map(r => {
            const rs = riskStyle[r.riskLevel] || riskStyle.LOW;
            return `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid ${rs.border};border-radius:8px;margin-bottom:6px;background:${rs.bg};">
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                        <span style="background:${rs.badge};color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;">${r.riskLevel}</span>
                        <span style="font-weight:600;font-size:13px;color:#111827;">${Utils.esc(r.establishment)}</span>
                    </div>
                    <div style="font-size:11px;color:#6b7280;">
                        ${r.barangay ? '📍 ' + r.barangay + ' · ' : ''}Score: ${r.riskScore}/100 · Last: ${r.lastInspected} · ${r.reason}
                    </div>
                </div>
            </div>`;
        }).join('');

        document.getElementById('autoSchedStatus').innerHTML = `<span style="color:#6b7280;">${recs.length} establishment(s) overdue for inspection.</span>`;
    },

    execute: async () => {
        const status   = document.getElementById('autoSchedStatus');
        const inspector = document.getElementById('autoSchedInspector')?.value || '';

        status.innerHTML = '<span style="color:#7c3aed;"><i class="fas fa-spinner fa-spin"></i> Scheduling...</span>';

        try {
            const resp = await fetch(`${API_BASE_URL}/auto_schedule.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inspector: inspector,
                    startDate: new Date().toISOString().split('T')[0],
                    maxPerDay: 3
                })
            });
            const text = await resp.text();
            let json;
            try { json = JSON.parse(text); } catch (e) { throw new Error('Server returned invalid response. Run setup_database.php to create the required tables.'); }
            if (!json.success) throw new Error(json.message);

            const count = json.data?.scheduled || 0;
            status.innerHTML = `<span style="color:#059669;font-weight:600;"><i class="fas fa-check-circle"></i> ${json.message}</span>`;

            // Refresh the calendar
            await ScheduleManager.render();

            // Refresh alerts
            setTimeout(() => NotifManager.fetchAlerts(), 500);
        } catch (err) {
            status.innerHTML = `<span style="color:#ef4444;"><i class="fas fa-times-circle"></i> Error: ${err.message}</span>`;
        }
    }
};

// ==================== END AUTO-SCHEDULER ====================

// ==================== PREDICTION ENGINE ====================

const PredictionEngine = {
    results: [],

    run: async () => {
        const statusEl = document.getElementById('predStatus');
        const tbody    = document.getElementById('predTableBody');
        statusEl.textContent = 'Running prescription...';
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#6b7280;"><i class="fas fa-spinner fa-spin"></i> Analyzing establishments...</td></tr>';

        try {
            const resp = await fetch(`${API_BASE_URL}/predict.php`, { method: 'GET' });
            const json = await resp.json();

            if (!json.success) throw new Error(json.message);

            const results = json.data;

            PredictionEngine.results = results;
            PredictionEngine.updateSummary(results);
            PredictionEngine.renderTable(results);
            statusEl.textContent = `Last run: ${new Date().toLocaleTimeString('en-PH')} · ${results.length} establishments prescribed`;

            // Update sidebar badge with HIGH count
            const highCount = results.filter(r => r.riskLevel === 'HIGH').length;
            const badge = document.getElementById('predHighBadge');
            if (badge) { badge.textContent = highCount; badge.style.display = highCount > 0 ? 'inline-block' : 'none'; }

        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:#ef4444;">Error: ${err.message}. Make sure XAMPP is running and predict.php is in the php folder.</td></tr>`;
            statusEl.textContent = '';
        }
    },

    updateSummary: (results) => {
        const high = results.filter(r => r.riskLevel === 'HIGH').length;
        const mod  = results.filter(r => r.riskLevel === 'MODERATE').length;
        const low  = results.filter(r => r.riskLevel === 'LOW').length;
        document.getElementById('predHighCount').textContent = high;
        document.getElementById('predModCount').textContent  = mod;
        document.getElementById('predLowCount').textContent  = low;
    },

    filter: () => {
        const risk   = document.getElementById('predFilterRisk').value;
        const search = document.getElementById('predFilterSearch').value.toLowerCase();
        const sortBy = document.getElementById('predSortBy')?.value || 'high-first';
        const countEl = document.getElementById('predCount');
        const allResults = PredictionEngine.results;
        let filtered = allResults.filter(r => {
            const matchRisk   = !risk   || r.riskLevel === risk;
            const matchSearch = !search || (r.businessName || '').toLowerCase().includes(search) || (r.barangay || '').toLowerCase().includes(search);
            return matchRisk && matchSearch;
        });

        // Sort
        filtered = [...filtered].sort((a, b) => {
            switch (sortBy) {
                case 'high-first': return b.totalScore - a.totalScore;
                case 'low-first': return a.totalScore - b.totalScore;
                case 'name-az': return (a.businessName || '').localeCompare(b.businessName || '');
                case 'recent': return new Date(b.lastInspected || 0) - new Date(a.lastInspected || 0);
                default: return b.totalScore - a.totalScore;
            }
        });

        const hasFilter = risk || search;
        const page = hasFilter ? { displayed: filtered, hasMore: false, remaining: 0 } : TablePaging.slice(filtered, 'prediction', 15);
        const displayed = page.displayed;
        if (countEl) countEl.textContent = hasFilter ? `${displayed.length} matching` : `Showing ${displayed.length} of ${allResults.length} establishments`;
        PredictionEngine.renderTable(displayed);
        if (page.hasMore) {
            const tbody = document.getElementById('predTableBody');
            if (tbody) tbody.insertAdjacentHTML('beforeend', TablePaging.moreRow('prediction', page.remaining, 8, 15));
        }
    },

    renderTable: (results) => {
        const tbody = document.getElementById('predTableBody');
        if (!results.length) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#9ca3af;">No results match your filter.</td></tr>';
            return;
        }

        const riskStyle = {
            HIGH:     { bg: '#fef2f2', color: '#ef4444', border: '#fecaca' },
            MODERATE: { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
            LOW:      { bg: '#ecfdf5', color: '#059669', border: '#a7f3d0' },
        };

        tbody.innerHTML = results.map((r, i) => {
            const rs      = riskStyle[r.riskLevel] || riskStyle.LOW;
            const scorePct= Math.min(100, r.totalScore);
            const barColor= r.riskLevel === 'HIGH' ? '#ef4444' : r.riskLevel === 'MODERATE' ? '#f59e0b' : '#10b981';
            return `
            <tr style="border-bottom:1px solid #f3f4f6;" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background=''">
                <td style="padding:12px 16px;color:#9ca3af;font-size:12px;">${getSanitaryPermitNoForEstablishment(r.businessName)}</td>
                <td style="padding:12px 16px;font-weight:600;color:#111827;max-width:200px;">
                    ${Utils.esc(r.businessName)}
                    <div style="margin-top:4px;background:#e5e7eb;border-radius:4px;height:5px;width:120px;">
                        <div style="width:${scorePct}%;background:${barColor};height:5px;border-radius:4px;transition:width 0.5s;"></div>
                    </div>
                </td>
                <td style="padding:12px 16px;color:#6b7280;font-size:12px;">${Utils.esc(r.barangay) || '—'}</td>
                <td style="padding:12px 16px;text-align:center;font-size:15px;font-weight:800;color:${barColor};">${r.totalScore}<span style="font-size:10px;font-weight:400;color:#9ca3af;">/100</span></td>
                <td style="padding:12px 16px;text-align:center;">
                    <span style="background:${rs.bg};color:${rs.color};border:1px solid ${rs.border};font-size:11px;font-weight:700;padding:4px 12px;border-radius:999px;">${r.riskLevel}</span>
                </td>
                <td style="padding:12px 16px;text-align:center;font-size:12px;color:#374151;">${r.lastInspected}</td>
                <td style="padding:12px 16px;text-align:center;font-size:12px;color:#374151;">${r.totalInspections}</td>
                <td style="padding:12px 16px;">
                    <button onclick="PredictionEngine.showDetailByName('${Utils.esc(r.businessName).replace(/'/g, "\\'")}')" style="font-size:11px;padding:4px 12px;border:1px solid #7c3aed;color:#7c3aed;background:#f5f3ff;border-radius:6px;cursor:pointer;">View Details</button>
                </td>
            </tr>`;
        }).join('');
    },

    showDetailByName: async (businessName) => {
        const r = PredictionEngine.results.find(x => x.businessName === businessName);
        if (r) PredictionEngine.showDetail(PredictionEngine.results.indexOf(r));
    },

    showDetail: async (index) => {
        const r     = PredictionEngine.results[index];
        if (!r) return;
        const panel = document.getElementById('predDetailPanel');
        const title = document.getElementById('predDetailTitle');
        const body  = document.getElementById('predDetailBody');

        const riskColor = r.riskLevel === 'HIGH' ? '#ef4444' : r.riskLevel === 'MODERATE' ? '#d97706' : '#059669';
        const riskBg    = r.riskLevel === 'HIGH' ? '#fef2f2' : r.riskLevel === 'MODERATE' ? '#fffbeb' : '#ecfdf5';

        title.innerHTML = `${Utils.esc(r.businessName)} &nbsp;<span style="font-size:15px;padding:5px 14px;border-radius:999px;background:${riskBg};color:${riskColor};font-weight:700;">${r.riskLevel} RISK · ${r.totalScore}/100</span>`;

        const factors = r.factors || {};
        const factorRows = Object.values(factors).map(f => {
            const pct      = Math.round((f.score / f.max) * 100);
            const barColor = pct >= 70 ? '#ef4444' : pct >= 40 ? '#f59e0b' : '#10b981';
            const extra    = f.count !== undefined ? ` (${f.count} found)` :
                             f.days  !== undefined ? ` (${f.days} days ago)` :
                             f.rate  !== undefined ? ` (${f.rate}% compliant)` : '';
            return `
            <div style="margin-bottom:14px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="font-size:15px;font-weight:600;color:#374151;">${f.label}${extra}</span>
                    <span style="font-size:15px;font-weight:700;color:${barColor};">${f.score}/${f.max}</span>
                </div>
                <div style="background:#e5e7eb;border-radius:6px;height:10px;">
                    <div style="width:${pct}%;background:${barColor};height:10px;border-radius:6px;transition:width 0.6s;"></div>
                </div>
            </div>`;
        }).join('');

        const recoHtml = (r.recommendations || []).map(rec =>
            `<li style="margin-bottom:10px;color:#374151;font-size:15px;line-height:1.6;">📌 ${Utils.esc(rec)}</li>`
        ).join('');

        const remarksHtml = (r.inspectorRemarks && r.inspectorRemarks.length > 0)
            ? (r.inspectorRemarks).map(rec =>
                `<li style="margin-bottom:10px;color:#374151;font-size:15px;line-height:1.6;">📋 ${Utils.esc(rec)}</li>`
              ).join('')
            : '<li style="color:#9ca3af;font-size:15px;">No inspector remarks on record yet.</li>';

        // Show panel immediately with loading state for AI
        body.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
            <div>
                <h4 style="font-size:15px;font-weight:700;color:#6b7280;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.5px;">Factor Breakdown</h4>
                ${factorRows}
            </div>
            <div>
                <h4 style="font-size:15px;font-weight:700;color:#6b7280;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.5px;">Recommendations</h4>
                <ul style="list-style:none;padding:0;margin:0;">${recoHtml}</ul>
                <h4 style="font-size:15px;font-weight:700;color:#6b7280;margin:16px 0 10px;text-transform:uppercase;letter-spacing:0.5px;">Inspector Remarks</h4>
                <ul style="list-style:none;padding:0;margin:0;">${remarksHtml}</ul>
                <div style="margin-top:20px;padding:16px;background:#f9fafb;border-radius:8px;font-size:15px;color:#374151;line-height:2;">
                    <strong>Barangay:</strong> ${Utils.esc(r.barangay) || 'N/A'}<br>
                    <strong>Total Inspections on Record:</strong> ${r.totalInspections}<br>
                    <strong>Last Inspected:</strong> ${r.lastInspected}<br>
                    <strong>Prescription basis:</strong> PD 856 — Sanitation Code of the Philippines
                </div>
                <button onclick="EstablishmentTrend.show('${Utils.esc(r.businessName)}')" style="margin-top:12px;background:#7c3aed;border:none;color:#fff;padding:8px 16px;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px;">
                    <i class="fas fa-chart-line" style="margin-right:6px;"></i>View Risk Score Trend
                </button>
            </div>
        </div>
        <div id="aiAssessmentBox" style="margin-top:24px;padding:28px;background:#f0f9ff;border:2px solid #bae6fd;border-radius:12px;">
            <h4 style="font-size:20px;font-weight:700;color:#0369a1;margin:0 0 16px;display:flex;align-items:center;gap:8px;">🤖 AI Assessment</h4>
            <p id="aiAssessmentText" style="font-size:18px;color:#1e3a5f;margin:0;line-height:2;letter-spacing:0.01em;">
                <i class="fas fa-spinner fa-spin"></i> Generating AI assessment, please wait...
            </p>
        </div>`;

        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Call AI
        try {
            const aiResp = await fetch(`${API_BASE_URL}/ai_analyze.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    businessName:    r.businessName,
                    riskLevel:       r.riskLevel,
                    totalScore:      r.totalScore,
                    totalViolations: r.factors?.violations?.count ?? 0,
                    lastInspected:   r.lastInspected,
                    barangay:        r.barangay,
                    recommendations: r.recommendations || []
                })
            });
            const aiJson = await aiResp.json();
            const aiText = aiJson?.analysis?.aiAssessment || aiJson?.error || 'Could not generate AI assessment.';
            document.getElementById('aiAssessmentText').textContent = aiText;
        } catch (e) {
            document.getElementById('aiAssessmentText').textContent = 'AI assessment unavailable. Check your connection.';
        }
    },

    exportCSV: () => {
        const results = PredictionEngine.results;
        if (!results || results.length === 0) {
            alert('No prescription results to export. Run the analysis first.');
            return;
        }
        const headers = ['#', 'Business Name', 'Barangay', 'Business Type', 'Risk Level', 'Score', 'Last Inspected', 'Total Violations', 'Compliance Rate'];
        const rows = results.map((r, i) => [
            i + 1,
            r.businessName || '',
            r.barangay || '',
            r.businessType || 'Other',
            r.riskLevel || '',
            r.totalScore || 0,
            r.lastInspected || '',
            r.factors?.violations?.count ?? 0,
            (r.factors?.compliance?.rate ?? 'N/A') + '%'
        ]);
        const csv = [headers, ...rows].map(row => row.map(v => `"${v}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `risk-prescriptions-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    },
};

// ==================== CSV EXPORT FUNCTIONS ====================
function exportReportsCSV() {
    const reports = DataStore.inspectionReports;
    if (!reports || reports.length === 0) {
        alert('No inspection reports to export.');
        return;
    }
    const headers = ['Report ID', 'Inspector', 'Establishment', 'Location', 'Date', 'Status', 'Complied', 'Recommendation'];
    const rows = reports.map(r => [
        getSanitaryPermitNoForEstablishment(r.establishment || r.location),
        r.inspector || '',
        r.establishment || r.location || '',
        r.location || '',
        r.date || '',
        r.status || '',
        (r.complied === true || r.complied === 'true') ? 'Yes' : 'No',
        (r.recommendation || '').replace(/,/g, ';')
    ]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `inspection-reports-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}
// ==================== END CSV EXPORT FUNCTIONS ====================

// ==================== HISTORICAL RECORDS BULK IMPORT (Objective 1) ====================
function normalizeImportDate(val) {
    if (!val) return '';
    if (val instanceof Date && !isNaN(val)) {
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return String(val).trim();
}

const SanitaryImport = {
    // Expected column headers in the CSV/Excel file (case-sensitive):
    // businessName, ownerFirst, ownerMiddle, ownerLast, permitNo,
    // barangay, buildingStreet, corporationName, date, sex, remarks
    handleFile: (input) => {
        const file = input.files && input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const data     = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const sheet    = workbook.Sheets[workbook.SheetNames[0]];
            const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

            if (jsonRows.length === 0) {
                adminShowNotification('The file has no rows to import.', 'error');
                input.value = '';
                return;
            }

            const mapped = jsonRows.map(r => ({
                businessName:    r.businessName    || r['Business Name']    || '',
                ownerFirst:      r.ownerFirst      || r['Owner First']      || '',
                ownerMiddle:     r.ownerMiddle     || r['Owner Middle']     || '',
                ownerLast:       r.ownerLast       || r['Owner Last']       || '',
                permitNo:        r.permitNo        || r['Permit No']        || '',
                barangay:        r.barangay        || r['Barangay']         || '',
                buildingStreet:  r.buildingStreet  || r['Building/Street']  || '',
                corporationName: r.corporationName || r['Corporation Name'] || '',
                date:            normalizeImportDate(r.date || r['Date']),
                sex:             r.sex             || r['Sex']              || '',
                remarks:         r.remarks         || r['Remarks']          || ''
            })).filter(r => r.businessName.trim() !== '');

            if (mapped.length === 0) {
                adminShowNotification('No valid rows found (Business Name is required).', 'error');
                input.value = '';
                return;
            }

            SanitaryImport.confirmAndSend(mapped, input);
        };
        reader.readAsArrayBuffer(file);
    },

    confirmAndSend: async (rows, input) => {
        const ok = confirm(`Import ${rows.length} historical record(s) into the database?`);
        if (!ok) { input.value = ''; return; }

        try {
            const res  = await fetch(`${API_BASE_URL}/import_sanitary.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rows })
            });
            const json = await res.json();

            if (json.success) {
                const { imported, skipped, failed } = json.data;
                let msg = `Imported ${imported} record(s).`;
                if (skipped > 0) msg += ` ${skipped} duplicate(s) skipped.`;
                if (failed.length > 0) msg += ` ${failed.length} row(s) failed.`;
                adminShowNotification(msg, failed.length ? 'error' : 'success');
                await SanitaryManager.render();
                Dashboard.updateStats();
            } else {
                adminShowNotification('Import failed: ' + (json.message || 'Unknown error'), 'error');
            }
        } catch (err) {
            console.error('Import error:', err);
            adminShowNotification('Import failed: could not reach server.', 'error');
        }

        input.value = '';
    }
};
// ==================== END HISTORICAL RECORDS BULK IMPORT ====================

// ==================== EXCEL EXPORT FUNCTIONS ====================
function exportReportsExcel() {
    const reports = DataStore.inspectionReports;
    if (!reports || reports.length === 0) {
        alert('No inspection reports to export.');
        return;
    }

    const rows = reports.map(r => ({
        'Report ID':      getSanitaryPermitNoForEstablishment(r.establishment || r.location),
        'Inspector':      r.inspector || '',
        'Establishment':  r.establishment || r.location || '',
        'Location':       r.location || '',
        'Date':           r.date || '',
        'Status':         r.status || '',
        'Complied':       (r.complied === true || r.complied === 'true') ? 'Yes' : 'No',
        'Recommendation': r.recommendation || ''
    }));

    const worksheet  = XLSX.utils.json_to_sheet(rows);
    const workbook   = XLSX.utils.book_new();

    // Set column widths
    worksheet['!cols'] = [
        { wch: 12 }, { wch: 22 }, { wch: 30 }, { wch: 25 },
        { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 40 }
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Inspection Reports');
    XLSX.writeFile(workbook, `inspection-reports-${new Date().toISOString().split('T')[0]}.xlsx`);
}
// ==================== END EXCEL EXPORT FUNCTIONS ====================

// ==================== ACTIVITY LOG MODULE ====================
const ActivityLog = {
    data: [],
    filtered: [],
    _showAll: false,

    load: async () => {
        try {
            // Load modules for filter dropdown
            const modResp = await fetch(`${API_BASE_URL}/activity_log.php?action=modules`);
            const modJson = await modResp.json();
            if (modJson.success && Array.isArray(modJson.data)) {
                const sel = document.getElementById('alFilterModule');
                if (sel) {
                    const current = sel.value;
                    sel.innerHTML = '<option value="">All Modules</option>';
                    modJson.data.forEach(m => {
                        sel.innerHTML += `<option value="${m}" ${m === current ? 'selected' : ''}>${m}</option>`;
                    });
                }
            }

            // Load summary
            const sumResp = await fetch(`${API_BASE_URL}/activity_log.php?action=summary`);
            const sumJson = await sumResp.json();
            if (sumJson.success) {
                const s = sumJson.data;
                document.getElementById('alTotalToday').textContent = s.todayCount || 0;
                const createAction = (s.byAction || []).find(a => a.action === 'CREATE');
                const updateAction = (s.byAction || []).find(a => a.action === 'UPDATE');
                const deleteAction = (s.byAction || []).find(a => a.action === 'DELETE');
                document.getElementById('alTotalCreate').textContent = createAction ? createAction.count : 0;
                document.getElementById('alTotalUpdate').textContent = updateAction ? updateAction.count : 0;
                document.getElementById('alTotalDelete').textContent = deleteAction ? deleteAction.count : 0;
            }

            // Load log entries
            ActivityLog.applyFilters();
        } catch (err) {
            console.error('Failed to load activity log:', err);
        }
    },

    applyFilters: async () => {
        ActivityLog._showAll = false;
        const params = new URLSearchParams();
        const module = document.getElementById('alFilterModule')?.value;
        const action = document.getElementById('alFilterAction')?.value;
        const user   = document.getElementById('alFilterUser')?.value;
        const from   = document.getElementById('alFilterFrom')?.value;
        const to     = document.getElementById('alFilterTo')?.value;

        if (module) params.set('module', module);
        if (action) params.set('action_type', action);
        if (user)   params.set('user', user);
        if (from)   params.set('from', from);
        if (to)     params.set('to', to);

        try {
            const resp = await fetch(`${API_BASE_URL}/activity_log.php?action=list&${params.toString()}`);
            const json = await resp.json();
            ActivityLog.data = json.success ? json.data : [];
            ActivityLog.render();
        } catch (err) {
            console.error('Failed to fetch activity log:', err);
            ActivityLog.data = [];
            ActivityLog.render();
        }
    },

    clearFilters: () => {
        document.getElementById('alFilterModule').value = '';
        document.getElementById('alFilterAction').value = '';
        document.getElementById('alFilterUser').value = '';
        document.getElementById('alFilterFrom').value = '';
        document.getElementById('alFilterTo').value = '';
        ActivityLog._showAll = false;
        ActivityLog.applyFilters();
    },
    showAll: () => {
        ActivityLog._showAll = true;
        ActivityLog.render();
    },

    render: () => {
        const tbody = document.getElementById('activityLogBody');
        if (!tbody) return;
        const logs = ActivityLog.data;
        const countEl = document.getElementById('al-count');
        const showAllBtn = document.getElementById('al-show-all-btn');

        if (!logs || logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#9ca3af;">No activity recorded yet</td></tr>';
            if (countEl) countEl.textContent = '';
            if (showAllBtn) showAllBtn.style.display = 'none';
            return;
        }

        const total = logs.length;
        const showing = ActivityLog._showAll ? total : Math.min(20, total);
        const displayed = logs.slice(0, showing);
        if (countEl) countEl.textContent = `Showing ${showing} of ${total} entries`;
        if (showAllBtn) showAllBtn.style.display = showing < total ? '' : 'none';

        const actionColors = {
            'CREATE':  { bg: '#dcfce7', color: '#16a34a' },
            'UPDATE':  { bg: '#dbeafe', color: '#2563eb' },
            'DELETE':  { bg: '#fef2f2', color: '#dc2626' },
            'LOGIN':   { bg: '#f0f9ff', color: '#0284c7' },
            'LOGOUT':  { bg: '#f5f5f5', color: '#737373' },
            'RESTORE': { bg: '#fefce8', color: '#ca8a04' },
            'IMPORT':  { bg: '#faf5ff', color: '#9333ea' },
            'EXPORT':  { bg: '#ecfdf5', color: '#059669' }
        };

        tbody.innerHTML = displayed.map(log => {
            const ac = actionColors[log.action] || { bg: '#f3f4f6', color: '#6b7280' };
            const ts = log.createdAt ? new Date(log.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
            return `<tr style="border-bottom:1px solid #f3f4f6;">
                <td style="padding:10px 14px;color:#374151;white-space:nowrap;">${ts}</td>
                <td style="padding:10px 14px;font-weight:600;color:#111827;">${Utils.esc(log.username) || ''}</td>
                <td style="padding:10px 14px;text-align:center;">
                    <span style="background:${ac.bg};color:${ac.color};padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;">${log.action}</span>
                </td>
                <td style="padding:10px 14px;color:#6b7280;">${Utils.esc(log.module) || ''}</td>
                <td style="padding:10px 14px;color:#374151;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Utils.esc(log.recordLabel) || ''}">${Utils.esc(log.recordLabel) || '-'}</td>
                <td style="padding:10px 14px;color:#6b7280;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Utils.esc(log.details) || ''}">${Utils.esc(log.details) || '-'}</td>
                <td style="padding:10px 14px;color:#9ca3af;font-size:11px;">${Utils.esc(log.ipAddress) || ''}</td>
            </tr>`;
        }).join('');
    },

    exportCSV: () => {
        const logs = ActivityLog.data;
        if (!logs || logs.length === 0) {
            alert('No activity log data to export.');
            return;
        }
        const headers = ['Timestamp', 'User', 'Action', 'Module', 'Record', 'Details', 'IP Address'];
        const rows = logs.map(l => [
            l.createdAt || '',
            l.username || '',
            l.action || '',
            l.module || '',
            l.recordLabel || '',
            l.details || '',
            l.ipAddress || ''
        ]);
        const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `activity-log-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
};
// ==================== END ACTIVITY LOG MODULE ====================

// ==================== NOTIFICATION RUNNER MODULE ====================
const NotificationRunner = {
    status: null,

    checkStatus: async () => {
        try {
            const resp = await fetch(`${API_BASE_URL}/notification_runner.php?action=status`);
            const json = await resp.json();
            if (json.success) {
                NotificationRunner.status = json.data;
                NotificationRunner.renderStatus();
            }
        } catch (err) {
            console.warn('Notification status check failed:', err);
        }
    },

    renderStatus: () => {
        const s = NotificationRunner.status;
        if (!s) return;

        const textEl = document.getElementById('notifStatusText');
        const badgeEl = document.getElementById('notifStatusBadge');
        const btnEl = document.getElementById('notifSendBtn');

        if (!textEl || !badgeEl) return;

        if (s.alreadySentToday) {
            textEl.textContent = `Sent ${s.sentToday} reminder(s) today · ${s.pendingTomorrow} scheduled for tomorrow`;
            badgeEl.textContent = 'SENT TODAY';
            badgeEl.style.background = '#dcfce7';
            badgeEl.style.color = '#16a34a';
            if (btnEl) {
                btnEl.innerHTML = '<i class="fas fa-check" style="margin-right:4px;"></i>Sent';
                btnEl.style.background = '#9ca3af';
            }
        } else if (s.pendingTomorrow > 0) {
            textEl.textContent = `${s.pendingTomorrow} inspection(s) scheduled for tomorrow · Not yet sent`;
            badgeEl.textContent = 'PENDING';
            badgeEl.style.background = '#fef2f2';
            badgeEl.style.color = '#dc2626';
            if (btnEl) {
                btnEl.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:4px;"></i>Send Reminders Now';
                btnEl.style.background = '#0284c7';
            }
        } else {
            textEl.textContent = `No inspections scheduled for tomorrow`;
            badgeEl.textContent = 'NO SCHEDULE';
            badgeEl.style.background = '#f3f4f6';
            badgeEl.style.color = '#6b7280';
            if (btnEl) {
                btnEl.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:4px;"></i>Send Reminders Now';
                btnEl.style.background = '#9ca3af';
            }
        }

        if (s.lastSentAt) {
            const lastTime = new Date(s.lastSentAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            textEl.textContent += ` · Last sent: ${lastTime}`;
        }
    },

    send: async () => {
        const btn = document.getElementById('notifSendBtn');
        if (btn) {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:4px;"></i>Sending...';
            btn.disabled = true;
        }

        try {
            const resp = await fetch(`${API_BASE_URL}/notification_runner.php?action=send`);
            const json = await resp.json();

            if (json.success) {
                const d = json.data;
                if (d.skipped) {
                    Utils.showToast('Reminders already sent today. Use force to resend.', 'warning');
                } else if (d.sent > 0) {
                    Utils.showToast(`Sent ${d.sent} email reminder(s) successfully!`);
                } else {
                    Utils.showToast(d.message || 'No reminders to send.', 'warning');
                }
                // Refresh status
                await NotificationRunner.checkStatus();
            } else {
                Utils.showToast('Failed to send reminders: ' + (json.message || 'Unknown error'), 'error');
            }
        } catch (err) {
            console.error('Send reminders failed:', err);
            Utils.showToast('Failed to send reminders. Check connection.', 'error');
        }

        if (btn) {
            btn.disabled = false;
            NotificationRunner.renderStatus();
        }
    },

    init: () => {
        NotificationRunner.checkStatus().then(() => {
            // Auto-send if there are pending notifications for tomorrow and none sent today
            const s = NotificationRunner.status;
            if (s && s.pendingTomorrow > 0 && !s.alreadySentToday) {
                NotificationRunner.send();
            }
        });
        // Refresh status every 5 minutes
        setInterval(() => NotificationRunner.checkStatus(), 300000);
    }
};
// ==================== END NOTIFICATION RUNNER MODULE ====================

// ==================== ANALYTICS EXPORT MODULE ====================
async function fetchAnalyticsData(period = 'monthly') {
    const now = new Date();
    let url = `${API_BASE_URL}/export_analytics.php?period=${period}&year=${now.getFullYear()}&month=${now.getMonth() + 1}&quarter=${Math.ceil((now.getMonth() + 1) / 3)}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (!json.success) throw new Error(json.message || 'Failed to fetch analytics');
    return json.data;
}

async function exportAnalyticsPDF() {
    try {
        const data = await fetchAnalyticsData('monthly');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const pageWidth = 210;
        let y = 0;

        // Header
        doc.setFillColor(16, 108, 75);
        doc.rect(0, 0, pageWidth, 28, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('TAYABASCARE — ANALYTICS REPORT', 14, 16);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(`Period: ${data.periodLabel}  |  Generated: ${new Date().toLocaleString('en-PH')}`, 14, 23);

        y = 38;

        // Summary Stats
        doc.setTextColor(16, 108, 75);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('SUMMARY', 14, y);
        doc.setDrawColor(16, 108, 75);
        doc.line(14, y + 2, 196, y + 2);
        y += 10;

        doc.setTextColor(30, 30, 30);
        doc.setFontSize(10);
        const stats = [
            ['Total Establishments', data.totalEstablishments],
            ['Total Inspections (This Month)', data.totalInspections],
            ['Compliance Rate', data.complianceRate + '%']
        ];
        stats.forEach(([label, value]) => {
            doc.setFont('helvetica', 'bold');
            doc.text(label + ':', 14, y);
            doc.setFont('helvetica', 'normal');
            doc.text(String(value), 80, y);
            y += 7;
        });

        y += 6;

        // Top Violations
        doc.setTextColor(16, 108, 75);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('TOP VIOLATION TYPES', 14, y);
        doc.line(14, y + 2, 196, y + 2);
        y += 10;

        doc.setTextColor(30, 30, 30);
        doc.setFontSize(9);
        if (data.topViolations && data.topViolations.length > 0) {
            data.topViolations.forEach((v, i) => {
                doc.setFont('helvetica', 'normal');
                doc.text(`${i + 1}. ${v.type}`, 14, y);
                doc.setFont('helvetica', 'bold');
                doc.text(`${v.count} occurrence(s)`, 150, y);
                y += 6;
            });
        } else {
            doc.text('No violations recorded for this period.', 14, y);
            y += 6;
        }

        y += 6;

        // Inspector Productivity
        doc.setTextColor(16, 108, 75);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('INSPECTOR PRODUCTIVITY', 14, y);
        doc.line(14, y + 2, 196, y + 2);
        y += 10;

        // Table header
        doc.setFillColor(249, 250, 251);
        doc.rect(14, y - 4, 182, 8, 'F');
        doc.setTextColor(107, 114, 128);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text('INSPECTOR', 16, y);
        doc.text('TOTAL', 110, y);
        doc.text('COMPLIED', 135, y);
        doc.text('NOT COMPLIED', 160, y);
        y += 8;

        doc.setTextColor(30, 30, 30);
        doc.setFont('helvetica', 'normal');
        if (data.inspectorProductivity && data.inspectorProductivity.length > 0) {
            data.inspectorProductivity.forEach(ip => {
                if (y > 270) { doc.addPage(); y = 20; }
                doc.text(ip.inspector_name || '', 16, y);
                doc.text(String(ip.total || 0), 115, y);
                doc.text(String(ip.complied || 0), 140, y);
                doc.text(String(ip.not_complied || 0), 168, y);
                y += 6;
            });
        } else {
            doc.text('No inspector data for this period.', 16, y);
            y += 6;
        }

        y += 6;

        // Barangay Breakdown
        if (y > 240) { doc.addPage(); y = 20; }
        doc.setTextColor(16, 108, 75);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('ESTABLISHMENTS BY BARANGAY', 14, y);
        doc.line(14, y + 2, 196, y + 2);
        y += 10;

        doc.setTextColor(30, 30, 30);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        if (data.barangayBreakdown && data.barangayBreakdown.length > 0) {
            data.barangayBreakdown.slice(0, 20).forEach(b => {
                if (y > 270) { doc.addPage(); y = 20; }
                doc.text(b.barangay || 'Unknown', 16, y);
                doc.text(`${b.count} establishment(s)`, 120, y);
                y += 6;
            });
        } else {
            doc.text('No barangay data available.', 16, y);
        }

        // Footer
        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFillColor(16, 108, 75);
            doc.rect(0, 287, pageWidth, 10, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(7);
            doc.text('TayabasCare — City Health Office, Tayabas City', 14, 293);
            doc.text(`Page ${i} of ${pageCount}`, 170, 293);
        }

        doc.save(`tayabascare-analytics-${data.periodLabel.replace(/\s+/g, '-').toLowerCase()}.pdf`);
        Utils.showToast('Analytics PDF exported successfully');
    } catch (err) {
        console.error('PDF export failed:', err);
        Utils.showToast('Failed to export PDF: ' + err.message, 'error');
    }
}

async function exportAnalyticsExcel() {
    try {
        const data = await fetchAnalyticsData('monthly');
        const workbook = XLSX.utils.book_new();

        // Sheet 1: Summary
        const summaryRows = [
            ['TayabasCare Analytics Report'],
            ['Period', data.periodLabel],
            ['Generated', new Date().toLocaleString('en-PH')],
            [''],
            ['Metric', 'Value'],
            ['Total Establishments', data.totalEstablishments],
            ['Total Inspections', data.totalInspections],
            ['Compliance Rate', data.complianceRate + '%']
        ];
        const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
        ws1['!cols'] = [{ wch: 25 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(workbook, ws1, 'Summary');

        // Sheet 2: Risk Prescriptions (from existing PredictionEngine data)
        if (PredictionEngine.results && PredictionEngine.results.length > 0) {
            const riskRows = PredictionEngine.results.map(r => ({
                'Business Name': r.businessName || '',
                'Barangay': r.barangay || '',
                'Risk Level': r.riskLevel || '',
                'Score': r.totalScore || 0,
                'Violations': r.factors?.violations?.count ?? 0,
                'Compliance Rate': (r.factors?.compliance?.rate ?? '') + '%',
                'Last Inspected': r.lastInspected || 'Never'
            }));
            const ws2 = XLSX.utils.json_to_sheet(riskRows);
            ws2['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 15 }, { wch: 15 }];
            XLSX.utils.book_append_sheet(workbook, ws2, 'Risk Prescriptions');
        }

        // Sheet 3: Top Violations
        if (data.topViolations && data.topViolations.length > 0) {
            const violRows = data.topViolations.map(v => ({
                'Violation Type': v.type,
                'Count': v.count
            }));
            const ws3 = XLSX.utils.json_to_sheet(violRows);
            ws3['!cols'] = [{ wch: 35 }, { wch: 10 }];
            XLSX.utils.book_append_sheet(workbook, ws3, 'Top Violations');
        }

        // Sheet 4: Inspector Productivity
        if (data.inspectorProductivity && data.inspectorProductivity.length > 0) {
            const inspRows = data.inspectorProductivity.map(ip => ({
                'Inspector': ip.inspector_name || '',
                'Total Inspections': ip.total || 0,
                'Complied': ip.complied || 0,
                'Not Complied': ip.not_complied || 0,
                'Compliance Rate': ip.total > 0 ? Math.round(ip.complied / ip.total * 100) + '%' : 'N/A'
            }));
            const ws4 = XLSX.utils.json_to_sheet(inspRows);
            ws4['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
            XLSX.utils.book_append_sheet(workbook, ws4, 'Inspector Productivity');
        }

        // Sheet 5: Barangay Breakdown
        if (data.barangayBreakdown && data.barangayBreakdown.length > 0) {
            const bgyRows = data.barangayBreakdown.map(b => ({
                'Barangay': b.barangay || 'Unknown',
                'Establishments': b.count || 0
            }));
            const ws5 = XLSX.utils.json_to_sheet(bgyRows);
            ws5['!cols'] = [{ wch: 25 }, { wch: 15 }];
            XLSX.utils.book_append_sheet(workbook, ws5, 'Barangay Breakdown');
        }

        // Sheet 6: Monthly Trend
        if (data.monthlyTrend && data.monthlyTrend.length > 0) {
            const trendRows = data.monthlyTrend.map(t => ({
                'Month': t.month || '',
                'Total': t.total || 0,
                'Complied': t.complied || 0,
                'Not Complied': t.not_complied || 0
            }));
            const ws6 = XLSX.utils.json_to_sheet(trendRows);
            ws6['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }];
            XLSX.utils.book_append_sheet(workbook, ws6, 'Monthly Trend');
        }

        XLSX.writeFile(workbook, `tayabascare-analytics-${new Date().toISOString().split('T')[0]}.xlsx`);
        Utils.showToast('Analytics Excel exported successfully');
    } catch (err) {
        console.error('Excel export failed:', err);
        Utils.showToast('Failed to export Excel: ' + err.message, 'error');
    }
}
// ==================== END ANALYTICS EXPORT MODULE ====================

// ==================== ADMIN INSPECTION HISTORY MODULE ====================

let _adminIHAllReports = [];
let _adminIHEstablishments = [];

async function adminLoadIHEstablishments() {
    const grid = document.getElementById('admin-ih-grid');
    if (!grid) return;
    grid.innerHTML = `<div style="text-align:center;padding:50px;color:#9ca3af;"><i class="fas fa-spinner fa-spin" style="font-size:22px;"></i><p style="margin-top:12px;">Loading...</p></div>`;

    try {
        const res = await fetch(`${API_BASE_URL}/inspection.php`);
        const json = await res.json();
        _adminIHAllReports = (json.success && Array.isArray(json.data)) ? json.data : [];
    } catch (e) {
        _adminIHAllReports = [];
    }

    const estabMap = {};
    _adminIHAllReports.forEach(r => {
        const name = (r.establishment || '').trim();
        if (!name) return;
        if (!estabMap[name]) {
            estabMap[name] = { name, barangay: r.location || 'N/A', count: 0, violations: 0, lastDate: null };
        }
        estabMap[name].count++;
        if (!r.complied) estabMap[name].violations++;
        const d = new Date(r.date || r.report_date || 0);
        if (!estabMap[name].lastDate || d > estabMap[name].lastDate) estabMap[name].lastDate = d;
    });

    _adminIHEstablishments = Object.values(estabMap).sort((a, b) => (b.lastDate || 0) - (a.lastDate || 0));
    adminRenderIHEstablishments(_adminIHEstablishments);
}

function adminRenderIHEstablishments(list) {
    const grid = document.getElementById('admin-ih-grid');
    const countEl = document.getElementById('admin-ih-count');
    const searchEl = document.getElementById('admin-ih-search');
    const q = (searchEl?.value || '').trim().toLowerCase();
    if (countEl) countEl.textContent = q ? `${list.length} matching establishments` : `Showing ${list.length} of ${_adminIHEstablishments.length} establishments`;
    if (!grid) return;

    if (list.length === 0) {
        grid.innerHTML = `<div style="text-align:center;padding:50px;color:#9ca3af;"><i class="fas fa-clipboard-list" style="font-size:40px;display:block;margin-bottom:12px;"></i><p>No establishments with inspection records found.</p></div>`;
        return;
    }

    grid.innerHTML = `<table class="data-table">
        <thead>
            <tr>
                <th>Establishment</th>
                <th>Barangay</th>
                <th>Total Inspections</th>
                <th>Violations</th>
                <th>Last Inspected</th>
                <th>Action</th>
            </tr>
        </thead>
        <tbody>
            ${list.map(e => {
                const lastInspected = e.lastDate ? e.lastDate.toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' }) : 'N/A';
                return `<tr>
                    <td style="font-weight:600;">${Utils.esc(e.name)}</td>
                    <td>${Utils.esc(e.barangay)}</td>
                    <td style="text-align:center;">${e.count}</td>
                    <td style="text-align:center;">
                        <span style="background:${e.violations > 0 ? '#fee2e2' : '#d1fae5'};color:${e.violations > 0 ? '#dc2626' : '#059669'};padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;">${e.violations}</span>
                    </td>
                    <td>${lastInspected}</td>
                    <td>
                        <button onclick="adminOpenIHDetail('${e.name.replace(/'/g, "\\'")}')"
                            style="background:#059669;color:#fff;border:none;padding:6px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
                            <i class="fas fa-history" style="margin-right:5px;"></i>View History
                        </button>
                    </td>
                </tr>`;
            }).join('')}
        </tbody>
    </table>`;
}

function adminFilterIHEstablishments() {
    const q = (document.getElementById('admin-ih-search')?.value || '').trim().toLowerCase();
    let filtered = q ? _adminIHEstablishments.filter(e => e.name.toLowerCase().includes(q) || e.barangay.toLowerCase().includes(q)) : _adminIHEstablishments;
    // Re-apply current sort
    const sortBy = document.getElementById('admin-ih-sort')?.value || 'recent';
    filtered = adminSortIHList(filtered, sortBy);
    const page = q ? { displayed: filtered, hasMore: false, remaining: 0 } : TablePaging.slice(filtered, 'admin-ih', 12);
    adminRenderIHEstablishments(page.displayed);
    if (page.hasMore) {
        const container = document.getElementById('admin-ih-list');
        if (container && !container.querySelector('.load-more-ih')) {
            container.insertAdjacentHTML('beforeend',
                `<div class="load-more-ih" style="text-align:center;padding:12px;">
                    <button type="button" class="btn btn-sm btn-outline" onclick="TablePaging.showMore('admin-ih', 12); adminFilterIHEstablishments();">Load more (${page.remaining} more)</button>
                </div>`);
        }
    }
}

function adminSortIHEstablishments() {
    const sortBy = document.getElementById('admin-ih-sort')?.value || 'recent';
    const q = (document.getElementById('admin-ih-search')?.value || '').trim().toLowerCase();
    let list = q ? _adminIHEstablishments.filter(e => e.name.toLowerCase().includes(q) || e.barangay.toLowerCase().includes(q)) : _adminIHEstablishments;
    list = adminSortIHList(list, sortBy);
    const page = q ? { displayed: list, hasMore: false, remaining: 0 } : TablePaging.slice(list, 'admin-ih', 12);
    adminRenderIHEstablishments(page.displayed);
    if (page.hasMore) {
        const container = document.getElementById('admin-ih-list');
        if (container && !container.querySelector('.load-more-ih')) {
            container.insertAdjacentHTML('beforeend',
                `<div class="load-more-ih" style="text-align:center;padding:12px;">
                    <button type="button" class="btn btn-sm btn-outline" onclick="TablePaging.showMore('admin-ih', 12); adminSortIHEstablishments();">Load more (${page.remaining} more)</button>
                </div>`);
        }
    }
}

function adminSortIHList(list, sortBy) {
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

async function adminOpenIHDetail(establishmentName) {
    document.getElementById('admin-ih-list').style.display = 'none';
    document.getElementById('admin-ih-detail').style.display = '';
    document.getElementById('admin-ih-detail-title').textContent = establishmentName;

    const name = establishmentName.trim().toLowerCase();
    const estab = _adminIHEstablishments.find(e => e.name.toLowerCase() === name);
    document.getElementById('admin-ih-detail-barangay').innerHTML = estab ? `<i class="fas fa-map-marker-alt" style="color:#059669;margin-right:5px;"></i>${estab.barangay}` : '';

    let combined = _adminIHAllReports.filter(r => (r.establishment || '').trim().toLowerCase() === name);

    // Fetch archived history records per report
    const allHistory = [];
    for (const r of combined) {
        if (r.id) {
            try {
                const hRes = await fetch(`${API_BASE_URL}/inspection.php?history_id=${r.id}`);
                const hJson = await hRes.json();
                if (hJson.success && Array.isArray(hJson.data) && hJson.data.length > 0) {
                    hJson.data.forEach(h => allHistory.push(h));
                }
            } catch (_) {}
        }
    }

    combined = [...combined, ...allHistory];
    combined.sort((a, b) => new Date(b.date || b.archived_at || 0) - new Date(a.date || a.archived_at || 0));

    if (combined.length === 0) {
        document.getElementById('admin-ih-tbody').innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#9ca3af;">No inspection history found.</td></tr>`;
        return;
    }

    const total = combined.length;
    const violations = combined.filter(r => !r.complied).length;
    const complied = combined.filter(r => r.complied).length;
    const rate = total > 0 ? Math.round((complied / total) * 100) : 0;

    document.getElementById('admin-ih-stats').innerHTML = `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;text-align:center;">
            <p style="font-size:26px;font-weight:800;color:#10b981;margin:0;">${total}</p>
            <p style="font-size:12px;color:#6b7280;margin:4px 0 0 0;">Total Inspections</p>
        </div>
        <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:10px;padding:14px;text-align:center;">
            <p style="font-size:26px;font-weight:800;color:#ef4444;margin:0;">${violations}</p>
            <p style="font-size:12px;color:#6b7280;margin:4px 0 0 0;">Violations</p>
        </div>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px;text-align:center;">
            <p style="font-size:26px;font-weight:800;color:#3b82f6;margin:0;">${complied}</p>
            <p style="font-size:12px;color:#6b7280;margin:4px 0 0 0;">Complied</p>
        </div>
        <div style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:14px;text-align:center;">
            <p style="font-size:26px;font-weight:800;color:#d97706;margin:0;">${rate}%</p>
            <p style="font-size:12px;color:#6b7280;margin:4px 0 0 0;">Compliance Rate</p>
        </div>`;

    document.getElementById('admin-ih-tbody').innerHTML = combined.map((r, i) => {
        const compliedStatus = r.complied === true || r.complied === 'true' || r.complied === 1;
        const dateStr = (r.date || r.archived_at) ? new Date(r.date || r.archived_at).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' }) : 'N/A';
        const fileCell = r.filePath
            ? `<a href="${API_BASE_URL}/download.php?path=${encodeURIComponent(r.filePath)}" class="btn btn-primary" style="padding:4px 10px;font-size:12px;"><i class="fas fa-download" style="margin-right:4px;"></i>${Utils.esc(r.file) || 'File'}</a>`
            : (r.file ? `<span style="font-size:12px;color:#9ca3af;">${Utils.esc(r.file)} (unavailable)</span>` : `<span style="font-size:12px;color:#d1d5db;">None</span>`);
        return `<tr>
            <td style="font-weight:600;">${i + 1}</td>
            <td>${dateStr}</td>
            <td style="max-width:220px;">${Utils.esc(r.remarks) || 'N/A'}</td>
            <td style="max-width:220px;">${Utils.esc(r.recommendation) || 'N/A'}</td>
            <td><span style="background:${compliedStatus ? '#d1fae5' : '#fee2e2'};color:${compliedStatus ? '#059669' : '#dc2626'};padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;">${compliedStatus ? '✓ Complied' : '✗ Violation'}</span></td>
            <td>${Utils.esc(r.inspector) || 'N/A'}</td>
            <td>${fileCell}</td>
        </tr>`;
    }).join('');
}

function adminIHBackToList() {
    document.getElementById('admin-ih-detail').style.display = 'none';
    document.getElementById('admin-ih-list').style.display = '';
}

// ==================== PATTERN ANALYSIS MODULE (Objective 2) ====================
const PatternAnalysis = {
    _catChart: null,
    _brgyChart: null,

    load: async () => {
        try {
            const [catRes, brgyRes, recRes] = await Promise.all([
                fetch(`${API_BASE_URL}/pattern_analysis.php?action=by_category`).then(r => r.json()),
                fetch(`${API_BASE_URL}/pattern_analysis.php?action=by_barangay`).then(r => r.json()),
                fetch(`${API_BASE_URL}/pattern_analysis.php?action=recurrence`).then(r => r.json())
            ]);

            if (catRes.success) PatternAnalysis.drawCategoryChart(catRes.data);
            if (brgyRes.success) PatternAnalysis.drawBarangayChart(brgyRes.data);
            if (recRes.success) PatternAnalysis.renderRecurrenceTable(recRes.data);
        } catch (err) {
            console.error('Pattern analysis failed:', err);
        }
    },

    drawCategoryChart: (data) => {
        const canvas = document.getElementById('patternCategoryChart');
        if (!canvas) return;
        if (PatternAnalysis._catChart) PatternAnalysis._catChart.destroy();

        const top = data.slice(0, 12);
        PatternAnalysis._catChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: top.map(d => d.category),
                datasets: [{
                    label: 'Violation Rate %',
                    data: top.map(d => d.violationRate),
                    backgroundColor: top.map(d => d.violationRate > 50 ? '#ef4444' : d.violationRate > 25 ? '#f59e0b' : '#10b981'),
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } }, x: { ticks: { maxRotation: 45, font: { size: 10 } } } }
            }
        });
    },

    drawBarangayChart: (data) => {
        const canvas = document.getElementById('patternBarangayChart');
        if (!canvas) return;
        if (PatternAnalysis._brgyChart) PatternAnalysis._brgyChart.destroy();

        const top = data.slice(0, 15);
        PatternAnalysis._brgyChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: top.map(d => d.barangay),
                datasets: [{
                    label: 'Total Violations',
                    data: top.map(d => d.totalViolations),
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true }, x: { ticks: { maxRotation: 45, font: { size: 10 } } } }
            }
        });
    },

    renderRecurrenceTable: (data) => {
        const container = document.getElementById('recurrenceTable');
        if (!container) return;
        if (!data || data.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#9ca3af;font-size:12px;padding:10px;">No recurrence data available</p>';
            return;
        }
        const top = data.slice(0, 15);
        container.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
                <th style="text-align:left;padding:8px 10px;color:#6b7280;font-weight:700;">Establishment</th>
                <th style="text-align:left;padding:8px 10px;color:#6b7280;font-weight:700;">Barangay</th>
                <th style="text-align:center;padding:8px 10px;color:#6b7280;font-weight:700;">Inspections</th>
                <th style="text-align:center;padding:8px 10px;color:#6b7280;font-weight:700;">Violations</th>
                <th style="text-align:center;padding:8px 10px;color:#6b7280;font-weight:700;">Recurrence %</th>
            </tr></thead>
            <tbody>${top.map(r => `<tr style="border-bottom:1px solid #f3f4f6;">
                <td style="padding:8px 10px;">${Utils.esc(r.establishment)}</td>
                <td style="padding:8px 10px;">${Utils.esc(r.barangay) || 'N/A'}</td>
                <td style="text-align:center;padding:8px 10px;">${r.totalInspections}</td>
                <td style="text-align:center;padding:8px 10px;">${r.totalViolations}</td>
                <td style="text-align:center;padding:8px 10px;"><span style="background:${r.recurrenceRate > 50 ? '#fee2e2' : '#fef3c7'};color:${r.recurrenceRate > 50 ? '#dc2626' : '#d97706'};padding:2px 8px;border-radius:10px;font-weight:700;">${r.recurrenceRate}%</span></td>
            </tr>`).join('')}</tbody></table>`;
    }
};

// ==================== YEAR-OVER-YEAR COMPARISON MODULE (Objective 5) ====================
const YoYComparison = {
    init: () => {
        const currentYear = new Date().getFullYear();
        const sel1 = document.getElementById('yoyYear1');
        const sel2 = document.getElementById('yoyYear2');
        if (!sel1 || !sel2) return;
        for (let y = currentYear; y >= currentYear - 5; y--) {
            sel1.innerHTML += `<option value="${y}" ${y === currentYear - 1 ? 'selected' : ''}>${y}</option>`;
            sel2.innerHTML += `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`;
        }
    },

    load: async () => {
        const year1 = document.getElementById('yoyYear1')?.value;
        const year2 = document.getElementById('yoyYear2')?.value;
        if (!year1 || !year2) return;

        try {
            const resp = await fetch(`${API_BASE_URL}/statistics.php?action=year_over_year&year1=${year1}&year2=${year2}`);
            const json = await resp.json();
            if (!json.success) return;

            const { years, changes } = json.data;
            const container = document.getElementById('yoyResults');
            if (!container) return;

            const metrics = [
                { key: 'totalInspections', label: 'Total Inspections', icon: 'fa-clipboard-list' },
                { key: 'complianceRate', label: 'Compliance Rate', icon: 'fa-check-circle' },
                { key: 'totalViolations', label: 'Violations', icon: 'fa-exclamation-triangle' }
            ];

            container.innerHTML = metrics.map(m => {
                const c = changes[m.key];
                const change = c.changePercent;
                const isPositive = m.key === 'complianceRate' ? change > 0 : (m.key === 'totalViolations' ? change < 0 : change > 0);
                const arrow = change > 0 ? '&#9650;' : change < 0 ? '&#9660;' : '&#9644;';
                const color = isPositive ? '#10b981' : change === 0 ? '#6b7280' : '#ef4444';
                return `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;text-align:center;">
                    <i class="fas ${m.icon}" style="color:#6b7280;font-size:18px;margin-bottom:8px;"></i>
                    <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">${m.label}</div>
                    <div style="display:flex;justify-content:center;gap:20px;margin:8px 0;">
                        <div><div style="font-size:18px;font-weight:700;color:#374151;">${c[year1]}</div><div style="font-size:10px;color:#9ca3af;">${year1}</div></div>
                        <div style="font-size:18px;color:#6b7280;">→</div>
                        <div><div style="font-size:18px;font-weight:700;color:#374151;">${c[year2]}</div><div style="font-size:10px;color:#9ca3af;">${year2}</div></div>
                    </div>
                    <div style="font-size:14px;font-weight:700;color:${color};">${arrow} ${Math.abs(change)}%</div>
                </div>`;
            }).join('');
        } catch (err) {
            console.error('YoY comparison failed:', err);
        }
    }
};

// ==================== INSPECTION IMPORT MODULE (Objective 1) ====================
const InspectionImport = {
    handleFile: async (input) => {
        const file = input.files[0];
        if (!file) return;
        input.value = '';

        if (typeof XLSX === 'undefined') {
            Utils.showToast('SheetJS library not loaded. Cannot import.', 'error');
            return;
        }

        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

            if (rows.length === 0) {
                Utils.showToast('No data rows found in file.', 'warning');
                return;
            }

            // Map column names
            const mapped = rows.map(row => ({
                establishment: row.establishment || row.Establishment || row.business_name || row['Business Name'] || '',
                inspectorName: row.inspectorName || row['Inspector Name'] || row.inspector || row.Inspector || '',
                reportDate: row.reportDate || row['Report Date'] || row.date || row.Date || '',
                recommendation: row.recommendation || row.Recommendation || '',
                remarks: row.remarks || row.Remarks || '',
                complied: row.complied || row.Complied || '',
                status: row.status || row.Status || 'Submitted',
                complianceDeadline: row.complianceDeadline || row['Compliance Deadline'] || row.deadline || ''
            })).filter(r => r.establishment);

            if (mapped.length === 0) {
                Utils.showToast('No valid rows found. Ensure the file has an "establishment" column.', 'warning');
                return;
            }

            const confirmed = confirm(`Import ${mapped.length} inspection report(s)?`);
            if (!confirmed) return;

            const resp = await fetch(`${API_BASE_URL}/import_inspections.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rows: mapped })
            });
            const result = await resp.json();

            if (result.success) {
                Utils.showToast(result.message || `Imported ${result.data.imported} report(s).`);
                if (result.data.failed && result.data.failed.length > 0) {
                    console.warn('Import failures:', result.data.failed);
                }
            } else {
                Utils.showToast('Import failed: ' + (result.message || 'Unknown error'), 'error');
            }
        } catch (err) {
            console.error('Import error:', err);
            Utils.showToast('Failed to parse file. Ensure it is a valid CSV/Excel file.', 'error');
        }
    }
};

// ==================== ESTABLISHMENT RISK TREND (Objective 2) ====================
const EstablishmentTrend = {
    _chart: null,

    show: async (establishmentName) => {
        try {
            const resp = await fetch(`${API_BASE_URL}/risk_history.php?action=establishment&name=${encodeURIComponent(establishmentName)}`);
            const json = await resp.json();

            if (!json.success || !json.data || json.data.length === 0) {
                Utils.showToast('No historical risk data for this establishment.', 'warning');
                return;
            }

            const container = document.getElementById('predDetailBody');
            if (!container) return;

            // Add trend chart section
            let trendSection = document.getElementById('estabTrendSection');
            if (!trendSection) {
                trendSection = document.createElement('div');
                trendSection.id = 'estabTrendSection';
                trendSection.style.cssText = 'margin-top:16px;padding-top:16px;border-top:1px solid #e5e7eb;';
                container.appendChild(trendSection);
            }

            trendSection.innerHTML = `
                <h4 style="font-size:14px;font-weight:600;color:#374151;margin:0 0 12px;">Risk Score Trend — ${establishmentName}</h4>
                <div style="position:relative;height:200px;"><canvas id="estabTrendChart"></canvas></div>
            `;

            const canvas = document.getElementById('estabTrendChart');
            if (EstablishmentTrend._chart) EstablishmentTrend._chart.destroy();

            const scores = json.data.reverse();
            EstablishmentTrend._chart = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: scores.map(s => new Date(s.recorded_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })),
                    datasets: [{
                        label: 'Risk Score',
                        data: scores.map(s => s.total_score),
                        borderColor: '#7c3aed',
                        backgroundColor: 'rgba(124,58,237,0.1)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4
                    }, {
                        label: 'HIGH Threshold',
                        data: scores.map(() => 60),
                        borderColor: '#ef4444',
                        borderDash: [5, 5],
                        pointRadius: 0,
                        fill: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true, max: 100 } },
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        } catch (err) {
            console.error('Risk trend failed:', err);
        }
    }
};

// ==================== INIT NEW MODULES ====================
document.addEventListener('DOMContentLoaded', () => {
    YoYComparison.init();
});