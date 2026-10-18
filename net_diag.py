import os
import sys
import re
import socket
import struct
import platform
import subprocess
import locale
import concurrent.futures
from typing import Dict, Any, List, Optional

def safe_decode(b: bytes) -> str:
    """Safely decodes binary subprocess output supporting CP850/CP1252 (Windows) and UTF-8 without raising UnicodeDecodeError."""
    if not b:
        return ""
    # Try utf-8
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        pass
    # Try cp850 (standard Spanish / Western European DOS and Windows command prompt OEM codepage)
    try:
        return b.decode("cp850")
    except UnicodeDecodeError:
        pass
    # Try cp1252 (Windows ANSI)
    try:
        return b.decode("cp1252")
    except UnicodeDecodeError:
        pass
    # Fallback to system preferred encoding with replacement
    try:
        pref = locale.getpreferredencoding(False) or "utf-8"
        return b.decode(pref, errors="replace")
    except Exception:
        return b.decode("latin-1", errors="replace")

def run_cmd_safe(cmd: List[str], timeout: float = 10.0) -> tuple[int, str, str]:
    """
    Runs a subprocess command capturing raw bytes without text=True.
    This guarantees Python's _readerthread never crashes on Windows with UnicodeDecodeError: 'utf-8' codec can't decode byte 0xa0...
    """
    try:
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout
        )
        return res.returncode, safe_decode(res.stdout), safe_decode(res.stderr)
    except subprocess.TimeoutExpired:
        raise
    except Exception as e:
        return -1, "", str(e)

def detect_default_gateway() -> Optional[str]:
    """Detects default gateway IP in Linux or Windows."""
    system = platform.system().lower()

    if system == "linux":
        # 1. Read /proc/net/route in pure Python
        try:
            with open("/proc/net/route", "r") as f:
                for line in f.readlines()[1:]:
                    fields = line.strip().split()
                    if len(fields) >= 3 and fields[1] == "00000000":
                        gw_hex = int(fields[2], 16)
                        if gw_hex != 0:
                            return socket.inet_ntoa(struct.pack("<L", gw_hex))
        except Exception:
            pass

        # 2. Fallback via ip route
        try:
            ret, stdout, stderr = run_cmd_safe(["ip", "route", "show", "default"], timeout=3.0)
            m = re.search(r"default via ([0-9.]+)", stdout)
            if m:
                return m.group(1)
        except Exception:
            pass

    elif system == "windows":
        try:
            ret, stdout, stderr = run_cmd_safe(["route", "print", "0.0.0.0"], timeout=4.0)
            for line in stdout.splitlines():
                parts = line.strip().split()
                if len(parts) >= 5 and parts[0] == "0.0.0.0" and parts[1] == "0.0.0.0":
                    return parts[2]
        except Exception:
            pass

        try:
            ps_cmd = "(Get-NetRoute -DestinationPrefix '0.0.0.0/0').NextHop"
            ret, stdout, stderr = run_cmd_safe(["powershell", "-NoProfile", "-Command", ps_cmd], timeout=4.0)
            ip_str = stdout.strip()
            if re.match(r"^[0-9.]+$", ip_str):
                return ip_str
        except Exception:
            pass

    return None

