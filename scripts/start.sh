#!/usr/bin/env bash

# このスクリプトは src/ をローカルサーバーで公開します。
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-8000}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 が見つかりません。Python 3 をインストールしてから、もう一度実行してください。" >&2
  exit 1
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "ポート番号は 1〜65535 の数字で指定してください。" >&2
  exit 1
fi

echo "在庫管理モックを起動します。"
echo "ブラウザで http://localhost:${PORT} を開いてください。"
echo "停止するには、このターミナルで Ctrl + C を押します。"

exec python3 -m http.server "$PORT" --directory "$PROJECT_ROOT/src"
