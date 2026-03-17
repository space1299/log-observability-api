#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BASE_DIR"

COMPOSE="docker compose"

echo "[INFO] Deploy start (down -> pull -> up -d)"

$COMPOSE down || true

$COMPOSE pull

$COMPOSE up -d

echo "[INFO] Deploy done"
