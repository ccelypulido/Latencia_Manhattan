import sqlite3
import datetime
import math
import json
from typing import Dict, Any, List, Optional

DB_FILE = "latency_history.db"

def get_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initializes SQLite tables and performs migrations if needed."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL NOT NULL,
                created_at TEXT NOT NULL,
                url TEXT NOT NULL,
                ip TEXT,
                status_code INTEGER,
                dns_ms REAL,
                tcp_ms REAL,
                tls_ms REAL,
                ttfb_ms REAL,
                transfer_ms REAL,
                total_ms REAL,
                is_error INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                response_size_bytes INTEGER DEFAULT 0,
                location TEXT DEFAULT 'Sede Principal'
            )
        """)

        # Migration: Ensure location column exists for existing databases
        cursor.execute("PRAGMA table_info(records)")
        columns = [column[1] for column in cursor.fetchall()]
        if 'location' not in columns:
            cursor.execute("ALTER TABLE records ADD COLUMN location TEXT DEFAULT 'Sede Principal'")

        # Migration: Adjust historical total_ms to Browser / PDA methodology (TTFB + Transfer)
        # Old logic had total_ms = dns + tcp + tls + ttfb + transfer (~380-450ms)
        # Browser / PDA (Chrome DevTools W3C Resource Timing) measures HTTP response turnaround = TTFB + Transfer (~180-250ms)
        cursor.execute("""
            UPDATE records 
            SET total_ms = ROUND(ttfb_ms + transfer_ms, 2) 
            WHERE total_ms > (ttfb_ms + transfer_ms + 5) AND is_error = 0 AND (ttfb_ms + transfer_ms) > 0
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS net_diag_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL NOT NULL,
                created_at TEXT NOT NULL,
                location TEXT DEFAULT 'Sede Principal',
                results_json TEXT NOT NULL
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        # Default configuration values
        defaults = {
            "target_url": "https://alkop.sce.manh.com/ping",
            "interval_seconds": "10",
            "timeout_seconds": "5",
            "auto_probe_enabled": "1",
            "location_name": "Sede Principal",
            "auth_enabled": "0",
            "auth_type": "ntlm",
            "auth_domain": "",
            "auth_user": "",
            "auth_password": "",
            "auth_token": "",
            "extra_ping_targets": "",
            "excluded_ping_targets": "",
            "net_diag_interval_minutes": "15" 
        }
        for k, v in defaults.items():
            cursor.execute("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)", (k, v))
        conn.commit()

def save_record(record: Dict[str, Any], location: Optional[str] = None) -> int:
    """Inserts a new latency measurement record with location tagging into SQLite."""
    created_at = datetime.datetime.fromtimestamp(record['timestamp'], tz=datetime.timezone.utc).isoformat()
    if not location:
        cfg = get_config()
        location = cfg.get("location_name", "Sede Principal")

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO records (
                timestamp, created_at, url, ip, status_code,
                dns_ms, tcp_ms, tls_ms, ttfb_ms, transfer_ms, total_ms,
                is_error, error_message, response_size_bytes, location
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            record['timestamp'],
            created_at,
            record['url'],
            record.get('ip'),
            record.get('status_code', 0),
            record.get('dns_ms', 0.0),
            record.get('tcp_ms', 0.0),
            record.get('tls_ms', 0.0),
            record.get('ttfb_ms', 0.0),
            record.get('transfer_ms', 0.0),
            record.get('total_ms', 0.0),
            1 if record.get('is_error') else 0,
            record.get('error_message'),
            record.get('response_size_bytes', 0),
            location
        ))
        conn.commit()
        return cursor.lastrowid

def get_history(limit: int = 100, offset: int = 0, status_filter: Optional[str] = None, location_filter: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieves historical latency records with filtering options."""
    with get_connection() as conn:
        cursor = conn.cursor()
        query = "SELECT * FROM records WHERE 1=1"
        params = []

        if status_filter == 'success':
            query += " AND is_error = 0"
        elif status_filter == 'error':
            query += " AND is_error = 1"

        if location_filter and location_filter != 'all':
            query += " AND location = ?"
            params.append(location_filter)

        query += " ORDER BY id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor.execute(query, params)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

def get_locations() -> List[str]:
    """Returns list of distinct location tags recorded in the database."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT location FROM records WHERE location IS NOT NULL AND location != '' ORDER BY location ASC")
        rows = cursor.fetchall()
        return [r[0] for r in rows]

