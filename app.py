import http.server
import json
import os
import csv
import io
import urllib.parse
import zipfile
import datetime
import threading
import time
from typing import Dict, Any

import database
import probe
import net_diag

PORT = 8080
HOST = "0.0.0.0"

# Background thread control
background_thread = None
thread_running = True
last_net_diag_time = 0.0

def background_probe_loop():
    """Background loop that periodically measures HTTP latency and runs scheduled network diagnostics every 15 min."""
    global thread_running, last_net_diag_time
    print("[INFO] Background monitor thread started.")

    # Initialize last_net_diag_time from latest DB run if available
    try:
        latest_run = database.get_latest_net_diag()
        if latest_run and latest_run.get("timestamp"):
            last_net_diag_time = float(latest_run["timestamp"])
        else:
            last_net_diag_time = time.time()
    except Exception:
        last_net_diag_time = time.time()

    while thread_running:
        try:
            cfg = database.get_config()
            auto_enabled = cfg.get("auto_probe_enabled", "1") == "1"
            interval = float(cfg.get("interval_seconds", "10"))
            timeout = float(cfg.get("timeout_seconds", "5"))
            target_url = cfg.get("target_url", "https://alkop.sce.manh.com/ping")
            location_name = cfg.get("location_name", "Sede Principal")

            if auto_enabled and target_url:
                result = probe.measure_latency(target_url, timeout=timeout, auth_config=cfg)
                database.save_record(result, location=location_name)

            # Scheduled 15-minute Network Diagnostic (900 seconds)
            now_ts = time.time()
            if auto_enabled and (now_ts - last_net_diag_time >= 900):
                last_net_diag_time = now_ts
                try:
                    extra_targets = cfg.get("extra_ping_targets", "")
                    print(f"[INFO] Running scheduled 15-min network diagnostic for '{location_name}'...")
                    net_results = net_diag.run_full_network_diagnostic(extra_hosts_str=extra_targets)
                    saved_id = database.save_net_diag_run(net_results, location=location_name)
                    print(f"[INFO] Scheduled network diagnostic saved (ID #{saved_id}, {len(net_results)} targets).")
                except Exception as nd_err:
                    print(f"[ERROR] Scheduled network diagnostic error: {nd_err}")

            # Sleep in 1-second ticks so we can stop quickly
            for _ in range(int(max(1, interval))):
                if not thread_running:
                    break
                time.sleep(1)

        except Exception as e:
            print(f"[ERROR] Exception in background probe loop: {e}")
            time.sleep(5)

