#!/bin/bash
set -e

echo "=== RzWeb Build Script ==="

echo "Downloading rizin.js..."
curl -fL "https://indalok.github.io/rzwasi/rizin.js" -o public/rizin.js
echo "Downloaded rizin.js to public/"

echo "Fetching Rizin version..."
RIZIN_VERSION=$(curl -fsSL "https://indalok.github.io/rzwasi/VERSION" 2>/dev/null || echo "0.8.1")
echo "Rizin version: $RIZIN_VERSION"
echo "$RIZIN_VERSION" > public/VERSION

echo "Installing dependencies..."
npm ci

echo "Building..."
VITE_RIZIN_VERSION="$RIZIN_VERSION" npm run build

echo "=== Build Complete ==="
ls -la dist/