def calculate_percentile(sorted_list: List[float], p: float) -> float:
    """Calculates percentile p (0 to 100) from a sorted list of floats."""
    if not sorted_list:
        return 0.0
    n = len(sorted_list)
    if n == 1:
        return sorted_list[0]
    k = (n - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_list[int(k)]
    d0 = sorted_list[int(f)] * (c - k)
    d1 = sorted_list[int(c)] * (k - f)
    return round(d0 + d1, 2)

def get_statistics(location_filter: Optional[str] = None) -> Dict[str, Any]:
    """Calculates overall statistics, averages, peaks, percentiles filtered by location."""
    with get_connection() as conn:
        cursor = conn.cursor()

        where_clause = " WHERE 1=1"
        params = []
        if location_filter and location_filter != 'all':
            where_clause += " AND location = ?"
            params.append(location_filter)

        # Basic counts
        cursor.execute(f"SELECT COUNT(*) FROM records{where_clause}", params)
        total_samples = cursor.fetchone()[0]

        if total_samples == 0:
            return {
                "total_samples": 0,
                "successful_samples": 0,
                "error_samples": 0,
                "uptime_percentage": 100.0,
                "averages": {"total": 0, "dns": 0, "tcp": 0, "tls": 0, "ttfb": 0, "transfer": 0},
                "peaks": {"total": 0, "dns": 0, "tcp": 0, "tls": 0, "ttfb": 0, "transfer": 0},
                "mins": {"total": 0, "dns": 0, "tcp": 0, "tls": 0, "ttfb": 0, "transfer": 0},
                "percentiles": {"p50": 0, "p90": 0, "p95": 0, "p99": 0},
                "jitter": 0.0,
                "status_codes": {}
            }

        cursor.execute(f"SELECT COUNT(*) FROM records{where_clause} AND is_error = 0", params)
        successful_samples = cursor.fetchone()[0]
        error_samples = total_samples - successful_samples
        uptime_percentage = round((successful_samples / total_samples) * 100, 2)

        # Averages, Peaks, Mins
        cursor.execute(f"""
            SELECT 
                AVG(total_ms), AVG(dns_ms), AVG(tcp_ms), AVG(tls_ms), AVG(ttfb_ms), AVG(transfer_ms),
                MAX(total_ms), MAX(dns_ms), MAX(tcp_ms), MAX(tls_ms), MAX(ttfb_ms), MAX(transfer_ms),
                MIN(total_ms), MIN(dns_ms), MIN(tcp_ms), MIN(tls_ms), MIN(ttfb_ms), MIN(transfer_ms)
            FROM records {where_clause} AND is_error = 0
        """, params)
        row = cursor.fetchone()

        if not row or row[0] is None:
            # Fallback if no is_error=0 records exist
            cursor.execute(f"""
                SELECT 
                    AVG(total_ms), AVG(dns_ms), AVG(tcp_ms), AVG(tls_ms), AVG(ttfb_ms), AVG(transfer_ms),
                    MAX(total_ms), MAX(dns_ms), MAX(tcp_ms), MAX(tls_ms), MAX(ttfb_ms), MAX(transfer_ms),
                    MIN(total_ms), MIN(dns_ms), MIN(tcp_ms), MIN(tls_ms), MIN(ttfb_ms), MIN(transfer_ms)
                FROM records {where_clause}
            """, params)
            row = cursor.fetchone()

        if row and row[0] is not None:
            averages = {
                "total": round(row[0], 2), "dns": round(row[1], 2), "tcp": round(row[2], 2),
                "tls": round(row[3], 2), "ttfb": round(row[4], 2), "transfer": round(row[5], 2)
            }
            peaks = {
                "total": round(row[6], 2), "dns": round(row[7], 2), "tcp": round(row[8], 2),
                "tls": round(row[9], 2), "ttfb": round(row[10], 2), "transfer": round(row[11], 2)
            }
            mins = {
                "total": round(row[12], 2), "dns": round(row[13], 2), "tcp": round(row[14], 2),
                "tls": round(row[15], 2), "ttfb": round(row[16], 2), "transfer": round(row[17], 2)
            }
        else:
            averages = {"total": 0, "dns": 0, "tcp": 0, "tls": 0, "ttfb": 0, "transfer": 0}
            peaks = {"total": 0, "dns": 0, "tcp": 0, "tls": 0, "ttfb": 0, "transfer": 0}
            mins = {"total": 0, "dns": 0, "tcp": 0, "tls": 0, "ttfb": 0, "transfer": 0}

        # Percentiles & Jitter
        cursor.execute(f"SELECT total_ms FROM records {where_clause} AND is_error = 0 ORDER BY total_ms ASC", params)
        total_list = [r[0] for r in cursor.fetchall()]

        p50 = calculate_percentile(total_list, 50)
        p90 = calculate_percentile(total_list, 90)
        p95 = calculate_percentile(total_list, 95)
        p99 = calculate_percentile(total_list, 99)

        jitter = 0.0
        if len(total_list) > 1:
            mean_val = averages['total']
            variance = sum((x - mean_val) ** 2 for x in total_list) / (len(total_list) - 1)
            jitter = round(math.sqrt(variance), 2)

        # Status Code Distribution
        cursor.execute(f"SELECT status_code, COUNT(*) FROM records {where_clause} GROUP BY status_code", params)
        status_codes = {str(r[0] if r[0] != 0 else "Error"): r[1] for r in cursor.fetchall()}

        return {
            "total_samples": total_samples,
            "successful_samples": successful_samples,
            "error_samples": error_samples,
            "uptime_percentage": uptime_percentage,
            "averages": averages,
            "peaks": peaks,
            "mins": mins,
            "percentiles": {"p50": p50, "p90": p90, "p95": p95, "p99": p99},
            "jitter": jitter,
            "status_codes": status_codes
        }

def get_location_comparison() -> List[Dict[str, Any]]:
    """Returns comparative metrics grouped by location."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                location,
                COUNT(*) as total_samples,
                AVG(total_ms) as avg_total,
                AVG(dns_ms) as avg_dns,
                AVG(tcp_ms) as avg_tcp,
                AVG(tls_ms) as avg_tls,
                AVG(ttfb_ms) as avg_ttfb,
                MAX(total_ms) as peak_total
            FROM records
            WHERE is_error = 0
            GROUP BY location
            ORDER BY location ASC
        """)
        rows = cursor.fetchall()
        return [
            {
                "location": r[0],
                "total_samples": r[1],
                "avg_total": round(r[2], 2) if r[2] else 0,
                "avg_dns": round(r[3], 2) if r[3] else 0,
                "avg_tcp": round(r[4], 2) if r[4] else 0,
                "avg_tls": round(r[5], 2) if r[5] else 0,
                "avg_ttfb": round(r[6], 2) if r[6] else 0,
                "peak_total": round(r[7], 2) if r[7] else 0
            }
            for r in rows
        ]

