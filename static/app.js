// Manhattan Latency Analyzer Frontend Application Logic

let chartBreakdownInstance = null;
let chartTimelineInstance = null;
let chartPhaseBarInstance = null;

let autoRefreshTimer = null;
const REFRESH_INTERVAL_MS = 4000;

document.addEventListener('DOMContentLoaded', () => {
    try { initLucideIcons(); } catch (e) { console.warn("Lucide init warning:", e); }
    try { initCharts(); } catch (e) { console.warn("Charts init warning:", e); }
    try { setupEventListeners(); } catch (e) { console.error("setupEventListeners error:", e); }
    try { loadConfig(); } catch (e) { console.error("loadConfig error:", e); }
    try { fetchLocations(); } catch (e) { console.error("fetchLocations error:", e); }
    try { fetchZones(); } catch (e) { console.error("fetchZones error:", e); }
    try { refreshAllData(); } catch (e) { console.error("refreshAllData error:", e); }

    // Start auto-refresh polling
    if (!autoRefreshTimer) {
        autoRefreshTimer = setInterval(refreshAllData, REFRESH_INTERVAL_MS);
    }
});

function initLucideIcons() {
    if (typeof lucide !== "undefined" && lucide && typeof lucide.createIcons === "function") {
        try {
            lucide.createIcons();
        } catch (e) {
            console.warn("Error creando iconos Lucide:", e);
        }
    }
}

// Event Listeners setup
function setupEventListeners() {
    initHelpSystem();
    initLocationCustomDropdown();
    initZoneCustomDropdown();
    initSedesZonasImport();
    initSyncSedesButton();
    // General Auto-probe Stop / Resume Toggle Button
    const btnToggleAuto = document.getElementById('btnToggleAuto');
    if (btnToggleAuto) {
        btnToggleAuto.addEventListener('click', toggleAutoProbe);
    }

    // Manual Probe Trigger
    document.getElementById('btnProbeNow').addEventListener('click', runManualProbe);

    // Report System Triggers & Controls
    const btnOpenReport = document.getElementById('btnOpenReport');
    if (btnOpenReport) {
        btnOpenReport.addEventListener('click', async () => {
            openModal('reportModal');
            setReportPreset('today');
            await loadReportLocations();
            await fetchZones();
            await fetchAndRenderReport();
        });
    }

    const btnCloseReport = document.getElementById('btnCloseReport');
    if (btnCloseReport) btnCloseReport.addEventListener('click', () => closeModal('reportModal'));

    const btnCloseReportFooter = document.getElementById('btnCloseReportFooter');
    if (btnCloseReportFooter) btnCloseReportFooter.addEventListener('click', () => closeModal('reportModal'));

    const btnGenerateReport = document.getElementById('btnGenerateReport');
    if (btnGenerateReport) {
        btnGenerateReport.addEventListener('click', fetchAndRenderReport);
    }

    const btnPrintReport = document.getElementById('btnPrintReport');
    if (btnPrintReport) {
        btnPrintReport.addEventListener('click', () => window.print());
    }

    const presetGroup = document.getElementById('reportPresetGroup');
    if (presetGroup) {
        presetGroup.addEventListener('click', (e) => {
            const pill = e.target.closest('.preset-pill');
            if (pill) {
                const preset = pill.getAttribute('data-preset');
                setReportPreset(preset);
                fetchAndRenderReport();
            }
        });
    }

    const reportStartInput = document.getElementById('reportStartDate');
    const reportEndInput = document.getElementById('reportEndDate');
    if (reportStartInput) {
        reportStartInput.addEventListener('change', () => {
            document.querySelectorAll('.preset-pill').forEach(b => b.classList.remove('active'));
        });
    }
    if (reportEndInput) {
        reportEndInput.addEventListener('change', () => {
            document.querySelectorAll('.preset-pill').forEach(b => b.classList.remove('active'));
        });
    }
    const reportLocSelect = document.getElementById('reportLocationSelect');
    if (reportLocSelect) {
        reportLocSelect.addEventListener('change', async () => {
            await fetchZones();
            fetchAndRenderReport();
        });
    }

    // Network Diagnostics Trigger
    const btnNetDiag = document.getElementById('btnRunNetDiag');
    if (btnNetDiag) {
        btnNetDiag.addEventListener('click', runNetworkDiagnostic);
    }

    // Network Diagnostics History Select
    const historySelect = document.getElementById('netDiagHistorySelect');
    if (historySelect) {
        historySelect.addEventListener('change', (e) => {
            fetchNetDiag(e.target.value);
        });
    }

    // Active Zone Selector (Walkthrough Switcher)
    const activeZoneSel = document.getElementById('activeZoneSelect');
    if (activeZoneSel) {
        activeZoneSel.addEventListener('change', (e) => {
            changeActiveZone(e.target.value);
        });
    }

    // Quick Add Zone Button
    const btnQuickAddZone = document.getElementById('btnQuickAddZone');
    if (btnQuickAddZone) {
        btnQuickAddZone.addEventListener('click', quickAddZone);
    }

    // Filter Zone Select
    const filterZoneSel = document.getElementById('filterZoneSelect');
    if (filterZoneSel) {
        filterZoneSel.addEventListener('change', () => {
            refreshAllData();
        });
    }

    // Report Zone Select
    const reportZoneSel = document.getElementById('reportZoneSelect');
    if (reportZoneSel) {
        reportZoneSel.addEventListener('change', fetchAndRenderReport);
    }

    // Modal controls
    document.getElementById('btnOpenConfig').addEventListener('click', () => {
        openModal('configModal');
        renderConfiguredSedesList();
    });
    document.getElementById('btnCloseConfig').addEventListener('click', () => closeModal('configModal'));
    document.getElementById('btnCloseDetail').addEventListener('click', () => closeModal('detailModal'));

    // Config Save
    document.getElementById('btnSaveConfig').addEventListener('click', saveConfig);

    // Export Dropdown Controls (HTTP & ICMP)
    const btnExport = document.getElementById('btnExport');
    const exportDropdown = document.getElementById('exportDropdownMenu');
    const dropdownWrapper = btnExport ? btnExport.closest('.dropdown-wrapper') : null;

    if (btnExport && exportDropdown) {
        btnExport.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = exportDropdown.classList.toggle('show');
            if (dropdownWrapper) dropdownWrapper.classList.toggle('active', isOpen);
            initLucideIcons();
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.dropdown-wrapper')) {
                exportDropdown.classList.remove('show');
                if (dropdownWrapper) dropdownWrapper.classList.remove('active');
            }
        });

        // Handle export item clicks (All ZIP, ICMP CSV, HTTP CSV)
        document.querySelectorAll('.export-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const type = item.getAttribute('data-type') || 'all';
                const loc = document.getElementById('filterLocationSelect') ? document.getElementById('filterLocationSelect').value : null;
                const zone = document.getElementById('filterZoneSelect') ? document.getElementById('filterZoneSelect').value : null;
                
                let url = `/api/export?type=${encodeURIComponent(type)}`;
                if (loc && loc !== 'all') {
                    url += `&location=${encodeURIComponent(loc)}`;
                }
                if (zone && zone !== 'all') {
                    url += `&zone=${encodeURIComponent(zone)}`;
                }

                exportDropdown.classList.remove('show');
                if (dropdownWrapper) dropdownWrapper.classList.remove('active');
                
                window.location.href = url;
            });
        });
    }

    // Clear History
    document.getElementById('btnClearHistory').addEventListener('click', async () => {
        const loc = document.getElementById('filterLocationSelect').value;
        const zone = document.getElementById('filterZoneSelect') ? document.getElementById('filterZoneSelect').value : null;
        const isLocSpecific = loc && loc !== 'all';
        const isZoneSpecific = zone && zone !== 'all';

        let msg = '¿Está seguro de que desea eliminar los registros históricos';
        if (isLocSpecific && isZoneSpecific) {
            msg += ` de la sede "${loc}" en la zona "${zone}"?`;
        } else if (isLocSpecific) {
            msg += ` de la sede "${loc}"?`;
        } else if (isZoneSpecific) {
            msg += ` de la zona "${zone}" en todas las sedes?`;
        } else {
            msg += ' de todas las sedes?';
        }

        if (confirm(msg)) {
            try {
                let url = '/api/clear';
                const payload = {};
                const params = [];
                if (isLocSpecific) {
                    payload.location = loc;
                    params.push(`location=${encodeURIComponent(loc)}`);
                }
                if (isZoneSpecific) {
                    payload.zone = zone;
                    params.push(`zone=${encodeURIComponent(zone)}`);
                }
                if (params.length > 0) {
                    url += '?' + params.join('&');
                }
                await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                await fetchLocations();
                await fetchZones();
                refreshAllData();
            } catch (err) {
                alert('Error al borrar el histórico: ' + err);
            }
        }
    });

    // Filters Change
    document.getElementById('filterStatus').addEventListener('change', fetchHistory);
    document.getElementById('filterLocationSelect').addEventListener('change', async (e) => {
        const val = e.target.value;
        currentNetDiagRunId = 'latest';
        if (val && val !== 'all' && val !== currentActiveLocation) {
            await changeActiveLocation(val);
        } else {
            await fetchZones();
            refreshAllData();
        }
    });

    // Auth Toggle Event Listeners
    const chkAuth = document.getElementById('cfgAuthEnabled');
    const authFields = document.getElementById('authConfigFields');
    const selAuthType = document.getElementById('cfgAuthType');
    const tokenGrp = document.getElementById('tokenGroup');

    chkAuth.addEventListener('change', () => {
        authFields.style.display = chkAuth.checked ? 'flex' : 'none';
    });

    selAuthType.addEventListener('change', () => {
        tokenGrp.style.display = (selAuthType.value === 'bearer') ? 'block' : 'none';
    });

    // Close modal on click outside card
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal.id);
        });
    });
}

function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
}

// Update Auto-probe UI state (Button, dot, label, icon, config modal)
function updateAutoProbeUI(isEnabled) {
    const btnToggle = document.getElementById('btnToggleAuto');
    const label = document.getElementById('toggleAutoLabel');
    const dot = document.getElementById('toggleAutoDot');
    const iconSlot = document.getElementById('toggleAutoIconSlot');
    const cfgCheckbox = document.getElementById('cfgAutoEnabled');

    if (cfgCheckbox) {
        cfgCheckbox.checked = isEnabled;
    }

    if (btnToggle) {
        if (isEnabled) {
            btnToggle.classList.remove('paused');
            btnToggle.classList.add('active');
            btnToggle.title = 'Pruebas automáticas activas (Clic para detener)';
            if (label) label.textContent = 'Monitoreando';
            if (dot) dot.className = 'status-dot pulsing';
            if (iconSlot) iconSlot.innerHTML = '<i data-lucide="pause-circle" class="btn-inline-icon"></i>';
        } else {
            btnToggle.classList.remove('active');
            btnToggle.classList.add('paused');
            btnToggle.title = 'Pruebas automáticas pausadas (Clic para reanudar)';
            if (label) label.textContent = 'Pausado (Detenido)';
            if (dot) dot.className = 'status-dot';
            if (iconSlot) iconSlot.innerHTML = '<i data-lucide="play-circle" class="btn-inline-icon"></i>';
        }
        initLucideIcons();
    }
}

// Toggle Auto-probe execution
async function toggleAutoProbe() {
    const btnToggle = document.getElementById('btnToggleAuto');
    if (btnToggle) {
        btnToggle.style.pointerEvents = 'none';
        btnToggle.style.opacity = '0.65';
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const res = await fetch('/api/auto-probe/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        if (data && data.success) {
            updateAutoProbeUI(data.auto_probe_enabled);
        } else {
            throw new Error((data && data.error) || 'Respuesta inesperada del servidor');
        }
    } catch (err) {
        console.error('Error al conmutar monitoreo automático:', err);
        const errorMsg = (err.name === 'AbortError')
            ? 'El servidor no respondió a tiempo (timeout de 8s).'
            : err.message;
        alert(`⚠️ No se pudo conmutar el estado del monitoreo automático:\n${errorMsg}`);
    } finally {
        if (btnToggle) {
            btnToggle.style.pointerEvents = 'auto';
            btnToggle.style.opacity = '1';
        }
    }
}

// Fetch configuration from server
async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        const cfg = await res.json();
        
        document.getElementById('targetUrlBadge').textContent = cfg.target_url || 'https://alkop.sce.manh.com/ping';
        currentActiveLocation = cfg.location_name || 'Bodega_CLEN';
        const badge = document.getElementById('currentLocationBadge');
        if (badge) badge.textContent = currentActiveLocation;
        
        document.getElementById('cfgLocationName').value = currentActiveLocation;
        document.getElementById('cfgTargetUrl').value = cfg.target_url || 'https://alkop.sce.manh.com/ping';
        document.getElementById('cfgInterval').value = cfg.interval_seconds || '10';
        document.getElementById('cfgTimeout').value = cfg.timeout_seconds || '5';
        document.getElementById('cfgAutoEnabled').checked = (cfg.auto_probe_enabled === '1');

        // Authentication fields
        const isAuthEnabled = (cfg.auth_enabled === '1');
        document.getElementById('cfgAuthEnabled').checked = isAuthEnabled;
        document.getElementById('authConfigFields').style.display = isAuthEnabled ? 'flex' : 'none';

        document.getElementById('cfgAuthType').value = cfg.auth_type || 'ntlm';
        document.getElementById('cfgAuthDomain').value = cfg.auth_domain || '';
        document.getElementById('cfgAuthUser').value = cfg.auth_user || '';
        document.getElementById('cfgAuthPassword').value = cfg.auth_password || '';
        document.getElementById('cfgAuthToken').value = cfg.auth_token || '';

        document.getElementById('tokenGroup').style.display = ((cfg.auth_type || 'ntlm') === 'bearer') ? 'block' : 'none';

        // Extra ping targets & ICMP diagnostic frequency
        const extraTargetsEl = document.getElementById('cfgExtraTargets');
        if (extraTargetsEl) {
            extraTargetsEl.value = cfg.extra_ping_targets || '';
        }

        const excludedTargetsEl = document.getElementById('cfgExcludedTargets');
        if (excludedTargetsEl) {
            excludedTargetsEl.value = cfg.excluded_ping_targets || '';
        }

        const netDiagIntervalEl = document.getElementById('cfgNetDiagInterval');
        const netDiagMinutes = cfg.net_diag_interval_minutes || '15';
        if (netDiagIntervalEl) {
            netDiagIntervalEl.value = netDiagMinutes;
        }

        const netDiagSubtitleEl = document.getElementById('netDiagSubtitle');
        if (netDiagSubtitleEl) {
            netDiagSubtitleEl.textContent = `Análisis de latencia ICMP, pérdida de paquetes, jitter y saltos de enrutamiento (Automático cada ${netDiagMinutes} min o manual con Play)`;
        }

        const cfgCurrentZoneEl = document.getElementById('cfgCurrentZone');
        if (cfgCurrentZoneEl) {
            cfgCurrentZoneEl.value = cfg.current_zone || '';
        }

        const cfgLocZonesEl = document.getElementById('cfgLocationZones');
        if (cfgLocZonesEl) {
            let zonesMap = {};
            try {
                zonesMap = JSON.parse(cfg.zones_by_location || '{}');
            } catch (e) {
                zonesMap = {};
            }
            const currentLoc = cfg.location_name || 'Sede Principal';
            const locList = zonesMap[currentLoc] || ['Rack:1-2', 'Rack:3-4', 'Muelles:1-2', 'Mezanine', 'Bunker'];
            cfgLocZonesEl.value = locList.join(', ');
        }

        updateAutoProbeUI(cfg.auto_probe_enabled === '1');
    } catch (err) {
        console.error('Error cargando configuración:', err);
    }
}

