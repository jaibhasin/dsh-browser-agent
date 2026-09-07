#!/usr/bin/env bash
set -euo pipefail
command -v node >/dev/null 2>&1 || { echo 'Install Node.js 24 LTS from https://nodejs.org, then retry.' >&2; exit 1; }
script_dir=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
if [ -n "$script_dir" ] && [ -f "$script_dir/install.mjs" ]; then
  exec node "$script_dir/install.mjs" "$@"
fi
command -v curl >/dev/null 2>&1 || { echo 'Install curl first.' >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo 'Install tar first.' >&2; exit 1; }
install_tmp="$(mktemp -d)"
trap 'rm -rf -- "$install_tmp"' EXIT
curl --fail --location --silent --show-error --retry 3 \
  https://github.com/jaibhasin/dsh-browser-agent/archive/refs/heads/main.tar.gz \
  --output "$install_tmp/source.tar.gz"
tar -xzf "$install_tmp/source.tar.gz" -C "$install_tmp"
node "$install_tmp/dsh-browser-agent-main/scripts/install.mjs" "$@"
