#!/usr/bin/env bash
set -e

echo ""
echo "  ============================================"
echo "     Luma Studio - Photo Viewer & Editor"
echo "  ============================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  [Error] Node.js not found."
  echo "  Please install Node.js 18+ from https://nodejs.org/"
  echo ""
  exit 1
fi

echo "  Starting server at http://localhost:3000"
echo "  Press Ctrl+C to stop."
echo ""

# Try to open the browser (macOS / Linux)
( sleep 2; (open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null) ) &

node server.js
