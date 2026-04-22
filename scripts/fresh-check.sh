#!/usr/bin/env bash
# Fresh typecheck: clears stale TS/Vite caches, then runs typecheck + build.
# Usage:  bash scripts/fresh-check.sh           # typecheck only
#         bash scripts/fresh-check.sh --build   # typecheck + production build
#         bash scripts/fresh-check.sh --dev     # clean caches then start dev server
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "🧹 Clearing stale caches..."
rm -rf \
  node_modules/.vite \
  node_modules/.cache \
  node_modules/.tmp \
  .vite \
  dist \
  tsconfig.tsbuildinfo \
  tsconfig.app.tsbuildinfo \
  tsconfig.node.tsbuildinfo \
  src/**/*.tsbuildinfo 2>/dev/null || true

echo "🔍 Running fresh TypeScript check (no cache)..."
npx tsc -b --force --pretty

case "${1:-}" in
  --build)
    echo "📦 Building production bundle..."
    npx vite build
    ;;
  --dev)
    echo "🚀 Starting dev server with fresh cache..."
    npx vite --force
    ;;
esac

echo "✅ Done. No stale errors should remain."
