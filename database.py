import sqlite3
import datetime
import math
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
            "auth_token": ""
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
        else:
            cursor.execute("DELETE FROM records")
        conn.commit()
