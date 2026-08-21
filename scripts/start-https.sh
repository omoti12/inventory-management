#!/usr/bin/env bash

# このスクリプトは src/ を HTTPS（自己署名証明書）でローカル公開します。
# スマホでバーコードのカメラ読み取りを試すときはこちらを使ってください
# （http:// のIPアドレスアクセスではブラウザの制約でカメラが使えません）。
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-8443}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 が見つかりません。Python 3 をインストールしてから、もう一度実行してください。" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl が見つかりません。証明書の作成に必要なので、インストールしてから、もう一度実行してください。" >&2
  exit 1
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "ポート番号は 1〜65535 の数字で指定してください。" >&2
  exit 1
fi

exec python3 "$PROJECT_ROOT/scripts/https_server.py" "$PORT"
