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
        if (confirm('¿Está seguro de que desea eliminar todos los registros históricos?')) {
            try {
                await fetch('/api/clear', { method: 'POST' });
                refreshAllData();
                fetchLocations();
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
                auto_probe_enabled: autoEnabled
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
                    '#06b6d4',
                    '#c084fc',
                    '#fbbf24',
                    '#34d399',
                    '#38bdf8'
                ],
                borderRadius: 6
            }]
        },
        options: {
            ...chartOptionsBase,
            indexAxis: 'y'
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
        averages.dns || 0,
        averages.tcp || 0,
        averages.tls || 0,
        averages.ttfb || 0,
        averages.transfer || 0
    ];
    chartPhaseBarInstance.update();
}