def detect_dns_servers() -> List[str]:
    """Detects configured DNS servers in Linux or Windows."""
    system = platform.system().lower()
    servers = []

    if system == "linux":
        # Check resolvectl dns first for active uplink DNS
        try:
            ret, stdout, stderr = run_cmd_safe(["resolvectl", "dns"], timeout=3.0)
            for line in stdout.splitlines():
                matches = re.findall(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", line)
                for ip in matches:
                    if ip not in servers and not ip.startswith("127."):
                        servers.append(ip)
        except Exception:
            pass

        # Check /etc/resolv.conf
        try:
            with open("/etc/resolv.conf", "r") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("nameserver"):
                        parts = line.split()
                        if len(parts) >= 2:
                            ip = parts[1]
                            if ip not in servers:
                                servers.append(ip)
        except Exception:
            pass

    elif system == "windows":
        try:
            ps_cmd = "(Get-DnsClientServerAddress -AddressFamily IPv4).ServerAddresses"
            ret, stdout, stderr = run_cmd_safe(["powershell", "-NoProfile", "-Command", ps_cmd], timeout=4.0)
            for line in stdout.splitlines():
                ip = line.strip()
                if re.match(r"^[0-9.]+$", ip) and ip not in servers:
                    servers.append(ip)
        except Exception:
            pass

    clean_servers = []
    for s in servers:
        if s not in clean_servers:
            clean_servers.append(s)

    return clean_servers

def run_ping(target: str, count: int = 4, timeout_sec: int = 2) -> Dict[str, Any]:
    """Executes ICMP ping to target and parses latency and packet loss across Linux and Windows (English/Spanish)."""
    system = platform.system().lower()
    target = target.strip()
    
    if system == "windows":
        cmd = ["ping", "-n", str(count), "-w", str(timeout_sec * 1000), target]
    else:
        cmd = ["ping", "-c", str(count), "-W", str(timeout_sec), target]

    try:
        ret, stdout, stderr = run_cmd_safe(cmd, timeout=(count * timeout_sec) + 3)
        out = stdout + "\n" + stderr
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "loss_pct": 100.0,
            "min_ms": None,
            "avg_ms": None,
            "max_ms": None,
            "mdev_ms": None,
            "error": "Ping timeout"
        }
    except Exception as e:
        return {
            "success": False,
            "loss_pct": 100.0,
            "min_ms": None,
            "avg_ms": None,
            "max_ms": None,
            "mdev_ms": None,
            "error": str(e)
        }

    loss_pct = 100.0
    # Match loss in English or Spanish: "0% loss", "0% perdidos", "0% de pérdida"
    m_loss = re.search(r"(\d+(?:\.\d+)?)%\s*(?:packet loss|perdidos|loss|de p[eé]rdida)", out, re.IGNORECASE)
    if m_loss:
        try:
            loss_pct = float(m_loss.group(1))
        except ValueError:
            pass

    # 1. Linux summary regex
    m_rtt = re.search(r"rtt min/avg/max/mdev = ([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+)\s*ms", out)
    if m_rtt:
        return {
            "success": loss_pct < 100.0,
            "loss_pct": round(loss_pct, 1),
            "min_ms": round(float(m_rtt.group(1)), 2),
            "avg_ms": round(float(m_rtt.group(2)), 2),
            "max_ms": round(float(m_rtt.group(3)), 2),
            "mdev_ms": round(float(m_rtt.group(4)), 2),
            "error": None
        }

    # 2. Windows summary regex (English: Minimum = 1ms, Maximum = 2ms, Average = 1ms; Spanish: Mínimo = 1ms, Máximo = 2ms, Media = 1ms)
    m_win = re.search(r"(?:M[ií]nimo|Minimum)\s*=\s*(\d+)\s*ms.*?(?:M[aá]ximo|Maximum)\s*=\s*(\d+)\s*ms.*?(?:Media|Average)\s*=\s*(\d+)\s*ms", out, re.IGNORECASE | re.DOTALL)
    if m_win:
        min_v = float(m_win.group(1))
        max_v = float(m_win.group(2))
        avg_v = float(m_win.group(3))
        return {
            "success": loss_pct < 100.0,
            "loss_pct": round(loss_pct, 1),
            "min_ms": round(min_v, 2),
            "avg_ms": round(avg_v, 2),
            "max_ms": round(max_v, 2),
            "mdev_ms": round(abs(max_v - min_v) / 2.0, 2),
            "error": None
        }

    # 3. Individual packet times (English: time=1ms or time<1ms; Spanish: tiempo=1ms or tiempo<1ms)
    times = []
    for t_str in re.findall(r"(?:time|tiempo)\s*[<=]\s*([<]?\d+(?:\.\d+)?)\s*ms", out, re.IGNORECASE):
        val = 0.5 if "<" in t_str else float(t_str)
        times.append(val)

    if times:
        min_v = min(times)
        max_v = max(times)
        avg_v = sum(times) / len(times)
        return {
            "success": loss_pct < 100.0,
            "loss_pct": round(loss_pct, 1),
            "min_ms": round(min_v, 2),
            "avg_ms": round(avg_v, 2),
            "max_ms": round(max_v, 2),
            "mdev_ms": round(abs(max_v - min_v) / 2.0, 2),
            "error": None
        }

    return {
        "success": False,
        "loss_pct": 100.0,
        "min_ms": None,
        "avg_ms": None,
        "max_ms": None,
        "mdev_ms": None,
        "error": "Destino inaccesible o sin respuesta ICMP"
    }

