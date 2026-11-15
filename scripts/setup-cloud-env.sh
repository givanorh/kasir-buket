#!/usr/bin/env bash
# Skrip penyiapan untuk environment Claude Code (cloud).
# Tempel isi berkas ini ke kolom "Setup script" environment, atau jalankan manual: bash scripts/setup-cloud-env.sh
# Butuh akses jaringan ke registry.npmjs.org (termasuk dalam akses jaringan default/"Trusted").
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22||(a===22&&b<13)){console.error('Butuh Node.js >= 22.13 (node:sqlite). Versi sekarang: '+process.version); process.exit(1)}"
(cd app && npm ci --no-audit --no-fund)
(cd app && npm run build)
echo "Siap: server tanpa dependensi; app/dist sudah dibangun."
