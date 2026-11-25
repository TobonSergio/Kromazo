#!/usr/bin/env bash
# Actualiza la app en el servidor a la última versión de la rama main. Ejecutar como el usuario vinilos.
set -euo pipefail
cd /opt/vinilos

npm run --silent backup   # respaldo antes de cambiar nada
git pull --ff-only
npm ci
npm run build
npm test                  # si alguna prueba falla, no se reinicia: la versión anterior sigue funcionando
sudo systemctl restart vinilos
sleep 2
curl -fsS http://127.0.0.1:3000/api/health && echo " ← la app responde"
