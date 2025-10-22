#!/usr/bin/env bash
set -euo pipefail

echo "=== GUARDS START ==="
scripts/guard-single-adapter.sh
node scripts/guard-registry-coverage.js
node scripts/guard-tenant-context.js
echo "=== GUARDS OK ==="

