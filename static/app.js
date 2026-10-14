// Manhattan Latency Analyzer Frontend Application Logic

let chartBreakdownInstance = null;
let chartTimelineInstance = null;
let chartPhaseBarInstance = null;

let autoRefreshTimer = null;
const REFRESH_INTERVAL_MS = 4000;

document.addEventListener('DOMContentLoaded', () => {
    initLucideIcons();
    initCharts();
    setupEventListeners();
    loadConfig();
    fetchLocations();
    refreshAllData();

    // Start auto-refresh polling
    autoRefreshTimer = setInterval(refreshAllData, REFRESH_INTERVAL_MS);
});

function initLucideIcons() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Event Listeners setup
function setupEventListeners() {
    initHelpSystem();
    // Manual Probe Trigger
    document.getElementById('btnProbeNow').addEventListener('click', runManualProbe);

    // Modal controls
    document.getElementById('btnOpenConfig').addEventListener('click', () => openModal('configModal'));
    document.getElementById('btnCloseConfig').addEventListener('click', () => closeModal('configModal'));
    document.getElementById('btnCloseDetail').addEventListener('click', () => closeModal('detailModal'));

    // Config Save
    document.getElementById('btnSaveConfig').addEventListener('click', saveConfig);

    // Export CSV
    document.getElementById('btnExport').addEventListener('click', () => {
        const loc = document.getElementById('filterLocationSelect').value;
        let url = '/api/export?format=csv';
        if (loc && loc !== 'all') {
            url += `&location=${encodeURIComponent(loc)}`;
        }
        window.location.href = url;
    });

    // Clear History
    document.getElementById('btnClearHistory').addEventListener('click', async () => {
        const loc = document.getElementById('filterLocationSelect').value;
        const isSpecific = loc && loc !== 'all';
        const msg = isSpecific
            ? `¿Está seguro de que desea eliminar todos los registros históricos de la sede "${loc}"?`
            : '¿Está seguro de que desea eliminar todos los registros históricos de todas las sedes?';

        if (confirm(msg)) {
            try {
                let url = '/api/clear';
                if (isSpecific) {
                    url += `?location=${encodeURIComponent(loc)}`;
                }
                await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(isSpecific ? { location: loc } : {})
                });
                await fetchLocations();
                refreshAllData();
            } catch (err) {
                alert('Error al borrar el histórico: ' + err);
            }
        }
    });

    // Filters Change
    document.getElementById('filterStatus').addEventListener('change', fetchHistory);
    document.getElementById('filterLocationSelect').addEventListener('change', () => {
        refreshAllData();
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

// Fetch configuration from server
async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        const cfg = await res.json();
        
        document.getElementById('targetUrlBadge').textContent = cfg.target_url || 'https://alkop.sce.manh.com/ping';
        document.getElementById('currentLocationBadge').textContent = cfg.location_name || 'Sede Principal';
        
        document.getElementById('cfgLocationName').value = cfg.location_name || 'Sede Principal';
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

        const statusLabel = document.querySelector('.status-label');
        const statusDot = document.querySelector('.status-dot');
        if (cfg.auto_probe_enabled === '1') {
            statusLabel.textContent = 'Monitoreando';
            statusDot.className = 'status-dot pulsing';
        } else {
            statusLabel.textContent = 'Pausado';
            statusDot.className = 'status-dot';
        }
    } catch (err) {
        console.error('Error cargando configuración:', err);
    }
}

// Save configuration to server
async function saveConfig() {
    const locationName = document.getElementById('cfgLocationName').value.trim() || 'Sede Principal';
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

    if (!targetUrl) {
        alert('Por favor ingrese una URL válida.');
        return;
    }

    try {
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                location_name: locationName,
                target_url: targetUrl,
                interval_seconds: interval,
                timeout_seconds: timeout,
                auto_probe_enabled: autoEnabled,
                auth_enabled: authEnabled,
                auth_type: authType,
                auth_domain: authDomain,
                auth_user: authUser,
                auth_password: authPassword,
                auth_token: authToken
            })
        });

        closeModal('configModal');
        await loadConfig();
        await fetchLocations();
        refreshAllData();
    } catch (err) {
        alert('Error al guardar configuración: ' + err);
    }
}

// Fetch list of distinct locations from database
async function fetchLocations() {
    try {
        const res = await fetch('/api/locations');
        const locations = await res.json();
        const select = document.getElementById('filterLocationSelect');
        const currentVal = select.value;

        let html = `<option value="all">Todas las Sedes</option>`;
        locations.forEach(loc => {
            html += `<option value="${loc}">${loc}</option>`;
        });
        select.innerHTML = html;
        if (locations.includes(currentVal)) {
            select.value = currentVal;
        }
    } catch (err) {
        console.error('Error fetching locations:', err);
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
        const res = await fetch('/api/probe/now');
        const data = await res.json();
        
        btn.disabled = false;
        btn.innerHTML = origHTML;
        initLucideIcons();

        await fetchLocations();
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
        fetchComparison()
    ]);
}

