#!/usr/bin/env bash
# Compila .app y .dmg localmente firmando los artefactos del actualizador.
# La clave privada vive fuera del repositorio (~/.tauri) y su contraseña en el Llavero.
set -euo pipefail
cd "$(dirname "$0")/.."

key="$HOME/.tauri/flowdesk-pro.key"
if [[ ! -f "$key" ]]; then
  echo "Falta la clave de firma $key (ver README, sección Actualizaciones)." >&2
  exit 1
fi
TAURI_SIGNING_PRIVATE_KEY="$(cat "$key")"
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -a flowdesk-pro -s tauri-updater-key-password -w)"
export TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD

npx tauri build --bundles app,dmg "$@"