def generate_http_csv(records: list) -> str:
    """Generates a standard CSV string for HTTP probe latency records."""
    output = io.StringIO()
    fieldnames = [
        "id", "created_at", "location", "url", "ip", "status_code",
        "dns_ms", "tcp_ms", "tls_ms", "ttfb_ms", "transfer_ms", "total_ms",
        "is_error", "error_message", "response_size_bytes"
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for r in records:
        row_copy = {k: r.get(k) for k in fieldnames}
        writer.writerow(row_copy)
    return output.getvalue()

def generate_icmp_csv(runs: list) -> str:
    """Generates a detailed CSV string for ICMP ping and traceroute diagnostic runs."""
    output = io.StringIO()
    fieldnames = [
        "run_id", "created_at", "location", "target_type", "target_name", "target_host",
        "status", "ping_min_ms", "ping_avg_ms", "ping_max_ms", "jitter_mdev_ms",
        "packet_loss_pct", "traceroute_hops_count", "traceroute_reached", "traceroute_path", "error"
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for run in runs:
        run_id = run["id"]
        created_at = run["created_at"]
        location = run["location"]
        for target in run.get("results", []):
            ping = target.get("ping", {})
            trace = target.get("traceroute", {})
            hops = trace.get("hops", [])
            path_str = ""
            if hops:
                path_parts = []
                for h in hops:
                    rtt = f"{h['rtt_ms']}ms" if h.get("rtt_ms") is not None else "timeout"
                    path_parts.append(f"#{h['hop']}:{h['ip']} ({rtt})")
                path_str = " -> ".join(path_parts)

            writer.writerow({
                "run_id": run_id,
                "created_at": created_at,
                "location": location,
                "target_type": target.get("type", "extra"),
                "target_name": target.get("name", target.get("host", "")),
                "target_host": target.get("host", ""),
                "status": target.get("status", "healthy"),
                "ping_min_ms": ping.get("min_ms", ""),
                "ping_avg_ms": ping.get("avg_ms", ""),
                "ping_max_ms": ping.get("max_ms", ""),
                "jitter_mdev_ms": ping.get("mdev_ms", ""),
                "packet_loss_pct": ping.get("loss_pct", 0.0),
                "traceroute_hops_count": trace.get("hops_count", len(hops)),
                "traceroute_reached": trace.get("reached", False),
                "traceroute_path": path_str,
                "error": ping.get("error") or trace.get("error") or ""
            })
    return output.getvalue()

class LatencyHandler(http.server.BaseHTTPRequestHandler):
    """HTTP Request Handler for Manhattan Latency Analyzer API and Static Web App."""

    def log_message(self, format, *args):
        # Suppress noisy standard HTTP logs except errors
        pass

    def send_json(self, data: Any, status: int = 200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, filepath: str, content_type: str):
        if not os.path.exists(filepath):
            self.send_error(404, "File Not Found")
            return
        with open(filepath, "rb") as f:
            content = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_HEAD(self):
        self.do_GET()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # Static assets
        static_dir = os.path.join(os.path.dirname(__file__), "static")
        if path == "/" or path == "/index.html":
            return self.send_file(os.path.join(static_dir, "index.html"), "text/html; charset=utf-8")
        elif path == "/styles.css":
            return self.send_file(os.path.join(static_dir, "styles.css"), "text/css; charset=utf-8")
        elif path == "/app.js":
            return self.send_file(os.path.join(static_dir, "app.js"), "application/javascript; charset=utf-8")

        # API Endpoints
        if path == "/api/probe/now":
            cfg = database.get_config()
            target_url = query.get("url", [cfg.get("target_url", "https://alkop.sce.manh.com/ping")])[0]
            timeout = float(query.get("timeout", [cfg.get("timeout_seconds", "5")])[0])
            location_name = cfg.get("location_name", "Sede Principal")
            result = probe.measure_latency(target_url, timeout=timeout, auth_config=cfg)
            database.save_record(result, location=location_name)
            return self.send_json(result)

        elif path == "/api/history":
            limit = int(query.get("limit", [100])[0])
            offset = int(query.get("offset", [0])[0])
            status_filter = query.get("status", [None])[0]
            location_filter = query.get("location", [None])[0]
            records = database.get_history(limit=limit, offset=offset, status_filter=status_filter, location_filter=location_filter)
            return self.send_json({"records": records, "count": len(records)})

        elif path == "/api/stats":
            location_filter = query.get("location", [None])[0]
            stats = database.get_statistics(location_filter=location_filter)
            return self.send_json(stats)

        elif path == "/api/locations":
            locations = database.get_locations()
            return self.send_json(locations)

        elif path == "/api/comparison":
            comparison = database.get_location_comparison()
            return self.send_json(comparison)

        elif path == "/api/net-diag":
            location_filter = query.get("location", [None])[0]
            run_id = query.get("run_id", [None])[0]
            
            run_data = None
            if run_id and run_id != "latest":
                try:
                    run_data = database.get_net_diag_run_by_id(int(run_id))
                except (ValueError, TypeError):
                    run_data = None

            if not run_data:
                run_data = database.get_latest_net_diag(location_filter=location_filter)

            runs_list = database.get_net_diag_runs_list(location_filter=location_filter, limit=50)
            gw = net_diag.detect_default_gateway()
            dns_list = net_diag.detect_dns_servers()
            cfg = database.get_config()
            return self.send_json({
                "latest": run_data,
                "history_runs": runs_list,
                "detected": {
                    "gateway": gw,
                    "dns_servers": dns_list,
                    "extra_targets": cfg.get("extra_ping_targets", "")
                }
            })

        elif path == "/api/report":
            start_date = query.get("start", [None])[0]
            end_date = query.get("end", [None])[0]
            location_filter = query.get("location", [None])[0]
            if location_filter == "all" or location_filter == "":
                location_filter = None
            report_data = database.get_report_data(start_date=start_date, end_date=end_date, location_filter=location_filter)
            return self.send_json(report_data)

        elif path == "/api/config":
            cfg = database.get_config()
            return self.send_json(cfg)

        elif path == "/api/export":
            export_type = query.get("type", ["all"])[0].lower()
            export_format = query.get("format", ["zip" if export_type == "all" else "csv"])[0].lower()
            location_filter = query.get("location", [None])[0]

            loc_suffix = f"_{location_filter}" if (location_filter and location_filter != "all") else ""
            date_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

            if export_type == "http":
                history = database.get_history(limit=50000, offset=0, location_filter=location_filter)
                if export_format == "json":
                    return self.send_json(history)
                csv_content = generate_http_csv(history)
                filename = f"latencia_http{loc_suffix}_{date_str}.csv"
                body = csv_content.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            elif export_type == "icmp":
                net_history = database.get_all_net_diag_history(location_filter=location_filter)
                if export_format == "json":
                    return self.send_json(net_history)
                csv_content = generate_icmp_csv(net_history)
                filename = f"diagnostico_red_icmp{loc_suffix}_{date_str}.csv"
                body = csv_content.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            else:
                # Default "all": Package both HTTP and ICMP into a single ZIP archive
                history = database.get_history(limit=50000, offset=0, location_filter=location_filter)
                net_history = database.get_all_net_diag_history(location_filter=location_filter)

                if export_format == "json":
                    return self.send_json({"http_latency": history, "network_diagnostics": net_history})

                http_csv = generate_http_csv(history)
                icmp_csv = generate_icmp_csv(net_history)

                zip_buffer = io.BytesIO()
                with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                    zf.writestr(f"latencia_http_manhattan{loc_suffix}.csv", http_csv)
                    zf.writestr(f"diagnostico_red_icmp_traceroute{loc_suffix}.csv", icmp_csv)
                
                zip_data = zip_buffer.getvalue()
                filename = f"auditoria_latencia_red{loc_suffix}_{date_str}.zip"
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                self.send_header("Content-Length", str(len(zip_data)))
                self.end_headers()
                self.wfile.write(zip_data)
                return

        self.send_error(404, "Endpoint not found")

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_length) if content_length > 0 else b""
        payload = {}
        if body_bytes:
            try:
                payload = json.loads(body_bytes.decode('utf-8'))
            except json.JSONDecodeError:
                pass

        if path == "/api/config":
            for k, v in payload.items():
                database.set_config_key(k, str(v))
            return self.send_json({"success": True, "config": database.get_config()})

        elif path == "/api/net-diag/run":
            global last_net_diag_time
            last_net_diag_time = time.time()
            cfg = database.get_config()
            location_name = payload.get("location") or cfg.get("location_name", "Sede Principal")
            extra_targets = payload.get("extra_targets") if "extra_targets" in payload else cfg.get("extra_ping_targets", "")
            results = net_diag.run_full_network_diagnostic(extra_hosts_str=extra_targets)
            saved_id = database.save_net_diag_run(results, location=location_name)
            return self.send_json({
                "success": True,
                "id": saved_id,
                "results": results,
                "location": location_name,
                "timestamp": time.time()
            })

        elif path == "/api/auto-probe/toggle":
            cfg = database.get_config()
            current_state = cfg.get("auto_probe_enabled", "1") == "1"
            if "enabled" in payload:
                new_state = "1" if payload["enabled"] else "0"
            else:
                new_state = "0" if current_state else "1"
            database.set_config_key("auto_probe_enabled", new_state)
            is_enabled = (new_state == "1")
            return self.send_json({
                "success": True,
                "auto_probe_enabled": is_enabled,
                "message": "Monitoreo automático " + ("reanudado" if is_enabled else "pausado")
            })

        elif path == "/api/clear":
            query = urllib.parse.parse_qs(parsed.query)
            location_filter = payload.get("location") or query.get("location", [None])[0]
            database.clear_records(location_filter=location_filter)
            return self.send_json({"success": True, "message": "History cleared successfully"})

        self.send_error(404, "Endpoint not found")

def run():
    database.init_db()

    # Start background probe thread
    global background_thread
    background_thread = threading.Thread(target=background_probe_loop, daemon=True)
    background_thread.start()

    server = http.server.ThreadingHTTPServer((HOST, PORT), LatencyHandler)
    print(f"\n=======================================================")
    print(f"🚀 Manhattan Latency Analyzer running at:")
    print(f"👉 Local: http://localhost:{PORT}")
    print(f"👉 Target URL: https://alkop.sce.manh.com/ping")
    print(f"👉 Cross-Platform: Compatible with Windows & Linux")
    print(f"=======================================================\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down Manhattan Latency Analyzer...")
        global thread_running
        thread_running = False
        server.shutdown()

if __name__ == "__main__":
    run()
