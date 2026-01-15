#!/bin/bash
set -e

echo "=== RzWeb Build Script ==="

# Download rizin.js from GitHub Pages to bundle locally
# This avoids COEP cross-origin script blocking issues
# The rizin.wasm (30MB) will be loaded from GitHub Pages at runtime
echo "Downloading rizin.js..."
curl -fL "https://indalok.github.io/rzwasi/rizin.js" -o public/rizin.js
echo "Downloaded rizin.js to public/"

# Install dependencies
echo "Installing dependencies..."
npm ci

# Build the project
echo "Building..."
npm run build

echo "=== Build Complete ==="
ls -la dist/