def get_config() -> Dict[str, str]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM config")
        return {r[0]: r[1] for r in cursor.fetchall()}

def set_config_key(key: str, value: str):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", (key, str(value)))
        conn.commit()

def clear_records(location_filter: Optional[str] = None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if location_filter and location_filter != 'all':
            cursor.execute("DELETE FROM records WHERE location = ?", (location_filter,))
            cursor.execute("DELETE FROM net_diag_history WHERE location = ?", (location_filter,))
        else:
            cursor.execute("DELETE FROM records")
            cursor.execute("DELETE FROM net_diag_history")
        conn.commit()


def save_net_diag_run(results: List[Dict[str, Any]], location: Optional[str] = None) -> int:
    """Saves a full network diagnostic run (Gateway, DNS, Extra IPs) to SQLite."""
    now = datetime.datetime.now(datetime.timezone.utc)
    created_at = now.isoformat()
    ts = now.timestamp()
    if not location:
        cfg = get_config()
        location = cfg.get("location_name", "Sede Principal")

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO net_diag_history (timestamp, created_at, location, results_json)
            VALUES (?, ?, ?, ?)
        """, (ts, created_at, location, json.dumps(results)))
        conn.commit()
        return cursor.lastrowid

def get_latest_net_diag(location_filter: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Retrieves the most recent network diagnostic run for a location."""
    with get_connection() as conn:
        cursor = conn.cursor()
        query = "SELECT * FROM net_diag_history WHERE 1=1"
        params = []
        if location_filter and location_filter != "all":
            query += " AND location = ?"
            params.append(location_filter)
        query += " ORDER BY id DESC LIMIT 1"
        cursor.execute(query, params)
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "timestamp": row["timestamp"],
            "created_at": row["created_at"],
            "location": row["location"],
            "results": json.loads(row["results_json"])
        }

