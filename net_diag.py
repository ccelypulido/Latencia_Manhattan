import os
import sys
import re
import socket
import struct
import platform
import subprocess
import concurrent.futures
from typing import Dict, Any, List, Optional

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
            res = subprocess.run(["ip", "route", "show", "default"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=3)
            m = re.search(r"default via ([0-9.]+)", res.stdout)
            if m:
                return m.group(1)
        except Exception:
            pass

    elif system == "windows":
        try:
            res = subprocess.run(["route", "print", "0.0.0.0"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=4)
            for line in res.stdout.splitlines():
                parts = line.strip().split()
                if len(parts) >= 5 and parts[0] == "0.0.0.0" and parts[1] == "0.0.0.0":
                    return parts[2]
        except Exception:
            pass

        try:
            ps_cmd = "(Get-NetRoute -DestinationPrefix '0.0.0.0/0').NextHop"
            res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=4)
            ip_str = res.stdout.strip()
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
            res = subprocess.run(["resolvectl", "dns"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=3)
            for line in res.stdout.splitlines():
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
            res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=4)
            for line in res.stdout.splitlines():
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

def run_ping(target: str, count: int = 3, timeout_sec: int = 2) -> Dict[str, Any]:
    """Executes ICMP ping to target and parses latency and packet loss."""
    system = platform.system().lower()
    target = target.strip()
    
    if system == "windows":
        cmd = ["ping", "-n", str(count), "-w", str(timeout_sec * 1000), target]
    else:
        cmd = ["ping", "-c", str(count), "-W", str(timeout_sec), target]

    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=(count * timeout_sec) + 3)
        out = res.stdout + "\n" + res.stderr
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
    m_loss = re.search(r"(\d+(?:\.\d+)?)%\s*(?:packet loss|perdidos)", out, re.IGNORECASE)
    if m_loss:
        try:
            loss_pct = float(m_loss.group(1))
        except ValueError:
            pass

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

    m_win = re.search(r"(?:M[ií]nimo|Minimum)\s*=\s*(\d+)ms.*?(?:M[aá]ximo|Maximum)\s*=\s*(\d+)ms.*?(?:Media|Average)\s*=\s*(\d+)ms", out, re.IGNORECASE | re.DOTALL)
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

    times = [float(t) for t in re.findall(r"time[<=]([\d.]+)\s*ms", out, re.IGNORECASE)]
    if times:
        return {
            "success": True,
            "loss_pct": round(loss_pct, 1),
            "min_ms": round(min(times), 2),
            "avg_ms": round(sum(times) / len(times), 2),
            "max_ms": round(max(times), 2),
            "mdev_ms": round(abs(max(times) - min(times)) / 2.0, 2),
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
    """Executes traceroute / tracepath / mtr to target and extracts hop-by-hop nodes and RTTs."""
    system = platform.system().lower()
    target = target.strip()
    hops = []
    reached = False

    if system == "linux":
        # 1. Try mtr report first
        try:
            res = subprocess.run(["mtr", "-r", "-c", "1", "-n", "-m", str(max_hops), target], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=8)
            if res.returncode == 0 and res.stdout:
                for line in res.stdout.splitlines():
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
                            "rtt_ms": rtt_v if loss_p < 100.0 else None,
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
            res = subprocess.run(["tracepath", "-n", "-m", str(max_hops), target], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=8)
            out = res.stdout
            for line in out.splitlines():
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
            res = subprocess.run(["traceroute", "-n", "-m", str(max_hops), "-w", str(timeout_sec), target], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
            for line in res.stdout.splitlines()[1:]:
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
            res = subprocess.run(["tracert", "-d", "-h", str(max_hops), "-w", str(timeout_sec * 1000), target], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=15)
            for line in res.stdout.splitlines():
                m = re.match(r"^\s*(\d+)\s+([<\d*]+)\s*(?:ms)?\s+([<\d*]+)\s*(?:ms)?\s+([<\d*]+)\s*(?:ms)?\s+([^\s]+)", line.strip())
                if m:
                    hop_num = int(m.group(1))
                    hop_ip = m.group(5)
                    times = []
                    for t in [m.group(2), m.group(3), m.group(4)]:
                        if t != "*" and re.search(r"\d+", t):
                            times.append(float(re.search(r"\d+", t).group(0)))
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
                    "reached": reached,
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