// Save configuration to server
async function saveConfig() {
    const locationName = document.getElementById('cfgLocationName').value.trim() || 'Sede Principal';
    const currentZone = document.getElementById('cfgCurrentZone') ? document.getElementById('cfgCurrentZone').value.trim() : '';
    const locationZonesRaw = document.getElementById('cfgLocationZones') ? document.getElementById('cfgLocationZones').value.trim() : '';

    if (currentZone && currentZone.includes(',')) {
        alert('⚠️ El campo "Zona Activa del Recorrido" solo puede contener una (1) zona individual activa.\n\nSi deseas registrar múltiples zonas, ingrésalas separadas por coma (,) en el campo "Zonas Predefinidas".');
        return;
    }

    // Split multiple comma-separated zones, trim each, and deduplicate
    const locationZonesList = [];
    if (locationZonesRaw) {
        locationZonesRaw.split(',').forEach(item => {
            const clean = item.trim();
            if (clean && !locationZonesList.includes(clean)) {
                locationZonesList.push(clean);
            }
        });
    }

    const targetUrl = document.getElementById('cfgTargetUrl').value.trim();
    const interval = document.getElementById('cfgInterval').value;
    const timeout = document.getElementById('cfgTimeout').value;
    const autoEnabled = document.getElementById('cfgAutoEnabled').checked ? '1' : '0';

    const authEnabled = document.getElementById('cfgAuthEnabled').checked ? '1' : '0';
    const authType = document.getElementById('cfgAuthType').value;
    const authDomain = document.getElementById('cfgAuthDomain').value.trim();
    const authUser = document.getElementById('cfgAuthUser').value.trim();
    const authPassword = document.getElementById('cfgAuthPassword').value;
    const authToken = document.getElementById('cfgAuthToken').value.trim();
    const extraTargets = document.getElementById('cfgExtraTargets') ? document.getElementById('cfgExtraTargets').value.trim() : '';
    const excludedTargets = document.getElementById('cfgExcludedTargets') ? document.getElementById('cfgExcludedTargets').value.trim() : '';
    const netDiagInterval = document.getElementById('cfgNetDiagInterval') ? document.getElementById('cfgNetDiagInterval').value.trim() : '15';

    if (!targetUrl) {
        alert('Por favor ingrese una URL válida.');
        return;
    }

    try {
        let updatedMap = Object.assign({}, zonesByLocation);
        updatedMap[locationName] = locationZonesList;

        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                location_name: locationName,
                current_zone: currentZone,
                zones_by_location: JSON.stringify(updatedMap),
                target_url: targetUrl,
                interval_seconds: interval,
                timeout_seconds: timeout,
                auto_probe_enabled: autoEnabled,
                auth_enabled: authEnabled,
                auth_type: authType,
                auth_domain: authDomain,
                auth_user: authUser,
                auth_password: authPassword,
                auth_token: authToken,
                extra_ping_targets: extraTargets,
                excluded_ping_targets: excludedTargets,
                net_diag_interval_minutes: netDiagInterval || '15'
            })
        });

        closeModal('configModal');
        await loadConfig();
        await fetchLocations();
        await fetchZones();
        refreshAllData();
    } catch (err) {
        alert('Error al guardar configuración: ' + err);
    }
}

let currentActiveLocation = 'Bodega_CLEN';
let currentZone = '';
let zonesByLocation = {};

// Fetch list of zones and update active & filter selectors
async function fetchZones() {
    try {
        const filterLoc = document.getElementById('filterLocationSelect') ? document.getElementById('filterLocationSelect').value : null;
        let url = '/api/zones';
        if (filterLoc && filterLoc !== 'all') {
            url += `?location=${encodeURIComponent(filterLoc)}`;
        } else if (currentActiveLocation) {
            url += `?location=${encodeURIComponent(currentActiveLocation)}`;
        }
        const res = await fetch(url);
        if (!res.ok) {
            console.warn('API /api/zones devolvió status:', res.status);
            return;
        }
        const data = await res.json();

        currentZone = data.current_zone || '';
        zonesByLocation = data.zones_by_location || {};
        const zones = data.zones || [];

        // 1. Populate activeZoneSelect (Walkthrough switcher)
        const activeSel = document.getElementById('activeZoneSelect');
        if (activeSel) {
            const currentLoc = currentActiveLocation || (document.getElementById('currentLocationBadge') ? document.getElementById('currentLocationBadge').textContent.trim() : (document.getElementById('cfgLocationName') ? document.getElementById('cfgLocationName').value : 'Bodega_CLEN'));
            const locZones = zonesByLocation[currentLoc] || zones;
            
            const uniqueZones = Array.from(new Set([...(locZones || []), ...(currentZone ? [currentZone] : [])]));
            let activeHtml = '<option value="">(Sin Zona / General)</option>';
            uniqueZones.forEach(z => {
                if (!z) return;
                const isSel = (z === currentZone) ? 'selected' : '';
                activeHtml += `<option value="${z}" ${isSel}>📍 ${z}</option>`;
            });
            activeSel.innerHTML = activeHtml;
            activeSel.value = currentZone;

            // Render custom dropdown with adaptive height
            renderCustomZoneDropdown(uniqueZones, currentZone);
        }

        // 2. Populate filterZoneSelect (View filter)
        const filterSel = document.getElementById('filterZoneSelect');
        if (filterSel) {
            const curFilter = filterSel.value || 'all';
            let filterHtml = '<option value="all">Todas las Zonas</option>';
            filterHtml += '<option value="">(Sin Zona / General)</option>';
            zones.forEach(z => {
                if (!z) return;
                const isSel = (z === curFilter) ? 'selected' : '';
                filterHtml += `<option value="${z}" ${isSel}>${z}</option>`;
            });
            filterSel.innerHTML = filterHtml;
            if (curFilter === 'all' || zones.includes(curFilter) || curFilter === '') {
                filterSel.value = curFilter;
            }
        }

        // 3. Populate reportZoneSelect (Report filter)
        const reportSel = document.getElementById('reportZoneSelect');
        if (reportSel) {
            const curReportVal = reportSel.value || 'all';
            let rptHtml = '<option value="all">Todas las Zonas</option>';
            rptHtml += '<option value="">(Sin Zona / General)</option>';
            zones.forEach(z => {
                if (!z) return;
                const isSel = (z === curReportVal) ? 'selected' : '';
                rptHtml += `<option value="${z}" ${isSel}>${z}</option>`;
            });
            reportSel.innerHTML = rptHtml;
            if (curReportVal === 'all' || zones.includes(curReportVal) || curReportVal === '') {
                reportSel.value = curReportVal;
            }
        }
    } catch (err) {
        console.error('Error fetching zones:', err);
    }
}

// Change active zone on the fly during warehouse walkthrough
async function changeActiveZone(newZone) {
    try {
        const curLoc = currentActiveLocation || (document.getElementById('currentLocationBadge') ? document.getElementById('currentLocationBadge').textContent.trim() : (document.getElementById('cfgLocationName') ? document.getElementById('cfgLocationName').value : 'Bodega_CLEN'));
        
        // Optimistic UI update
        currentZone = newZone || '';
        const triggerText = document.getElementById('zoneTriggerText');
        if (triggerText) {
            triggerText.textContent = currentZone ? `📍 ${currentZone}` : '(Sin Zona / General)';
            triggerText.title = currentZone ? `Zona activa: ${currentZone}` : 'Sin Zona seleccionada (Muestras generales)';
        }

        const res = await fetch('/api/zones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'set_current',
                zone: currentZone,
                location: curLoc
            })
        });
        if (!res.ok) {
            if (res.status === 404) {
                alert('El servidor debe ser reiniciado para activar las zonas.\n\nPor favor presiona Ctrl+C en la consola donde corre la aplicación y vuelve a ejecutar: python app.py');
                return;
            }
            throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (data.success) {
            currentZone = data.current_zone || '';
            await fetchZones();
            refreshAllData();
        }
    } catch (err) {
        console.error('Error changing active zone:', err);
        showToast('Error al cambiar zona: ' + err.message, 'error');
    }
}

// Quick add zone for the current location (single zone only)
async function quickAddZone() {
    const curLoc = document.getElementById('cfgLocationName') ? document.getElementById('cfgLocationName').value : 'Sede Principal';
    const zoneName = prompt(`Ingresa el nombre de la nueva zona para el recorrido en "${curLoc}":\n(Ej: Habitación:302, Rack:5-6, Bunker, Mezanine)\n\n* Nota: Por medio de esta función rápida (+) solo se permite 1 sola zona para activarla en el recorrido.\nPara ingresar múltiples zonas separadas por coma (,), utiliza el menú "⚙️ Configuración".`);
    if (!zoneName || !zoneName.trim()) return;

    const trimmed = zoneName.trim();
    if (trimmed.includes(',')) {
        alert('⚠️ Por medio del botón de creación rápida (+) solo se permite el ingreso de un (1) solo registro a la vez para fijarlo de inmediato como zona activa.\n\nPara ingresar varias zonas separadas por coma (,), por favor abre el menú "⚙️ Configuración" en la barra superior y agrégalas en el campo "Zonas Predefinidas".');
        return;
    }

    try {
        const res = await fetch('/api/zones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'add_zone',
                zone: trimmed,
                location: curLoc,
                set_active: true
            })
        });
        if (!res.ok) {
            if (res.status === 404) {
                alert('El servidor debe ser reiniciado para activar las rutas de zonas.\n\nPor favor presiona Ctrl+C en la terminal donde corre la aplicación y vuelve a ejecutar:\npython app.py (en Windows) o python3 app.py (en Linux)');
                return;
            }
            let errDetail = `HTTP ${res.status}`;
            try {
                const errData = await res.json();
                if (errData && errData.error) errDetail = errData.error;
            } catch (e) {}
            throw new Error(errDetail);
        }
        const data = await res.json();
        if (data.success) {
            await fetchZones();
            refreshAllData();
        }
    } catch (err) {
        alert('Error al agregar nueva zona: ' + err.message);
    }
}

// ==========================================================================
// CUSTOM ZONE DROPDOWN COMPONENT (Adaptive Viewport Height)
// ==========================================================================

function initZoneCustomDropdown() {
    const trigger = document.getElementById('btnZoneDropdownTrigger');
    if (trigger) {
        trigger.addEventListener('click', toggleZoneDropdown);
    }

    const searchInput = document.getElementById('zoneSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterZoneDropdownItems(e.target.value);
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const list = document.getElementById('zoneDropdownList');
                if (list) {
                    const firstVisible = Array.from(list.querySelectorAll('.zone-dropdown-item')).find(el => el.style.display !== 'none');
                    if (firstVisible) {
                        selectCustomZone(firstVisible.getAttribute('data-value') || '');
                    }
                }
            } else if (e.key === 'Escape') {
                closeZoneDropdown();
            }
        });
    }

    // Close on click outside
    document.addEventListener('click', (e) => {
        const container = document.getElementById('zoneDropdownContainer');
        if (container && !container.contains(e.target)) {
            closeZoneDropdown();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeZoneDropdown();
        }
    });

    // Recalculate max-height on window resize or scroll
    window.addEventListener('resize', positionZoneDropdown);
    window.addEventListener('scroll', positionZoneDropdown, { passive: true });
}

function renderCustomZoneDropdown(zones, curZone) {
    const triggerText = document.getElementById('zoneTriggerText');
    const dropdownList = document.getElementById('zoneDropdownList');
    const searchWrapper = document.getElementById('zoneSearchWrapper');
    const searchInput = document.getElementById('zoneSearchInput');

    if (!triggerText || !dropdownList) return;

    // 1. Update trigger label
    if (curZone) {
        triggerText.textContent = `📍 ${curZone}`;
        triggerText.title = `Zona activa: ${curZone}`;
    } else {
        triggerText.textContent = '(Sin Zona / General)';
        triggerText.title = 'Sin Zona seleccionada (Muestras generales)';
    }

    // 2. Show search input if there are more than 6 zones
    if (searchWrapper) {
        searchWrapper.style.display = (zones && zones.length > 6) ? 'flex' : 'none';
        if (searchInput) searchInput.value = '';
    }

    // 3. Render items list
    let html = '';
    
    // Default option: "(Sin Zona / General)"
    const isGeneralSel = !curZone ? 'selected' : '';
    html += `
        <div class="zone-dropdown-item ${isGeneralSel}" data-value="" role="option" aria-selected="${!curZone}">
            <span>(Sin Zona / General)</span>
            <i data-lucide="check" class="zone-dropdown-item-check"></i>
        </div>
    `;

    // Each custom zone
    if (zones && zones.length > 0) {
        zones.forEach(z => {
            if (!z) return;
            const isSel = (z === curZone) ? 'selected' : '';
            html += `
                <div class="zone-dropdown-item ${isSel}" data-value="${z}" role="option" aria-selected="${z === curZone}">
                    <span>📍 ${z}</span>
                    <i data-lucide="check" class="zone-dropdown-item-check"></i>
                </div>
            `;
        });
    }

    dropdownList.innerHTML = html;
    initLucideIcons();

    // 4. Attach click handlers to items
    dropdownList.querySelectorAll('.zone-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            const val = item.getAttribute('data-value') || '';
            selectCustomZone(val);
        });
    });
}

function selectCustomZone(val) {
    const activeSel = document.getElementById('activeZoneSelect');
    if (activeSel) {
        activeSel.value = val;
        // Dispatch change event so existing listener calls changeActiveZone(val)
        activeSel.dispatchEvent(new Event('change'));
    }
    closeZoneDropdown();
}

function toggleZoneDropdown(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('zoneDropdownMenu');
    if (!menu) return;
    if (menu.style.display === 'none' || !menu.style.display) {
        openZoneDropdown();
    } else {
        closeZoneDropdown();
    }
}

function openZoneDropdown() {
    const menu = document.getElementById('zoneDropdownMenu');
    const container = document.getElementById('zoneDropdownContainer');
    const trigger = document.getElementById('btnZoneDropdownTrigger');
    const list = document.getElementById('zoneDropdownList');
    const searchInput = document.getElementById('zoneSearchInput');
    if (!menu || !container || !trigger) return;

    menu.style.display = 'flex';
    container.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');

    positionZoneDropdown();

    // Scroll selected item into view
    if (list) {
        const selected = list.querySelector('.zone-dropdown-item.selected');
        if (selected) {
            selected.scrollIntoView({ block: 'nearest' });
        }
    }

    // Focus search input if visible
    const searchWrapper = document.getElementById('zoneSearchWrapper');
    if (searchWrapper && searchWrapper.style.display !== 'none' && searchInput) {
        setTimeout(() => searchInput.focus(), 50);
    }
}

function closeZoneDropdown() {
    const menu = document.getElementById('zoneDropdownMenu');
    const container = document.getElementById('zoneDropdownContainer');
    const trigger = document.getElementById('btnZoneDropdownTrigger');
    if (!menu) return;

    menu.style.display = 'none';
    if (container) container.classList.remove('open');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');

    // Reset filter search
    const searchInput = document.getElementById('zoneSearchInput');
    if (searchInput) {
        searchInput.value = '';
        filterZoneDropdownItems('');
    }
}

function positionZoneDropdown() {
    const trigger = document.getElementById('btnZoneDropdownTrigger');
    const menu = document.getElementById('zoneDropdownMenu');
    const list = document.getElementById('zoneDropdownList');
    if (!trigger || !menu || !list || menu.style.display === 'none') return;

    const rect = trigger.getBoundingClientRect();
    const windowHeight = window.innerHeight;
    const windowWidth = window.innerWidth;
    
    // Space below trigger leaving a 16px safety margin from the window edge
    const spaceBelow = windowHeight - rect.bottom - 16;
    // Space above trigger leaving a 16px safety margin from window top
    const spaceAbove = rect.top - 16;

    const searchWrapper = document.getElementById('zoneSearchWrapper');
    const searchHeight = (searchWrapper && searchWrapper.style.display !== 'none') ? searchWrapper.offsetHeight : 0;

    // Vertical positioning & adaptive max-height
    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
        // Open upwards
        menu.style.top = 'auto';
        menu.style.bottom = 'calc(100% + 6px)';
        const maxListHeight = Math.max(120, spaceAbove - searchHeight - 24);
        list.style.maxHeight = `${maxListHeight}px`;
    } else {
        // Open downwards (default)
        menu.style.top = 'calc(100% + 6px)';
        menu.style.bottom = 'auto';
        const maxListHeight = Math.max(120, spaceBelow - searchHeight - 24);
        list.style.maxHeight = `${maxListHeight}px`;
    }

    // Horizontal guard: prevent overflowing right edge of viewport
    if (rect.left + 260 > windowWidth) {
        menu.style.left = 'auto';
        menu.style.right = '0';
    } else {
        menu.style.left = '0';
        menu.style.right = 'auto';
    }
}

