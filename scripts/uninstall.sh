#!/usr/bin/env bash
set -euo pipefail
command -v node >/dev/null 2>&1 || { echo 'Node.js is required to uninstall.' >&2; exit 1; }
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$script_dir/install.mjs" --uninstall "$@"
