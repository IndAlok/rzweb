#!/bin/bash
set -e

echo "=== RzWeb Build Script ==="

# Vite 7 needs Node 20.19+ (crypto.hash). Cloudflare Pages v2 still injects
# Node 18 via NODE_VERSION even when .nvmrc pins 22.12.0.
node_ok() {
    node -e 'const [maj,min]=process.versions.node.split(".").map(Number); process.exit((maj===20&&min>=19)||maj>=22?0:1)'
}

echo "Node $(node -v)"
if ! node_ok; then
    echo "Node $(node -v) is below engines; installing 22.12.0..."
    if command -v asdf >/dev/null 2>&1; then
        asdf install nodejs 22.12.0
        asdf local nodejs 22.12.0
        NODE_HOME="$(asdf where nodejs)"
        export PATH="${NODE_HOME}/bin:${PATH}"
        hash -r
    fi
    if ! node_ok; then
        NODE_DIST="node-v22.12.0-linux-x64"
        curl -fsSL "https://nodejs.org/dist/v22.12.0/${NODE_DIST}.tar.gz" -o "/tmp/${NODE_DIST}.tar.gz"
        tar -xzf "/tmp/${NODE_DIST}.tar.gz" -C /tmp
        export PATH="/tmp/${NODE_DIST}/bin:${PATH}"
        hash -r
    fi
    if ! node_ok; then
        echo "Error: need Node 20.19+ or 22.12+ (have $(node -v)). Set Cloudflare NODE_VERSION=22." >&2
        exit 1
    fi
    echo "Now using $(command -v node) $(node -v)"
fi

echo "Downloading rizin.js..."
curl -fL "https://indalok.github.io/rzwasi/rizin.js" -o public/rizin.js
echo "Downloaded rizin.js to public/"

echo "Fetching Rizin version..."
RIZIN_VERSION=$(curl -fsSL "https://indalok.github.io/rzwasi/VERSION" 2>/dev/null | tr -d '\r\n' || echo "unknown")
echo "Rizin version: $RIZIN_VERSION"
echo "$RIZIN_VERSION" > public/VERSION

echo "Installing dependencies..."
npm ci

echo "Building..."
VITE_RIZIN_VERSION="$RIZIN_VERSION" npm run build

echo "=== Build Complete ==="
ls -la dist/