function filterZoneDropdownItems(query) {
    const list = document.getElementById('zoneDropdownList');
    if (!list) return;
    const q = (query || '').toLowerCase().trim();
    const items = list.querySelectorAll('.zone-dropdown-item');
    let visibleCount = 0;

    items.forEach(item => {
        const text = (item.textContent || '').toLowerCase();
        const matches = !q || text.includes(q);
        item.style.display = matches ? 'flex' : 'none';
        if (matches) visibleCount++;
    });

    let emptyMsg = list.querySelector('.zone-dropdown-empty');
    if (visibleCount === 0) {
        if (!emptyMsg) {
            emptyMsg = document.createElement('div');
            emptyMsg.className = 'zone-dropdown-empty';
            emptyMsg.textContent = 'No se encontraron zonas que coincidan';
            list.appendChild(emptyMsg);
        }
        emptyMsg.style.display = 'block';
    } else if (emptyMsg) {
        emptyMsg.style.display = 'none';
    }
}

// Fetch list of distinct locations from database
async function fetchLocations() {
    try {
        const res = await fetch('/api/locations');
        const locations = await res.json();
        const select = document.getElementById('filterLocationSelect');
        const currentVal = select ? select.value : 'all';

        if (select) {
            let html = `<option value="all">Todas las Sedes</option>`;
            locations.forEach(loc => {
                html += `<option value="${escapeHtml(loc)}">${escapeHtml(loc)}</option>`;
            });
            select.innerHTML = html;
            if (locations.includes(currentVal) || currentVal === 'all') {
                select.value = currentVal;
            } else if (locations.includes(currentActiveLocation)) {
                select.value = currentActiveLocation;
            } else {
                select.value = 'all';
            }
        }

        renderCustomLocationDropdown(locations, currentActiveLocation);
        renderConfiguredSedesList(locations);
    } catch (err) {
        console.error('Error fetching locations:', err);
    }
}

// ==========================================================================
// CUSTOM SEDE DROPDOWN COMPONENT & SWITCHER
// ==========================================================================

function initLocationCustomDropdown() {
    const trigger = document.getElementById('btnLocationDropdownTrigger');
    if (trigger) {
        trigger.addEventListener('click', toggleLocationDropdown);
    }

    // Close on click outside
    document.addEventListener('click', (e) => {
        const container = document.getElementById('locationDropdownContainer');
        if (container && !container.contains(e.target)) {
            closeLocationDropdown();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeLocationDropdown();
        }
    });
}

function toggleLocationDropdown(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('locationDropdownMenu');
    if (!menu) return;
    if (menu.style.display === 'none' || !menu.style.display) {
        openLocationDropdown();
    } else {
        closeLocationDropdown();
    }
}

function openLocationDropdown() {
    const menu = document.getElementById('locationDropdownMenu');
    const container = document.getElementById('locationDropdownContainer');
    const trigger = document.getElementById('btnLocationDropdownTrigger');
    if (!menu || !container || !trigger) return;
    menu.style.display = 'flex';
    container.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
}

function closeLocationDropdown() {
    const menu = document.getElementById('locationDropdownMenu');
    const container = document.getElementById('locationDropdownContainer');
    const trigger = document.getElementById('btnLocationDropdownTrigger');
    if (!menu || !container) return;
    menu.style.display = 'none';
    container.classList.remove('open');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function renderCustomLocationDropdown(locations, activeLoc) {
    const list = document.getElementById('locationDropdownList');
    if (!list) return;

    const locs = (locations && locations.length > 0) ? locations : [activeLoc || 'Bodega_CLEN'];

    let html = '';
    locs.forEach(loc => {
        const isSel = (loc === activeLoc) ? 'selected' : '';
        html += `
            <div class="location-dropdown-item ${isSel}" data-value="${escapeHtml(loc)}" role="option" aria-selected="${loc === activeLoc}">
                <span><i data-lucide="map-pin" style="width: 13px; height: 13px; margin-right: 6px; color: #a855f7;"></i>${escapeHtml(loc)}</span>
                ${isSel ? '<i data-lucide="check" style="width: 14px; height: 14px; color: #a855f7;"></i>' : ''}
            </div>
        `;
    });

    list.innerHTML = html;
    initLucideIcons();

    list.querySelectorAll('.location-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            const val = item.getAttribute('data-value');
            if (val) {
                changeActiveLocation(val);
            }
            closeLocationDropdown();
        });
    });
}

async function changeActiveLocation(newLoc) {
    if (!newLoc) return;
    try {
        currentActiveLocation = newLoc;
        const badge = document.getElementById('currentLocationBadge');
        if (badge) badge.textContent = newLoc;

        const cfgLoc = document.getElementById('cfgLocationName');
        if (cfgLoc) cfgLoc.value = newLoc;

        // Reset active zone in memory and UI
        currentZone = '';
        const zoneTriggerText = document.getElementById('zoneTriggerText');
        if (zoneTriggerText) {
            zoneTriggerText.textContent = '(Sin Zona / General)';
            zoneTriggerText.title = 'Sin Zona seleccionada (Muestras generales)';
        }

        // Persist active location to server config
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                location_name: newLoc,
                current_zone: ''
            })
        });

        // Sync filterLocationSelect if exists
        const filterLoc = document.getElementById('filterLocationSelect');
        if (filterLoc) {
            let optExists = Array.from(filterLoc.options).some(o => o.value === newLoc);
            if (!optExists) {
                const opt = document.createElement('option');
                opt.value = newLoc;
                opt.textContent = newLoc;
                filterLoc.appendChild(opt);
            }
            filterLoc.value = newLoc;
        }

        // Reload zones for the new location and re-render dropdowns
        await fetchZones();
        await fetchLocations();
        refreshAllData();
        renderConfiguredSedesList();
    } catch (err) {
        console.error('Error al cambiar sede activa:', err);
    }
}

// Configured Sedes Management in Config Modal
async function renderConfiguredSedesList(knownLocations) {
    const container = document.getElementById('configuredSedesList');
    if (!container) return;

    try {
        let locs = knownLocations;
        if (!locs) {
            const res = await fetch('/api/locations');
            locs = await res.json();
        }

        let map = zonesByLocation;
        if (!map || Object.keys(map).length === 0) {
            const resCfg = await fetch('/api/config');
            const cfg = await resCfg.json();
            try {
                map = JSON.parse(cfg.zones_by_location || '{}');
            } catch (e) {
                map = {};
            }
        }

        if (!locs || locs.length === 0) {
            container.innerHTML = '<span style="font-size: 0.78rem; color: #94a3b8; font-style: italic;">No hay sedes configuradas.</span>';
            return;
        }

        let html = '';
        locs.forEach(loc => {
            const isActive = (loc === currentActiveLocation);
            const zCount = (map[loc] && Array.isArray(map[loc])) ? map[loc].length : 0;
            html += `
                <div class="sede-chip ${isActive ? 'active-sede' : ''}">
                    <span style="font-weight: 600;">${escapeHtml(loc)}</span>
                    <span style="font-size: 0.7rem; opacity: 0.8; background: rgba(0,0,0,0.25); padding: 1px 5px; border-radius: 4px;">${zCount} zonas</span>
                    ${isActive ? '<span style="font-size: 0.68rem; color: #a855f7; font-weight: 700; margin-left: 2px;">(Activa)</span>' : ''}
                    <button type="button" class="sede-chip-delete" data-sede="${escapeHtml(loc)}" title="Eliminar ${escapeHtml(loc)} del catálogo">
                        <i data-lucide="x" style="width: 12px; height: 12px;"></i>
                    </button>
                </div>
            `;
        });
        container.innerHTML = html;
        initLucideIcons();

        container.querySelectorAll('.sede-chip-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const sedeToDelete = btn.getAttribute('data-sede');
                if (!sedeToDelete) return;
                if (!confirm(`¿Eliminar la sede "${sedeToDelete}" y sus zonas del catálogo configurado?`)) {
                    return;
                }
                try {
                    const res = await fetch('/api/locations/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ location: sedeToDelete })
                    });
                    const data = await res.json();
                    if (data.success) {
                        showToast(`Sede "${sedeToDelete}" eliminada del catálogo.`, 'info');
                        await loadConfig();
                        await fetchLocations();
                        await fetchZones();
                        refreshAllData();
                    } else {
                        showToast(data.error || 'Error al eliminar sede.', 'error');
                    }
                } catch (err) {
                    showToast('Error de conexión al eliminar: ' + err.message, 'error');
                }
            });
        });
    } catch (err) {
        console.error('Error rendering configured sedes:', err);
    }
}

function initSyncSedesButton() {
    const btnSync = document.getElementById('btnSyncSedesFile');
    if (btnSync) {
        btnSync.addEventListener('click', async () => {
            if (!confirm('¿Deseas reemplazar el catálogo actual con la definición exacta contenida en sedes_zonas.json?')) {
                return;
            }
            btnSync.disabled = true;
            btnSync.innerHTML = '<i data-lucide="loader" class="spin"></i> Sincronizando...';
            initLucideIcons();

            try {
                const res = await fetch('/api/locations/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: 'replace' })
                });
                const data = await res.json();
                if (data.success) {
                    showToast(data.message || 'Catálogo sincronizado exitosamente.', 'success');
                    await loadConfig();
                    await fetchLocations();
                    await fetchZones();
                    refreshAllData();
                } else {
                    showToast(data.error || 'Error al sincronizar catálogo.', 'error');
                }
            } catch (err) {
                showToast('Error al sincronizar: ' + err.message, 'error');
            } finally {
                btnSync.disabled = false;
                btnSync.innerHTML = '<i data-lucide="refresh-cw"></i> Sincronizar desde sedes_zonas.json';
                initLucideIcons();
            }
        });
    }
}

// Run immediate manual latency probe
async function runManualProbe() {
    const btn = document.getElementById('btnProbeNow');
    const origHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Probando...`;
    initLucideIcons();

    try {
        const activeZone = document.getElementById('activeZoneSelect') ? document.getElementById('activeZoneSelect').value : '';
        let url = '/api/probe/now';
        if (activeZone) {
            url += `?zone=${encodeURIComponent(activeZone)}`;
        }
        const res = await fetch(url);
        const data = await res.json();
        
        btn.disabled = false;
        btn.innerHTML = origHTML;
        initLucideIcons();

        await fetchLocations();
        await fetchZones();
        refreshAllData();
        showDetailModal(data);
    } catch (err) {
        btn.disabled = false;
        btn.innerHTML = origHTML;
        initLucideIcons();
        alert('Error ejecutando prueba: ' + err);
    }
}

// Refresh all metrics, statistics, charts, and history table
async function refreshAllData() {
    await Promise.all([
        fetchStats(),
        fetchHistory(),
        fetchComparison(),
        fetchNetDiag()
    ]);
}

// Fetch stats and update metric cards
async function fetchStats() {
    try {
        const loc = document.getElementById('filterLocationSelect').value;
        const zone = document.getElementById('filterZoneSelect') ? document.getElementById('filterZoneSelect').value : null;

        let url = '/api/stats';
        const params = [];
        if (loc && loc !== 'all') {
            params.push(`location=${encodeURIComponent(loc)}`);
        }
        if (zone && zone !== 'all') {
            params.push(`zone=${encodeURIComponent(zone)}`);
        }
        if (params.length > 0) {
            url += '?' + params.join('&');
        }
        const res = await fetch(url);
        const stats = await res.json();

        // Metric numbers
        document.getElementById('valAvgTotal').textContent = stats.averages.total || 0;
        document.getElementById('valMinTotal').textContent = `${stats.mins.total || 0} ms`;
        document.getElementById('valMaxTotal').textContent = `${stats.peaks.total || 0} ms`;

        document.getElementById('valAvgDNS').textContent = stats.averages.dns || 0;
        document.getElementById('valMinDNS').textContent = `${stats.mins.dns || 0} ms`;
        document.getElementById('valMaxDNS').textContent = `${stats.peaks.dns || 0} ms`;

        document.getElementById('valAvgTCP').textContent = stats.averages.tcp || 0;
        document.getElementById('valMinTCP').textContent = `${stats.mins.tcp || 0} ms`;
        document.getElementById('valMaxTCP').textContent = `${stats.peaks.tcp || 0} ms`;

        document.getElementById('valAvgTLS').textContent = stats.averages.tls || 0;
        document.getElementById('valMinTLS').textContent = `${stats.mins.tls || 0} ms`;
        document.getElementById('valMaxTLS').textContent = `${stats.peaks.tls || 0} ms`;

        document.getElementById('valAvgTTFB').textContent = stats.averages.ttfb || 0;
        document.getElementById('valMinTTFB').textContent = `${stats.mins.ttfb || 0} ms`;
        document.getElementById('valMaxTTFB').textContent = `${stats.peaks.ttfb || 0} ms`;

        // Percentiles & Jitter
        document.getElementById('valP95').textContent = `${stats.percentiles.p95 || 0} ms`;
        document.getElementById('valP99').textContent = `${stats.percentiles.p99 || 0} ms`;
        document.getElementById('valJitter').textContent = `${stats.jitter || 0} ms`;
        document.getElementById('valUptime').textContent = `${stats.uptime_percentage || 100}%`;

        // Update Phase Comparison Bar Chart
        updatePhaseBarChart(stats.averages);

        // Status Codes Summary panel
        updateStatusCodesPanel(stats.status_codes);

    } catch (err) {
        console.error('Error fetching stats:', err);
    }
}

// Fetch comparative metrics by location and zones
async function fetchComparison() {
    try {
        const filterLoc = document.getElementById('filterLocationSelect') ? document.getElementById('filterLocationSelect').value : null;
        let url = '/api/comparison';
        if (filterLoc && filterLoc !== 'all') {
            url += `?location=${encodeURIComponent(filterLoc)}`;
        }
        const res = await fetch(url);
        if (!res.ok) {
            console.warn('Error en /api/comparison status:', res.status);
            return;
        }
        const data = await res.json();
        const tbody = document.getElementById('locationComparisonBody');
        if (!tbody) return;

        // Support both old array format and new { locations, zones } object format
        let rows = [];
        let zoneRows = [];
        if (Array.isArray(data)) {
            rows = data;
        } else if (data && typeof data === 'object') {
            rows = data.locations || [];
            zoneRows = data.zones || [];
        }

        if ((!rows || rows.length === 0) && (!zoneRows || zoneRows.length === 0)) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No hay suficientes datos registrados para comparar sedes.</td></tr>`;
            return;
        }

        let html = '';
        if (rows.length > 0) {
            html += rows.map(r => `
                <tr>
                    <td><span class="loc-pill">${r.location}</span></td>
                    <td>${r.total_samples}</td>
                    <td>${r.avg_dns} ms</td>
                    <td>${r.avg_tcp} ms</td>
                    <td>${r.avg_tls} ms</td>
                    <td class="text-success font-bold">${r.avg_ttfb} ms</td>
                    <td class="font-bold text-blue">${r.avg_total} ms</td>
                    <td class="text-danger font-bold">${r.peak_total} ms</td>
                </tr>
            `).join('');
        }

        if (zoneRows.length > 0) {
            html += `
                <tr class="table-subgroup-header" style="background: rgba(14, 165, 233, 0.08); border-top: 1px solid rgba(14, 165, 233, 0.25);">
                    <td colspan="8" style="font-size: 0.74rem; font-weight: 700; color: #38bdf8; padding: 0.35rem 0.75rem; text-transform: uppercase; letter-spacing: 0.04em;">
                        📍 Rendimiento por Zonas Físicas de Recorrido
                    </td>
                </tr>
            `;
            html += zoneRows.map(z => `
                <tr style="font-size: 0.83rem;">
                    <td>
                        <span class="loc-pill" style="opacity: 0.85;">${z.location}</span>
                        <span class="zone-pill ${z.zone.startsWith('(') ? 'empty' : ''}" style="margin-left: 0.35rem;">${z.zone}</span>
                    </td>
                    <td>${z.total_samples}</td>
                    <td>${z.avg_dns} ms</td>
                    <td>${z.avg_tcp} ms</td>
                    <td>${z.avg_tls} ms</td>
                    <td class="text-success font-bold">${z.avg_ttfb} ms</td>
                    <td class="font-bold text-blue">${z.avg_total} ms</td>
                    <td class="text-danger font-bold">${z.peak_total} ms</td>
                </tr>
            `).join('');
        }

        tbody.innerHTML = html;

    } catch (err) {
        console.error('Error fetching comparison:', err);
    }
}

let currentNetDiagRunId = 'latest';

