#!/bin/bash
# Manhattan Latency Analyzer - Linux/macOS Launcher

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

if command -v python3 &> /dev/null; then
    echo "🚀 Iniciando Manhattan Latency Analyzer con python3..."
    python3 app.py
elif command -v python &> /dev/null; then
    echo "🚀 Iniciando Manhattan Latency Analyzer con python..."
    python app.py
else
    echo "❌ Error: Python 3 no se encuentra instalado en el sistema."
    echo "Por favor instale Python 3 y vuelva a intentarlo."
    exit 1
fi
