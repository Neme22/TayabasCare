/* ============================================================
 * import_common.js — shared bulk-import engine (inspector + admin)
 *
 * Client-side parsing (SheetJS for xlsx/xls/csv, mammoth for docx)
 * → preview modal → POST JSON rows to php/import_*.php.
 * CSRF is attached automatically by the fetch monkey-patch in
 * inspector.js / admin.js.
 * ============================================================ */
(function () {
    'use strict';

    // ---------------- helpers ----------------
    function escAny(v) {
        const s = String(v === null || v === undefined ? '' : v);
        if (typeof window.esc === 'function') return window.esc(s);
        if (window.Utils && typeof window.Utils.esc === 'function') return window.Utils.esc(s);
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function normKey(s) {
        return String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function str(v) {
        if (v === null || v === undefined) return '';
        if (v instanceof Date) return '';
        return String(v).trim();
    }

    function apiBase() {
        return (typeof API_BASE_URL !== 'undefined' && API_BASE_URL) ? API_BASE_URL : 'php';
    }

    function extOf(file) {
        const m = /\.([a-z0-9]+)$/i.exec(file.name || '');
        return m ? m[1].toLowerCase() : '';
    }

    const SHEET_EXTS = ['xlsx', 'xls', 'csv'];

    const MONTHS = {
        january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
        july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
    };

    function pad2(n) { return String(n).padStart(2, '0'); }

    // Date → 'YYYY-MM-DD' | '' (Date objects, Excel serials, many string formats)
    function normalizeDate(val) {
        if (val === null || val === undefined || val === '') return '';
        if (val instanceof Date && !isNaN(val)) {
            return `${val.getFullYear()}-${pad2(val.getMonth() + 1)}-${pad2(val.getDate())}`;
        }
        if (typeof val === 'number' && val > 20000 && val < 60000) {
            // Excel serial (1900 date system)
            const d = new Date(Date.UTC(1899, 11, 30) + Math.round(val) * 86400000);
            return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
        }
        const s = String(val).trim();
        if (!s) return '';
        let m;
        // YYYY-M-D[ ...]
        if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
            return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
        }
        // M/D/YYYY or D-M-YYYY etc.
        if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/))) {
            let a = +m[1], b = +m[2], y = +m[3], month, day;
            if (a > 12) { day = a; month = b; }          // must be DD/MM
            else if (b > 12) { month = a; day = b; }     // must be MM/DD
            else { month = a; day = b; }                 // ambiguous → MM/DD (Excel default)
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                return `${y}-${pad2(month)}-${pad2(day)}`;
            }
            return '';
        }
        // Month-name forms: "September 17, 2025"
        if ((m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/)) && MONTHS[m[1].toLowerCase()]) {
            return `${m[3]}-${pad2(MONTHS[m[1].toLowerCase()])}-${pad2(+m[2])}`;
        }
        const d = new Date(s);
        if (!isNaN(d)) {
            return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        }
        return '';
    }

    // '10:20 am' / '2:34 pm' → 'HH:MM' (24h) | ''
    function normalizeTime(val) {
        const m = String(val || '').match(/(\d{1,2}):(\d{2})\s*([ap]m)?/i);
        if (!m) return '';
        let h = +m[1];
        const ap = (m[3] || '').toLowerCase();
        if (ap === 'pm' && h < 12) h += 12;
        if (ap === 'am' && h === 12) h = 0;
        return `${pad2(h)}:${m[2]}`;
    }

    function normalizeSex(val) {
        const s = str(val).toUpperCase();
        if (s === 'M' || s === 'MALE') return 'Male';
        if (s === 'F' || s === 'FEMALE') return 'Female';
        return str(val);
    }

    function anyTruth(v) {
        return /^(ok|yes|y|true|1|pass|complied|x)$/i.test(String(v === null || v === undefined ? '' : v).trim());
    }

    function isDateLike(v) {
        if (v instanceof Date) return true;
        const s = String(v === null || v === undefined ? '' : v).trim();
        if (!s) return false;
        return /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})$/.test(s);
    }

    // 'KRISTEL ANN MAE L. JACELA' → {first:'KRISTEL ANN MAE', middle:'L.', last:'JACELA'}
    function splitPersonnelName(fullName) {
        const tokens = String(fullName || '').trim().split(/\s+/).filter(Boolean);
        if (!tokens.length) return { first: '', middle: '', last: '' };
        if (tokens.length === 1) return { first: tokens[0], middle: '', last: '' };
        let midIdx = -1;
        for (let i = 1; i < tokens.length - 1; i++) {
            if (/\.$/.test(tokens[i])) { midIdx = i; break; }
        }
        if (midIdx >= 0) {
            return {
                first: tokens.slice(0, midIdx).join(' '),
                middle: tokens[midIdx],
                last: tokens.slice(midIdx + 1).join(' ')
            };
        }
        return {
            first: tokens.slice(0, -1).join(' '),
            middle: '',
            last: tokens[tokens.length - 1]
        };
    }

    // ---------------- busy overlay (cross-page) ----------------
    function busy(message) {
        unbusy();
        const el = document.createElement('div');
        el.id = 'import-busy-overlay';
        // Above admin's dialog.modal z-index (999999) so the spinner shows over the open modal
        el.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[1000001]';
        el.innerHTML = `<div class="bg-white rounded-lg px-8 py-6 shadow-2xl flex items-center gap-3">
            <span class="loading loading-spinner loading-md text-emerald-600"></span>
            <span class="font-medium text-gray-700">${escAny(message || 'Working...')}</span>
        </div>`;
        document.body.appendChild(el);
    }
    function unbusy() {
        const el = document.getElementById('import-busy-overlay');
        if (el) el.remove();
    }

    // ---------------- header aliases ----------------
    // normalized alias → canonical field
    const SANITARY_ALIASES = {
        businessname: 'businessName', business: 'businessName', nameofbusiness: 'businessName',
        nameofestablishment: 'businessName', establishment: 'businessName',
        ownerfirst: 'ownerFirst', firstname: 'ownerFirst', owner: 'ownerFirst',
        ownermiddle: 'ownerMiddle', middlename: 'ownerMiddle', middleinitial: 'ownerMiddle',
        ownerlast: 'ownerLast', lastname: 'ownerLast', surname: 'ownerLast',
        permitno: 'permitNo', permit: 'permitNo', sanitarypermit: 'permitNo',
        barangay: 'barangay', barrio: 'barangay',
        buildingstreet: 'buildingStreet', address: 'buildingStreet',
        corporationname: 'corporationName', corporation: 'corporationName',
        date: 'date', recorddate: 'date',
        sex: 'sex', gender: 'sex',
        remarks: 'remarks', remark: 'remarks',
        no: 'no', recordno: 'no', seq: 'no', number: 'no',
        personnelno: 'personnelNo', numberofpersonnel: 'personnelNo',
        personnelname: 'personName', fullname: 'personName', nameofperson: 'personName',
        personnel: 'personnelList', personnellist: 'personnelList', staff: 'personnelList',
        resultxray: 'xray', xray: 'xray', resultofxray: 'xray',
        resultstool: 'stool', stool: 'stool', resultofstool: 'stool',
        businesstype: 'businessType'
    };
    const SANITARY_HEADER_KEYS = new Set(Object.keys(SANITARY_ALIASES));

    const INSPECTION_ALIASES = {
        establishment: 'establishment', businessname: 'establishment', business: 'establishment',
        inspectorname: 'inspectorName', inspector: 'inspectorName',
        reportdate: 'reportDate', dateofinspection: 'reportDate', date: 'reportDate',
        recommendation: 'recommendation', remarks: 'remarks', remark: 'remarks',
        complied: 'complied', status: 'status',
        compliancedeadline: 'complianceDeadline', deadline: 'complianceDeadline'
    };
    const INSPECTION_HEADER_KEYS = new Set(Object.keys(INSPECTION_ALIASES));

    const BURIAL_ALIASES = {
        deceased: 'deceased', nameofdeceased: 'deceased', name: 'deceased',
        deathdate: 'deathDate', dateofdeath: 'deathDate',
        deathplace: 'deathPlace', placeofdeath: 'deathPlace',
        causeofdeath: 'causeOfDeath', cause: 'causeOfDeath',
        age: 'age', informant: 'informant', inspector: 'inspector',
        sex: 'sex', gender: 'sex',
        origin: 'origin', transfer: 'transfer', funeral: 'funeral',
        ornumber: 'orNumber', or: 'orNumber',
        cemeteryorigin: 'cemeteryOrigin', cemeterytransfer: 'cemeteryTransfer',
        datetime: 'datetime', released: 'datetime', datetimecreated: 'datetime'
    };
    const BURIAL_HEADER_KEYS = new Set(Object.keys(BURIAL_ALIASES));

    function detectHeader(cells, keySet) {
        if (!Array.isArray(cells)) return false;
        return cells.some(c => keySet.has(normKey(c)));
    }

    // ---------------- file readers ----------------
    async function readSheetRows(file) {
        if (typeof XLSX === 'undefined') throw new Error('SheetJS library not loaded. Cannot parse spreadsheet.');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        return rows.filter(r => Array.isArray(r) && r.some(c => String(c === null || c === undefined ? '' : c).trim() !== ''));
    }

    function htmlTableToRows(table) {
        return Array.from(table.querySelectorAll('tr')).map(tr => {
            const out = [];
            Array.from(tr.children).forEach(cell => {
                const cs = parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
                const txt = (cell.textContent || '').replace(/\s+/g, ' ').trim();
                out.push(txt);
                for (let i = 1; i < cs; i++) out.push('');
            });
            return out;
        });
    }

    async function readDocxTables(file) {
        if (typeof mammoth === 'undefined') throw new Error('mammoth.js library not loaded. Cannot parse DOCX.');
        const buf = await file.arrayBuffer();
        const res = await mammoth.convertToHtml({ arrayBuffer: buf });
        const doc = new DOMParser().parseFromString(res.value || '', 'text/html');
        const tables = Array.from(doc.querySelectorAll('table'));
        if (!tables.length) return [];
        const rows = tables.flatMap(htmlTableToRows);
        return rows.filter(r => r.some(c => String(c).trim() !== ''));
    }

    async function readDocxText(file) {
        if (typeof mammoth === 'undefined') throw new Error('mammoth.js library not loaded. Cannot parse DOCX.');
        const buf = await file.arrayBuffer();
        const res = await mammoth.extractRawText({ arrayBuffer: buf });
        return res.value || '';
    }

    // ---------------- sanitary parsing ----------------
    function mapSanitaryPositionalRows(rawRows) {
        const dataRows = rawRows.slice(1); // row 0 may be junk/noise in headerless exports
        // positional layout requires ≥9 columns with a business name in col7
        const checkRow = rawRows.length > 1 && String(rawRows[1][7] || '').trim() !== ''
            ? rawRows[1] : rawRows[0];
        if (!checkRow || checkRow.length < 9 || String(checkRow[7] || '').trim() === '') {
            throw new Error('Unrecognized layout — add a header row (e.g. businessName, barangay, permitNo, date, ...).');
        }
        // If row0 looked like data (not noise), include it
        const all = String(rawRows[0][7] || '').trim() !== '' ? rawRows : dataRows;
        return all.map(r => ({
            date: normalizeDate(r[0]),
            permitNo: str(r[1]),
            seq: str(r[2]),
            personName: str(r[3]),
            sex: normalizeSex(r[4]),
            xray: r[5],
            stool: r[6],
            businessName: str(r[7]),
            barangay: str(r[8]),
            remarks: isDateLike(r[9]) ? '' : str(r[9]),
            ownerFirst: '', ownerMiddle: '', ownerLast: '',
            buildingStreet: '', corporationName: '',
            personnelNo: '', personnelListRaw: null
        })).filter(r => r.businessName || r.personName || r.barangay);
    }

    function mapSanitaryHeaderRows(rawRows) {
        const header = rawRows[0].map(normKey);
        const canon = header.map(h => SANITARY_ALIASES[h] || '');
        return rawRows.slice(1).map(r => {
            const o = {};
            canon.forEach((f, i) => { if (f && o[f] === undefined) o[f] = r[i]; });
            return {
                date: normalizeDate(o.date),
                permitNo: str(o.permitNo),
                seq: str(o.no),
                personName: str(o.personName),
                sex: normalizeSex(o.sex),
                xray: o.xray,
                stool: o.stool,
                businessName: str(o.businessName),
                barangay: str(o.barangay),
                remarks: str(o.remarks),
                ownerFirst: str(o.ownerFirst),
                ownerMiddle: str(o.ownerMiddle),
                ownerLast: str(o.ownerLast),
                buildingStreet: str(o.buildingStreet),
                corporationName: str(o.corporationName),
                personnelNo: str(o.personnelNo),
                personnelListRaw: (o.personnelList === undefined || o.personnelList === '') ? null : o.personnelList
            };
        }).filter(r => r.businessName || r.personName || r.barangay);
    }

    function normalizePersonnelList(raw) {
        if (raw === null || raw === undefined || raw === '') return [];
        if (Array.isArray(raw)) {
            return raw.map(p => {
                if (p && typeof p === 'object') {
                    return {
                        first: str(p.first), middle: str(p.middle), last: str(p.last),
                        sex: normalizeSex(p.sex),
                        result: { xray: !!(p.result && p.result.xray), stool: !!(p.result && p.result.stool) }
                    };
                }
                const s = splitPersonnelName(p);
                return { first: s.first, middle: s.middle, last: s.last, sex: '', result: { xray: false, stool: false } };
            });
        }
        return String(raw).split(',').map(s => s.trim()).filter(Boolean).map(name => {
            const s = splitPersonnelName(name);
            return { first: s.first, middle: s.middle, last: s.last, sex: '', result: { xray: false, stool: false } };
        });
    }

    function groupSanitary(interRows) {
        const groups = [];
        const byKey = new Map();
        interRows.forEach((r, idx) => {
            const biz = r.businessName.trim();
            const brgy = r.barangay.trim();
            let g;
            if (biz) {
                const key = biz.toLowerCase() + '|' + brgy.toLowerCase();
                if (byKey.has(key)) {
                    g = byKey.get(key);
                } else {
                    g = makeGroup(biz, brgy);
                    byKey.set(key, g);
                    groups.push(g);
                }
            } else {
                // rows without a business name stay standalone so they show as errors
                g = makeGroup('', brgy);
                groups.push(g);
            }
            if (!g.date && r.date) g.date = r.date;
            if (!g.permitNo && r.permitNo) g.permitNo = r.permitNo;
            if (!g.no && r.seq) g.no = r.seq;
            if (!g.remarks && r.remarks) g.remarks = r.remarks;
            if (!g.ownerFirst && r.ownerFirst) g.ownerFirst = r.ownerFirst;
            if (!g.ownerMiddle && r.ownerMiddle) g.ownerMiddle = r.ownerMiddle;
            if (!g.ownerLast && r.ownerLast) g.ownerLast = r.ownerLast;
            if (!g.buildingStreet && r.buildingStreet) g.buildingStreet = r.buildingStreet;
            if (!g.corporationName && r.corporationName) g.corporationName = r.corporationName;
            if (!g.personnelNo && r.personnelNo) g.personnelNo = r.personnelNo;
            if (r.personName) {
                const s = splitPersonnelName(r.personName);
                g.persons.push({
                    first: s.first, middle: s.middle, last: s.last,
                    sex: r.sex,
                    result: { xray: anyTruth(r.xray), stool: anyTruth(r.stool) }
                });
            }
            if (anyTruth(r.xray)) g.resultXrayAny = true;
            if (anyTruth(r.stool)) g.resultStoolAny = true;
            if (r.personnelListRaw && !g.personnelListRaw) g.personnelListRaw = r.personnelListRaw;
        });
        return groups;

        function makeGroup(biz, brgy) {
            return {
                businessName: biz, barangay: brgy, date: '', permitNo: '', no: '',
                remarks: '', ownerFirst: '', ownerMiddle: '', ownerLast: '',
                buildingStreet: '', corporationName: '', personnelNo: '',
                persons: [], personnelListRaw: null,
                resultXrayAny: false, resultStoolAny: false
            };
        }
    }

    function buildSanitaryPayload(groups) {
        return groups.map(g => {
            const personnel = g.persons.length ? g.persons : normalizePersonnelList(g.personnelListRaw);
            const ownerFirst = g.ownerFirst || g.businessName;
            const payload = {
                date: g.date,
                permitNo: g.permitNo,
                businessName: g.businessName,
                barangay: g.barangay,
                buildingStreet: g.buildingStreet || 'N/A',
                corporationName: g.corporationName,
                ownerFirst: ownerFirst,
                ownerMiddle: g.ownerMiddle,
                ownerLast: g.ownerLast,
                sex: '',
                resultXray: g.resultXrayAny ? 1 : 0,
                resultStool: g.resultStoolAny ? 1 : 0,
                personnelNo: g.personnelNo || String(personnel.length),
                personnel: personnel,
                remarks: g.remarks
            };
            if (g.no) payload.no = g.no;

            let status = 'ok', issue = '';
            if (!payload.businessName) { status = 'error'; issue = 'Missing business name'; }
            else if (!payload.barangay) { status = 'error'; issue = 'Missing barangay'; }
            else if (!payload.date) { status = 'warn'; issue = 'Date missing — will default to today'; }
            return Object.assign({}, payload, {
                _status: status,
                _issue: issue,
                ownerDisplay: [payload.ownerFirst, payload.ownerLast].filter(Boolean).join(' ')
            });
        });
    }

    // ---------------- inspection parsing ----------------
    function mapInspectionRows(rawRows) {
        const header = rawRows[0].map(normKey);
        const canon = header.map(h => INSPECTION_ALIASES[h] || '');
        return rawRows.slice(1).map(r => {
            const o = {};
            canon.forEach((f, i) => { if (f && o[f] === undefined) o[f] = r[i]; });
            return {
                establishment: str(o.establishment),
                inspectorName: str(o.inspectorName),
                reportDate: normalizeDate(o.reportDate),
                recommendation: str(o.recommendation),
                remarks: str(o.remarks),
                complied: str(o.complied),
                status: str(o.status) || 'Submitted',
                complianceDeadline: normalizeDate(o.complianceDeadline)
            };
        }).filter(r => Object.values(r).some(v => v !== ''));
    }

    function classifyInspectionRows(rows) {
        return rows.map(r => {
            let status = 'ok', issue = '';
            if (!r.establishment) { status = 'error'; issue = 'Missing establishment'; }
            else if (!r.reportDate) { status = 'warn'; issue = 'Report date missing — will default to today'; }
            return Object.assign({}, r, { _status: status, _issue: issue });
        });
    }

    // ---------------- burial parsing ----------------
    function cleanSpace(s) {
        return String(s || '').replace(/\s+/g, ' ').replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, '').trim();
    }

    function stripPlacePrefix(s) {
        return cleanSpace(String(s || '').replace(/^\s*(?:City|Municipality|Town)\s+of\s+/i, ''));
    }

    function extractBurialInspector(text) {
        const idx = text.search(/Recommended\s+by:/i);
        if (idx < 0) return '';
        const after = text.slice(idx);
        const firstLine = after.split(/\n/)[0].replace(/Recommended\s+by:/i, '').trim();
        if (/[A-Za-z]/.test(firstLine)) return cleanSpace(firstLine);
        const lines = after.split(/\n/).slice(1);
        for (const line of lines) {
            const s = cleanSpace(line);
            if (s && /[A-Za-z]/.test(s)) return s;
        }
        return '';
    }

    function parseBurialBlock(blockText) {
        const t = String(blockText || '').replace(/\r/g, '');
        const rec = {
            deceased: '', deathDate: '', causeOfDeath: '', age: '', funeral: '',
            origin: '', transfer: '', inspector: '', datetime: '',
            sex: '', deathPlace: '', informant: '', orNumber: '',
            cemeteryOrigin: '', cemeteryTransfer: ''
        };

        // deceased / cause / age / death date — one anchored pattern, then fallbacks
        const died = t.match(/who\s+died\s+of\s+(.+?)\s+at\s+the\s+age\s+of\s+(\d+)\s*years?\s+old\s+on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/i);
        if (died) {
            rec.causeOfDeath = cleanSpace(died[1]);
            rec.age = died[2];
            rec.deathDate = normalizeDate(died[3]);
        } else {
            const c = t.match(/who\s+died\s+of\s+([^\n,]+)/i);
            if (c) rec.causeOfDeath = cleanSpace(c[1]);
            const a = t.match(/age\s+of\s+(\d+)/i);
            if (a) rec.age = a[1];
            const dd = t.match(/\bon\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4})\s+was\s+transferred/i)
                || t.match(/\bdied\s+on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/i);
            if (dd) rec.deathDate = normalizeDate(dd[1]);
        }

        // deceased name: text immediately before 'who died'
        const pre = t.match(/(.{0,220}?)\bwho\s+died\b/i);
        if (pre) {
            let name = pre[1];
            const ofIdx = name.lastIndexOf(' of ');
            name = ofIdx >= 0 ? name.slice(ofIdx + 4) : name;
            name = name.replace(/^This\s+is\s+to\s+certify\s+that\s+/i, '')
                       .replace(/^(?:the\s+)?(?:CADAVER|SKELETAL|SKELETON|REMAINS|HUMAN REMAINS)\s+/i, '');
            rec.deceased = cleanSpace(name);
        }

        // funeral home
        const f = t.match(/transferred\s+by\s+(.+?)\s+from\s+the\s+/i);
        if (f) rec.funeral = cleanSpace(f[1]);

        // origin municipality (from) + transfer "Prov | Muni" (to)
        const fromM = t.match(/\bfrom\s+the\s+(?:City|Municipality|Town)\s+of\s+([^,\n]+?),\s*Province\s+of\s+([A-Za-z\s]+?)(?=\s+to\s+the\s+|\s+for\s+|\n|\.|,|$)/i);
        const toM = t.match(/\bto\s+the\s+(?:City|Municipality|Town)\s+of\s+([^,\n]+?),\s*Province\s+of\s+([A-Za-z\s]+?)(?=\s+for\s+|\n|\.|,|$)/i);
        if (fromM) rec.origin = stripPlacePrefix(fromM[1]);
        if (toM) rec.transfer = `${cleanSpace(toM[2])} | ${stripPlacePrefix(toM[1])}`;

        rec.inspector = extractBurialInspector(t);

        // released date/time, else certificate Date + Time
        const rel = t.match(/Date\s*&\s*Time\s+Released:\s*([^\n\/]+?)\s*\/\s*([^\n]+?)(?:\n|$)/i);
        if (rel) {
            const d = normalizeDate(rel[1]);
            const tm = normalizeTime(rel[2]);
            rec.datetime = d ? (tm ? `${d} ${tm}` : d) : '';
        } else {
            const cd = t.match(/\bDate:\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
            const ct = t.match(/\bTime:\s*(\d{1,2}:\d{2}\s*[ap]m)/i);
            if (cd) {
                const d = normalizeDate(cd[1]);
                const tm = ct ? normalizeTime(ct[1]) : '';
                rec.datetime = d ? (tm ? `${d} ${tm}` : d) : '';
            }
        }

        return rec;
    }

    function parseBurialDocxText(rawText) {
        const text = String(rawText || '').replace(/\r/g, '');
        let blocks = text.split(/\bTO WHOM IT\s+(?:MAY|MY)\s+CONCERN\b/i);
        if (blocks.length <= 1) blocks = text.split(/\b(?:CERTIFICATE|PERMIT)\s+OF\b/i);
        if (blocks.length > 1) blocks = blocks.slice(1);
        else blocks = [text];

        const rows = [];
        blocks.forEach(b => {
            if (!/[A-Za-z]{3}/.test(b)) return; // skip noise
            const rec = parseBurialBlock(b);
            let status = 'ok', issue = '';
            if (!rec.deceased) { status = 'error'; issue = 'Deceased name not found'; }
            else if (!rec.deathDate) { status = 'warn'; issue = 'Death date not found — left blank'; }
            rows.push(Object.assign({}, rec, { _status: status, _issue: issue }));
        });
        return rows;
    }

    function mapBurialSheetRows(rawRows) {
        const header = rawRows[0].map(normKey);
        const canon = header.map(h => BURIAL_ALIASES[h] || '');
        return rawRows.slice(1).map(r => {
            const o = {};
            canon.forEach((f, i) => { if (f && o[f] === undefined) o[f] = r[i]; });
            return {
                deceased: str(o.deceased),
                deathDate: normalizeDate(o.deathDate),
                deathPlace: str(o.deathPlace),
                causeOfDeath: str(o.causeOfDeath),
                age: str(o.age),
                informant: str(o.informant),
                inspector: str(o.inspector),
                sex: normalizeSex(o.sex),
                origin: str(o.origin),
                transfer: str(o.transfer),
                funeral: str(o.funeral),
                orNumber: str(o.orNumber),
                cemeteryOrigin: str(o.cemeteryOrigin),
                cemeteryTransfer: str(o.cemeteryTransfer),
                datetime: str(o.datetime)
            };
        }).filter(r => Object.values(r).some(v => v !== ''));
    }

    // ---------------- public parse functions ----------------
    async function parseSanitaryFile(file) {
        const ext = extOf(file);
        let rawRows;
        if (SHEET_EXTS.includes(ext)) rawRows = await readSheetRows(file);
        else if (ext === 'docx') rawRows = await readDocxTables(file);
        else throw new Error('Unsupported file type. Use .xlsx, .xls, .csv or .docx.');
        if (!rawRows.length) return { rows: [], validRows: [] };

        const useHeader = detectHeader(rawRows[0], SANITARY_HEADER_KEYS);
        const inter = useHeader ? mapSanitaryHeaderRows(rawRows) : mapSanitaryPositionalRows(rawRows);
        const rows = buildSanitaryPayload(groupSanitary(inter));
        return { rows, validRows: rows.filter(r => r._status !== 'error') };
    }

    async function parseInspectionFile(file) {
        const ext = extOf(file);
        let rawRows;
        if (SHEET_EXTS.includes(ext)) rawRows = await readSheetRows(file);
        else if (ext === 'docx') rawRows = await readDocxTables(file);
        else throw new Error('Unsupported file type. Use .xlsx, .xls, .csv or .docx.');
        if (!rawRows.length) return { rows: [], validRows: [] };

        if (!detectHeader(rawRows[0], INSPECTION_HEADER_KEYS)) {
            const rows = rawRows.slice(1).map(() => ({
                establishment: '', reportDate: '', inspectorName: '', status: '', complied: '',
                recommendation: '', remarks: '', complianceDeadline: '',
                _status: 'error', _issue: 'Unrecognized layout — add a header row (establishment, reportDate, ...)'
            }));
            return { rows, validRows: [] };
        }
        const rows = classifyInspectionRows(mapInspectionRows(rawRows));
        return { rows, validRows: rows.filter(r => r._status !== 'error') };
    }

    async function parseBurialFile(file) {
        const ext = extOf(file);
        let rows;
        if (ext === 'docx') {
            const text = await readDocxText(file);
            rows = parseBurialDocxText(text);
        } else if (SHEET_EXTS.includes(ext)) {
            const rawRows = await readSheetRows(file);
            if (!rawRows.length) return { rows: [], validRows: [] };
            if (!detectHeader(rawRows[0], BURIAL_HEADER_KEYS)) {
                return {
                    rows: rawRows.slice(1).map(() => ({
                        deceased: '', deathDate: '', _status: 'error',
                        _issue: 'Unrecognized layout — add a header row (deceased, deathDate, ...)'
                    })),
                    validRows: []
                };
            }
            rows = mapBurialSheetRows(rawRows).map(r => {
                let status = 'ok', issue = '';
                if (!r.deceased) { status = 'error'; issue = 'Missing deceased name'; }
                else if (!r.deathDate) { status = 'warn'; issue = 'Death date missing — left blank'; }
                return Object.assign({}, r, { _status: status, _issue: issue });
            });
        } else {
            throw new Error('Unsupported file type. Use .docx, .xlsx, .xls or .csv.');
        }
        return { rows, validRows: rows.filter(r => r._status !== 'error') };
    }

    // ---------------- preview modal controller ----------------
    const PREVIEW_ROW_LIMIT = 300;

    // The ONE import UI — injected once into whichever page uses it
    // (inspector.html and admin.html share this single definition).
    const DIALOG_HTML = `
    <dialog id="import-preview-modal" class="modal">
        <div class="modal-box w-11/12 max-w-5xl">
            <h3 class="font-bold text-lg mb-3" id="import-modal-title">Import</h3>

            <!-- Burial only: record type applies to the whole file -->
            <div id="import-type-row" class="mb-3 hidden">
                <label class="label">
                    <span class="label-text font-semibold">Record Type (applies to the whole file)</span>
                </label>
                <select id="import-type" class="select select-bordered select-success w-full">
                    <option value="cadaver" selected>Cadaver</option>
                    <option value="skeletal">Transfer of Skeletal</option>
                    <option value="exhumation">Exhumation</option>
                </select>
            </div>

            <!-- File picker -->
            <input type="file" id="import-file-input" data-testid="import-file-input"
                   class="file-input file-input-bordered file-input-success w-full"
                   accept=".xlsx,.xls,.csv,.docx" />

            <div class="flex items-center justify-between mt-3 mb-2">
                <div id="import-counts" class="text-sm font-medium" data-testid="import-counts">No file selected.</div>
                <div id="import-hint" class="text-xs opacity-60">Rows with errors are excluded from the import.</div>
            </div>

            <!-- Preview table -->
            <div class="overflow-auto max-h-96 border rounded-lg">
                <table class="table table-xs w-full">
                    <thead id="import-preview-head"></thead>
                    <tbody id="import-preview-body" data-testid="import-preview-body"></tbody>
                </table>
            </div>

            <div class="modal-action">
                <button class="btn" id="import-cancel-btn" data-testid="import-cancel-btn">Cancel</button>
                <button class="btn btn-success text-white" id="import-confirm-btn"
                        data-testid="import-confirm-btn" disabled>
                    <i class="fas fa-file-import mr-1"></i>Import
                </button>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop">
            <button>close</button>
        </form>
    </dialog>`;

    function ensureDialog() {
        if (document.getElementById('import-preview-modal')) return;
        const wrap = document.createElement('div');
        wrap.innerHTML = DIALOG_HTML.trim();
        document.body.appendChild(wrap.firstElementChild);
    }

    const ImportFlow = {
        _cfg: null,
        _rows: [],
        _valid: [],
        _bound: false,

        open(cfg) {
            ensureDialog();
            const modal = document.getElementById('import-preview-modal');
            if (!modal) { console.error('ImportFlow: failed to create #import-preview-modal'); return; }
            this._cfg = cfg;
            this._rows = [];
            this._valid = [];

            const title = document.getElementById('import-modal-title');
            if (title) title.textContent = cfg.title || 'Import';
            const fileInput = document.getElementById('import-file-input');
            if (fileInput) { fileInput.value = ''; fileInput.accept = cfg.accept || '.xlsx,.xls,.csv,.docx'; }

            const typeRow = document.getElementById('import-type-row');
            const typeSel = document.getElementById('import-type');
            if (typeRow && typeSel) {
                typeRow.classList.toggle('hidden', !cfg.typeSelect);
                if (cfg.typeSelect) typeSel.value = cfg.defaultType || 'cadaver';
            }

            const hint = document.getElementById('import-hint');
            if (hint) hint.textContent = 'Rows with errors are excluded from the import.';

            this._bindOnce();
            this._renderTable();
            this._updateCounts();
            modal.showModal();
        },

        close() {
            const modal = document.getElementById('import-preview-modal');
            if (modal && modal.open) modal.close();
            this._cfg = null;
            this._rows = [];
            this._valid = [];
            const fileInput = document.getElementById('import-file-input');
            if (fileInput) fileInput.value = '';
        },

        _bindOnce() {
            if (this._bound) return;
            this._bound = true;
            const fileInput = document.getElementById('import-file-input');
            if (fileInput) {
                fileInput.addEventListener('change', (e) => { this._onFile(e.target); });
            }
            const cancelBtn = document.getElementById('import-cancel-btn');
            if (cancelBtn) cancelBtn.addEventListener('click', () => this.close());
            const confirmBtn = document.getElementById('import-confirm-btn');
            if (confirmBtn) confirmBtn.addEventListener('click', () => this._onConfirm());
            const modal = document.getElementById('import-preview-modal');
            if (modal) {
                modal.addEventListener('close', () => {
                    this._cfg = null;
                    this._rows = [];
                    this._valid = [];
                });
            }
        },

        async _onFile(input) {
            const cfg = this._cfg;
            if (!cfg) return;
            const file = input.files && input.files[0];
            if (!file) return;
            busy('Reading file…');
            try {
                const parsed = await cfg.parseFile(file);
                this._rows = parsed.rows || [];
                this._valid = parsed.validRows || [];
                this._renderTable();
                this._updateCounts();
                if (!this._rows.length) {
                    cfg.notify('The file has no rows to import.', 'error');
                    input.value = '';
                }
            } catch (err) {
                console.error('Import parse error:', err);
                this._rows = [];
                this._valid = [];
                this._renderTable();
                this._updateCounts();
                cfg.notify(err.message || 'Failed to parse file.', 'error');
                input.value = '';
            } finally {
                unbusy();
            }
        },

        _renderTable() {
            const cfg = this._cfg;
            const head = document.getElementById('import-preview-head');
            const body = document.getElementById('import-preview-body');
            if (!head || !body) return;
            const columns = (cfg && cfg.columns) || [];
            head.innerHTML = columns.length
                ? `<tr>${columns.map(c => `<th>${escAny(c.label)}</th>`).join('')}</tr>`
                : '';
            if (!this._rows.length) {
                body.innerHTML = columns.length
                    ? `<tr><td colspan="${columns.length}" class="text-center opacity-60">No rows parsed yet — select a file above.</td></tr>`
                    : '';
                return;
            }
            const shown = this._rows.slice(0, PREVIEW_ROW_LIMIT);
            let html = shown.map(row => {
                const cls = row._status === 'error' ? 'bg-red-100'
                    : row._status === 'warn' ? 'bg-yellow-50' : '';
                const cells = columns.map(c => `<td>${escAny(row[c.key] === undefined || row[c.key] === null ? '' : row[c.key])}</td>`).join('');
                return `<tr class="${cls}">${cells}</tr>`;
            }).join('');
            if (this._rows.length > shown.length) {
                html += `<tr><td colspan="${columns.length}" class="text-center opacity-60">…and ${this._rows.length - shown.length} more row(s)</td></tr>`;
            }
            body.innerHTML = html;
        },

        _updateCounts() {
            const el = document.getElementById('import-counts');
            const confirmBtn = document.getElementById('import-confirm-btn');
            if (el) {
                if (!this._rows.length) {
                    el.innerHTML = '<span class="opacity-60">No file selected.</span>';
                } else {
                    const errors = this._rows.filter(r => r._status === 'error').length;
                    const warns = this._rows.filter(r => r._status === 'warn').length;
                    el.innerHTML =
                        `<span class="text-emerald-700 font-semibold">Ready: ${this._valid.length}</span>` +
                        `<span class="mx-2 opacity-40">·</span>` +
                        `<span class="text-red-600">Errors: ${errors}</span>` +
                        `<span class="mx-2 opacity-40">·</span>` +
                        `<span class="text-yellow-600">Warnings: ${warns}</span>`;
                }
            }
            if (confirmBtn) confirmBtn.disabled = this._valid.length === 0;
        },

        async _onConfirm() {
            const cfg = this._cfg;
            if (!cfg || !this._valid.length) return;
            const confirmBtn = document.getElementById('import-confirm-btn');
            if (confirmBtn) confirmBtn.disabled = true;
            busy('Importing…');
            try {
                const typeSel = document.getElementById('import-type');
                const state = { type: (typeSel && typeSel.value) || cfg.defaultType || 'cadaver' };
                const body = cfg.buildPayload(this._valid, state);
                const res = await fetch(`${apiBase()}/${cfg.endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const json = await res.json();
                if (json.success) {
                    cfg.notify(json.message || 'Import successful.', 'success');
                    if (cfg.onSuccess) await cfg.onSuccess(json.data);
                    this.close();
                } else {
                    cfg.notify('Import failed: ' + (json.message || 'Unknown error'), 'error');
                    if (confirmBtn) confirmBtn.disabled = false;
                }
            } catch (err) {
                console.error('Import error:', err);
                cfg.notify('Import failed: could not reach server.', 'error');
                if (confirmBtn) confirmBtn.disabled = false;
            } finally {
                unbusy();
            }
        }
    };

    // ---------------- accomplishment parsing ----------------
    const ACC_ALIASES = (() => {
        const a = {
            inspector: 'inspector', inspectorname: 'inspector', name: 'inspector',
            month: 'month', mon: 'month',
            year: 'year', yr: 'year'
        };
        for (let i = 1; i <= 24; i++) {
            a['f' + i] = 'f' + i;
            a['field' + i] = 'f' + i;
            a[String(i)] = 'f' + i;
        }
        return a;
    })();
    const ACC_HEADER_KEYS = new Set(Object.keys(ACC_ALIASES));

    function parseAccMonth(val) {
        const s = str(val).toLowerCase();
        if (!s) return 0;
        if (MONTHS[s]) return MONTHS[s];
        const n = parseInt(s, 10);
        return (n >= 1 && n <= 12) ? n : 0;
    }

    function toCount(val) {
        if (val === null || val === undefined || val === '') return 0;
        const n = parseFloat(String(val).replace(/[^\d.-]/g, ''));
        return isNaN(n) || n < 0 ? 0 : Math.round(n);
    }

    function mapAccomplishmentRows(rawRows) {
        const header = rawRows[0].map(normKey);
        const canon = header.map(h => ACC_ALIASES[h] || '');
        return rawRows.slice(1).map(r => {
            const o = {};
            canon.forEach((f, i) => { if (f && o[f] === undefined) o[f] = r[i]; });
            const fields = [];
            for (let i = 1; i <= 24; i++) fields.push(toCount(o['f' + i]));
            const month = parseAccMonth(o.month);
            const year = parseInt(str(o.year), 10);
            return {
                inspector: str(o.inspector),
                month,
                year: (year >= 2000 && year <= 2099) ? year : 0,
                fields,
                _status: 'ok',
                _issue: ''
            };
        }).map(r => {
            if (!r.inspector) { r._status = 'error'; r._issue = 'Missing inspector name'; }
            else if (!r.month) { r._status = 'error'; r._issue = 'Missing or invalid month'; }
            else if (!r.year) { r._status = 'error'; r._issue = 'Missing or invalid year'; }
            return r;
        }).filter(r => r.inspector || r.month || r.year || r.fields.some(v => v));
    }

    async function parseAccomplishmentFile(file) {
        const ext = extOf(file);
        let rawRows;
        if (SHEET_EXTS.includes(ext)) rawRows = await readSheetRows(file);
        else if (ext === 'docx') rawRows = await readDocxTables(file);
        else throw new Error('Unsupported file type. Use .xlsx, .xls, .csv or .docx.');
        if (!rawRows.length) return { rows: [], validRows: [] };
        if (!detectHeader(rawRows[0], ACC_HEADER_KEYS)) {
            return {
                rows: rawRows.slice(1).map(() => ({
                    inspector: '', month: 0, year: 0, fields: [],
                    _status: 'error', _issue: 'Unrecognized layout — add a header row (inspector, month, year, f1, f2, … f24)'
                })),
                validRows: []
            };
        }
        const rows = mapAccomplishmentRows(rawRows);
        return { rows, validRows: rows.filter(r => r._status !== 'error') };
    }

    window.ImportFlow = ImportFlow;
    // Exposed for reuse/testing
    window.ImportFlow.parseSanitaryFile = parseSanitaryFile;
    window.ImportFlow.parseInspectionFile = parseInspectionFile;
    window.ImportFlow.parseBurialFile = parseBurialFile;
    window.ImportFlow.parseAccomplishmentFile = parseAccomplishmentFile;
    window.ImportFlow.normalizeDate = normalizeDate;
    window.ImportFlow.splitPersonnelName = splitPersonnelName;
})();