def run_traceroute(target: str, max_hops: int = 15, timeout_sec: int = 2) -> Dict[str, Any]:
    """Executes traceroute / tracepath / mtr / tracert to target and extracts hop-by-hop nodes and RTTs."""
    system = platform.system().lower()
    target = target.strip()
    hops = []
    reached = False

    if system == "linux":
        # 1. Try mtr report first
        try:
            ret, stdout, stderr = run_cmd_safe(["mtr", "-r", "-c", "1", "-n", "-m", str(max_hops), target], timeout=8.0)
            if ret == 0 and stdout:
                for line in stdout.splitlines():
                    m = re.match(r"^\s*(\d+)\.\|--\s+([^\s]+)\s+([\d.]+)%\s+(\d+)\s+([\d.]+)\s+([\d.]+)", line.strip())
                    if m:
                        hop_num = int(m.group(1))
                        hop_ip = m.group(2)
                        loss_p = float(m.group(3))
                        rtt_v = float(m.group(6))
                        if hop_ip == target:
                            reached = True
                        hops.append({
                            "hop": hop_num,
                            "ip": hop_ip,
                            "rtt_ms": rtt_v,
                            "loss_pct": loss_p,
                            "status": "ok" if loss_p < 100.0 else "timeout"
                        })
                if hops:
                    return {
                        "success": True,
                        "hops_count": len(hops),
                        "reached": reached or (len(hops) > 0 and hops[-1]["ip"] == target),
                        "hops": hops,
                        "tool": "mtr"
                    }
        except Exception:
            pass

        # 2. Try tracepath
        try:
            ret, stdout, stderr = run_cmd_safe(["tracepath", "-n", "-m", str(max_hops), target], timeout=8.0)
            for line in stdout.splitlines():
                m = re.match(r"^\s*(\d+):\s+([^\s]+)\s+([\d.]+)ms", line)
                if m:
                    hop_num = int(m.group(1))
                    hop_ip = m.group(2)
                    rtt_v = float(m.group(3))
                    if "reached" in line or hop_ip == target:
                        reached = True
                    hops.append({
                        "hop": hop_num,
                        "ip": hop_ip,
                        "rtt_ms": rtt_v,
                        "loss_pct": 0.0,
                        "status": "ok"
                    })
            if hops:
                return {
                    "success": True,
                    "hops_count": len(hops),
                    "reached": reached,
                    "hops": hops,
                    "tool": "tracepath"
                }
        except Exception:
            pass

        # 3. Fallback traceroute
        try:
            ret, stdout, stderr = run_cmd_safe(["traceroute", "-n", "-m", str(max_hops), "-w", str(timeout_sec), target], timeout=10.0)
            for line in stdout.splitlines()[1:]:
                m = re.match(r"^\s*(\d+)\s+([^\s]+)\s+([\d.]+)\s*ms", line)
                if m:
                    hop_num = int(m.group(1))
                    hop_ip = m.group(2)
                    rtt_v = float(m.group(3))
                    if hop_ip == target:
                        reached = True
                    hops.append({
                        "hop": hop_num,
                        "ip": hop_ip,
                        "rtt_ms": rtt_v,
                        "loss_pct": 0.0,
                        "status": "ok"
                    })
                elif re.match(r"^\s*(\d+)\s+\*", line):
                    m_star = re.match(r"^\s*(\d+)", line)
                    hop_num = int(m_star.group(1)) if m_star else len(hops) + 1
                    hops.append({
                        "hop": hop_num,
                        "ip": "*",
                        "rtt_ms": None,
                        "loss_pct": 100.0,
                        "status": "timeout"
                    })
            if hops:
                return {
                    "success": True,
                    "hops_count": len(hops),
                    "reached": reached,
                    "hops": hops,
                    "tool": "traceroute"
                }
        except Exception:
            pass

    elif system == "windows":
        try:
            ret, stdout, stderr = run_cmd_safe(
                ["tracert", "-d", "-h", str(max_hops), "-w", str(timeout_sec * 1000), target],
                timeout=18.0
            )
            for line in stdout.splitlines():
                line_clean = line.strip()
                m_num = re.match(r"^(\d+)\s+", line_clean)
                if not m_num:
                    continue
                hop_num = int(m_num.group(1))

                m_ip = re.search(r"((?:\d{1,3}\.){3}\d{1,3})", line_clean)
                hop_ip = m_ip.group(1) if m_ip else "*"

                times = []
                for t_str in re.findall(r"([<]?\d+)\s*ms", line_clean):
                    val = 0.5 if "<" in t_str else float(t_str)
                    times.append(val)

                avg_t = round(sum(times) / len(times), 2) if times else None
                if hop_ip == target:
                    reached = True

                hops.append({
                    "hop": hop_num,
                    "ip": hop_ip,
                    "rtt_ms": avg_t,
                    "loss_pct": 0.0 if avg_t is not None else 100.0,
                    "status": "ok" if avg_t is not None else "timeout"
                })

            if hops:
                return {
                    "success": True,
                    "hops_count": len(hops),
                    "reached": reached or (len(hops) > 0 and hops[-1]["ip"] == target),
                    "hops": hops,
                    "tool": "tracert"
                }
        except Exception:
            pass

    return {
        "success": False,
        "hops_count": 0,
        "reached": False,
        "hops": [],
        "tool": "none",
        "error": "No traceroute utility available"
    }

