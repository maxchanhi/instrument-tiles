#!/bin/bash
echo "========================================"
echo "  Instrument Tiles - macOS Installer"
echo "========================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "[1/3] Installing Node.js..."
    echo ""
    
    # Check if Homebrew is installed
    if ! command -v brew &> /dev/null; then
        echo "Installing Homebrew first..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    
    echo "Installing Node.js via Homebrew..."
    brew install node
    
    echo "Node.js installed!"
else
    echo "[1/3] Node.js already installed - skipping..."
    node --version
fi

echo ""
echo "[2/3] Installing dependencies..."
npm install

echo ""
echo "[3/3] Starting Instrument Tiles..."
echo ""
echo "========================================"
echo "  Server starting..."
echo "  Open http://localhost:3000 in browser"
echo "========================================"
echo ""
npm start