// Fetch stats and update metric cards
async function fetchStats() {
    try {
        const loc = document.getElementById('filterLocationSelect').value;
        let url = '/api/stats';
        if (loc && loc !== 'all') {
            url += `?location=${encodeURIComponent(loc)}`;
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

// Fetch comparative metrics by location
async function fetchComparison() {
    try {
        const res = await fetch('/api/comparison');
        const rows = await res.json();
        const tbody = document.getElementById('locationComparisonBody');

        if (!rows || rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No hay suficientes datos registradas para comparar sedes.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(r => `
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

    } catch (err) {
        console.error('Error fetching comparison:', err);
    }
}

// Fetch historical log entries
async function fetchHistory() {
    try {
        const statusVal = document.getElementById('filterStatus').value;
        const locVal = document.getElementById('filterLocationSelect').value;

        let url = `/api/history?limit=50&status=${statusVal}`;
        if (locVal && locVal !== 'all') {
            url += `&location=${encodeURIComponent(locVal)}`;
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
            tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted">No se encontraron registros de latencia para este filtro.</td></tr>`;
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

            return `
                <tr>
                    <td>#${r.id}</td>
                    <td>${dateStr}</td>
                    <td><span class="loc-pill">${locationTag}</span></td>
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

    body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:0.75rem; font-family: var(--font-mono); font-size: 0.88rem;">
            <div><strong>ID Registro:</strong> #${r.id}</div>
            <div><strong>Fecha & Hora:</strong> ${dateStr}</div>
            <div><strong>Sede / Ubicación:</strong> <span class="loc-pill">${r.location || 'Sede Principal'}</span></div>
            <div><strong>URL Probe:</strong> ${r.url}</div>
            <div><strong>IP Resuelta:</strong> ${r.ip || 'Sin resolución'}</div>
            <div><strong>Estado HTTP:</strong> ${r.is_error ? `<span class="text-danger">${r.error_message}</span>` : `HTTP ${r.status_code}`}</div>
            <div><strong>Tamaño Respuesta:</strong> ${r.response_size_bytes} bytes</div>

            <hr style="border-color: var(--border-color); margin: 0.5rem 0;">

            <div><strong>1. Resolución DNS:</strong> ${r.dns_ms} ms</div>
            <div><strong>2. Conexión TCP:</strong> ${r.tcp_ms} ms</div>
            <div><strong>3. TLS/SSL Handshake:</strong> ${r.tls_ms} ms</div>
            <div><strong>4. Tiempo de Espera (TTFB):</strong> ${r.ttfb_ms} ms</div>
            <div><strong>5. Transferencia Datos:</strong> ${r.transfer_ms} ms</div>
            <div style="font-size:1.1rem; color: var(--accent-blue); margin-top:0.4rem;">
                <strong>TIEMPO TOTAL:</strong> ${r.total_ms} ms
            </div>
        </div>
    `;
    openModal('detailModal');
}

// Chart.js Initialization
function initCharts() {
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
        title: 'Latencia Total Promedio',
        subtitle: 'Tiempo Acumulado End-to-End',
        badgeClass: 'badge-blue',
        badgeText: 'Métrica Global',
        icon: 'clock',
        layer: 'Capa 1 a 7 (Extremo a Extremo)',
        mechanism: 'T_Total = T_DNS + T_TCP + T_TLS + T_TTFB + T_Transfer',
        description: 'Mide el tiempo total acumulado desde que se inicia la resolución del nombre de dominio hasta que el cliente recibe y descarga completamente la respuesta HTTP devuelta por el servidor de Manhattan. Es la suma estrictamente secuencial y desacoplada de cada fase.',
        benchmarks: [
            { label: 'Excelente', range: '< 450 ms', type: 'good', desc: 'Respuesta fluida para terminales RF y estaciones de empaque.' },
            { label: 'Aceptable', range: '450 - 800 ms', type: 'warn', desc: 'Leve retraso perceptible en operaciones de alta velocidad.' },
            { label: 'Crítico', range: '> 800 ms', type: 'crit', desc: 'Riesgo inminente de congelamiento o timeout en bodega.' }
        ],
        troubleshooting: 'Si la latencia total es elevada, inspecciona el gráfico de Desglose Temporal Apilado para identificar cuál de las 4 fases (DNS, TCP, TLS o TTFB) causó el incremento.',
        recommendation: 'Aísla el problema: si TCP es alto el problema es del enlace/ISP; si TTFB es alto el problema es del servidor de Manhattan.',
        guideTab: 'tab-methodology'
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
        description: 'Muestra en barras verticales el tiempo promedio exacto consumido por cada una de las 5 fases de conexión. Proporciona una vista macro para responder de un vistazo: ¿la mayor parte del tiempo se va en la red (TCP) o en el servidor (TTFB)?',
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