// Fetch Network Diagnostics (Gateway, DNS & Extra Hosts) with History Selector support
async function fetchNetDiag(targetRunId = null) {
    try {
        if (targetRunId !== null) {
            currentNetDiagRunId = targetRunId;
        }

        const loc = document.getElementById('filterLocationSelect') ? document.getElementById('filterLocationSelect').value : null;
        const zone = document.getElementById('filterZoneSelect') ? document.getElementById('filterZoneSelect').value : null;
        let url = '/api/net-diag';
        const params = [];
        if (loc && loc !== 'all') {
            params.push(`location=${encodeURIComponent(loc)}`);
        }
        if (zone && zone !== 'all') {
            params.push(`zone=${encodeURIComponent(zone)}`);
        }
        if (currentNetDiagRunId && currentNetDiagRunId !== 'latest') {
            params.push(`run_id=${encodeURIComponent(currentNetDiagRunId)}`);
        }
        if (params.length > 0) {
            url += '?' + params.join('&');
        }

        const res = await fetch(url);
        const data = await res.json();
        
        const container = document.getElementById('netDiagContainer');
        const lastRunEl = document.getElementById('netDiagLastRun');
        const historySelect = document.getElementById('netDiagHistorySelect');
        if (!container) return;

        // Populate history selector dropdown
        if (historySelect && data.history_runs) {
            const historyRuns = data.history_runs;
            let optionsHtml = `<option value="latest">⚡ Más reciente (Automático / Último)</option>`;
            
            historyRuns.forEach(r => {
                const dt = new Date(r.timestamp * 1000);
                const dateStr = dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
                const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const isSelected = (String(r.id) === String(currentNetDiagRunId)) ? 'selected' : '';
                optionsHtml += `<option value="${r.id}" ${isSelected}>Prueba #${r.id} - ${dateStr} ${timeStr} (${r.location})</option>`;
            });

            historySelect.innerHTML = optionsHtml;
            if (currentNetDiagRunId === 'latest') {
                historySelect.value = 'latest';
            }
        }

        const latest = data.latest;
        if (!latest || !latest.results || latest.results.length === 0) {
            if (lastRunEl) lastRunEl.textContent = 'Sin pruebas ejecutadas';
            container.innerHTML = `
                <div class="net-diag-empty">
                    <i data-lucide="activity" style="width: 36px; height: 36px; color: var(--accent-blue); margin-bottom: 0.75rem;"></i>
                    <p style="font-weight: 600; margin-bottom: 0.25rem;">No se han ejecutado diagnósticos de red todavía.</p>
                    <p style="font-size: 0.85rem;">Presiona "Ejecutar Ahora" o espera la prueba programada cada 15 min.</p>
                </div>
            `;
            initLucideIcons();
            return;
        }

        // Format timestamp
        if (latest.timestamp && lastRunEl) {
            const dt = new Date(latest.timestamp * 1000);
            const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const locStr = latest.location ? ` [${latest.location}]` : '';
            const isHistorical = (currentNetDiagRunId && currentNetDiagRunId !== 'latest');
            lastRunEl.textContent = `${isHistorical ? `Prueba #${latest.id}:` : 'Última prueba:'} ${timeStr}${locStr}`;
        }

        const excludedStr = (data.detected && data.detected.excluded_targets) ? data.detected.excluded_targets : '';
        const excludedList = excludedStr.split(/[,;\s\n]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
        const visibleResults = latest.results.filter(node => !excludedList.includes(node.host.toLowerCase()));

        container.innerHTML = visibleResults.map(node => renderNetDiagCard(node)).join('');
        initLucideIcons();
    } catch (err) {
        console.error('Error fetching net-diag:', err);
    }
}

// Render individual node card for network diagnostics
function renderNetDiagCard(node) {
    const status = node.status || 'healthy';
    const statusLabels = {
        'healthy': 'En Línea (Normal)',
        'degraded': 'Degradado / Alto RTT',
        'down': 'Sin Respuesta'
    };
    const badgeStyles = {
        'healthy': 'background: rgba(16, 185, 129, 0.15); color: var(--accent-emerald); border: 1px solid rgba(16, 185, 129, 0.3);',
        'degraded': 'background: rgba(245, 158, 11, 0.15); color: var(--accent-amber); border: 1px solid rgba(245, 158, 11, 0.3);',
        'down': 'background: rgba(239, 68, 68, 0.15); color: var(--accent-rose); border: 1px solid rgba(239, 68, 68, 0.3);'
    };
    const typeBadges = {
        'gateway': '<span class="status-badge" style="background: rgba(59, 130, 246, 0.15); color: var(--accent-blue); border: 1px solid rgba(59, 130, 246, 0.3);">Gateway</span>',
        'dns': '<span class="status-badge" style="background: rgba(6, 182, 212, 0.15); color: var(--accent-cyan); border: 1px solid rgba(6, 182, 212, 0.3);">DNS</span>',
        'extra': '<span class="status-badge" style="background: rgba(168, 85, 247, 0.15); color: var(--accent-purple); border: 1px solid rgba(168, 85, 247, 0.3);">Host Extra</span>'
    };
    const icons = {
        'gateway': 'router',
        'dns': 'server',
        'extra': 'globe'
    };

    const iconName = icons[node.type] || 'network';
    const ping = node.ping || {};
    const trace = node.traceroute || {};
    const hops = trace.hops || [];

    const avgMs = (ping.avg_ms !== null && ping.avg_ms !== undefined) ? ping.avg_ms.toFixed(1) : '--';
    const lossPct = (ping.loss_pct !== null && ping.loss_pct !== undefined) ? ping.loss_pct.toFixed(0) : '0';
    const minMs = (ping.min_ms !== null && ping.min_ms !== undefined) ? ping.min_ms.toFixed(1) : '--';
    const maxMs = (ping.max_ms !== null && ping.max_ms !== undefined) ? ping.max_ms.toFixed(1) : '--';
    const jitterMs = (ping.mdev_ms !== null && ping.mdev_ms !== undefined) ? `±${ping.mdev_ms.toFixed(1)} ms` : '--';

    let hopsHtml = '';
    if (hops.length > 0) {
        hopsHtml = hops.map(h => {
            const isTimeout = h.status === 'timeout' || h.ip === '*' || h.rtt_ms === null;
            return `
                <div class="hop-item">
                    <span class="hop-num">#${h.hop}</span>
                    <span class="hop-ip" title="${h.ip}">${h.ip}</span>
                    ${isTimeout 
                        ? `<span class="hop-timeout">* Timeout</span>` 
                        : `<span class="hop-rtt">${h.rtt_ms.toFixed(1)} ms</span>`}
                </div>
            `;
        }).join('');
    } else {
        hopsHtml = `<div class="text-muted" style="font-size: 0.78rem; padding: 0.25rem;">${trace.error || 'Sin saltos disponibles (destino local o traceroute bloqueado)'}</div>`;
    }

    const uniqueId = 'trace_' + Math.random().toString(36).substring(2, 9);

    return `
        <div class="net-node-card status-${status}">
            <div class="net-node-header">
                <div class="net-node-title-group">
                    <div class="net-node-icon">
                        <i data-lucide="${iconName}"></i>
                    </div>
                    <div>
                        <div class="net-node-name">${node.name}</div>
                        <div class="net-node-host">${node.host}</div>
                    </div>
                </div>
                <div class="net-node-badges">
                    ${typeBadges[node.type] || ''}
                    <span class="status-badge" style="${badgeStyles[status]}">${statusLabels[status]}</span>
                    ${node.type !== 'gateway' ? `
                        <button type="button" class="btn-node-exclude" onclick="excludeNetNode('${node.host}', '${node.name}')" title="Excluir este nodo de las pruebas ICMP">
                            <i data-lucide="shield-ban" style="width: 13px; height: 13px;"></i>
                        </button>
                    ` : ''}
                </div>
            </div>

            <div class="net-ping-stats">
                <div class="net-stat-box">
                    <span class="net-stat-label">Latencia Ping (RTT)</span>
                    <div class="net-stat-value">
                        ${avgMs} <span class="net-stat-unit">ms</span>
                    </div>
                    <div class="net-stat-sub">Jitter: ${jitterMs}</div>
                </div>

                <div class="net-stat-box">
                    <span class="net-stat-label">Pérdida de Paquetes</span>
                    <div class="net-stat-value" style="color: ${parseFloat(lossPct) > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)'}">
                        ${lossPct} <span class="net-stat-unit">%</span>
                    </div>
                    <div class="net-stat-sub">Mín: ${minMs} | Máx: ${maxMs} ms</div>
                </div>
            </div>

            <div class="net-trace-section">
                <button type="button" class="net-trace-toggle-btn" onclick="toggleTraceroute('${uniqueId}', this)">
                    <span><i data-lucide="git-commit" style="width: 14px; height: 14px; vertical-align: middle;"></i> Ruta Traceroute (${trace.hops_count || hops.length} saltos)</span>
                    <i data-lucide="chevron-down" style="width: 14px; height: 14px;"></i>
                </button>
                <div class="net-trace-hops-list" id="${uniqueId}">
                    ${hopsHtml}
                </div>
            </div>
        </div>
    `;
}

// Toggle Traceroute accordion in network card
function toggleTraceroute(id, btn) {
    const list = document.getElementById(id);
    if (!list) return;
    const isExpanded = list.classList.toggle('expanded');
    const chevron = btn.querySelector('[data-lucide="chevron-down"], [data-lucide="chevron-up"]');
    if (chevron) {
        chevron.setAttribute('data-lucide', isExpanded ? 'chevron-up' : 'chevron-down');
        initLucideIcons();
    }
}

// Trigger network diagnostic execution via API
async function runNetworkDiagnostic() {
    const btn = document.getElementById('btnRunNetDiag');
    if (!btn) return;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Ejecutando...`;
    initLucideIcons();

    try {
        const locFilter = document.getElementById('filterLocationSelect') ? document.getElementById('filterLocationSelect').value : null;
        const activeZone = document.getElementById('activeZoneSelect') ? document.getElementById('activeZoneSelect').value : undefined;
        const res = await fetch('/api/net-diag/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                location: (locFilter && locFilter !== 'all') ? locFilter : undefined,
                zone: activeZone || undefined
            })
        });
        const data = await res.json();
        if (data.success) {
            currentNetDiagRunId = 'latest';
            await fetchNetDiag('latest');
        } else {
            alert('Error al ejecutar el diagnóstico de red: ' + (data.error || 'Desconocido'));
        }
    } catch (err) {
        console.error('Error running net-diag:', err);
        alert('Error al conectar con el servidor para diagnóstico de red.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        initLucideIcons();
    }
}

// Fetch historical log entries
async function fetchHistory() {
    try {
        const statusVal = document.getElementById('filterStatus').value;
        const locVal = document.getElementById('filterLocationSelect').value;
        const zoneVal = document.getElementById('filterZoneSelect') ? document.getElementById('filterZoneSelect').value : null;

        let url = `/api/history?limit=50&status=${statusVal}`;
        if (locVal && locVal !== 'all') {
            url += `&location=${encodeURIComponent(locVal)}`;
        }
        if (zoneVal && zoneVal !== 'all') {
            url += `&zone=${encodeURIComponent(zoneVal)}`;
        }

        const res = await fetch(url);
        const data = await res.json();
        const records = data.records || [];

        document.getElementById('recordCounter').textContent = `${data.count} registros`;

        // Update Charts with historical records (chronological order)
        const chronoRecords = [...records].reverse();
        updateBreakdownChart(chronoRecords);
        updateTimelineChart(chronoRecords);

        // Render Table Rows
        const tbody = document.getElementById('historyTableBody');
        if (records.length === 0) {
            tbody.innerHTML = `<tr><td colspan="12" class="text-center text-muted">No se encontraron registros de latencia para este filtro.</td></tr>`;
            return;
        }

        tbody.innerHTML = records.map(r => {
            const dateStr = new Date(r.timestamp * 1000).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' });
            
            let badgeClass = 'code-2xx';
            if (r.is_error) badgeClass = 'code-err';
            else if (r.status_code >= 400 && r.status_code < 500) badgeClass = 'code-4xx';
            else if (r.status_code >= 500) badgeClass = 'code-5xx';

            const statusLabel = r.is_error ? (r.error_message || 'ERROR') : `HTTP ${r.status_code}`;
            const locationTag = r.location || 'Sede Principal';
            const zoneTag = r.zone 
                ? `<span class="zone-pill">${r.zone}</span>` 
                : `<span class="zone-pill empty">(General)</span>`;

            return `
                <tr>
                    <td>#${r.id}</td>
                    <td>${dateStr}</td>
                    <td><span class="loc-pill">${locationTag}</span></td>
                    <td>${zoneTag}</td>
                    <td>${r.ip || 'N/A'}</td>
                    <td><span class="status-badge ${badgeClass}">${statusLabel}</span></td>
                    <td>${r.dns_ms}</td>
                    <td>${r.tcp_ms}</td>
                    <td>${r.tls_ms}</td>
                    <td class="text-success font-bold">${r.ttfb_ms}</td>
                    <td class="font-bold">${r.total_ms}</td>
                    <td>
                        <button class="btn btn-sm btn-secondary" onclick="viewRecordDetail(${r.id})">Detalle</button>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error('Error fetching history:', err);
    }
}

// Render status code distribution items
function updateStatusCodesPanel(statusCodes) {
    const container = document.getElementById('statusCodesContainer');
    if (!statusCodes || Object.keys(statusCodes).length === 0) {
        container.innerHTML = `<div class="empty-state">No hay respuestas registradas aún</div>`;
        return;
    }

    container.innerHTML = Object.entries(statusCodes).map(([code, count]) => {
        let label = `HTTP ${code}`;
        let badgeClass = 'code-2xx';
        if (code === 'Error' || code === '0') {
            label = 'Error de Red / Timeout';
            badgeClass = 'code-err';
        } else if (code.startsWith('4')) {
            badgeClass = 'code-4xx';
        } else if (code.startsWith('5')) {
            badgeClass = 'code-5xx';
        }

        return `
            <div class="status-row-item">
                <span class="status-badge ${badgeClass}">${label}</span>
                <span class="font-bold">${count} peticiones</span>
            </div>
        `;
    }).join('');
}

// Show Detail Modal for a single probe record
async function viewRecordDetail(recordId) {
    const res = await fetch(`/api/history?limit=1000`);
    const data = await res.json();
    const record = (data.records || []).find(r => r.id === recordId);
    if (record) {
        showDetailModal(record);
    }
}