def diagnose_single_target(target_info: Dict[str, str]) -> Dict[str, Any]:
    """Runs ping and traceroute for a single target."""
    host = target_info["host"].strip()
    name = target_info.get("name", host)
    target_type = target_info.get("type", "extra")

    ping_res = run_ping(host)
    trace_res = run_traceroute(host)

    status = "healthy"
    if not ping_res.get("success"):
        status = "down"
    elif ping_res.get("loss_pct", 0) > 0 or (ping_res.get("avg_ms") and ping_res.get("avg_ms") > 120):
        status = "degraded"

    return {
        "host": host,
        "name": name,
        "type": target_type,
        "status": status,
        "ping": ping_res,
        "traceroute": trace_res
    }

def run_full_network_diagnostic(extra_hosts_str: str = "") -> List[Dict[str, Any]]:
    """Runs full network diagnostics concurrently for Gateway, DNS servers, and extra targets."""
    targets_to_test = []

    # 1. Default Gateway
    gw = detect_default_gateway()
    dns_list = detect_dns_servers()
    if gw:
        gw_label = f"Puerta de Enlace ({gw})"
        if gw in dns_list:
            gw_label = f"Gateway & DNS Local ({gw})"
        targets_to_test.append({
            "host": gw,
            "name": gw_label,
            "type": "gateway"
        })

    # 2. DNS Servers
    dns_count = 0
    for dns_ip in dns_list:
        if gw and dns_ip == gw:
            continue
        dns_count += 1
        targets_to_test.append({
            "host": dns_ip,
            "name": f"DNS {'Primario' if dns_count == 1 else f'Secundario #{dns_count}'} ({dns_ip})",
            "type": "dns"
        })

    # 3. Extra targets configured by user
    if extra_hosts_str:
        raw_items = re.split(r"[,;\s\n]+", extra_hosts_str.strip())
        existing_hosts = [t["host"] for t in targets_to_test]
        for item in raw_items:
            item = item.strip()
            if item and item not in existing_hosts:
                targets_to_test.append({
                    "host": item,
                    "name": f"Nodo Adicional ({item})",
                    "type": "extra"
                })
                existing_hosts.append(item)

    if not targets_to_test:
        targets_to_test.append({
            "host": "8.8.8.8",
            "name": "DNS Público (8.8.8.8)",
            "type": "dns"
        })

    results = []
    max_w = max(1, min(6, len(targets_to_test)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_w) as executor:
        future_to_target = {executor.submit(diagnose_single_target, t): t for t in targets_to_test}
        for future in concurrent.futures.as_completed(future_to_target):
            try:
                res = future.result()
                results.append(res)
            except Exception as e:
                t = future_to_target[future]
                results.append({
                    "host": t["host"],
                    "name": t.get("name", t["host"]),
                    "type": t.get("type", "extra"),
                    "status": "down",
                    "ping": {"success": False, "loss_pct": 100.0, "error": str(e)},
                    "traceroute": {"success": False, "hops": []}
                })

    type_order = {"gateway": 1, "dns": 2, "extra": 3}
    results.sort(key=lambda x: type_order.get(x.get("type", "extra"), 99))

    return results

if __name__ == "__main__":
    print("Testing network diagnostic...")
    gw = detect_default_gateway()
    print("Default gateway:", gw)
    dns = detect_dns_servers()
    print("DNS servers:", dns)
    diag = run_full_network_diagnostic()
    print(f"Diagnostics completed for {len(diag)} targets:")
    for d in diag:
        print(f" - {d['name']}: {d['status']} | Ping: {d['ping'].get('avg_ms')} ms (Loss: {d['ping'].get('loss_pct')}%) | Hops: {d['traceroute'].get('hops_count')}")
