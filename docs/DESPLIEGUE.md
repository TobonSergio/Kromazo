# Puesta en internet

Guía para publicar la app en un **VPS con Ubuntu 24.04** y un dominio propio, con HTTPS automático (Caddy),
la app como servicio (systemd) y **respaldo diario fuera del servidor** (rclone). Ver ARQUITECTURA §2.1.

Lo que hay que tener antes:

| Qué | Ejemplo | Costo aproximado |
|---|---|---|
| VPS Linux, 1 vCPU y 1–2 GB de RAM | Hetzner, DigitalOcean, Vultr, Contabo | 5–10 USD/mes |
| Dominio | `nombredellocal.com` o `.com.co` | 10–25 USD/año |
| Almacenamiento para respaldos, en **otro** proveedor | Backblaze B2, Google Drive, Cloudflare R2 | 0–1 USD/mes |
| El código en un repositorio Git (GitHub privado, por ejemplo) | | gratis |

Los comandos van en la terminal del VPS (por SSH). Donde dice `TU-DOMINIO.com`, usa el dominio real.

---

## 1. Dominio → VPS

En el panel del dominio, crea dos registros **A** apuntando a la IP pública del VPS: `@` y `www`.
Puede tardar de minutos a unas horas en propagarse. Compruébalo con `ping TU-DOMINIO.com`.

## 2. Preparar el servidor

```bash
# Actualizaciones y firewall: solo SSH, HTTP y HTTPS.
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ufw unattended-upgrades rclone
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable

# Node.js 22 LTS (o superior)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Caddy (HTTPS automático)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# Usuario sin privilegios que corre la app
sudo useradd --system --create-home --home-dir /home/vinilos --shell /bin/bash vinilos
sudo mkdir -p /opt/vinilos && sudo chown vinilos:vinilos /opt/vinilos
```

Recomendado: entrar por SSH con llave (no contraseña) y desactivar `PasswordAuthentication` en `/etc/ssh/sshd_config`.

## 3. Instalar la app

```bash
sudo -iu vinilos
git clone <URL-DEL-REPOSITORIO> /opt/vinilos
cd /opt/vinilos
npm ci
npm run build
npm test                      # debe terminar sin fallos

cp server/.env.example server/.env
nano server/.env
```

En `server/.env` cambia **solo** esto (lo demás puede quedar como está):

```ini
NODE_ENV=production
HOST=127.0.0.1          # solo Caddy habla con la app
PORT=3000
COOKIE_SECURE=true      # hay HTTPS
TRUST_PROXY=true        # Caddy está delante
```

Crea el primer administrador (pide correo, nombre y contraseña) y sal del usuario `vinilos`:

```bash
npm run create-admin
exit
```

## 4. Servicios

```bash
sudo cp /opt/vinilos/deploy/vinilos.service /opt/vinilos/deploy/vinilos-backup.service /opt/vinilos/deploy/vinilos-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vinilos
curl http://127.0.0.1:3000/api/health          # → {"ok":true}

sudo cp /opt/vinilos/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/TU-DOMINIO.com/nombredellocal.com/g' /etc/caddy/Caddyfile   # tu dominio
sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy
sudo systemctl reload caddy
```

Abre `https://TU-DOMINIO.com`: debe verse el catálogo con el candado de HTTPS. Si falla, revisa
`sudo journalctl -u caddy -n 50` (casi siempre es el DNS que aún no apunta al VPS).

## 5. Respaldo diario fuera del servidor

El respaldo (`npm run backup`) copia la BD de forma consistente con la app funcionando, verifica su integridad,
copia las fotos y conserva 14 copias. Pero queda **en el mismo VPS**: hay que subirlo a otro lugar.

1. Configura el destino con rclone **como el usuario `vinilos`**, y llámalo `respaldo`:

   ```bash
   sudo -iu vinilos rclone config      # n (nuevo) → nombre: respaldo → elige el proveedor y sigue el asistente
   ```

   Backblaze B2 es una opción económica y sencilla: crea un *bucket* privado `vinilos` y una *application key*
   con acceso solo a ese bucket.

2. Prueba el respaldo completo y activa el timer diario (3:00 a. m., hora de Colombia):

   ```bash
   sudo systemctl start vinilos-backup && sudo journalctl -u vinilos-backup -n 20
   sudo systemctl enable --now vinilos-backup.timer
   systemctl list-timers vinilos-backup.timer
   ```

Si el destino de rclone no se llama `respaldo:vinilos`, agrega `Environment=RCLONE_REMOTE=otro:carpeta`
en `vinilos-backup.service`.

### Restaurar

```bash
sudo systemctl stop vinilos
sudo -iu vinilos
cd /opt/vinilos/server
# Si el servidor se perdió: primero baja la copia con rclone (rclone copy respaldo:vinilos ./data/backups)
npm run restore -- ./data/backups/db/negocio-AAAAMMDD-HHMMSS.db
exit
sudo systemctl start vinilos
```

`restore` verifica la integridad del archivo, guarda la BD actual como `*.antes-de-restaurar-…`, aplica las
migraciones pendientes y recupera las fotos que falten. **Practícalo una vez** en tu PC con una copia real:
un respaldo que nunca se ha restaurado no está probado.

## 6. Actualizar a una nueva versión

```bash
sudo -iu vinilos /opt/vinilos/deploy/actualizar.sh
```

Hace un respaldo, baja el código, instala, compila, corre las pruebas y reinicia la app. Si una prueba falla,
se detiene antes de reiniciar y la versión anterior sigue funcionando. Para que `vinilos` pueda reiniciar el
servicio sin contraseña, agrega con `sudo visudo -f /etc/sudoers.d/vinilos`:

```
vinilos ALL=(root) NOPASSWD: /usr/bin/systemctl restart vinilos
```

Las migraciones de la BD se aplican solas al arrancar.

## 7. Revisión rápida después de publicar

- [ ] `https://TU-DOMINIO.com` abre con candado; `http://` redirige a `https://`.
- [ ] Iniciar sesión funciona; en las herramientas del navegador, la cookie se llama `__Host-sid` y es `Secure`.
- [ ] `curl -I http://IP-DEL-VPS:3000` **no** responde desde fuera (la app solo escucha en 127.0.0.1).
- [ ] Un cliente nuevo puede registrarse, pedir cotización desde el celular y subir fotos.
- [ ] El respaldo aparece en el destino de rclone al día siguiente.
- [ ] Monitoreo (opcional, gratis): un servicio como UptimeRobot que consulte `https://TU-DOMINIO.com/api/health` cada 5 minutos y avise si cae.

## Problemas comunes

| Síntoma | Causa probable |
|---|---|
| «Token CSRF inválido» o la sesión se cierra sola | `COOKIE_SECURE=true` sin HTTPS, o falta `TRUST_PROXY=true`. |
| Todos los usuarios quedan bloqueados por «demasiadas solicitudes» | Falta `TRUST_PROXY=true`: la app ve a todos con la IP de Caddy. |
| Error 413 al subir fotos | `request_body max_size` en el Caddyfile. |
| La app no arranca | `sudo journalctl -u vinilos -n 50`: casi siempre es una variable inválida en `.env` (la app dice cuál). |
