# Vinilos · Gestión

Sistema de inventario y gestión para un local de vinilos para motos, calcas y trabajos similares.
Diseño y decisiones: [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

| Fase | Estado |
|---|---|
| 1. Base, autenticación, roles y usuarios | ✅ Lista |
| 2. Materiales, rollos, retazos y cortes | ✅ Lista |
| 3. Clientes, catálogo, cotizaciones y pedidos | ✅ Lista |
| 4. Compras, alertas, reportes, respaldo y despliegue | ✅ Lista (falta publicarla: ver [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md)) |
| 5. Facturación electrónica DIAN | Pendiente (cuando lo confirme el contador) |

## Requisitos

- Node.js 22 o superior (probado con Node 24 en Windows 11).

## Instalación

```bash
npm install
cp server/.env.example server/.env      # en Windows: copy server\.env.example server\.env
npm run create-admin                     # crea el PRIMER administrador (pide correo, nombre y contraseña)
```

Los administradores **no** se pueden crear desde el registro público. El primero se crea con
`npm run create-admin`; los siguientes, y los **empleados**, los crea un admin desde **Usuarios** en la app.

## Primeros pasos con el inventario

1. **Materiales → Nuevo material**: marca, color, acabado, costo por m² y stock mínimo.
2. **+ Rollo** en cada material: ancho y largo (el que le queda, si ya está empezado). El sistema le da un código
   (`R-001`); escríbelo en el tubo.
3. **Cortes a pulso**: ajusta las tallas (los botones que ve el empleado) a los cortes típicos del local.
4. Los empleados registran cada corte desde el celular en **Cortar**. El admin mide los rollos marcados como
   «por medir» desde **Stock** (por largo o por peso).

## Desarrollo

```bash
npm run dev        # API en http://127.0.0.1:3000 + frontend en http://localhost:5173
npm test           # pruebas del servidor
npm run typecheck
```

Abre http://localhost:5173. Vite redirige `/api` al backend (mismo origen, sin CORS).

## Producción (un solo proceso)

```bash
npm run build      # compila frontend (web/dist) y servidor (server/dist)
npm start          # sirve API + frontend en el puerto PORT
```

- **En el PC del local (red interna, HTTP):** `NODE_ENV=production`, `COOKIE_SECURE=false`,
  `HOST=0.0.0.0` para entrar desde otros equipos o celulares de la red (`http://IP-del-PC:3000`).
- **En internet:** pon un proxy con HTTPS delante (p. ej. Caddy), y usa `COOKIE_SECURE=true` y `TRUST_PROXY=true`.

## Respaldo

```bash
npm run backup                                                        # se puede hacer con la app funcionando
npm run restore -- ./server/data/backups/db/negocio-AAAAMMDD-HHMMSS.db   # con la app DETENIDA
```

`backup` hace una copia consistente de la BD (`VACUUM INTO`), verifica su integridad, copia las fotos nuevas y
conserva las últimas 14 copias en `server/data/backups/` (`BACKUP_DIR`, `BACKUP_KEEP`). `restore` verifica el
respaldo, guarda la BD actual como `*.antes-de-restaurar-…`, aplica las migraciones pendientes y recupera las fotos.

En el servidor, el respaldo corre a diario y se sube **fuera del servidor** con rclone: ver [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

## Puesta en internet

Paso a paso (VPS, dominio, HTTPS con Caddy, servicio systemd, respaldo diario, actualizaciones):
[`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md). Los archivos de configuración están en `deploy/`.

## Variables de entorno

Ver [`server/.env.example`](server/.env.example). La app no arranca si alguna tiene un valor inválido.

## Seguridad (resumen)

- Contraseñas con **argon2id**: mínimo 10 caracteres y rechazo de contraseñas comunes.
- **Sesiones en la base de datos**, con una cookie `httpOnly` y `SameSite=Lax` (y `__Host-`/`Secure` cuando hay HTTPS).
  En la BD solo se guarda el hash del token. Las sesiones expiran por inactividad (12 h) y por duración máxima (7 días).
- **CSRF**: token por sesión en el header `X-CSRF-Token`, y solo se aceptan cuerpos JSON.
- **Fuerza bruta**: límite de peticiones por IP en `/api/auth/*` y bloqueo de la cuenta tras 5 intentos fallidos.
- **Autorización en el servidor**: cada ruta `/api` declara quién puede usarla, y si una no lo declara la app no arranca.
  Las pruebas recorren automáticamente todas las rutas de admin y verifican que un cliente reciba 403.
- Cambiar la contraseña, desactivar a un usuario o cambiar su rol **cierra sus sesiones**.
  Siempre debe quedar al menos un admin activo.
- Las acciones administrativas quedan en `audit_log`.
- **Empleados**: registran cortes y ven el stock en m², pero ninguna respuesta de `/api/staff/*` incluye costos;
  las pruebas lo verifican en todas esas rutas. Los conteos, ajustes y bajas son solo del admin.
- **Fotos de clientes**: se valida el tipo real por contenido y se re-codifican a JPG (sin EXIF ni ubicación GPS),
  con nombre aleatorio y fuera de la carpeta pública. Solo las ve el dueño de la solicitud y el personal.
- **Clientes**: solo ven sus propias solicitudes, cotizaciones, pedidos y fotos (lo demás responde 404), y nunca
  notas internas ni costos. El empleado tampoco ve precios ni pagos.
- **Inventario**: el libro de movimientos es inmutable (triggers en la BD) y el saldo de cada rollo siempre es
  la suma de sus movimientos; no se permite stock negativo.

## Estructura

```
server/   API Fastify + SQLite (Drizzle)
  src/auth/        contraseñas, sesiones, CSRF y control de acceso
  src/modules/     auth, users, materials, inventory (cortes, conteos, conciliación),
                   customers, catalog, orders (solicitudes con fotos, cotizaciones, pedidos, pagos),
                   purchases (proveedores, compras, costo promedio), reports
  src/lib/         photos (re-codificación sin EXIF/GPS), money (IVA y redondeo), settings, audit
  src/db/          esquema y migraciones
  scripts/         create-admin, backup, restore
  test/            pruebas (Vitest)
web/      React + Vite
docs/     arquitectura y decisiones (ARQUITECTURA.md), puesta en internet (DESPLIEGUE.md)
deploy/   Caddyfile, servicios systemd, respaldo diario y script de actualización
```
