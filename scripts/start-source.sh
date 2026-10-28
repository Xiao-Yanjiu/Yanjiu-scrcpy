#!/usr/bin/env bash
set -euo pipefail
source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v node >/dev/null || { echo "Node.js is required." >&2; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 is required for X11 window integration." >&2; exit 1; }
if [[ ! -f "$source_root/desktop/node_modules/electron/dist/electron" || ! -f "$source_root/desktop/node_modules/vite/bin/vite.js" ]]; then
  echo "Install Linux dependencies in the source folder with pnpm install first; Windows node_modules cannot be reused." >&2
  exit 1
fi
export YANJIU_SOURCE_ROOT="$source_root"
unset ELECTRON_RUN_AS_NODE PORTABLE_EXECUTABLE_DIR
cd -- "$source_root/desktop"
exec node node_modules/vite/bin/vite.js dev --host 127.0.0.1 --strictPort
