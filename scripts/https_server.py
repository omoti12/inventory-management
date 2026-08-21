#!/usr/bin/env python3
"""src/ を HTTPS で配信する。

スマートフォンでバーコードのカメラ読み取りを使うには、ブラウザの制約で
HTTPS（または localhost）での表示が必須。scripts/start.sh の http:// では
パソコンのIPアドレスにスマホからアクセスしてもカメラが使えないため、
このスクリプトで自己署名証明書を使ったHTTPSサーバーを立てる。
"""
import http.server
import os
import shutil
import socket
import ssl
import subprocess
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(PROJECT_ROOT, 'src')
CERT_DIR = os.path.join(PROJECT_ROOT, '.certs')
CERT_FILE = os.path.join(CERT_DIR, 'dev-cert.pem')
KEY_FILE = os.path.join(CERT_DIR, 'dev-key.pem')

# PowerShell / cmd からは Git for Windows の openssl が PATH に無いことが多いので、
# 見つからなければ既定のインストール先も探す。
FALLBACK_OPENSSL_PATHS = [
    r'C:\Program Files\Git\usr\bin\openssl.exe',
    r'C:\Program Files\Git\mingw64\bin\openssl.exe',
    r'C:\Program Files (x86)\Git\usr\bin\openssl.exe',
]


def find_openssl():
    found = shutil.which('openssl')
    if found:
        return found
    for path in FALLBACK_OPENSSL_PATHS:
        if os.path.exists(path):
            return path
    return None


def local_ip():
    """スマホから開く用の、この端末のLAN IPアドレスを推測する。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


def ensure_cert(ip):
    """証明書が無い、またはIPが変わっていたら openssl で自己署名証明書を作り直す。"""
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        with open(CERT_FILE, 'r', encoding='utf-8') as f:
            if ip in f.read():
                return

    openssl = find_openssl()
    if not openssl:
        sys.stderr.write(
            'openssl was not found. It ships with Git for Windows, but PowerShell\n'
            'often does not have it on PATH. Either run this from Git Bash\n'
            '(`bash scripts/start-https.sh`), or install openssl and add it to PATH.\n'
        )
        sys.exit(1)

    os.makedirs(CERT_DIR, exist_ok=True)
    subject = '/CN=' + ip
    san = 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:' + ip
    cmd = [
        openssl, 'req', '-x509', '-newkey', 'rsa:2048',
        '-keyout', KEY_FILE, '-out', CERT_FILE,
        '-days', '365', '-nodes', '-subj', subject,
        '-addext', san,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        sys.stderr.write('Failed to create the certificate.\n')
        sys.stderr.write((e.stderr or b'').decode(errors='replace') + '\n')
        sys.exit(1)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
    ip = local_ip()
    ensure_cert(ip)

    os.chdir(SRC_DIR)
    handler = http.server.SimpleHTTPRequestHandler
    httpd = http.server.HTTPServer(('0.0.0.0', port), handler)

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

    # 日本語をそのまま print すると、Windows のコンソール既定コードページ次第で
    # 文字化けすることがあるため、ここは英語にしておく（アプリ本体のUI表示には影響しない）。
    print('Starting the inventory mock over HTTPS.')
    print('Open on this PC:     https://localhost:%d' % port)
    print('Open on a phone (same Wi-Fi): https://%s:%d' % (ip, port))
    print('This uses a self-signed certificate, so your browser will warn you the')
    print('first time you open it. Choose "Advanced" -> "Proceed anyway" to continue.')
    print('Press Ctrl+C in this terminal to stop.')
    sys.stdout.flush()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
