import os
import time
import struct
import base64
import hashlib
import hmac

def md4(msg: bytes) -> bytes:
    """Pure Python implementation of MD4 hash algorithm (RFC 1320)."""
    orig_len_bits = (len(msg) * 8) & 0xffffffffffffffff
    msg += b'\x80'
    while (len(msg) % 64) != 56:
        msg += b'\x00'
    msg += struct.pack('<Q', orig_len_bits)

    A, B, C, D = 0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476

    F = lambda x, y, z: (x & y) | (~x & z)
    G = lambda x, y, z: (x & y) | (x & z) | (y & z)
    H = lambda x, y, z: x ^ y ^ z

    lrot = lambda val, n: ((val << n) & 0xffffffff) | ((val & 0xffffffff) >> (32 - n))

    for i in range(0, len(msg), 64):
        X = struct.unpack('<16I', msg[i:i+64])
        AA, BB, CC, DD = A, B, C, D

        # Round 1
        for j, s in zip([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], [3,7,11,19]*4):
            A = lrot((A + F(B, C, D) + X[j]) & 0xffffffff, s)
            A, B, C, D = D, A, B, C

        # Round 2
        for j, s in zip([0,4,8,12,1,5,9,13,2,6,10,14,3,7,11,15], [3,5,9,13]*4):
            A = lrot((A + G(B, C, D) + X[j] + 0x5a827999) & 0xffffffff, s)
            A, B, C, D = D, A, B, C

        # Round 3
        for j, s in zip([0,8,4,12,2,10,6,14,1,9,5,13,3,11,7,15], [3,9,11,15]*4):
            A = lrot((A + H(B, C, D) + X[j] + 0x6ed9eba1) & 0xffffffff, s)
            A, B, C, D = D, A, B, C

        A = (A + AA) & 0xffffffff
        B = (B + BB) & 0xffffffff
        C = (C + CC) & 0xffffffff
        D = (D + DD) & 0xffffffff

    return struct.pack('<4I', A, B, C, D)

def get_ntlm_type1() -> str:
    """Generates base64-encoded NTLM Type 1 Negotiate Message."""
    # NTLMSSP Negotiate flags: Unicode, OEM, Request Target, NTLM, Always Sign, NTLM2 Key
    msg = b'NTLMSSP\x00\x01\x00\x00\x00\x07\x82\x08\x80\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x06\x01\xb1\x1d\x00\x00\x00\x0f'
    return base64.b64encode(msg).decode('ascii')

def create_ntlm_type3(type2_b64: str, user: str, domain: str, password: str, workstation: str = '') -> str:
    """Generates base64-encoded NTLM v2 Type 3 Authenticate Message from server Type 2 challenge."""
    type2_bytes = base64.b64decode(type2_b64)
    if len(type2_bytes) < 32 or not type2_bytes.startswith(b'NTLMSSP\x00\x02\x00\x00\x00'):
        raise ValueError("Respuesta NTLM Type 2 no válida recibida del servidor")

    # Server challenge (8 bytes at offset 24)
    server_challenge = type2_bytes[24:32]

    # Target info (AV pairs at offset 40)
    target_info = b''
    if len(type2_bytes) >= 48:
        target_info_len, _, target_info_offset = struct.unpack('<HH1I', type2_bytes[40:48])
        target_info = type2_bytes[target_info_offset:target_info_offset + target_info_len]

    # Parse domain\\username or user@domain if provided inside user string
    if '\\' in user:
        domain, user = user.split('\\', 1)
    elif '@' in user:
        user, domain = user.split('@', 1)

    user_bytes = user.encode('utf-16le')
    domain_bytes = domain.encode('utf-16le')
    ws_bytes = workstation.encode('utf-16le')

    # NTLM v2 Hash
    ntlm_hash = md4(password.encode('utf-16le'))
    identity = user.upper().encode('utf-16le') + domain.encode('utf-16le')
    ntlm_v2_hash = hmac.new(ntlm_hash, identity, hashlib.md5).digest()

    # NTLM v2 Timestamp & Client Challenge
    now_ft = int((time.time() + 11644473600) * 10000000)
    timestamp_bytes = struct.pack('<Q', now_ft)
    client_challenge = os.urandom(8)

    # NTLM v2 Response Blob
    temp_blob = b'\x01\x01\x00\x00\x00\x00\x00\x00' + timestamp_bytes + client_challenge + b'\x00\x00\x00\x00' + target_info + b'\x00\x00\x00\x00'
    nt_proof = hmac.new(ntlm_v2_hash, server_challenge + temp_blob, hashlib.md5).digest()
    ntlm_v2_response = nt_proof + temp_blob
    lm_v2_response = hmac.new(ntlm_v2_hash, server_challenge + client_challenge, hashlib.md5).digest() + client_challenge

    # Offsets layout (Header length = 64 bytes)
    offset = 64
    lm_offset = offset; offset += len(lm_v2_response)
    nt_offset = offset; offset += len(ntlm_v2_response)
    domain_offset = offset; offset += len(domain_bytes)
    user_offset = offset; offset += len(user_bytes)
    ws_offset = offset; offset += len(ws_bytes)
    session_key_offset = offset

    flags = 0x82088205  # NTLM2, Unicode, Request Target, Negotiate NTLM
    header = b'NTLMSSP\x00\x03\x00\x00\x00'
    header += struct.pack('<HH1I', len(lm_v2_response), len(lm_v2_response), lm_offset)
    header += struct.pack('<HH1I', len(ntlm_v2_response), len(ntlm_v2_response), nt_offset)
    header += struct.pack('<HH1I', len(domain_bytes), len(domain_bytes), domain_offset)
    header += struct.pack('<HH1I', len(user_bytes), len(user_bytes), user_offset)
    header += struct.pack('<HH1I', len(ws_bytes), len(ws_bytes), ws_offset)
    header += struct.pack('<HH1I', 0, 0, session_key_offset)
    header += struct.pack('<I', flags)

    payload = header + lm_v2_response + ntlm_v2_response + domain_bytes + user_bytes + ws_bytes
    return base64.b64encode(payload).decode('ascii')
