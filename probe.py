import socket
import ssl
import time
import urllib.parse
from typing import Dict, Any

def measure_latency(url: str, timeout: float = 10.0) -> Dict[str, Any]:
    """
    Measures latency breakdown for a given URL:
    - DNS Resolution time (dns_ms)
    - TCP Connection time (tcp_ms)
    - TLS/SSL Handshake time (tls_ms)
    - Time To First Byte / Server Wait time (ttfb_ms)
    - Data Transfer time (transfer_ms)
    - Total Latency (total_ms)
    """
    parsed = urllib.parse.urlparse(url)
    hostname = parsed.hostname
    if not hostname:
        return {
            'url': url,
            'timestamp': time.time(),
            'ip': None,
            'status_code': 0,
            'dns_ms': 0.0,
            'tcp_ms': 0.0,
            'tls_ms': 0.0,
            'ttfb_ms': 0.0,
            'transfer_ms': 0.0,
            'total_ms': 0.0,
            'is_error': True,
            'error_message': 'Invalid URL format',
            'response_size_bytes': 0
        }

    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    path = parsed.path or '/'
    if parsed.query:
        path += '?' + parsed.query

    res = {
        'url': url,
        'timestamp': time.time(),
        'ip': None,
        'status_code': 0,
        'dns_ms': 0.0,
        'tcp_ms': 0.0,
        'tls_ms': 0.0,
        'ttfb_ms': 0.0,
        'transfer_ms': 0.0,
        'total_ms': 0.0,
        'is_error': False,
        'error_message': None,
        'response_size_bytes': 0
    }

    t0 = time.perf_counter()
    try:
        # 1. DNS Resolution
        t_dns_start = time.perf_counter()
        ip = socket.gethostbyname(hostname)
        t_dns_end = time.perf_counter()
        res['dns_ms'] = round((t_dns_end - t_dns_start) * 1000, 2)
        res['ip'] = ip

        # 2. TCP Socket Connection
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        t_tcp_start = time.perf_counter()
        sock.connect((ip, port))
        t_tcp_end = time.perf_counter()
        res['tcp_ms'] = round((t_tcp_end - t_tcp_start) * 1000, 2)

        # 3. TLS Handshake (if HTTPS)
        if parsed.scheme == 'https':
            context = ssl.create_default_context()
            t_tls_start = time.perf_counter()
            ssl_sock = context.wrap_socket(sock, server_hostname=hostname)
            t_tls_end = time.perf_counter()
            res['tls_ms'] = round((t_tls_end - t_tls_start) * 1000, 2)
        else:
            ssl_sock = sock
            res['tls_ms'] = 0.0

        # 4. HTTP Request & Time To First Byte (TTFB)
        req_headers = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {hostname}\r\n"
            f"User-Agent: Manhattan-Latency-Analyzer/1.0\r\n"
            f"Accept: */*\r\n"
            f"Connection: close\r\n\r\n"
        )
        t_ttfb_start = time.perf_counter()
        ssl_sock.sendall(req_headers.encode('utf-8'))
        first_byte = ssl_sock.recv(1)
        t_ttfb_end = time.perf_counter()
        res['ttfb_ms'] = round((t_ttfb_end - t_ttfb_start) * 1000, 2)

        if not first_byte:
            raise Exception("Server closed connection without sending data")

        # 5. Data Read / Transfer Time
        t_trans_start = time.perf_counter()
        data = first_byte
        while True:
            chunk = ssl_sock.recv(8192)
            if not chunk:
                break
            data += chunk
        t_trans_end = time.perf_counter()
        res['transfer_ms'] = round((t_trans_end - t_trans_start) * 1000, 2)
        res['response_size_bytes'] = len(data)
        ssl_sock.close()

        # Parse Status Code
        status_line = data.split(b'\r\n')[0].decode('utf-8', errors='ignore')
        parts = status_line.split()
        if len(parts) >= 2 and parts[1].isdigit():
            res['status_code'] = int(parts[1])

        res['total_ms'] = round((time.perf_counter() - t0) * 1000, 2)

    except socket.timeout:
        res['is_error'] = True
        res['error_message'] = f"Timeout reached ({timeout}s)"
        res['total_ms'] = round((time.perf_counter() - t0) * 1000, 2)
    except Exception as e:
        res['is_error'] = True
        res['error_message'] = str(e)
        res['total_ms'] = round((time.perf_counter() - t0) * 1000, 2)

    return res

if __name__ == '__main__':
    test_url = "https://alkop.sce.manh.com/ping"
    print("Testing probe on:", test_url)
    metrics = measure_latency(test_url)
    print(metrics)