def get_net_diag_runs_list(location_filter: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    """Returns a list of summary records of past network diagnostic runs for the UI selector."""
    with get_connection() as conn:
        cursor = conn.cursor()
        query = "SELECT id, timestamp, created_at, location FROM net_diag_history WHERE 1=1"
        params = []
        if location_filter and location_filter != "all":
            query += " AND location = ?"
            params.append(location_filter)
        query += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        cursor.execute(query, params)
        rows = cursor.fetchall()
        return [
            {
                "id": r["id"],
                "timestamp": r["timestamp"],
                "created_at": r["created_at"],
                "location": r["location"]
            }
            for r in rows
        ]

def get_net_diag_run_by_id(run_id: int) -> Optional[Dict[str, Any]]:
    """Retrieves a specific network diagnostic run by its ID."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM net_diag_history WHERE id = ?", (run_id,))
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "timestamp": row["timestamp"],
            "created_at": row["created_at"],
            "location": row["location"],
            "results": json.loads(row["results_json"])
        }

def get_all_net_diag_history(location_filter: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieves all network diagnostic runs for export."""
    with get_connection() as conn:
        cursor = conn.cursor()
        query = "SELECT * FROM net_diag_history WHERE 1=1"
        params = []
        if location_filter and location_filter != "all":
            query += " AND location = ?"
            params.append(location_filter)
        query += " ORDER BY id ASC"
        cursor.execute(query, params)
        rows = cursor.fetchall()
        return [
            {
                "id": r["id"],
                "timestamp": r["timestamp"],
                "created_at": r["created_at"],
                "location": r["location"],
                "results": json.loads(r["results_json"])
            }
            for r in rows
        ]

def build_report_analysis(data: Dict[str, Any]) -> Dict[str, Any]:
    """Generates automated technical highlights, root-cause isolation, and actionable recommendations."""
    highlights = []
    recommendations = []

    total = data.get("total_samples", 0)
    if total == 0:
        return {
            "highlights": [{
                "badge": "Sin Datos",
                "badge_class": "badge-amber",
                "title": "No hay registros en el período seleccionado",
                "detail": "Selecciona un rango de fechas diferente o verifica que el monitoreo haya estado en ejecución."
            }],
            "recommendations": [{
                "priority": "Informativa",
                "priority_class": "badge-blue",
                "category": "Monitoreo Continuo",
                "text": "Inicia el monitoreo continuo para recolectar datos de rendimiento en esta sede."
            }]
        }

    uptime = data.get("uptime_pct", 100.0)
    averages = data.get("averages", {})
    avg_total = averages.get("total", 0.0)
    avg_ttfb = averages.get("ttfb", 0.0)
    avg_tcp = averages.get("tcp", 0.0)
    avg_tls = averages.get("tls", 0.0)
    avg_dns = averages.get("dns", 0.0)
    jitter = data.get("jitter", 0.0)
    percentiles = data.get("percentiles", {})
    p95 = percentiles.get("p95", 0.0)
    peaks = data.get("peaks", {})
    peak = peaks.get("total", 0.0)

    # 1. Root Cause Breakdown (Browser / PDA Latency & Infrastructure)
    init_conn = round(avg_tcp + avg_tls, 1)
    cold_total = round(avg_dns + avg_tcp + avg_tls + avg_total, 1)

    if avg_total > 0:
        highlights.append({
            "type": "server",
            "badge": "Metodología Navegador / PDA",
            "badge_class": "badge-blue",
            "title": f"Latencia operativa HTTP promedio: {avg_total} ms (TTFB: {avg_ttfb} ms)",
            "detail": f"Medida bajo el estándar W3C Resource Timing / Chrome DevTools utilizado por las terminales PDA con conexiones Keep-Alive. El servidor Manhattan demoró {avg_ttfb} ms en procesar y comenzar a responder la solicitud."
        })

        if avg_tcp > 80:
            highlights.append({
                "type": "network",
                "badge": "Transporte WAN Elevado",
                "badge_class": "badge-amber",
                "title": f"Fase TCP física elevada ({avg_tcp} ms promedio, Conexión Inicial TCP+TLS: {init_conn} ms)",
                "detail": "El tiempo del 3-Way Handshake TCP es elevado para este enlace, lo que apunta a congestión en el proveedor de internet (ISP) o distancia geográfica al datacenter."
            })
        else:
            highlights.append({
                "type": "network",
                "badge": "Red Física Saludable",
                "badge_class": "badge-emerald",
                "title": f"Canal de red físico ágil (TCP: {avg_tcp} ms, Conexión Inicial TCP+TLS: {init_conn} ms)",
                "detail": "El enlace de transporte entre la sede y el balanceador opera dentro de parámetros óptimos de ida y vuelta (1 RTT de transporte puro)."
            })

        highlights.append({
            "type": "architecture",
            "badge": "Comparativa de Conexión",
            "badge_class": "badge-purple",
            "title": f"Latencia Navegador/PDA: {avg_total} ms vs Arranque en Frío: {cold_total} ms",
            "detail": f"En producción, la PDA y Chrome mantienen activa la conexión (Keep-Alive), operando a {avg_total} ms. Una conexión desde cero que deba resolver DNS ({avg_dns} ms), abrir socket TCP ({avg_tcp} ms) y negociar TLS ({avg_tls} ms) acumula {cold_total} ms."
        })

    # 2. SLA & Critical Peaks
    if peak > 1500:
        highlights.append({
            "type": "alert",
            "badge": "Pico Crítico",
            "badge_class": "badge-rose",
            "title": f"Pico máximo registrado de {peak} ms (P95 situado en {p95} ms)",
            "detail": f"El 95% de las peticiones respondieron por debajo de {p95} ms, pero se presentaron picos esporádicos que pueden causar retrasos o congelamiento temporal en terminales de radiofrecuencia (RF) o navegadores."
        })
    elif peak > 800:
        highlights.append({
            "type": "warn",
            "badge": "Pico Moderado",
            "badge_class": "badge-amber",
            "title": f"Pico máximo de {peak} ms observado en el período",
            "detail": f"El percentil P95 se mantuvo en {p95} ms, dentro del umbral operativo aceptable."
        })

    # 3. Uptime and Availability
    if uptime < 99.0:
        highlights.append({
            "type": "availability",
            "badge": "Disponibilidad Comprometida",
            "badge_class": "badge-rose",
            "title": f"Disponibilidad del {uptime}% con {data.get('error_samples')} errores registrados",
            "detail": "Se presentaron fallos de conexión o códigos de error HTTP durante el período evaluado."
        })
    else:
        highlights.append({
            "type": "availability",
            "badge": "Alta Disponibilidad",
            "badge_class": "badge-emerald",
            "title": f"Disponibilidad excelente del {uptime}% ({data.get('successful_samples')} peticiones exitosas)",
            "detail": "El servicio de Manhattan se mantuvo accesible de forma continua durante todo el intervalo evaluado."
        })

    # 4. ICMP / Infrastructure Diagnostic Highlights
    icmp_summary = data.get("icmp_summary", {})
    if icmp_summary and icmp_summary.get("total_runs", 0) > 0:
        gw = icmp_summary.get("gateway", {})
        if gw and gw.get("avg_ms") is not None:
            if gw.get("loss_pct", 0) > 0 or gw.get("avg_ms", 0) > 10:
                highlights.append({
                    "type": "lan",
                    "badge": "Alerta LAN",
                    "badge_class": "badge-rose",
                    "title": f"Degradación en Puerta de Enlace Local ({gw.get('avg_ms')} ms, {gw.get('loss_pct')}% pérdida)",
                    "detail": "El router o switch de salida de la sede presenta congestión, latencia anómala o pérdida de paquetes locales antes de salir a internet."
                })
            else:
                highlights.append({
                    "type": "lan",
                    "badge": "LAN Óptima",
                    "badge_class": "badge-emerald",
                    "title": f"Puerta de Enlace LAN saludable ({gw.get('avg_ms')} ms, 0% pérdida de paquetes)",
                    "detail": "El tráfico local fluye sin demoras ni descartes hacia el router de borde de la sede."
                })

    # 5. Strategic Recommendations
    if avg_ttfb > 350:
        recommendations.append({
            "priority": "Alta",
            "priority_class": "badge-rose",
            "category": "Backend Manhattan Associates",
            "text": "Escalar formalmente al soporte de Manhattan los tiempos de TTFB observados (promedio > 350 ms), adjuntando la evidencia de este informe que desvincula a la red física de la sede de la degradación."
        })

    if avg_tcp > 85:
        recommendations.append({
            "priority": "Alta",
            "priority_class": "badge-amber",
            "category": "Conectividad WAN / Proveedor ISP",
            "text": "Solicitar al proveedor de internet (ISP) una revisión de enrutamiento BGP hacia el datacenter de Manhattan, o implementar políticas de Calidad de Servicio (QoS) para priorizar el tráfico de terminales RF."
        })

    if avg_tls > 120:
        recommendations.append({
            "priority": "Media",
            "priority_class": "badge-amber",
            "category": "Terminador Criptográfico TLS / SSL",
            "text": f"La fase de negociación TLS promedió {avg_tls} ms. Validar con el equipo de soporte e infraestructura de Manhattan la compatibilidad con TLS 1.3 (para reducir la negociación a 1 RTT) o verificar si existe sobrecarga de CPU en el balanceador al validar cadenas de certificados."
        })

    if avg_dns > 25:
        recommendations.append({
            "priority": "Media",
            "priority_class": "badge-amber",
            "category": "Servidores DNS Corporativos",
            "text": "Optimizar el tiempo de resolución DNS local configurando reenviadores (forwarders) de menor latencia o ajustando el TTL de la zona corporativa para evitar demoras en la Fase 1."
        })

    if jitter > 35:
        recommendations.append({
            "priority": "Media",
            "priority_class": "badge-amber",
            "category": "Estabilidad del Enlace / Wi-Fi",
            "text": "Se observa fluctuación de latencia (Jitter elevado). En terminales inalámbricas, revisar cobertura de antenas Wi-Fi y saturación de canales en las zonas operativas de bodega."
        })

    recommendations.append({
        "priority": "Informativa",
        "priority_class": "badge-blue",
        "category": "Línea Base Operativa",
        "text": "Continuar con el monitoreo automático periódico de HTTP y los diagnósticos ICMP programados para preservar la trazabilidad histórica ante auditorías de SLAs."
    })

    return {
        "highlights": highlights,
        "recommendations": recommendations
    }

def get_report_data(start_date: Optional[str] = None, end_date: Optional[str] = None, location_filter: Optional[str] = None) -> Dict[str, Any]:
    """Calculates comprehensive analytics, daily breakdown, location breakdown, and ICMP summary for a date range."""
    now = datetime.datetime.now(datetime.timezone.utc)
    start_ts = 0.0
    end_ts = now.timestamp() + 86400.0

    if start_date:
        try:
            start_dt = datetime.datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc)
            start_ts = start_dt.timestamp()
        except ValueError:
            pass

    if end_date:
        try:
            end_dt = (datetime.datetime.strptime(end_date, "%Y-%m-%d") + datetime.timedelta(days=1)).replace(tzinfo=datetime.timezone.utc)
            end_ts = end_dt.timestamp()
        except ValueError:
            pass

    with get_connection() as conn:
        cursor = conn.cursor()

        where_sql = " WHERE timestamp >= ? AND timestamp <= ?"
        params = [start_ts, end_ts]
        if location_filter and location_filter != "all":
            where_sql += " AND location = ?"
            params.append(location_filter)

        cursor.execute(f"""
            SELECT COUNT(*),
                   SUM(CASE WHEN is_error = 0 THEN 1 ELSE 0 END),
                   SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END),
                   AVG(total_ms), AVG(dns_ms), AVG(tcp_ms), AVG(tls_ms), AVG(ttfb_ms), AVG(transfer_ms),
                   MAX(total_ms), MIN(total_ms)
            FROM records {where_sql}
        """, params)
        agg = cursor.fetchone()
        total_samples = agg[0] or 0

        if total_samples == 0:
            return {
                "period": {"start": start_date or "Inicio", "end": end_date or "Fin"},
                "location": location_filter or "all",
                "total_samples": 0,
                "uptime_pct": 100.0,
                "averages": {"total": 0, "dns": 0, "tcp": 0, "tls": 0, "ttfb": 0, "transfer": 0},
                "peaks": {"total": 0},
                "mins": {"total": 0},
                "percentiles": {"p50": 0, "p90": 0, "p95": 0, "p99": 0},
                "jitter": 0,
                "daily_breakdown": [],
                "location_breakdown": [],
                "worst_peaks": [],
                "status_codes": {},
                "icmp_summary": {},
                "analysis": build_report_analysis({"total_samples": 0})
            }

        succ_samples = agg[1] or 0
        err_samples = agg[2] or 0
        uptime_pct = round((succ_samples / total_samples) * 100.0, 2)

        avg_total = round(agg[3] or 0, 2)
        avg_dns = round(agg[4] or 0, 2)
        avg_tcp = round(agg[5] or 0, 2)
        avg_tls = round(agg[6] or 0, 2)
        avg_ttfb = round(agg[7] or 0, 2)
        avg_transfer = round(agg[8] or 0, 2)
        peak_total = round(agg[9] or 0, 2)
        min_total = round(agg[10] or 0, 2)

        cursor.execute(f"SELECT total_ms FROM records {where_sql} ORDER BY total_ms ASC", params)
        all_totals = [row[0] for row in cursor.fetchall()]

        def calc_p(p_val):
            if not all_totals: return 0.0
            idx = int(len(all_totals) * p_val)
            idx = min(idx, len(all_totals) - 1)
            return round(all_totals[idx], 2)

        p50 = calc_p(0.50)
        p90 = calc_p(0.90)
        p95 = calc_p(0.95)
        p99 = calc_p(0.99)

        variance = sum((x - avg_total) ** 2 for x in all_totals) / len(all_totals)
        jitter = round(math.sqrt(variance), 2)

        cursor.execute(f"SELECT status_code, COUNT(*) FROM records {where_sql} GROUP BY status_code", params)
        status_codes = {str(r[0] or "ERROR"): r[1] for r in cursor.fetchall()}

        cursor.execute(f"""
            SELECT date(created_at) as day,
                   COUNT(*) as samples,
                   ROUND(AVG(total_ms), 1) as avg_total,
                   ROUND(AVG(ttfb_ms), 1) as avg_ttfb,
                   ROUND(AVG(tcp_ms), 1) as avg_tcp,
                   ROUND(MAX(total_ms), 1) as peak_total,
                   SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) as errors
            FROM records {where_sql}
            GROUP BY date(created_at)
            ORDER BY day ASC
        """, params)
        daily_breakdown = [
            {
                "day": r["day"],
                "samples": r["samples"],
                "avg_total": r["avg_total"],
                "avg_ttfb": r["avg_ttfb"],
                "avg_tcp": r["avg_tcp"],
                "peak_total": r["peak_total"],
                "errors": r["errors"]
            }
            for r in cursor.fetchall()
        ]

        cursor.execute(f"""
            SELECT location,
                   COUNT(*) as samples,
                   ROUND(AVG(total_ms), 1) as avg_total,
                   ROUND(AVG(ttfb_ms), 1) as avg_ttfb,
                   ROUND(AVG(tcp_ms), 1) as avg_tcp,
                   ROUND(AVG(tls_ms), 1) as avg_tls,
                   ROUND(AVG(dns_ms), 1) as avg_dns,
                   ROUND(MAX(total_ms), 1) as peak_total
            FROM records {where_sql}
            GROUP BY location
            ORDER BY samples DESC
        """, params)
        location_breakdown = [
            {
                "location": r["location"],
                "samples": r["samples"],
                "avg_total": r["avg_total"],
                "avg_ttfb": r["avg_ttfb"],
                "avg_tcp": r["avg_tcp"],
                "avg_tls": r["avg_tls"],
                "avg_dns": r["avg_dns"],
                "peak_total": r["peak_total"]
            }
            for r in cursor.fetchall()
        ]

        cursor.execute(f"""
            SELECT id, created_at, location, ROUND(total_ms, 1) as total_ms,
                   ROUND(ttfb_ms, 1) as ttfb_ms, ROUND(tcp_ms, 1) as tcp_ms,
                   ROUND(tls_ms, 1) as tls_ms, ROUND(dns_ms, 1) as dns_ms,
                   status_code, error_message
            FROM records {where_sql}
            ORDER BY total_ms DESC
            LIMIT 5
        """, params)
        worst_peaks = [
            {
                "id": r["id"],
                "created_at": r["created_at"],
                "location": r["location"],
                "total_ms": r["total_ms"],
                "ttfb_ms": r["ttfb_ms"],
                "tcp_ms": r["tcp_ms"],
                "tls_ms": r["tls_ms"],
                "dns_ms": r["dns_ms"],
                "status_code": r["status_code"],
                "error_message": r["error_message"]
            }
            for r in cursor.fetchall()
        ]

        cursor.execute(f"""
            SELECT results_json FROM net_diag_history {where_sql}
        """, params)
        diag_rows = cursor.fetchall()

        gw_pings, gw_losses = [], []
        dns_pings, dns_losses = [], []
        extra_pings, extra_losses = [], []
        for d in diag_rows:
            try:
                targets = json.loads(d["results_json"])
                for t in targets:
                    t_type = t.get("type")
                    ping = t.get("ping", {})
                    avg_v = ping.get("avg_ms")
                    loss_v = ping.get("loss_pct", 0.0)
                    if avg_v is not None:
                        if t_type == "gateway":
                            gw_pings.append(avg_v)
                            gw_losses.append(loss_v)
                        elif t_type == "dns":
                            dns_pings.append(avg_v)
                            dns_losses.append(loss_v)
                        elif t_type == "extra":
                            extra_pings.append(avg_v)
                            extra_losses.append(loss_v)
            except Exception:
                pass

        icmp_summary = {
            "total_runs": len(diag_rows),
            "gateway": {
                "avg_ms": round(sum(gw_pings) / len(gw_pings), 2) if gw_pings else None,
                "loss_pct": round(sum(gw_losses) / len(gw_losses), 1) if gw_losses else 0.0
            },
            "dns": {
                "avg_ms": round(sum(dns_pings) / len(dns_pings), 2) if dns_pings else None,
                "loss_pct": round(sum(dns_losses) / len(dns_losses), 1) if dns_losses else 0.0
            },
            "extra": {
                "avg_ms": round(sum(extra_pings) / len(extra_pings), 2) if extra_pings else None,
                "loss_pct": round(sum(extra_losses) / len(extra_losses), 1) if extra_losses else 0.0
            }
        }

    data_payload = {
        "period": {
            "start": start_date or (daily_breakdown[0]["day"] if daily_breakdown else "Inicio"),
            "end": end_date or (daily_breakdown[-1]["day"] if daily_breakdown else "Fin")
        },
        "location": location_filter or "all",
        "total_samples": total_samples,
        "successful_samples": succ_samples,
        "error_samples": err_samples,
        "uptime_pct": uptime_pct,
        "averages": {
            "total": avg_total,
            "dns": avg_dns,
            "tcp": avg_tcp,
            "tls": avg_tls,
            "ttfb": avg_ttfb,
            "transfer": avg_transfer
        },
        "peaks": {"total": peak_total},
        "mins": {"total": min_total},
        "percentiles": {"p50": p50, "p90": p90, "p95": p95, "p99": p99},
        "jitter": jitter,
        "status_codes": status_codes,
        "daily_breakdown": daily_breakdown,
        "location_breakdown": location_breakdown,
        "worst_peaks": worst_peaks,
        "icmp_summary": icmp_summary
    }

    data_payload["analysis"] = build_report_analysis(data_payload)
    return data_payload
