#!/usr/bin/env bash
# Publica una versión nueva de FlowDesk Pro.
#
#   npm run release -- 0.2.0 "Notas que verá el usuario en el aviso de actualización"
#
# Actualiza la versión en package.json, Cargo.toml, Cargo.lock y tauri.conf.json,
# ejecuta las comprobaciones, crea el commit y la etiqueta vX.Y.Z y los envía a GitHub.
# GitHub Actions compila, firma y publica la versión (.github/workflows/release.yml).
set -euo pipefail

cd "$(dirname "$0")/.."

version="${1:-}"
notes="${2:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Uso: npm run release -- X.Y.Z \"Notas de la versión\"" >&2
  exit 1
fi
if [[ -z "$notes" ]]; then
  echo "Escribe unas notas: se muestran en el aviso de actualización." >&2
  exit 1
fi

current=$(node -p "require('./src-tauri/tauri.conf.json').version")
if [[ "$(printf '%s\n%s\n' "$current" "$version" | sort -V | tail -1)" != "$version" || "$current" == "$version" ]]; then
  echo "La versión $version debe ser mayor que la actual ($current)." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Hay cambios sin confirmar. Haz commit antes de publicar." >&2
  exit 1
fi
if git rev-parse "v$version" >/dev/null 2>&1; then
  echo "La etiqueta v$version ya existe." >&2
  exit 1
fi

node - "$version" <<'NODE'
const fs = require("fs");
const version = process.argv[2];
for (const file of ["package.json", "src-tauri/tauri.conf.json"]) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  data.version = version;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
const cargo = "src-tauri/Cargo.toml";
fs.writeFileSync(
  cargo,
  fs.readFileSync(cargo, "utf8").replace(/^version = "[^"]+"/m, `version = "${version}"`),
);
NODE
npm install --package-lock-only --ignore-scripts >/dev/null
cargo update --manifest-path src-tauri/Cargo.toml --offline -p flowdesk-pro >/dev/null

npm run check
cargo test --manifest-path src-tauri/Cargo.toml --quiet

git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "Versión $version" -m "$notes"
git tag -a "v$version" -m "$notes"
git push origin HEAD "v$version"

echo
echo "Etiqueta v$version enviada. GitHub Actions publicará la versión en unos minutos:"
echo "  gh run watch \$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