function showDetailModal(r) {
    const body = document.getElementById('detailModalBody');
    const dateStr = new Date(r.timestamp * 1000).toLocaleString();
    const initConn = ((Number(r.tcp_ms) || 0) + (Number(r.tls_ms) || 0)).toFixed(2);
    const coldTotal = ((Number(r.dns_ms) || 0) + (Number(r.tcp_ms) || 0) + (Number(r.tls_ms) || 0) + (Number(r.total_ms) || 0)).toFixed(2);

    body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:0.85rem; font-family: var(--font-mono); font-size: 0.88rem;">
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem; background:rgba(255,255,255,0.03); padding:0.75rem; border-radius:8px; border:1px solid var(--border-color);">
                <div><strong>ID Registro:</strong> #${r.id || 'N/A'}</div>
                <div><strong>Fecha & Hora:</strong> ${dateStr}</div>
                <div><strong>Sede:</strong> <span class="loc-pill">${r.location || 'Sede Principal'}</span></div>
                <div><strong>Zona Recorrido:</strong> <span class="zone-pill ${r.zone ? '' : 'empty'}">${r.zone || '(Sin Zona / General)'}</span></div>
                <div><strong>Estado HTTP:</strong> ${r.is_error ? `<span class="text-danger">${r.error_message}</span>` : `<span class="text-success">HTTP ${r.status_code}</span>`}</div>
                <div><strong>IP Resuelta:</strong> ${r.ip || 'Sin resolución'}</div>
                <div style="grid-column: span 2;"><strong>URL Probe:</strong> <span style="color:var(--text-muted); word-break:break-all;">${r.url}</span></div>
                <div><strong>Tamaño Respuesta:</strong> ${r.response_size_bytes} bytes</div>
            </div>

            <!-- Sección 1: Metodología Navegador / PDA (Chrome DevTools) -->
            <div style="background:rgba(59, 130, 246, 0.08); border:1px solid rgba(59, 130, 246, 0.35); border-radius:8px; padding:0.85rem;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.6rem;">
                    <strong style="color:var(--accent-blue); display:flex; align-items:center; gap:0.4rem; font-size:0.92rem;">
                        <i data-lucide="compass" style="width:16px; height:16px;"></i> Latencia Navegador / PDA (Metodología Chrome)
                    </strong>
                    <span class="badge badge-blue">Estándar W3C</span>
                </div>
                <div style="display:flex; flex-direction:column; gap:0.4rem; padding-left:0.25rem;">
                    <div style="display:flex; justify-content:space-between;">
                        <span><strong>4. Tiempo de Espera (TTFB):</strong> <span style="color:var(--text-muted); font-size:0.8rem;">(Waiting for server response)</span></span>
                        <strong style="color:var(--accent-emerald);">${r.ttfb_ms} ms</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between;">
                        <span><strong>5. Transferencia Datos:</strong> <span style="color:var(--text-muted); font-size:0.8rem;">(Content Download)</span></span>
                        <strong style="color:var(--text-secondary);">${r.transfer_ms} ms</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.4rem; padding-top:0.5rem; border-top:1px dashed rgba(59,130,246,0.35);">
                        <strong style="color:var(--accent-blue); font-size:1.05rem;">TIEMPO TOTAL NAVEGADOR:</strong>
                        <span style="font-size:1.25rem; color: var(--accent-blue); font-weight:bold;">${r.total_ms} ms</span>
                    </div>
                </div>
            </div>

            <!-- Sección 2: Conexión Inicial de Red (Initial Connection) -->
            <div style="background:rgba(168, 85, 247, 0.05); border:1px solid rgba(168, 85, 247, 0.25); border-radius:8px; padding:0.85rem;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.6rem;">
                    <strong style="color:var(--accent-purple); display:flex; align-items:center; gap:0.4rem; font-size:0.92rem;">
                        <i data-lucide="network" style="width:16px; height:16px;"></i> Conexión Inicial de Red (Initial Connection)
                    </strong>
                    <span class="badge badge-purple">Infraestructura</span>
                </div>
                <div style="display:flex; flex-direction:column; gap:0.4rem; padding-left:0.25rem;">
                    <div style="display:flex; justify-content:space-between;">
                        <span><strong>1. Resolución DNS:</strong></span>
                        <span>${r.dns_ms} ms</span>
                    </div>
                    <div style="display:flex; justify-content:space-between;">
                        <span><strong>2. Conexión TCP:</strong> <span style="color:var(--text-muted); font-size:0.8rem;">(Socket 3-Way Handshake)</span></span>
                        <span>${r.tcp_ms} ms</span>
                    </div>
                    <div style="display:flex; justify-content:space-between;">
                        <span><strong>3. TLS/SSL Handshake:</strong> <span style="color:var(--text-muted); font-size:0.8rem;">(Negociación Cifrada)</span></span>
                        <span>${r.tls_ms} ms</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-top:0.3rem; padding-top:0.4rem; border-top:1px dashed rgba(168,85,247,0.25); color:var(--accent-purple); font-weight:600;">
                        <span>Total Conexión Inicial (TCP + TLS):</span>
                        <span>${initConn} ms</span>
                    </div>
                </div>
            </div>

            <!-- Explicación Técnica y Cold Start -->
            <div style="font-size:0.8rem; color:var(--text-muted); line-height:1.45; background:rgba(0,0,0,0.25); padding:0.75rem 0.85rem; border-radius:6px; border-left:3px solid var(--accent-blue);">
                💡 <strong>¿Por qué el navegador y la PDA muestran ~${r.total_ms} ms?</strong><br>
                En Chrome y terminales PDA (Resource Timing), las peticiones HTTP reutilizan conexiones persistentes (<em>Keep-Alive</em>). Por tanto, la latencia percibida en cada ping es el tiempo de respuesta HTTP (<strong>${r.total_ms} ms</strong>).<br>
                Si se suma la conexión en frío desde cero (apertura de socket TCP + TLS + HTTP), el tiempo total acumulado fue de <strong>${coldTotal} ms</strong>.
            </div>
        </div>
    `;
    openModal('detailModal');
    initLucideIcons();
}

// Chart.js Initialization
function initCharts() {
    if (typeof Chart === "undefined") {
        console.warn("Chart.js no está disponible aún. Las métricas continuarán funcionando normalmente.");
        return;
    }
    try {
    const chartOptionsBase = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                titleFont: { family: 'Inter', size: 13 },
                bodyFont: { family: 'JetBrains Mono', size: 12 },
                borderColor: 'rgba(255,255,255,0.1)',
                borderWidth: 1
            }
        },
        scales: {
            x: {
                grid: { color: 'rgba(255,255,255,0.04)' },
                ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } }
            },
            y: {
                grid: { color: 'rgba(255,255,255,0.06)' },
                ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 11 } }
            }
        }
    };

    // 1. Stacked Component Breakdown Chart
    const ctxBreakdown = document.getElementById('chartBreakdown').getContext('2d');
    chartBreakdownInstance = new Chart(ctxBreakdown, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'DNS (ms)', data: [], backgroundColor: 'rgba(6, 182, 212, 0.4)', borderColor: '#06b6d4', fill: true, tension: 0.3 },
                { label: 'TCP (ms)', data: [], backgroundColor: 'rgba(192, 132, 252, 0.4)', borderColor: '#c084fc', fill: true, tension: 0.3 },
                { label: 'TLS (ms)', data: [], backgroundColor: 'rgba(251, 191, 36, 0.4)', borderColor: '#fbbf24', fill: true, tension: 0.3 },
                { label: 'TTFB Servidor (ms)', data: [], backgroundColor: 'rgba(52, 211, 153, 0.4)', borderColor: '#34d399', fill: true, tension: 0.3 }
            ]
        },
        options: {
            ...chartOptionsBase,
            scales: {
                ...chartOptionsBase.scales,
                y: { ...chartOptionsBase.scales.y, stacked: true }
            }
        }
    });

    // 2. Total Latency Timeline & Peaks Chart
    const ctxTimeline = document.getElementById('chartTimeline').getContext('2d');
    chartTimelineInstance = new Chart(ctxTimeline, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Latencia Total (ms)',
                    data: [],
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.15)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.25,
                    pointRadius: 4,
                    pointHoverRadius: 7
                }
            ]
        },
        options: chartOptionsBase
    });

    // 3. Phase Comparison Bar Chart
    const ctxPhase = document.getElementById('chartPhaseBar').getContext('2d');
    chartPhaseBarInstance = new Chart(ctxPhase, {
        type: 'bar',
        data: {
            labels: ['DNS', 'TCP', 'TLS', 'TTFB (Servidor)', 'Transferencia'],
            datasets: [{
                label: 'Promedio (ms)',
                data: [0, 0, 0, 0, 0],
                backgroundColor: [
                    'rgba(6, 182, 212, 0.85)',
                    'rgba(192, 132, 252, 0.85)',
                    'rgba(251, 191, 36, 0.85)',
                    'rgba(52, 211, 153, 0.85)',
                    'rgba(56, 189, 248, 0.85)'
                ],
                borderColor: [
                    '#06b6d4',
                    '#c084fc',
                    '#fbbf24',
                    '#34d399',
                    '#38bdf8'
                ],
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleFont: { family: 'Inter', size: 13 },
                    bodyFont: { family: 'JetBrains Mono', size: 12 },
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            return ` Promedio: ${context.parsed.y} ms`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: { color: '#94a3b8', font: { family: 'Inter', size: 11, weight: '500' } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.06)' },
                    ticks: { 
                        color: '#94a3b8', 
                        font: { family: 'JetBrains Mono', size: 11 },
                        callback: function(value) {
                            return value + ' ms';
                        }
                    }
                }
            }
        }
    });
    } catch (chartErr) {
        console.error("Error al instanciar gráficas Chart.js:", chartErr);
    }
}

function updateBreakdownChart(records) {
    if (!chartBreakdownInstance) return;
    const labels = records.map(r => new Date(r.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    
    chartBreakdownInstance.data.labels = labels;
    chartBreakdownInstance.data.datasets[0].data = records.map(r => r.dns_ms);
    chartBreakdownInstance.data.datasets[1].data = records.map(r => r.tcp_ms);
    chartBreakdownInstance.data.datasets[2].data = records.map(r => r.tls_ms);
    chartBreakdownInstance.data.datasets[3].data = records.map(r => r.ttfb_ms);
    chartBreakdownInstance.update('quiet');
}

function updateTimelineChart(records) {
    if (!chartTimelineInstance) return;
    const labels = records.map(r => new Date(r.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    
    chartTimelineInstance.data.labels = labels;
    chartTimelineInstance.data.datasets[0].data = records.map(r => r.total_ms);
    chartTimelineInstance.update('quiet');
}

function updatePhaseBarChart(averages) {
    if (!chartPhaseBarInstance || !averages) return;
    chartPhaseBarInstance.data.datasets[0].data = [
        Number(averages.dns) || 0,
        Number(averages.tcp) || 0,
        Number(averages.tls) || 0,
        Number(averages.ttfb) || 0,
        Number(averages.transfer) || 0
    ];
    chartPhaseBarInstance.update();
}


// ==========================================================================
// Interactive Help System & Technical Topics Dictionary
// ==========================================================================

const HELP_TOPICS = {
    'total': {
        title: 'Latencia Navegador / PDA (Metodología Chrome)',
        subtitle: 'Tiempo de Respuesta HTTP (TTFB + Transferencia)',
        badgeClass: 'badge-blue',
        badgeText: 'Metodología Chrome / PDA',
        icon: 'clock',
        layer: 'Capa de Aplicación HTTP (W3C Resource Timing)',
        mechanism: 'T_Navegador = T_TTFB + T_Transfer',
        description: 'Mide la latencia de respuesta HTTP tal como la experimenta una terminal PDA o un navegador Chrome mediante conexiones persistentes Keep-Alive. El handshake de conexión inicial (TCP + TLS) se mide y reporta de forma complementaria para diagnóstico de infraestructura de red.',
        benchmarks: [
            { label: 'Excelente', range: '< 250 ms', type: 'good', desc: 'Respuesta ultrarrápida para terminales RF y estaciones de empaque.' },
            { label: 'Aceptable', range: '250 - 500 ms', type: 'warn', desc: 'Respuesta normal en enlace WAN hacia Manhattan.' },
            { label: 'Crítico', range: '> 600 ms', type: 'crit', desc: 'Retraso elevado en procesamiento del servidor Manhattan o congestión.' }
        ],
        troubleshooting: 'Si la latencia del navegador/PDA es elevada, el factor dominante es el TTFB (tiempo de procesamiento y retorno del servidor Manhattan). Si las fases de conexión inicial TCP o TLS son elevadas, el cuello de botella está en el enlace WAN/ISP o en el terminador SSL.',
        recommendation: 'Compara el TTFB contra el tiempo de Conexión Inicial (TCP + TLS): si TCP es bajo (<80 ms) y TTFB es alto (>350 ms), la causa raíz es del backend de Manhattan.',
        guideTab: 'tab-devtools'
    },
    'dns': {
        title: 'Fase 1: Resolución DNS',
        subtitle: 'Traducción de Dominio a Dirección IP',
        badgeClass: 'badge-cyan',
        badgeText: 'Fase 1',
        icon: 'server',
        layer: 'Capa de Aplicación (UDP puerto 53)',
        mechanism: 'socket.gethostbyname(hostname)',
        description: 'Tiempo requerido por el sistema operativo para consultar a los servidores DNS locales o corporativos y obtener la IP pública destino (ej. 136.68.87.180). Esta prueba se realiza en cada ciclo para auditar la salud del resolver.',
        benchmarks: [
            { label: 'Excelente', range: '< 15 ms', type: 'good', desc: 'Resuelto desde caché local o DNS de alta proximidad.' },
            { label: 'Aceptable', range: '15 - 50 ms', type: 'warn', desc: 'Consulta recursiva con latencia de red aceptable.' },
            { label: 'Lento', range: '> 50 ms', type: 'crit', desc: 'Servidor DNS saturado o reintentos por pérdida UDP.' }
        ],
        troubleshooting: 'Un DNS alto suele deberse a saturación en el servidor DNS corporativo de la sede, ruteo ineficiente hacia los DNS forwarders o problemas con el controlador de dominio Active Directory.',
        recommendation: 'Verifica la configuración de DNS primario y secundario en la interfaz de red de la sede o configura reenviadores con menor RTT.',
        guideTab: 'tab-flow'
    },
    'tcp': {
        title: 'Fase 2: Conexión TCP (3-Way Handshake)',
        subtitle: 'Establecimiento del Socket de Transporte Confiable',
        badgeClass: 'badge-purple',
        badgeText: 'Fase 2',
        icon: 'network',
        layer: 'Capa de Transporte (TCP)',
        mechanism: 'sock.connect((ip, port)) [SYN → SYN-ACK → ACK]',
        description: 'Mide el tiempo exacto del 3-Way Handshake a nivel de socket. Es la medida más pura de la latencia física de ida y vuelta de red (1 RTT) entre la sede y el balanceador/datacenter de Manhattan, totalmente independiente del software o backend.',
        benchmarks: [
            { label: 'Excelente', range: '< 75 ms', type: 'good', desc: 'Canal de fibra óptimo y ruteo directo hacia el datacenter.' },
            { label: 'Aceptable', range: '75 - 120 ms', type: 'warn', desc: 'Latencia típica WAN según la distancia geográfica.' },
            { label: 'Degradado', range: '> 120 ms', type: 'crit', desc: 'Congestión en el ISP, ruteo BGP subóptimo o enlace saturado.' }
        ],
        troubleshooting: 'Si TCP sube repentinamente mientras DNS está bajo, el origen es 100% de la red física, saturación del canal WAN de la sede o problemas en el proveedor de internet (ISP).',
        recommendation: 'Ejecuta pruebas de MTR o traceroute hacia la IP destino para localizar el salto (hop) donde se introduce la latencia.',
        guideTab: 'tab-devtools'
    },
    'tls': {
        title: 'Fase 3: Negociación TLS / SSL Handshake',
        subtitle: 'Seguridad, Certificados x509 y Cifrado',
        badgeClass: 'badge-amber',
        badgeText: 'Fase 3',
        icon: 'lock',
        layer: 'Capa de Seguridad / Presentación (TLS 1.2/1.3)',
        mechanism: 'ssl_context.wrap_socket(sock, hostname)',
        description: 'Sobre el socket TCP ya establecido, mide la negociación del canal cifrado HTTPS: intercambio de certificados del servidor Manhattan, validación de la cadena de confianza y generación de llaves de cifrado simétrico (1 a 2 RTTs + cómputo criptográfico de CPU).',
        benchmarks: [
            { label: 'Excelente', range: '< 85 ms', type: 'good', desc: 'Negociación TLS ágil con cipher suites eficientes.' },
            { label: 'Aceptable', range: '85 - 150 ms', type: 'warn', desc: 'Handshake normal para certificados con cadenas intermedias.' },
            { label: 'Lento', range: '> 150 ms', type: 'crit', desc: 'Sobrecarga de CPU en el terminador SSL o validación CRL lenta.' }
        ],
        troubleshooting: 'Si TCP es bajo pero TLS es alto, la red está sana pero el servidor web o balanceador de Manhattan está saturado negociando conexiones seguras o validando revocación de certificados.',
        recommendation: 'Nota: En Chrome DevTools esta métrica se agrupa visualmente dentro de "Initial Connection". Nuestro analizador la aísla para diferenciar problemas de red física de los criptográficos.',
        guideTab: 'tab-devtools'
    },
    'ttfb': {
        title: 'Fase 4: Espera del Servidor (Time To First Byte)',
        subtitle: 'Tiempo de Procesamiento en el Backend Manhattan',
        badgeClass: 'badge-emerald',
        badgeText: 'Fase 4',
        icon: 'cpu',
        layer: 'Capa de Aplicación (HTTP/1.1)',
        mechanism: 'sock.sendall() → sock.recv(1)',
        description: 'Mide el lapso desde que la petición HTTP (con cabeceras y cookies de sesión) se envía al socket hasta que llega el primer byte de respuesta del servidor. Es el indicador directo del tiempo de cálculo y procesamiento interno de la aplicación Manhattan.',
        benchmarks: [
            { label: 'Excelente', range: '< 300 ms', type: 'good', desc: 'Servidor ágil con baja carga en el motor de Manhattan.' },
            { label: 'Aceptable', range: '300 - 500 ms', type: 'warn', desc: 'Carga moderada en la aplicación o validación de tokens.' },
            { label: 'Saturado', range: '> 500 ms', type: 'crit', desc: 'Cuello de botella en base de datos o backend sobrecargado.' }
        ],
        troubleshooting: 'Si TCP y TLS son rápidos pero TTFB es alto, la red de la sede está perfecta: la demora reside exclusivamente en el procesamiento interno de Manhattan o en el servicio de autenticación.',
        recommendation: 'Si se utiliza autenticación por cookies/MFA, el servidor ejecuta la lógica completa del endpoint. Si se hace anónimo, responderá más rápido con 401/403.',
        guideTab: 'tab-troubleshoot'
    },
    'stats': {
        title: 'Percentiles (P95, P99) y Jitter',
        subtitle: 'Estabilidad Temporal para SLAs de Misión Crítica',
        badgeClass: 'badge-rose',
        badgeText: 'Estadística',
        icon: 'bar-chart-3',
        layer: 'Análisis Estadístico Multimuestra',
        mechanism: 'Percentil P95 / P99 y Desviación Estándar',
        description: 'Los promedios aritméticos pueden maquillar picos de latencia graves (un promedio de 250 ms puede esconder caídas periódicas de 3000 ms). El P95 garantiza que el 95% de las transacciones respondieron dentro de ese margen. El Jitter evalúa la estabilidad del canal.',
        benchmarks: [
            { label: 'Jitter Estable', range: '< 15 ms', type: 'good', desc: 'Canal de transmisión homogéneo y predecible.' },
            { label: 'Jitter Moderado', range: '15 - 40 ms', type: 'warn', desc: 'Fluctuaciones tolerables típicas de redes Wi-Fi.' },
            { label: 'Jitter Crítico', range: '> 40 ms', type: 'crit', desc: 'Inestabilidad severa de red, microcortes y bufferbloat.' }
        ],
        troubleshooting: 'Un Jitter alto indica congestión intermitente por ráfagas de tráfico, colisiones en enlaces Wi-Fi o retransmisiones en el router de la sede.',
        recommendation: 'Para acordar niveles de servicio (SLA) con el proveedor de internet o TI, utiliza siempre el percentil P95 en lugar de la media aritmética.',
        guideTab: 'tab-stats'
    },
    'locations': {
        title: 'Aislamiento y Gestión por Sedes',
        subtitle: 'Location Tagging para Auditorías Multisede',
        badgeClass: 'badge-purple',
        badgeText: 'Ubicaciones',
        icon: 'map-pin',
        layer: 'Gestión de Contexto y Persistencia',
        mechanism: 'SQLite location column + ISO 8601 timestamps',
        description: 'Permite desplegar o auditar el analizador desde diferentes sucursales (Bogotá, Medellín, Cali, Home Office) o en diferentes días sin mezclar resultados. Cada registro queda etiquetado con su sede.',
        benchmarks: [
            { label: 'Filtro Reactivo', range: 'Global', type: 'good', desc: 'Métricas, tablas y gráficos responden al filtro de sede.' },
            { label: 'Limpieza Contextual', range: 'Segura', type: 'good', desc: 'El botón Limpiar Histórico solo borra la sede filtrada.' }
        ],
        troubleshooting: 'Si deseas auditar una sede diferente, cámbiala en el menú Configuración antes de iniciar las pruebas para que los registros futuros adopten la nueva etiqueta.',
        recommendation: 'Utiliza el botón "Exportar" para descargar en CSV los resultados de una sede específica y entregar informes independientes por oficina.',
        guideTab: 'tab-locations'
    },
    'comparison': {
        title: 'Comparativa entre Sedes',
        subtitle: 'Auditoría de Rendimiento Relativo',
        badgeClass: 'badge-blue',
        badgeText: 'Benchmark',
        icon: 'git-compare',
        layer: 'Inteligencia de Datos Agrupados',
        mechanism: 'GROUP BY location (Averages, Peaks, Samples)',
        description: 'Contrasta de forma simultánea el rendimiento de cada sede registrada. Permite descubrir de inmediato cuál sucursal tiene el enlace más lento (TCP más alto), cuál tiene mejor resolución DNS y comparar los picos de cada bodega.',
        benchmarks: [
            { label: 'Equilibrio Ideal', range: 'Delta < 20%', type: 'good', desc: 'Todas las sedes operan con tiempos homogéneos.' },
            { label: 'Desviación Notoria', range: 'Delta > 40%', type: 'warn', desc: 'Una sede presenta un enlace sustancialmente más lento.' }
        ],
        troubleshooting: 'Si una sede específica tiene un TCP significativamente más alto que las demás, el problema es su proveedor de internet local o la distancia geográfica al servidor de Manhattan.',
        recommendation: 'Revisa periódicamente esta tabla para justificar upgrades de enlace de red en las sedes con mayor latencia.',
        guideTab: 'tab-locations'
    },
    'chart-breakdown': {
        title: 'Desglose Temporal por Componente (Stacked)',
        subtitle: 'Gráfico de Áreas Apiladas (DNS + TCP + TLS + TTFB)',
        badgeClass: 'badge-cyan',
        badgeText: 'Visualización',
        icon: 'activity',
        layer: 'Capa Gráfica Analítica',
        mechanism: 'Chart.js Stacked Line Dataset',
        description: 'Permite identificar visualmente qué componente específico ocasiona una lentitud. Al apilar las 4 fases secuenciales en bandas de colores (Cian para DNS, Púrpura para TCP, Ámbar para TLS y Esmeralda para TTFB), cualquier retraso ensancha de inmediato la banda de la fase culpable.',
        benchmarks: [
            { label: 'Banda Dominante Normal', range: 'TTFB', type: 'good', desc: 'Es normal que la espera del servidor ocupe la mayor porción.' },
            { label: 'Banda Anómala', range: 'TCP / TLS', type: 'warn', desc: 'Si TCP o TLS crecen, el cuello de botella es de red o SSL.' }
        ],
        troubleshooting: 'Al pasar el cursor sobre cualquier punto del gráfico, el tooltip revela el desglose exacto en milisegundos de cada fase en esa petición puntual.',
        recommendation: 'Úsalo para responder rápidamente a reportes de "el sistema se puso lento a las 10:30 am": podrás ver exactamente qué banda se elevó en ese minuto.',
        guideTab: 'tab-flow'
    },
    'chart-timeline': {
        title: 'Histórico de Latencia Total y Picos',
        subtitle: 'Línea de Tiempo Continua',
        badgeClass: 'badge-blue',
        badgeText: 'Tendencia',
        icon: 'trending-up',
        layer: 'Monitoreo de Tendencia Temporal',
        mechanism: 'Chart.js Smooth Line with Hover Inspection',
        description: 'Registra la curva cronológica continua de la latencia total. Es fundamental para detectar degradaciones progresivas del servicio, horarios pico de saturación en la bodega o microcortes de red.',
        benchmarks: [
            { label: 'Curva Plana', range: 'Óptimo', type: 'good', desc: 'Comportamiento predecible sin fluctuaciones.' },
            { label: 'Picos Aislados', range: 'Revisar', type: 'warn', desc: 'Micro-bursts esporádicos o renegociaciones de sesión.' }
        ],
        troubleshooting: 'Compara los picos con los momentos de mayor volumen de escaneo o sincronizaciones masivas de pedidos en el centro de distribución.',
        recommendation: 'Haz clic en cualquier registro correspondiente en la tabla inferior para ver el detalle de esa petición en particular.',
        guideTab: 'tab-flow'
    },
    'chart-phases': {
        title: 'Comparativa Promedio por Fase de Conexión',
        subtitle: 'Distribución Relativa en Barras (ms)',
        badgeClass: 'badge-amber',
        badgeText: 'Distribución',
        icon: 'bar-chart',
        layer: 'Resumen Global de Fases',
        mechanism: 'Chart.js Bar Chart with dynamic Zero-Scale',
        description: 'Muestra en barras verticales el tiempo promedio exacto consumido por cada una de las 5 fases de conexión. Proporciona una vista macro para contrastar la infraestructura de conexión inicial (DNS, TCP, TLS) contra el tiempo de respuesta operativo de la aplicación Manhattan (TTFB, Transferencia).',
        benchmarks: [
            { label: 'Proporción Sana', range: 'Red < 35%', type: 'good', desc: 'El canal de red y SSL toma menos de un tercio del tiempo total.' },
            { label: 'Red Saturada', range: 'Red > 60%', type: 'crit', desc: 'La infraestructura de red física está dominando la latencia.' }
        ],
        troubleshooting: 'Compara el tamaño de la barra TCP vs la barra TTFB para direccionar el caso de soporte al equipo correcto (Redes vs Aplicaciones).',
        recommendation: 'Si la barra Transferencia es alta, verifica el tamaño de respuesta en bytes de la URL auditada.',
        guideTab: 'tab-methodology'
    },
    'http-status': {
        title: 'Resumen de Respuestas HTTP',
        subtitle: 'Distribución de Códigos de Estado y Salud',
        badgeClass: 'badge-emerald',
        badgeText: 'Salud HTTP',
        icon: 'pie-chart',
        layer: 'Capa de Aplicación (Estado RFC 7231)',
        mechanism: 'Agrupación por status_code en SQLite',
        description: 'Informa la distribución de códigos HTTP devueltos por el endpoint: HTTP 200 (Éxito autenticado), HTTP 401/403 (Requiere autenticación de dominio o cookie MFA), HTTP 5xx (Error interno en servidores Manhattan) o Error 0 (Falla de red o Timeout).',
        benchmarks: [
            { label: 'HTTP 200 OK', range: '100% deseable', type: 'good', desc: 'Sesión autenticada y servidor operativo.' },
            { label: 'HTTP 401 / 403', range: 'Esperado si no hay auth', type: 'warn', desc: 'El endpoint responde pero requiere credenciales de dominio.' },
            { label: 'Errores / Timeout', range: '0% deseable', type: 'crit', desc: 'Pérdida de paquetes o servidor caído.' }
        ],
        troubleshooting: 'Si recibes HTTP 403, puedes configurar la autenticación en "Configuración" pegando la Cookie de tu sesión de navegador tras el login con MFA.',
        recommendation: 'Consulta la pestaña "6. Autenticación & MFA" en la Guía Técnica para ver el tutorial de cómo extraer la cookie con F12 en Chrome.',
        guideTab: 'tab-auth'
    },
    'history-table': {
        title: 'Histórico y Auditoría de Mediciones',
        subtitle: 'Registro Transaccional Muestra por Muestra',
        badgeClass: 'badge-purple',
        badgeText: 'Auditoría',
        icon: 'database',
        layer: 'Persistencia en Base de Datos SQLite',
        mechanism: 'SELECT * FROM records ORDER BY id DESC',
        description: 'Tabla transaccional que documenta cada una de las pruebas de latencia realizadas. Incluye ID único, fecha/hora local, sede de origen, IP resuelta, estado HTTP y el micro-cronometraje de las 5 fases.',
        benchmarks: [
            { label: 'Detalle Modal', range: 'Por Registro', type: 'good', desc: 'Haz clic en el botón "Detalle" de cualquier fila para inspección completa.' },
            { label: 'Filtro de Estados', range: 'Éxitos / Errores', type: 'good', desc: 'Filtra rápidamente solo las peticiones que presentaron error de red.' }
        ],
        troubleshooting: 'Usa la columna "IP Resuelta" para comprobar si la sede está resolviendo hacia el mismo balanceador o hacia un nodo de CDN diferente.',
        recommendation: 'Puedes exportar toda la tabla filtrada a formato CSV para entregar evidencia formal a proveedores o auditorías de TI.',
        guideTab: 'tab-troubleshoot'
    },
    'net-diag': {
        title: 'Diagnóstico de Infraestructura de Red',
        subtitle: 'Auditoría ICMP Ping y Traceroute Multi-Salto',
        badgeClass: 'badge-blue',
        badgeText: 'Capa 3 (Red)',
        icon: 'network',
        layer: 'Capa de Red / Enrutamiento (ICMP & IP TTL)',
        mechanism: 'Ping ICMP (Echo Request/Reply) + Traceroute Hop-by-Hop (MTR / Tracert)',
        description: 'Evalúa la conectividad física y de enrutamiento hacia tres elementos vitales de la red: la Puerta de Enlace Predeterminada (Gateway LAN local), los servidores DNS asignados (resolutores primario y secundario) y las direcciones IP o hosts adicionales configurados. Permite aislar si una degradación de latencia ocurre dentro de la LAN de la sede, en el enlace del proveedor de internet (ISP) o en el datacenter de Manhattan.',
        benchmarks: [
            { label: 'Gateway Local', range: '< 5 ms (0% pérdida)', type: 'good', desc: 'Conexión switch/router LAN saludable. Tiempos >10ms sugieren congestión Wi-Fi o switch saturado.' },
            { label: 'DNS Primario', range: '< 25 ms (0% pérdida)', type: 'good', desc: 'Resolutor DNS ágil. Si hay pérdida de paquetes, las consultas fallarán o aumentarán la Fase 1.' },
            { label: 'Destinos WAN', range: '< 80 ms (0% pérdida)', type: 'good', desc: 'Ruta WAN estable sin cuellos de botella en los saltos intermedios del ISP.' }
        ],
        troubleshooting: 'Si la latencia hacia el Gateway es alta o presenta pérdida de paquetes, el problema es 100% de la red local de la sede (cableado, switch, Wi-Fi o router local). Si el Gateway responde en <3ms pero un host WAN tiene alta latencia o pérdida en el salto 4 o 5, el problema reside en el ISP o en el enlace troncal.',
        recommendation: 'Haz clic en "Ruta Traceroute" en cada tarjeta para desplegar el desglose salto por salto y ver exactamente qué router introduce latencia o pérdida de paquetes.',
        guideTab: 'tab-troubleshoot'
    }
};

// Open Component Quick Help Modal
function showComponentHelp(topicKey) {
    const topic = HELP_TOPICS[topicKey];
    if (!topic) return;

    document.getElementById('compHelpTitle').textContent = topic.title;
    document.getElementById('compHelpSubtitle').textContent = topic.subtitle;
    
    const badgeEl = document.getElementById('compHelpBadge');
    badgeEl.className = `help-icon-badge ${topic.badgeClass}`;
    badgeEl.innerHTML = `<i data-lucide="${topic.icon}"></i>`;

    let benchmarksHtml = '';
    if (topic.benchmarks && topic.benchmarks.length > 0) {
        benchmarksHtml = `
            <div style="margin-top:0.6rem;">
                <strong style="font-size:0.82rem; color:#fff;">Valores de Referencia (Benchmarks):</strong>
                <div class="help-benchmark-grid">
                    ${topic.benchmarks.map(b => `
                        <div class="benchmark-card benchmark-${b.type}">
                            <strong>${b.label}: ${b.range}</strong>
                            <span>${b.desc}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    const bodyEl = document.getElementById('compHelpBody');
    bodyEl.innerHTML = `
        <div class="help-box">
            <div class="help-box-title"><i data-lucide="info"></i> ¿Qué mide y cómo opera?</div>
            <p>${topic.description}</p>
            ${topic.layer ? `<div style="margin-top:0.4rem; font-size:0.78rem; color:var(--text-secondary);"><strong>Capa de Red:</strong> ${topic.layer}</div>` : ''}
            ${topic.mechanism ? `<div class="flow-step-code" style="margin-top:0.35rem;">${topic.mechanism}</div>` : ''}
        </div>

        ${benchmarksHtml}

        <div class="help-box" style="border-left: 3px solid var(--accent-amber);">
            <div class="help-box-title" style="color:var(--accent-amber);"><i data-lucide="alert-triangle"></i> Diagnóstico de Causa Raíz</div>
            <p>${topic.troubleshooting}</p>
        </div>

        <div class="help-callout">
            <strong>Recomendación Técnica:</strong> ${topic.recommendation}
        </div>
    `;

    // Configure "Ver en Guía Completa" button
    const btnGoToGuide = document.getElementById('btnCompGoToGuide');
    btnGoToGuide.onclick = () => {
        closeModal('componentHelpModal');
        openModal('helpModal');
        if (topic.guideTab) {
            switchHelpTab(topic.guideTab);
        }
    };

    openModal('componentHelpModal');
    initLucideIcons();
}

// Switch Active Tab in General Help Modal
function switchHelpTab(tabId) {
    document.querySelectorAll('.help-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });

    document.querySelectorAll('.help-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });
}

// Initialize Help System Event Listeners
function initHelpSystem() {
    // Component Help Buttons
    document.querySelectorAll('.component-help-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const topic = btn.getAttribute('data-topic');
            if (topic) showComponentHelp(topic);
        });
    });

    // General Help Modal Trigger
    const btnOpenHelp = document.getElementById('btnOpenHelp');
    if (btnOpenHelp) {
        btnOpenHelp.addEventListener('click', () => {
            openModal('helpModal');
            initLucideIcons();
        });
    }

    const btnCloseHelp = document.getElementById('btnCloseHelp');
    if (btnCloseHelp) btnCloseHelp.addEventListener('click', () => closeModal('helpModal'));

    const btnCloseHelpFooter = document.getElementById('btnCloseHelpFooter');
    if (btnCloseHelpFooter) btnCloseHelpFooter.addEventListener('click', () => closeModal('helpModal'));

    const btnCloseCompHelp = document.getElementById('btnCloseComponentHelp');
    if (btnCloseCompHelp) btnCloseCompHelp.addEventListener('click', () => closeModal('componentHelpModal'));

    const btnCompClose = document.getElementById('btnCompClose');
    if (btnCompClose) btnCompClose.addEventListener('click', () => closeModal('componentHelpModal'));

    // Help Tabs Navigation
    document.querySelectorAll('.help-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            switchHelpTab(tabId);
            initLucideIcons();
        });
    });
}

/* ==========================================================================
   EXECUTIVE & DIAGNOSTIC REPORT SYSTEM
   ========================================================================== */
let currentReportPreset = 'today';

function getLocalDateString(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function setReportPreset(preset) {
    currentReportPreset = preset;
    const startInput = document.getElementById('reportStartDate');
    const endInput = document.getElementById('reportEndDate');
    const today = new Date();

    document.querySelectorAll('.preset-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-preset') === preset);
    });

    if (preset === 'today') {
        const str = getLocalDateString(today);
        startInput.value = str;
        endInput.value = str;
    } else if (preset === 'yesterday') {
        const y = new Date(today);
        y.setDate(y.getDate() - 1);
        const str = getLocalDateString(y);
        startInput.value = str;
        endInput.value = str;
    } else if (preset === '7d') {
        const past = new Date(today);
        past.setDate(past.getDate() - 6);
        startInput.value = getLocalDateString(past);
        endInput.value = getLocalDateString(today);
    } else if (preset === '30d') {
        const past = new Date(today);
        past.setDate(past.getDate() - 29);
        startInput.value = getLocalDateString(past);
        endInput.value = getLocalDateString(today);
    } else if (preset === 'all') {
        startInput.value = '';
        endInput.value = '';
    }
}

async function loadReportLocations() {
    try {
        const res = await fetch('/api/locations');
        const locations = await res.json();
        const select = document.getElementById('reportLocationSelect');
        if (!select) return;
        const curVal = select.value || 'all';

        let html = '<option value="all">Todas las Sedes</option>';
        locations.forEach(loc => {
            html += `<option value="${loc}">${loc}</option>`;
        });
        select.innerHTML = html;
        select.value = locations.includes(curVal) ? curVal : 'all';
    } catch (e) {
        console.error('Error loading report locations:', e);
    }
}

async function fetchAndRenderReport() {
    const container = document.getElementById('reportPrintArea');
    if (!container) return;

    container.innerHTML = `
        <div class="report-loading-state">
            <i data-lucide="loader-2" class="spin" style="width: 36px; height: 36px; color: var(--accent-blue);"></i>
            <p style="margin-top: 0.75rem; color: var(--text-secondary);">Generando informe ejecutivo y calculando hechos técnicos...</p>
        </div>
    `;
    initLucideIcons();

    const start = document.getElementById('reportStartDate').value.trim();
    const end = document.getElementById('reportEndDate').value.trim();
    const location = document.getElementById('reportLocationSelect').value;
    const zone = document.getElementById('reportZoneSelect') ? document.getElementById('reportZoneSelect').value : 'all';

    const params = new URLSearchParams();
    if (start) params.append('start', start);
    if (end) params.append('end', end);
    if (location && location !== 'all') params.append('location', location);
    if (zone && zone !== 'all') params.append('zone', zone);

    try {
        const res = await fetch(`/api/report?${params.toString()}`);
        const data = await res.json();
        renderReport(data);
    } catch (err) {
        console.error('Error fetching report:', err);
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--accent-rose);">
                <i data-lucide="alert-triangle" style="width: 32px; height: 32px; margin-bottom: 0.5rem;"></i>
                <p>Ocurrió un error al compilar el informe. Por favor intenta nuevamente.</p>
            </div>
        `;
        initLucideIcons();
    }
}

function renderReport(data) {
    const container = document.getElementById('reportPrintArea');
    if (!container) return;

    if (!data || data.total_samples === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 3rem 1rem; color: var(--text-secondary);">
                <i data-lucide="inbox" style="width: 48px; height: 48px; opacity: 0.4; margin-bottom: 0.75rem;"></i>
                <h3 style="color: #fff; font-size: 1.1rem; margin-bottom: 0.5rem;">Sin Registros en el Período</h3>
                <p style="font-size: 0.85rem; max-width: 450px; margin: 0 auto;">No se encontraron muestras de latencia entre las fechas seleccionadas o para la sede especificada. Selecciona otro rango de fechas o "Historial Completo".</p>
            </div>
        `;
        initLucideIcons();
        return;
    }

    const ttfbPct = data.averages.total > 0 ? Math.round((data.averages.ttfb / data.averages.total) * 100) : 0;
    const transferPct = data.averages.total > 0 ? Math.max(0, 100 - ttfbPct) : 0;
    const initConn = ((Number(data.averages.tcp) || 0) + (Number(data.averages.tls) || 0)).toFixed(1);
    const coldTotal = ((Number(data.averages.dns) || 0) + (Number(data.averages.tcp) || 0) + (Number(data.averages.tls) || 0) + (Number(data.averages.total) || 0)).toFixed(1);
    const nowStr = new Date().toLocaleString();
    const periodStr = (data.period.start === data.period.end) 
        ? data.period.start 
        : `${data.period.start} al ${data.period.end}`;
    const locationStr = data.location === 'all' ? 'Todas las Sedes' : data.location;
    const zoneStr = (data.zone && data.zone !== 'all') ? data.zone : 'Todas las Zonas';
    const isSlaCompliant = data.uptime_pct >= 99.0;

    // Zone Breakdown Table
    let zoneBreakdownHtml = '';
    if (data.zone_breakdown && data.zone_breakdown.length > 0) {
        zoneBreakdownHtml = `
            <div class="report-section">
                <div class="report-section-title">
                    <i data-lucide="compass"></i> Desglose de Rendimiento por Zonas de Recorrido
                </div>
                <div class="report-table-wrapper">
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Sede</th>
                                <th>Zona de Recorrido</th>
                                <th class="num">Muestras</th>
                                <th class="num">Latencia Total Media</th>
                                <th class="num">TTFB Backend</th>
                                <th class="num">Conexión TCP</th>
                                <th class="num">Pico Máximo</th>
                                <th class="num">Errores</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.zone_breakdown.map(z => `
                                <tr>
                                    <td><strong>${z.location}</strong></td>
                                    <td><span class="zone-pill ${z.zone.startsWith('(') ? 'empty' : ''}">${z.zone}</span></td>
                                    <td class="num">${z.samples}</td>
                                    <td class="num" style="color: ${(z.avg_total > 280) ? 'var(--accent-rose)' : 'var(--accent-blue)'}; font-weight: 700;">${z.avg_total} ms</td>
                                    <td class="num">${z.avg_ttfb} ms</td>
                                    <td class="num">${z.avg_tcp} ms</td>
                                    <td class="num" style="color: ${(z.peak_total > 1000) ? 'var(--accent-rose)' : 'inherit'};">${z.peak_total} ms</td>
                                    <td class="num" style="color: ${z.errors > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)'}; font-weight: ${z.errors > 0 ? '700' : 'normal'};">${z.errors}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // Highlights HTML
    let highlightsHtml = '';
    const highlights = data.analysis?.highlights || [];
    if (highlights.length > 0) {
        highlightsHtml = `
            <div class="report-section">
                <div class="report-section-title">
                    <i data-lucide="search"></i> Hechos Relevantes y Diagnóstico de Causa Raíz
                </div>
                <div class="report-facts-grid">
                    ${highlights.map(h => `
                        <div class="report-fact-card fact-${h.type || 'server'}">
                            <div class="report-fact-content">
                                <div class="report-fact-header">
                                    <span class="report-rec-pill ${h.badge_class || 'badge-blue'}">${h.badge}</span>
                                    <span class="report-fact-title">${h.title}</span>
                                </div>
                                <p class="report-fact-detail">${h.detail}</p>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // Recommendations HTML
    let recsHtml = '';
    const recommendations = data.analysis?.recommendations || [];
    if (recommendations.length > 0) {
        recsHtml = `
            <div class="report-section">
                <div class="report-section-title">
                    <i data-lucide="lightbulb"></i> Sugerencias y Recomendaciones Técnicas
                </div>
                <div class="report-recs-grid">
                    ${recommendations.map(r => {
                        let prioClass = 'prio-informativa';
                        if (r.priority === 'Alta') prioClass = 'prio-alta';
                        else if (r.priority === 'Media') prioClass = 'prio-media';
                        return `
                            <div class="report-rec-card">
                                <span class="report-rec-pill ${prioClass}">Prioridad ${r.priority}</span>
                                <div class="report-rec-body">
                                    <div class="report-rec-category">${r.category}</div>
                                    <p class="report-rec-text">${r.text}</p>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    // Latency Stages Breakdown Table
    const breakdownHtml = `
        <div class="report-section">
            <div class="report-section-title">
                <i data-lucide="layers"></i> Desglose Técnico por Fases de Red y Servidor
            </div>
            <div class="report-table-wrapper">
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>Fase de Comunicación</th>
                            <th>Entorno Responsable</th>
                            <th class="num">Promedio</th>
                            <th class="num">% del Total</th>
                            <th class="num">Mínimo</th>
                            <th class="num">Máximo</th>
                        </tr>
                    </thead>
                    <tbody>
                        <!-- Bloque 1: Latencia Operativa de Respuesta HTTP -->
                        <tr class="report-table-group-header">
                            <td colspan="6" style="background: rgba(59, 130, 246, 0.12); color: var(--accent-blue); font-weight: 700; font-size: 0.8rem; padding: 0.4rem 0.75rem;">
                                🌐 LATENCIA OPERATIVA DE RESPUESTA HTTP (METODOLOGÍA NAVEGADOR / TERMINALES PDA CON KEEP-ALIVE)
                            </td>
                        </tr>
                        <tr style="background: rgba(59, 130, 246, 0.04);">
                            <td><strong>Fase 4: TTFB (Backend)</strong></td>
                            <td>Servidor Manhattan SCE (Cálculo interno y procesamiento)</td>
                            <td class="num" style="color: var(--accent-blue); font-weight: 700;">${data.averages.ttfb} ms</td>
                            <td class="num" style="color: var(--accent-blue); font-weight: 700;">${ttfbPct}%</td>
                            <td class="num">-</td>
                            <td class="num">-</td>
                        </tr>
                        <tr>
                            <td><strong>Fase 5: Transferencia</strong></td>
                            <td>Descarga de Payload HTTP devuelto</td>
                            <td class="num">${data.averages.transfer} ms</td>
                            <td class="num">${transferPct}%</td>
                            <td class="num">-</td>
                            <td class="num">-</td>
                        </tr>
                        <tr style="font-weight: 700; background: rgba(59, 130, 246, 0.1); border-top: 1px solid rgba(59, 130, 246, 0.3);">
                            <td><span style="color: var(--accent-blue);">▶ Latencia Navegador / PDA (TTFB + Transfer)</span></td>
                            <td>Tiempo de Respuesta Efectivo en Terminal RF / Chrome</td>
                            <td class="num" style="font-size: 0.95rem; color: var(--accent-blue);">${data.averages.total} ms</td>
                            <td class="num" style="color: var(--accent-blue);">100%</td>
                            <td class="num">${data.mins.total} ms</td>
                            <td class="num" style="color: var(--accent-rose);">${data.peaks.total} ms</td>
                        </tr>

                        <!-- Bloque 2: Infraestructura de Red y Conexión Inicial -->
                        <tr class="report-table-group-header">
                            <td colspan="6" style="background: rgba(168, 85, 247, 0.12); color: var(--accent-purple); font-weight: 700; font-size: 0.8rem; padding: 0.4rem 0.75rem; border-top: 2px solid var(--border-color);">
                                🔌 INFRAESTRUCTURA DE RED Y CONEXIÓN INICIAL (INITIAL CONNECTION - SOCKET & CIFRADO)
                            </td>
                        </tr>
                        <tr>
                            <td><strong>Fase 1: DNS Lookup</strong></td>
                            <td>Resolución de Nombres Local / DNS Forwarder</td>
                            <td class="num">${data.averages.dns} ms</td>
                            <td class="num">-</td>
                            <td class="num">-</td>
                            <td class="num">-</td>
                        </tr>
                        <tr>
                            <td><strong>Fase 2: Conexión TCP</strong></td>
                            <td>Red WAN / ISP Físico (Socket 3-Way Handshake)</td>
                            <td class="num">${data.averages.tcp} ms</td>
                            <td class="num">-</td>
                            <td class="num">-</td>
                            <td class="num">-</td>
                        </tr>
                        <tr>
                            <td><strong>Fase 3: Negociación TLS / SSL</strong></td>
                            <td>Capa Criptográfica HTTPS / Terminador SSL</td>
                            <td class="num">${data.averages.tls} ms</td>
                            <td class="num">-</td>
                            <td class="num">-</td>
                            <td class="num">-</td>
                        </tr>
                        <tr style="font-weight: 700; background: rgba(168, 85, 247, 0.08); border-top: 1px solid rgba(168, 85, 247, 0.25);">
                            <td><span style="color: var(--accent-purple);">▶ Subtotal Conexión Inicial (TCP + TLS)</span></td>
                            <td>Establecimiento del Canal Seguro de Transporte</td>
                            <td class="num" style="color: var(--accent-purple);">${initConn} ms</td>
                            <td class="num">-</td>
                            <td class="num">-</td>
                            <td class="num">-</td>
                        </tr>

                        <!-- Bloque 3: Arranque en Frío -->
                        <tr style="font-weight: 600; background: rgba(255, 255, 255, 0.03); border-top: 1px solid var(--border-color); font-size: 0.82rem; color: var(--text-muted);">
                            <td>❄️ Arranque en Frío Acumulado (Cold Start)</td>
                            <td>Apertura de Socket desde cero (DNS + TCP + TLS + HTTP)</td>
                            <td class="num" style="color: #fff;">${coldTotal} ms</td>
                            <td class="num">-</td>
                            <td class="num">-</td>
                            <td class="num">-</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Percentiles Row -->
            <div style="display: flex; gap: 1rem; margin-top: 0.75rem; flex-wrap: wrap; font-size: 0.78rem; color: var(--text-secondary); background: rgba(255,255,255,0.02); padding: 0.5rem 0.85rem; border-radius: 6px; border: 1px solid var(--border-color);">
                <span><strong>Percentiles Totales:</strong></span>
                <span>P50 (Mediana): <strong style="color: #fff;">${data.percentiles.p50} ms</strong></span>
                <span>P90: <strong style="color: #fff;">${data.percentiles.p90} ms</strong></span>
                <span>P95: <strong style="color: #fff;">${data.percentiles.p95} ms</strong></span>
                <span>P99: <strong style="color: #fff;">${data.percentiles.p99} ms</strong></span>
                <span>Jitter (Desviación): <strong style="color: #fff;">±${data.jitter} ms</strong></span>
            </div>
        </div>
    `;

    // Daily breakdown table
    let dailyHtml = '';
    if (data.daily_breakdown && data.daily_breakdown.length > 0) {
        dailyHtml = `
            <div class="report-section">
                <div class="report-section-title">
                    <i data-lucide="calendar"></i> Evolución Diaria en el Período
                </div>
                <div class="report-table-wrapper">
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th class="num">Muestras</th>
                                <th class="num">Latencia Total Promedio</th>
                                <th class="num">TTFB Servidor</th>
                                <th class="num">TCP Físico</th>
                                <th class="num">Pico Máximo</th>
                                <th class="num">Errores</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.daily_breakdown.map(d => `
                                <tr>
                                    <td><strong>${d.day}</strong></td>
                                    <td class="num">${d.samples}</td>
                                    <td class="num">${d.avg_total} ms</td>
                                    <td class="num">${d.avg_ttfb} ms</td>
                                    <td class="num">${d.avg_tcp} ms</td>
                                    <td class="num" style="color: ${d.peak_total > 1000 ? 'var(--accent-rose)' : 'inherit'};">${d.peak_total} ms</td>
                                    <td class="num" style="color: ${d.errors > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)'}; font-weight: ${d.errors > 0 ? '700' : 'normal'};">${d.errors}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // Worst peaks table
    let peaksHtml = '';
    if (data.worst_peaks && data.worst_peaks.length > 0) {
        peaksHtml = `
            <div class="report-section">
                <div class="report-section-title">
                    <i data-lucide="zap-off"></i> Top 5 Peores Picos de Latencia Registrados
                </div>
                <div class="report-table-wrapper">
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Fecha y Hora</th>
                                <th>Sede</th>
                                <th class="num">Latencia Total</th>
                                <th class="num">TTFB Servidor</th>
                                <th class="num">TCP Conexión</th>
                                <th class="num">TLS Handshake</th>
                                <th>Código / Causa</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.worst_peaks.map(p => `
                                <tr>
                                    <td style="font-family: var(--font-mono); font-size: 0.75rem;">${p.created_at}</td>
                                    <td>${p.location}</td>
                                    <td class="num" style="color: var(--accent-rose); font-weight: 700;">${p.total_ms} ms</td>
                                    <td class="num">${p.ttfb_ms} ms</td>
                                    <td class="num">${p.tcp_ms} ms</td>
                                    <td class="num">${p.tls_ms} ms</td>
                                    <td>
                                        <span class="report-rec-pill ${p.status_code === 200 ? 'prio-alta' : 'prio-media'}">
                                            HTTP ${p.status_code || 'ERR'}
                                        </span>
                                        ${p.error_message ? `<span class="text-xs" style="color: var(--accent-rose); margin-left: 4px;">${p.error_message}</span>` : ''}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // ICMP Infrastructure Diagnostic Summary
    const gwPing = data.icmp_summary?.gateway?.avg_ms != null ? `${data.icmp_summary.gateway.avg_ms} ms` : 'N/A';
    const gwLoss = data.icmp_summary?.gateway?.loss_pct != null ? `${data.icmp_summary.gateway.loss_pct}%` : '0%';
    const dnsPing = data.icmp_summary?.dns?.avg_ms != null ? `${data.icmp_summary.dns.avg_ms} ms` : 'N/A';
    const dnsLoss = data.icmp_summary?.dns?.loss_pct != null ? `${data.icmp_summary.dns.loss_pct}%` : '0%';
    const extraPing = data.icmp_summary?.extra?.avg_ms != null ? `${data.icmp_summary.extra.avg_ms} ms` : 'N/A';
    const extraLoss = data.icmp_summary?.extra?.loss_pct != null ? `${data.icmp_summary.extra.loss_pct}%` : '0%';

    const icmpHtml = `
        <div class="report-section">
            <div class="report-section-title">
                <i data-lucide="network"></i> Estado de Infraestructura de Red Local e Internet (ICMP & Traceroute)
            </div>
            <div class="report-table-wrapper">
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>Destino Evaluado</th>
                            <th>Tipo de Enlace</th>
                            <th class="num">Latencia ICMP Media</th>
                            <th class="num">Pérdida de Paquetes</th>
                            <th>Diagnóstico de Capa Física</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><strong>Default Gateway</strong></td>
                            <td>Puerta de Enlace LAN Local</td>
                            <td class="num">${gwPing}</td>
                            <td class="num" style="color: ${parseFloat(gwLoss) > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)'}; font-weight: 700;">${gwLoss}</td>
                            <td>${parseFloat(gwLoss) === 0 ? '✅ Segmento LAN Estable sin saturación' : '⚠️ Alerta en Switch o Router local'}</td>
                        </tr>
                        <tr>
                            <td><strong>Servidores DNS</strong></td>
                            <td>Resolutores de Red / WAN</td>
                            <td class="num">${dnsPing}</td>
                            <td class="num" style="color: ${parseFloat(dnsLoss) > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)'}; font-weight: 700;">${dnsLoss}</td>
                            <td>${parseFloat(dnsLoss) === 0 ? '✅ Resolución DNS sin pérdidas' : '⚠️ Pérdida de paquetes hacia servidores DNS'}</td>
                        </tr>
                        <tr>
                            <td><strong>IPs Adicionales</strong></td>
                            <td>Nodos Corporativos / Core WAN</td>
                            <td class="num">${extraPing}</td>
                            <td class="num" style="color: ${parseFloat(extraLoss) > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)'}; font-weight: 700;">${extraLoss}</td>
                            <td>${parseFloat(extraLoss) === 0 ? '✅ Conectividad WAN directa operativa' : '⚠️ Pérdida de paquetes hacia nodos auxiliares'}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // Render entire document
    container.innerHTML = `
        <!-- Document Header -->
        <div class="report-doc-header">
            <div class="report-doc-title">
                <h1>AUDITORÍA DE LATENCIA Y CONECTIVIDAD — MANHATTAN SCE</h1>
                <p>Informe Técnico de Rendimiento, Correlación de Causa Raíz y Cumplimiento de Niveles de Servicio</p>
            </div>
            <div class="report-meta-box">
                <div class="report-meta-item">
                    <strong>Período:</strong> <span>${periodStr}</span>
                </div>
                <div class="report-meta-item">
                    <strong>Alcance:</strong> <span>${locationStr}</span>
                </div>
                <div class="report-meta-item">
                    <strong>Zona:</strong> <span>${zoneStr}</span>
                </div>
                <div class="report-meta-item">
                    <strong>Muestras:</strong> <span>${data.total_samples} peticiones</span>
                </div>
                <div class="report-meta-item">
                    <strong>Emisión:</strong> <span>${nowStr}</span>
                </div>
            </div>
        </div>

        <!-- 4 Executive KPI Cards -->
        <div class="report-kpi-grid">
            <div class="report-kpi-card">
                <div class="report-kpi-label">Latencia Navegador / PDA (Media)</div>
                <div class="report-kpi-value">${data.averages.total} <span style="font-size: 1rem; font-weight: 500;">ms</span></div>
                <div class="report-kpi-sub">Backend TTFB: <strong>${data.averages.ttfb} ms</strong> (${ttfbPct}%) | Conexión Inicial TCP+TLS: <strong>${initConn} ms</strong></div>
            </div>

            <div class="report-kpi-card kpi-uptime">
                <div class="report-kpi-label">Disponibilidad de Servicio</div>
                <div class="report-kpi-value" style="color: var(--accent-emerald);">${data.uptime_pct}%</div>
                <div class="report-kpi-sub">${data.successful_samples} exitosas • ${data.error_samples} fallos (${isSlaCompliant ? 'Cumple SLA' : 'SLA Degradado'})</div>
            </div>

            <div class="report-kpi-card kpi-peaks">
                <div class="report-kpi-label">Picos y Percentil 95 (P95)</div>
                <div class="report-kpi-value" style="color: var(--accent-rose);">${data.percentiles.p95} <span style="font-size: 1rem; font-weight: 500;">ms</span></div>
                <div class="report-kpi-sub">Pico Máximo: <strong>${data.peaks.total} ms</strong> | Jitter: <strong>±${data.jitter} ms</strong></div>
            </div>

            <div class="report-kpi-card kpi-lan">
                <div class="report-kpi-label">Puerta de Enlace LAN</div>
                <div class="report-kpi-value" style="color: var(--accent-amber);">${gwPing}</div>
                <div class="report-kpi-sub">Pérdida local: <strong>${gwLoss}</strong> | Pruebas ICMP: <strong>${data.icmp_summary?.total_runs || 0}</strong></div>
            </div>
        </div>

        ${highlightsHtml}
        ${recsHtml}
        ${breakdownHtml}
        ${zoneBreakdownHtml}
        ${dailyHtml}
        ${peaksHtml}
        ${icmpHtml}
    `;

    initLucideIcons();
}

// Exclude a network node from ICMP tests
async function excludeNetNode(host, name) {
    if (!confirm(`¿Deseas excluir '${name}' (${host}) de las pruebas de diagnóstico de red?`)) {
        return;
    }
    try {
        const res = await fetch('/api/config');
        const cfg = await res.json();
        let currentExcluded = cfg.excluded_ping_targets || '';
        let list = currentExcluded.split(/[,;\s\n]+/).map(s => s.trim()).filter(Boolean);
        if (!list.includes(host)) {
            list.push(host);
        }
        cfg.excluded_ping_targets = list.join(', ');
        
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cfg)
        });
        
        await fetchNetDiag();
    } catch (err) {
        alert('Error al excluir el nodo: ' + err);
    }
}


// ==========================================
// TOAST NOTIFICATIONS & SEDES/ZONAS IMPORT
// ==========================================

function showToast(message, type = "info", duration = 4000) {
    let container = document.querySelector(".toast-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast-msg ${type}`;
    
    let iconName = "info";
    if (type === "success") iconName = "check-circle";
    else if (type === "error") iconName = "alert-octagon";
    else if (type === "warning") iconName = "alert-triangle";

    toast.innerHTML = `
        <i data-lucide="${iconName}" style="width: 20px; height: 20px; flex-shrink: 0;"></i>
        <div style="flex: 1;">${escapeHtml(message)}</div>
    `;

    container.appendChild(toast);
    initLucideIcons();

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(15px) scale(0.95)";
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

let pendingImportData = null;

function initSedesZonasImport() {
    const btnQuick = document.getElementById("btnQuickImportZones");
    if (btnQuick) {
        btnQuick.addEventListener("click", () => {
            openModal("configModal");
            setTimeout(() => {
                const panel = document.querySelector(".import-sedes-zonas-panel");
                if (panel) panel.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 180);
        });
    }

    const dropzone = document.getElementById("dropzoneSedesZonas");
    const fileInput = document.getElementById("fileSedesZonasInput");
    const previewBox = document.getElementById("importPreviewBox");
    const previewTitle = document.getElementById("importPreviewTitle");
    const previewDetails = document.getElementById("importPreviewDetails");
    const btnCancel = document.getElementById("btnCancelImportPreview");
    const btnExecute = document.getElementById("btnExecuteImport");

    if (dropzone && fileInput) {
        dropzone.addEventListener("click", () => fileInput.click());

        dropzone.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropzone.style.borderColor = "#38bdf8";
            dropzone.style.background = "rgba(56, 189, 248, 0.15)";
        });

        ["dragleave", "dragend"].forEach(evt => {
            dropzone.addEventListener(evt, () => {
                dropzone.style.borderColor = "rgba(56, 189, 248, 0.35)";
                dropzone.style.background = "rgba(30, 41, 59, 0.3)";
            });
        });

        dropzone.addEventListener("drop", (e) => {
            e.preventDefault();
            dropzone.style.borderColor = "rgba(56, 189, 248, 0.35)";
            dropzone.style.background = "rgba(30, 41, 59, 0.3)";
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleSedesZonasFile(e.dataTransfer.files[0]);
            }
        });

        fileInput.addEventListener("change", () => {
            if (fileInput.files && fileInput.files.length > 0) {
                handleSedesZonasFile(fileInput.files[0]);
            }
        });
    }

    if (btnCancel) {
        btnCancel.addEventListener("click", () => {
            pendingImportData = null;
            if (fileInput) fileInput.value = "";
            if (previewBox) previewBox.style.display = "none";
        });
    }

    if (btnExecute) {
        btnExecute.addEventListener("click", async () => {
            if (!pendingImportData) return;
            const modeInput = document.querySelector('input[name="importMode"]:checked');
            const mode = modeInput ? modeInput.value : "merge";
            
            btnExecute.disabled = true;
            btnExecute.innerHTML = '<i data-lucide="loader"></i> Procesando e importando...';
            initLucideIcons();

            try {
                const res = await fetch("/api/zones/import", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        file_content: pendingImportData.content,
                        file_type: pendingImportData.fileType,
                        mode: mode
                    })
                });

                const data = await res.json();
                if (data.success) {
                    showToast(data.message || `¡Precarga exitosa! ${data.locations_count} sedes configuradas.`, "success");
                    if (previewBox) previewBox.style.display = "none";
                    pendingImportData = null;
                    if (fileInput) fileInput.value = "";
                    
                    // Reload locations, zones and update UI
                    await fetchLocations();
                    await fetchZones();
                    await loadConfig();
                    await refreshAllData();
                } else {
                    showToast(data.error || "Error al importar archivo", "error");
                }
            } catch (err) {
                console.error("Error importing sedes/zonas:", err);
                showToast("Error de conexión al importar: " + err.message, "error");
            } finally {
                btnExecute.disabled = false;
                btnExecute.innerHTML = '<i data-lucide="check-circle-2"></i> Confirmar y Aplicar al Catálogo de Sedes';
                initLucideIcons();
            }
        });
    }

    // Template download buttons
    const btnCsvTmpl = document.getElementById("btnDownloadCsvTemplate");
    if (btnCsvTmpl) {
        btnCsvTmpl.addEventListener("click", () => {
            window.location.href = "/api/zones/template?format=csv";
        });
    }

    const btnJsonTmpl = document.getElementById("btnDownloadJsonTemplate");
    if (btnJsonTmpl) {
        btnJsonTmpl.addEventListener("click", () => {
            window.location.href = "/api/zones/template?format=json";
        });
    }

    // Export buttons
    const btnExportJson = document.getElementById("btnExportCurrentJson");
    if (btnExportJson) {
        btnExportJson.addEventListener("click", () => {
            window.location.href = "/api/zones/export?format=json";
        });
    }

    const btnExportCsv = document.getElementById("btnExportCurrentCsv");
    if (btnExportCsv) {
        btnExportCsv.addEventListener("click", () => {
            window.location.href = "/api/zones/export?format=csv";
        });
    }
}

function handleSedesZonasFile(file) {
    if (!file) return;
    const isJson = file.name.endsWith(".json") || file.type.includes("json");
    const isCsv = file.name.endsWith(".csv") || file.type.includes("csv") || file.type.includes("text");

    if (!isJson && !isCsv) {
        showToast("Formato no soportado. Por favor selecciona un archivo .json o .csv", "warning");
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        try {
            let detectedLocations = {};
            if (isJson) {
                const parsed = JSON.parse(text);
                if (typeof parsed === "object" && !Array.isArray(parsed)) {
                    for (const [loc, zones] of Object.entries(parsed)) {
                        detectedLocations[loc] = Array.isArray(zones) ? zones.length : 1;
                    }
                } else if (Array.isArray(parsed)) {
                    parsed.forEach(item => {
                        const loc = item.sede || item.location || "Sin Sede";
                        detectedLocations[loc] = (detectedLocations[loc] || 0) + (Array.isArray(item.zonas) ? item.zonas.length : 1);
                    });
                }
            } else {
                // CSV preview
                const lines = text.split("\n").map(l => l.trim()).filter(l => l);
                const delim = lines[0] && lines[0].includes(";") ? ";" : ",";
                lines.slice(1).forEach(line => {
                    const parts = line.split(delim);
                    if (parts.length > 0 && parts[0].trim()) {
                        const loc = parts[0].trim().replace(/^[\"\']|[\"\']$/g, "");
                        if (loc && !["sede", "location"].includes(loc.toLowerCase())) {
                            detectedLocations[loc] = (detectedLocations[loc] || 0) + 1;
                        }
                    }
                });
            }

            const locKeys = Object.keys(detectedLocations);
            if (locKeys.length === 0) {
                showToast("No se pudieron detectar sedes o zonas en el archivo.", "warning");
                return;
            }

            const totalZones = Object.values(detectedLocations).reduce((a, b) => a + b, 0);
            pendingImportData = {
                file: file,
                content: text,
                fileType: isJson ? "json" : "csv",
                detectedLocations: detectedLocations
            };

            const previewBox = document.getElementById("importPreviewBox");
            const previewTitle = document.getElementById("importPreviewTitle");
            const previewDetails = document.getElementById("importPreviewDetails");

            if (previewTitle) {
                previewTitle.innerHTML = `<i data-lucide="check"></i> Archivo listo: <strong>${escapeHtml(file.name)}</strong> (${locKeys.length} sedes, ~${totalZones} zonas)`;
            }
            if (previewDetails) {
                previewDetails.innerHTML = locKeys.map(loc => `• <strong>${escapeHtml(loc)}</strong>: ${detectedLocations[loc]} zona(s)`).join("<br>");
            }
            if (previewBox) {
                previewBox.style.display = "block";
            }
            initLucideIcons();
        } catch (err) {
            console.error("Error parsing file preview:", err);
            showToast("Error al leer el archivo: " + err.message, "error");
        }
    };
    reader.readAsText(file);
}
