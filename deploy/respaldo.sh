#!/usr/bin/env bash
# Respaldo diario: copia consistente de la BD y fotos (npm run backup) y luego la sube FUERA del servidor con rclone.
# Un respaldo que vive en el mismo VPS no sirve si se pierde el VPS.
set -euo pipefail
cd /opt/vinilos/server

npm run --silent backup

# Destino configurado con `rclone config` (p. ej. Backblaze B2, Google Drive, otro VPS). Ver docs/DESPLIEGUE.md.
REMOTE="${RCLONE_REMOTE:-respaldo:vinilos}"
# copy (no sync) para las fotos: nunca borra en el destino. Las copias de BD sí se sincronizan (rotación incluida).
rclone copy  data/backups/uploads "$REMOTE/uploads" --transfers 4
rclone sync  data/backups/db      "$REMOTE/db"
echo "Copia fuera del servidor OK en $REMOTE"
