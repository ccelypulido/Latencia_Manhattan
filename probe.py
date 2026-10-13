import socket
import ssl
import time
import base64
import urllib.parse
from typing import Dict, Any, Optional

import ntlm_auth

def read_http_response(sock: socket.socket) -> tuple[bytes, dict, int]:
    """Reads HTTP headers and response body from a connected socket."""
    data = b""
    headers_end = -1
    while headers_end == -1:
        chunk = sock.recv(4096)
        if not chunk:
            break
        data += chunk
        headers_end = data.find(b"\r\n\r\n")

    if headers_end == -1:
        return data, {}, 0

    header_bytes = data[:headers_end]
    lines = header_bytes.decode('utf-8', errors='ignore').split('\r\n')
    status_line = lines[0] if lines else ""
    parts = status_line.split()
    status_code = int(parts[1]) if len(parts) >= 2 and parts[1].isdigit() else 0

    headers = {}
    for line in lines[1:]:
        if ':' in line:
            k, v = line.split(':', 1)
            headers[k.strip().lower()] = v.strip()

    content_length = int(headers.get('content-length', 0))
    body_read = len(data) - (headers_end + 4)
    while content_length > 0 and body_read < content_length:
        chunk = sock.recv(min(8192, content_length - body_read))
        if not chunk:
            break
        data += chunk
        body_read += len(chunk)

    return data, headers, status_code

def measure_latency(url: str, timeout: float = 10.0, auth_config: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """
    Measures latency breakdown for a given URL, supporting domain authentication (NTLM, Basic Auth, Bearer Token):
    - DNS Resolution (dns_ms)
    - TCP Connection (tcp_ms)
    - TLS/SSL Handshake (tls_ms)
    - Time To First Byte (ttfb_ms)
    - Data Transfer (transfer_ms)
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

    auth_enabled = False
    auth_type = 'ntlm'
    domain = ''
    user = ''
    password = ''
    token = ''

    if auth_config:
        auth_enabled = (str(auth_config.get('auth_enabled', '0')) == '1')
        auth_type = auth_config.get('auth_type', 'ntlm').lower()
        domain = auth_config.get('auth_domain', '')
        user = auth_config.get('auth_user', '')
        password = auth_config.get('auth_password', '')
        token = auth_config.get('auth_token', '')

    t0 = time.perf_counter()
    try:
        # 1. DNS Resolution
        t_dns_start = time.perf_counter()
        ip = socket.gethostbyname(hostname)
        t_dns_end = time.perf_counter()
        res['dns_ms'] = round((t_dns_end - t_dns_start) * 1000, 2)
        res['ip'] = ip

        # 2. TCP Connection
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        t_tcp_start = time.perf_counter()
        sock.connect((ip, port))
        t_tcp_end = time.perf_counter()
        res['tcp_ms'] = round((t_tcp_end - t_tcp_start) * 1000, 2)

        # 3. TLS Handshake
        if parsed.scheme == 'https':
            context = ssl.create_default_context()
            t_tls_start = time.perf_counter()
            ssl_sock = context.wrap_socket(sock, server_hostname=hostname)
            t_tls_end = time.perf_counter()
            res['tls_ms'] = round((t_tls_end - t_tls_start) * 1000, 2)
        else:
            ssl_sock = sock
            res['tls_ms'] = 0.0

        # 4. HTTP Request & NTLM / Authentication Handshake
        extra_headers = ""
        if auth_enabled:
            if auth_type == 'basic' and (user or password):
                full_user = f"{domain}\\{user}" if domain and '\\' not in user else user
                creds = base64.b64encode(f"{full_user}:{password}".encode('utf-8')).decode('ascii')
                extra_headers += f"Authorization: Basic {creds}\r\n"
            elif auth_type == 'bearer' and token:
                token_clean = token.strip()
                if token_clean.lower().startswith('cookie:'):
                    extra_headers += token_clean + '\r\n'
                elif token_clean.lower().startswith('authorization:'):
                    extra_headers += token_clean + '\r\n'
                elif '=' in token_clean and (';' in token_clean or not token_clean.lower().startswith('bearer ')):
                    extra_headers += 'Cookie: ' + token_clean + '\r\n'
                else:
                    auth_val = token_clean if token_clean.lower().startswith('bearer ') else 'Bearer ' + token_clean
                    extra_headers += 'Authorization: ' + auth_val + '\r\n'

        if auth_enabled and auth_type == 'ntlm' and (user or password):
            # Step 1: Send NTLM Type 1 Negotiate Header
            ntlm_type1 = ntlm_auth.get_ntlm_type1()
            req_type1 = (
                f"GET {path} HTTP/1.1\r\n"
                f"Host: {hostname}\r\n"
                f"User-Agent: Manhattan-Latency-Analyzer/1.0\r\n"
                f"Accept: */*\r\n"
                f"Authorization: NTLM {ntlm_type1}\r\n"
                f"Connection: keep-alive\r\n\r\n"
            )
            ssl_sock.sendall(req_type1.encode('utf-8'))
            data1, headers1, status1 = read_http_response(ssl_sock)

            # Check for WWW-Authenticate NTLM challenge in response
            www_auth = headers1.get('www-authenticate', '')
            challenge_b64 = None
            if 'ntlm' in www_auth.lower():
                parts = www_auth.split()
                for i, p in enumerate(parts):
                    if p.lower() == 'ntlm' and i + 1 < len(parts):
                        challenge_b64 = parts[i + 1]
                        break

            if challenge_b64:
                # Step 2: Generate Type 3 Authenticate header and send over same socket
                full_user = f"{domain}\\{user}" if domain and '\\' not in user else user
                type3_b64 = ntlm_auth.create_ntlm_type3(challenge_b64, full_user, domain, password)
                req_type3 = (
                    f"GET {path} HTTP/1.1\r\n"
                    f"Host: {hostname}\r\n"
                    f"User-Agent: Manhattan-Latency-Analyzer/1.0\r\n"
                    f"Accept: */*\r\n"
                    f"Authorization: NTLM {type3_b64}\r\n"
                    f"Connection: close\r\n\r\n"
                )
                t_ttfb_start = time.perf_counter()
                ssl_sock.sendall(req_type3.encode('utf-8'))
                first_byte = ssl_sock.recv(1)
                t_ttfb_end = time.perf_counter()
                res['ttfb_ms'] = round((t_ttfb_end - t_ttfb_start) * 1000, 2)

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

                status_line = data.split(b'\r\n')[0].decode('utf-8', errors='ignore')
                sp = status_line.split()
                if len(sp) >= 2 and sp[1].isdigit():
                    res['status_code'] = int(sp[1])

                res['total_ms'] = round((time.perf_counter() - t0) * 1000, 2)
                return res

        # Fallback / Direct Request (No NTLM or standard headers)
        req_headers = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {hostname}\r\n"
            f"User-Agent: Manhattan-Latency-Analyzer/1.0\r\n"
            f"Accept: */*\r\n"
            f"{extra_headers}"
            f"Connection: close\r\n\r\n"
        )
        t_ttfb_start = time.perf_counter()
        ssl_sock.sendall(req_headers.encode('utf-8'))
        first_byte = ssl_sock.recv(1)
        t_ttfb_end = time.perf_counter()
        res['ttfb_ms'] = round((t_ttfb_end - t_ttfb_start) * 1000, 2)

        if not first_byte:
            raise Exception("Server closed connection without sending data")

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
