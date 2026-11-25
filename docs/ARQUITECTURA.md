# Arquitectura y modelo de datos: inventario de vinilos

> Estado: **Fases 1 a 4 implementadas** (2026-11-24); falta publicar en internet (docs/DESPLIEGUE.md). Fase 5 pendiente.
> Lo que cambió al implementar cada fase respecto a este diseño está en §10.
>
> **Decidido para la Fase 2 (2026-11-24):** muchos cortes se hacen a pulso, sin medir. Por eso el sistema
> admite **dos formas de registrar un corte**: *medido* (el operario mide el largo) y *a pulso* (el
> operario elige un tamaño aproximado con un toque). El conteo físico concilia las estimaciones de los
> cortes a pulso. Ver §1.1.
>
> **Decisiones del dueño (2026-11-24):**
> - Habrá un rol **EMPLEADO** que registra cortes, sin ver costos ni administrar el negocio (§1.2).
> - Los clientes pueden **pedir cotizaciones desde la web con fotos de la moto**, ver las cotizaciones
>   que les hace el local y consultar el catálogo (§1.3).
> - El sistema corre **en internet**, como aplicación web (§2.1).
> - La **facturación electrónica DIAN** se integra después, como Fase 5, pero el modelo de datos queda
>   preparado desde ahora (§1.4).

---

## 1. La idea central: cómo medir un material que se gasta "a ojo"

El vinilo no se puede contar por unidades, y medir lo que queda en cada rollo cada vez sería poco práctico. La propuesta es **no medir el stock: medir los cortes**. Cada vez que se usa material se registra un **corte**, y el stock se calcula a partir de esos cortes.

```
 Rollo #R-014 (Negro mate 3M, 1520 mm de ancho)
 ┌──────────────────────────────────────────────┐
 │ CORTE: se sacan 800 mm de largo (ancho total) │  → salen 1520 × 800 = 1.216.000 mm² del rollo
 └──────────────────────────────────────────────┘
        │
        ├─ usado en el trabajo #T-0231 ......  700.000 mm²
        ├─ retazo guardado #RZ-088 (600×500) .. 300.000 mm²  → nueva unidad de inventario
        └─ desperdicio (se calcula solo) ...... 216.000 mm²
```

Reglas:

1. **Un corte saca área de una unidad** (rollo o retazo). En los rollos se registra el **largo cortado**, que es lo único que el operario mide con facilidad; el área sale de `ancho × largo`.
2. **Lo que sale se reparte** entre el área usada en el trabajo, los retazos que se guardan y el desperdicio. El desperdicio no se digita, se calcula: `desperdicio = cortado − usado − retazos`. Así no se puede "perder" material sin que quede registrado.
3. **Un retazo es una unidad de inventario** con su código, sus medidas (el rectángulo útil más grande) y su origen. Se puede volver a cortar igual que un rollo, o descartar.
4. **El stock nunca se sobrescribe.** Toda entrada o salida es un movimiento que no se borra. El saldo de cada unidad es la suma de sus movimientos. Para corregir un error se registra un movimiento compensatorio.
5. **Conteo físico periódico.** Cada cierto tiempo se mide el rollo (largo restante o, si se configura, **peso**: `área = (peso − peso del tubo) / gramaje`). El sistema registra la diferencia como ajuste de tipo *conteo*. Esa diferencia acumulada indica cuánto material se va sin registrar, que es el dato que hoy no tiene el negocio.

### 1.1 Dos formas de registrar un corte: medido y a pulso

No todos los cortes se pueden medir. Muchos se hacen **a pulso**: el operario corta a mano lo que necesita, con prisa y sin cinta métrica. Si se le obligara a medirlos, esos cortes no se registrarían. Por eso cada corte tiene un **método**:

| | **Corte medido** (`MEASURED`) | **Corte a pulso** (`FREEHAND`) |
|---|---|---|
| Cuándo | Se corta un tramo del rollo que se puede medir (p. ej. un wrap o un tanque completo). | Se corta a mano y "a ojo" (calcas, filetes, detalles, recortes). |
| Qué digita el operario | Largo cortado (y ancho si no es el ancho completo), área usada y retazos. | Solo un **tamaño aproximado**: un botón de talla (*Pequeño*, *Mediano*, *Grande*…) o, si lo sabe, un largo o un área aproximada. El retazo es opcional. |
| Área que sale del rollo | Exacta: `largo × ancho`. | **Estimada**: el área de la talla elegida o la que se digitó. |
| Desperdicio | Se calcula: `cortado − usado − retazos`. | No se separa: todo lo estimado cuenta como consumo del trabajo (menos los retazos guardados). |
| Precisión | Alta. | Baja en cada corte, pero **se corrige en el siguiente conteo físico** (ver abajo). |

```
 Rollo #R-014  (saldo en el sistema: 10,00 m²)
   ├─ corte MEDIDO   1,52 × 0,80 m ............. −1,22 m²  (exacto)
   ├─ corte A PULSO  talla "Mediano" ≈ 0,25 m² .. −0,25 m²  (estimado)
   ├─ corte A PULSO  talla "Pequeño" ≈ 0,05 m² .. −0,05 m²  (estimado)
   └─ CONTEO FÍSICO por peso → quedan 8,30 m²; el sistema esperaba 8,48 m² → diferencia −0,18 m²
        ├─ se atribuye a los 2 cortes a pulso (dentro de la tolerancia) ... −0,15 m²  → FREEHAND_ADJUST
        └─ faltante no explicado (lo que excede la tolerancia) ............ −0,03 m²  → COUNT_ADJUST
```

(En el ejemplo, la tolerancia es 50 % de 0,30 m² estimados = 0,15 m².)

**Tallas de corte a pulso.** Son una tabla que configura el admin (`freehand_sizes`): nombre, área de referencia y, opcionalmente, el tipo de material al que aplican. Ejemplos iniciales: *Pequeño* (≈ 10 × 50 cm, 0,05 m²), *Mediano* (≈ 50 × 50 cm, 0,25 m²), *Grande* (≈ 1 m²). Así el registro toma un toque, y el dueño ajusta las áreas a la realidad del local.

**Conciliación en el conteo físico.** Al contar una unidad, la diferencia entre lo medido y el saldo del sistema se reparte así:

1. Se toman los cortes a pulso de esa unidad **pendientes de conciliar** (los registrados desde el conteo anterior).
2. La diferencia se atribuye a esos cortes, **en proporción a su área estimada**, hasta un **límite de tolerancia** (configurable; por defecto ±50 % del total estimado pendiente). Esa parte se registra como movimiento `FREEHAND_ADJUST`, y cada corte guarda su área conciliada.
3. Lo que excede la tolerancia, o toda la diferencia si no hay cortes a pulso pendientes, es un `COUNT_ADJUST`: **faltante (o sobrante) no explicado**, igual que antes.
4. Los cortes quedan marcados como conciliados con ese conteo y no se vuelven a ajustar.

Así se mantienen las dos cosas: el registro a pulso es rápido, y el dato de "material que se va sin registrar" sigue siendo honesto, porque solo se perdona la imprecisión razonable de las estimaciones. Además, con los cortes ya conciliados, el sistema puede mostrar **qué tan buenas son las tallas** (p. ej. "los cortes *Mediano* gastan en promedio 30 % más de lo estimado") para que el dueño las recalibre.

> En la práctica: **entre más cortes a pulso tenga un rollo, más seguido conviene contarlo** (con balanza toma un minuto). El sistema avisa cuando una unidad acumula demasiados cortes a pulso sin conciliar (umbral configurable).

### 1.2 Roles: administrador, empleado y cliente

| Puede… | ADMIN | EMPLOYEE | CLIENT |
|---|:-:|:-:|:-:|
| Registrar cortes (medidos y a pulso) y retazos | ✅ | ✅ | — |
| Ver stock de rollos y retazos (en m², **sin costos**) | ✅ | ✅ | — |
| Ver pedidos y pasarlos a *En proceso* / *Terminado* | ✅ | ✅ | — |
| Ver las solicitudes de cotización y sus fotos | ✅ | ✅ | solo las suyas |
| Crear cotizaciones y fijar precios | ✅ | — | — |
| Conteos físicos, ajustes y bajas | ✅ | — | — |
| Materiales, tallas, catálogo, compras, proveedores | ✅ | — | — |
| Costos, márgenes, reportes, usuarios, auditoría | ✅ | — | — |
| Pedir cotizaciones, aceptarlas, ver sus pedidos | — | — | ✅ |

Por qué los **conteos físicos quedan solo para el admin**: el conteo es el control que revela el material que se va sin registrar. Si lo hiciera la misma persona que registra los cortes, podría ocultar un faltante. Si el dueño prefiere delegarlo, se puede habilitar, y el reporte de faltantes mostrará quién hizo cada conteo.

Los empleados **no se registran solos**: los crea el admin desde **Usuarios**, igual que a los otros admins. Cada corte guarda el `user_id` de quien lo registró, así que las métricas de desperdicio y de cortes a pulso se pueden ver por empleado.

En el código, el nivel de acceso de cada ruta pasa de un rol exacto a estos niveles: `public`, `authenticated`, `CLIENT`, `STAFF` (ADMIN o EMPLOYEE) y `ADMIN`. Las respuestas a un empleado usan DTOs sin costos ni márgenes, igual que las del cliente.

### 1.3 Cotizaciones desde la web, con fotos

```
 CLIENTE (web)                         LOCAL (admin)                       CLIENTE
 ┌──────────────────────────┐   ┌───────────────────────────────┐   ┌────────────────────┐
 │ Solicitud de cotización  │ → │ Revisa fotos y descripción    │ → │ Ve la cotización   │
 │ moto + qué quiere + fotos│   │ crea la cotización (precios)  │   │ y la acepta o no   │
 └──────────────────────────┘   │ o descarta la solicitud       │   └────────────────────┘
   quote_requests: NUEVA        └───────────────────────────────┘     orders: COTIZADO → APROBADO
                                  quote_requests: COTIZADA / DESCARTADA
```

- **La solicitud no es un pedido.** Se guarda aparte (`quote_requests`) porque no tiene precios, puede ser spam o quedar descartada. Cuando el admin la cotiza, se crea la `order` en estado `COTIZADO`, vinculada a la solicitud.
- **Fotos:** hasta 5 por solicitud, de máximo 10 MB cada una, en JPG, PNG, WebP o HEIC (lo que sube un celular). El servidor:
  - verifica el tipo real del archivo por su contenido, no por la extensión;
  - **re-codifica cada foto** (con `sharp`) a JPG de máximo 2000 px. Eso elimina los metadatos EXIF, incluida la **ubicación GPS** que muchos celulares guardan en la foto, y neutraliza archivos manipulados. Además ahorra espacio;
  - guarda las fotos **fuera de la carpeta pública**, con un nombre aleatorio, y solo las entrega por una ruta que verifica permisos (el dueño de la solicitud o el personal del local).
- **Límites contra abuso:** máximo 3 solicitudes abiertas por cliente y un límite de envíos por día. Para pedir una cotización hay que tener cuenta, lo que también permite contactar al cliente.
- **Catálogo público:** los productos y servicios marcados como públicos (`is_public`) se ven **sin iniciar sesión**, con su precio de referencia, como vitrina del local. El cliente con cuenta ve además sus solicitudes, cotizaciones y pedidos.

### 1.4 Facturación electrónica DIAN: después, pero preparada desde ahora

**Respuesta corta: se puede integrar después y no hay que construirla ahora.** Lo que sí conviene hacer desde ahora, porque es barato, es guardar los datos que una factura va a necesitar. Así, agregarla después no obliga a corregir información vieja.

Por qué no ahora:

- **No se recomienda conectarse directo a la DIAN.** Hacerlo exige firmar documentos XML (formato UBL 2.1), un certificado digital y un proceso de habilitación con pruebas. Lo normal para un negocio pequeño es usar un **proveedor tecnológico autorizado** (Alegra, Siigo, Facture, etc.) que ya resuelve todo eso y ofrece una API. Integrar esa API es un trabajo acotado: enviar los datos de la venta y guardar el número de factura y el CUFE que devuelve.
- **Mientras tanto, si el negocio ya está obligado a facturar**, puede seguir haciéndolo con el portal web del proveedor (o con la solución gratuita de la DIAN) y registrar en este sistema el número de factura de cada pedido.
- **Primero hay que confirmar con el contador** si el negocio está obligado a facturar electrónicamente (depende de si es responsable de IVA, de sus ingresos y de su régimen) y qué proveedor le conviene. Eso define la Fase 5.

Lo que se prepara desde ahora en el modelo:

- **Clientes:** tipo y número de documento (CC, NIT, CE, pasaporte), dígito de verificación para NIT y correo para enviar la factura.
- **Ítems de pedido:** precio sin impuesto, **tarifa de IVA** (0 % o 19 %) y valor del IVA, calculados al cotizar. Si el negocio no es responsable de IVA, la tarifa es 0 % y nada cambia para el usuario.
- **Pedidos:** subtotal, IVA y total por separado, y un campo para el número de factura (lo llena a mano el admin hasta la Fase 5, y luego la integración).

Unidades internas: **milímetros y mm², siempre enteros**, para no tener errores de redondeo. Un rollo de 1,52 m × 50 m son 76.000.000 mm², que cabe de sobra en un entero. La interfaz muestra metros, cm y m².
Dinero: **pesos enteros** (supuesto: COP, sin centavos).

---

## 2. Stack propuesto

| Componente | Elección | Por qué |
|---|---|---|
| Lenguaje | **TypeScript** (backend y frontend) | Un solo lenguaje, y los tipos evitan errores en cálculos de área y dinero. |
| Backend | **Node.js 24 + Fastify** | Ligero y rápido, con validación de esquemas integrada (JSON Schema / Zod). |
| Base de datos | **SQLite (modo WAL) + Drizzle ORM** con migraciones | Un archivo, sin servidor que administrar y con respaldo copiando un archivo. Alcanza para un local con pocos usuarios a la vez. Drizzle permite migrar a PostgreSQL después sin reescribir la lógica. |
| Frontend | **React + Vite** | Formularios con cálculos en vivo (área, desperdicio); un build estático que sirve el mismo backend. |
| Autenticación | **Sesiones en BD + cookie httpOnly** y **argon2id** | Ver §5. |
| Pruebas | **Vitest** (unitarias) + `fastify.inject` (integración y autorización) | Rápido, sin levantar un servidor real. |

Despliegue: **un solo proceso** Node que sirve la API (`/api/*`) y el frontend compilado. Con un mismo origen no se necesita CORS.

### 2.1 Dónde corre: en internet, como aplicación web

El sistema ya es una aplicación web (se usa desde el navegador del PC o del celular; no hay nada que instalar). La decisión es **dónde se aloja**, y se aloja **en internet**, porque los clientes tienen que entrar desde su celular para pedir cotizaciones y subir fotos.

| Pieza | Elección | Notas |
|---|---|---|
| Servidor | **VPS pequeño** (1 vCPU, 1–2 GB de RAM, Linux) | Del orden de 5 a 10 USD al mes. SQLite y un solo proceso Node caben de sobra. |
| Dominio | Un dominio propio (p. ej. `.com` o `.com.co`) | Del orden de 10 a 25 USD al año. |
| HTTPS | **Caddy** como proxy delante de Node | Obtiene y renueva el certificado solo. Con él: `COOKIE_SECURE=true`, `TRUST_PROXY=true`. |
| Proceso | Servicio de `systemd` que reinicia la app si se cae | |
| Respaldo | Copia diaria de la BD **y de las fotos** a otro lugar (otro proveedor o almacenamiento en la nube), con varios días de historial | En un VPS, un respaldo que vive en el mismo servidor no sirve si se pierde el servidor. |

Consecuencias:

- **Diseño "celular primero"** para el empleado y el cliente: el formulario de corte a pulso y la subida de fotos se usan sobre todo desde el teléfono.
- **Si se cae el internet del local**, no se pueden registrar cortes en ese momento. Es raro y corto; se anotan en papel y se registran después. (Un modo sin conexión es posible, pero complica bastante y no se justifica al inicio).
- La seguridad de §5 ya estaba pensada para estar expuesta a internet (argon2id, bloqueo de cuentas, rate limit, CSRF, autorización en el servidor).

---

## 3. Entidades principales

```
users ─┬─< sessions                  (role: ADMIN | EMPLOYEE | CLIENT)
       └── customers (opcional: un cliente puede no tener cuenta)
                │
                ├─< quote_requests ─< attachments (fotos)
                │        │ (al cotizarla)
                │        ▼
                └─< orders (cotización → pedido) ─< order_items >── catalog_items
                         │
                         └─< cuts ─< cut_remnants
                               │   (method: MEASURED | FREEHAND) >── freehand_sizes
                               │
materials ─< inventory_units ─<┘   (cada corte sale de una unidad)
                 │
                 └─< inventory_movements   (libro inmutable: única fuente de verdad del stock)

suppliers ─< purchases ─< purchase_lines ──> crean inventory_units (entrada)
audit_log  (acciones administrativas)
```

---

## 4. Esquema de base de datos (SQLite)

```sql
-- ============ USUARIOS Y SEGURIDAD ============
CREATE TABLE users (
  id              INTEGER PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,                       -- argon2id
  role            TEXT NOT NULL CHECK (role IN ('ADMIN','EMPLOYEE','CLIENT')),
  full_name       TEXT NOT NULL,
  phone           TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  failed_logins   INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,                                -- bloqueo temporal tras intentos fallidos
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id_hash         TEXT PRIMARY KEY,                    -- SHA-256 del token; el token real solo va en la cookie
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  ip              TEXT,
  user_agent      TEXT
);

CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY,
  actor_user_id   INTEGER REFERENCES users(id),
  action          TEXT NOT NULL,                       -- 'user.create', 'inventory.adjust', ...
  entity          TEXT NOT NULL,
  entity_id       INTEGER,
  details_json    TEXT,
  ip              TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ CLIENTES ============
-- Separado de users: el cliente que llega al local no necesita cuenta.
-- Si luego se registra con el mismo correo o teléfono, el admin vincula user_id.
CREATE TABLE customers (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER UNIQUE REFERENCES users(id),
  full_name       TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  -- Datos para facturar (opcionales hasta la Fase 5, ver §1.4)
  document_type   TEXT CHECK (document_type IN ('CC','NIT','CE','PASAPORTE','OTRO')),
  document_number TEXT,
  nit_check_digit INTEGER,                             -- dígito de verificación, solo NIT
  billing_email   TEXT,                                -- correo para enviar la factura (si difiere de email)
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ MATERIALES E INVENTARIO ============
CREATE TABLE materials (                               -- "referencia": qué es, no cuánto hay
  id                  INTEGER PRIMARY KEY,
  sku                 TEXT NOT NULL UNIQUE,
  brand               TEXT NOT NULL,                   -- 3M, Avery, Oracal, genérico...
  line                TEXT,                            -- 2080, 751...
  color               TEXT NOT NULL,
  finish              TEXT NOT NULL CHECK (finish IN
                        ('MATE','BRILLANTE','SATINADO','METALIZADO','CROMADO',
                         'CARBONO','TORNASOL','REFLECTIVO','TRANSPARENTE','OTRO')),
  type                TEXT NOT NULL CHECK (type IN
                        ('VINILO_CORTE','VINILO_IMPRESION','WRAP','LAMINADO','CALCA','OTRO')),
  grams_per_m2        INTEGER,                         -- opcional: habilita el conteo por peso
  cost_per_m2         INTEGER,                         -- costo promedio (pesos), se actualiza con compras
  min_stock_mm2       INTEGER NOT NULL DEFAULT 0,      -- umbral de alerta
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE inventory_units (                         -- rollo o retazo físico, con etiqueta
  id                  INTEGER PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,            -- R-014 / RZ-088 (para escribir en el tubo o etiqueta)
  material_id         INTEGER NOT NULL REFERENCES materials(id),
  kind                TEXT NOT NULL CHECK (kind IN ('ROLL','REMNANT')),
  width_mm            INTEGER NOT NULL CHECK (width_mm > 0),
  initial_length_mm   INTEGER NOT NULL CHECK (initial_length_mm > 0),
  core_weight_g       INTEGER,                         -- peso del tubo (solo rollos, para el conteo por peso)
  parent_unit_id      INTEGER REFERENCES inventory_units(id),   -- de qué rollo salió el retazo
  source_cut_id       INTEGER REFERENCES cuts(id),
  purchase_line_id    INTEGER REFERENCES purchase_lines(id),
  location            TEXT,
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DEPLETED','DISCARDED')),
  balance_mm2         INTEGER NOT NULL,                -- caché de SUM(movements); se actualiza en la misma transacción
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (balance_mm2 >= 0)                             -- supuesto conservador: no se permite stock negativo
);

CREATE TABLE inventory_movements (                     -- libro inmutable: solo INSERT
  id                  INTEGER PRIMARY KEY,
  unit_id             INTEGER NOT NULL REFERENCES inventory_units(id),
  type                TEXT NOT NULL CHECK (type IN (
                        'PURCHASE_IN',      -- entrada por compra (+)
                        'REMNANT_IN',       -- alta de un retazo generado por un corte (+)
                        'CUT_OUT',          -- salida por corte (−); su desglose está en cuts
                        'FREEHAND_ADJUST',  -- parte de un conteo atribuida a cortes a pulso (±)
                        'COUNT_ADJUST',     -- diferencia no explicada contra un conteo físico (±)
                        'MANUAL_ADJUST',    -- corrección con motivo (±)
                        'DISCARD')),        -- retazo o rollo dado de baja (−)
  area_mm2            INTEGER NOT NULL CHECK (area_mm2 <> 0),   -- con signo
  cut_id              INTEGER REFERENCES cuts(id),
  count_id            INTEGER REFERENCES physical_counts(id),  -- en FREEHAND_ADJUST y COUNT_ADJUST
  reason              TEXT,                            -- obligatorio en ajustes y bajas (lo valida la API)
  user_id             INTEGER NOT NULL REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER movements_no_update BEFORE UPDATE ON inventory_movements
  BEGIN SELECT RAISE(ABORT, 'inventory_movements es inmutable'); END;
CREATE TRIGGER movements_no_delete BEFORE DELETE ON inventory_movements
  BEGIN SELECT RAISE(ABORT, 'inventory_movements es inmutable'); END;

CREATE TABLE freehand_sizes (                          -- tallas para cortes a pulso (las configura el admin)
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,                   -- 'Pequeño', 'Mediano', 'Grande', 'Tanque'...
  ref_area_mm2        INTEGER NOT NULL CHECK (ref_area_mm2 > 0),
  material_type       TEXT,                            -- NULL = aplica a todos los tipos de material
  sort_order          INTEGER NOT NULL DEFAULT 0,
  is_active           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE cuts (                                    -- el evento central
  id                  INTEGER PRIMARY KEY,
  unit_id             INTEGER NOT NULL REFERENCES inventory_units(id),
  order_id            INTEGER REFERENCES orders(id),   -- NULL = corte para muestra o uso interno
  method              TEXT NOT NULL CHECK (method IN ('MEASURED','FREEHAND')),
  -- MEASURED: largo y ancho obligatorios. FREEHAND: opcionales (solo si el operario los aproximó).
  cut_length_mm       INTEGER CHECK (cut_length_mm > 0),
  cut_width_mm        INTEGER CHECK (cut_width_mm > 0),  -- rollo: el ancho completo; retazo: lo que se corte
  freehand_size_id    INTEGER REFERENCES freehand_sizes(id),  -- talla elegida (solo FREEHAND)
  cut_area_mm2        INTEGER NOT NULL CHECK (cut_area_mm2 > 0),  -- MEASURED: exacta. FREEHAND: estimada
  used_area_mm2       INTEGER NOT NULL CHECK (used_area_mm2 >= 0),
  remnant_area_mm2    INTEGER NOT NULL DEFAULT 0,      -- suma de los retazos guardados
  waste_area_mm2      INTEGER NOT NULL,                -- calculado (FREEHAND: siempre 0, no se separa)
  -- Conciliación (solo FREEHAND): se llenan una sola vez, en el conteo físico que lo concilia
  reconciled_count_id INTEGER REFERENCES physical_counts(id),
  reconciled_area_mm2 INTEGER,                         -- área real atribuida = estimada + su parte del ajuste
  notes               TEXT,
  user_id             INTEGER NOT NULL REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (method = 'FREEHAND' OR (cut_length_mm IS NOT NULL AND cut_width_mm IS NOT NULL
                                  AND cut_area_mm2 = cut_length_mm * cut_width_mm)),
  CHECK (method = 'MEASURED' OR waste_area_mm2 = 0),
  CHECK (method = 'FREEHAND' OR (freehand_size_id IS NULL AND reconciled_count_id IS NULL)),
  CHECK (waste_area_mm2 >= 0),
  CHECK (used_area_mm2 + remnant_area_mm2 + waste_area_mm2 = cut_area_mm2)   -- conservación del área
);

CREATE TABLE physical_counts (                         -- registro de cada medición física
  id                  INTEGER PRIMARY KEY,
  unit_id             INTEGER NOT NULL REFERENCES inventory_units(id),
  method              TEXT NOT NULL CHECK (method IN ('LENGTH','WEIGHT')),
  measured_length_mm  INTEGER,
  measured_weight_g   INTEGER,
  computed_area_mm2   INTEGER NOT NULL,
  system_area_mm2     INTEGER NOT NULL,                -- saldo del sistema en ese momento
  freehand_adjust_mm2 INTEGER NOT NULL DEFAULT 0,      -- parte de la diferencia atribuida a cortes a pulso
  unexplained_mm2     INTEGER NOT NULL DEFAULT 0,      -- resto: faltante (−) o sobrante (+) no explicado
  CHECK (freehand_adjust_mm2 + unexplained_mm2 = computed_area_mm2 - system_area_mm2),
  -- los movimientos generados apuntan a este conteo con inventory_movements.count_id
  user_id             INTEGER NOT NULL REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ CATÁLOGO, COTIZACIONES Y PEDIDOS ============
CREATE TABLE catalog_items (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('PRODUCTO','SERVICIO')),
  pricing_unit    TEXT NOT NULL CHECK (pricing_unit IN ('UNIDAD','METRO_LINEAL','M2','GLOBAL')),
  unit_price      INTEGER NOT NULL CHECK (unit_price >= 0),   -- pesos
  material_id     INTEGER REFERENCES materials(id),          -- p. ej. "vinilo por metro" de un material
  is_public       INTEGER NOT NULL DEFAULT 1,                -- visible para clientes
  is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE quote_requests (                          -- lo que pide el cliente desde la web (§1.3)
  id              INTEGER PRIMARY KEY,
  customer_id     INTEGER NOT NULL REFERENCES customers(id),
  status          TEXT NOT NULL DEFAULT 'NUEVA' CHECK (status IN ('NUEVA','COTIZADA','DESCARTADA')),
  vehicle_desc    TEXT NOT NULL,                       -- "Pulsar NS200 negra 2022"
  description     TEXT NOT NULL,                       -- qué quiere el cliente
  discard_reason  TEXT,                                -- visible para el cliente si se descarta
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE attachments (                             -- fotos (re-codificadas, sin EXIF)
  id              INTEGER PRIMARY KEY,
  quote_request_id INTEGER REFERENCES quote_requests(id),
  order_id        INTEGER REFERENCES orders(id),       -- fotos que agrega el local (antes/después del trabajo)
  storage_key     TEXT NOT NULL UNIQUE,                -- nombre aleatorio en disco; nunca el nombre original
  mime_type       TEXT NOT NULL CHECK (mime_type = 'image/jpeg'),
  size_bytes      INTEGER NOT NULL,
  width_px        INTEGER NOT NULL,
  height_px       INTEGER NOT NULL,
  uploaded_by     INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (quote_request_id IS NOT NULL OR order_id IS NOT NULL)
);

CREATE TABLE orders (                                  -- cotización y pedido son el mismo registro en distintos estados
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,                -- T-0231
  customer_id     INTEGER NOT NULL REFERENCES customers(id),
  quote_request_id INTEGER UNIQUE REFERENCES quote_requests(id),  -- si nació de una solicitud web
  status          TEXT NOT NULL CHECK (status IN
                    ('COTIZADO','APROBADO','EN_PROCESO','TERMINADO','ENTREGADO','CANCELADO')),
  vehicle_desc    TEXT,                                -- "Pulsar NS200 negra 2022"
  description     TEXT,
  subtotal        INTEGER NOT NULL DEFAULT 0,          -- sin IVA, después del descuento por ítem
  discount        INTEGER NOT NULL DEFAULT 0,
  tax_total       INTEGER NOT NULL DEFAULT 0,          -- suma del IVA de los ítems
  total           INTEGER NOT NULL DEFAULT 0,          -- subtotal − discount + tax_total
  invoice_number  TEXT,                                -- factura (manual hasta la Fase 5)
  invoice_cufe    TEXT,                                -- código único que devuelve la DIAN (Fase 5)
  quote_valid_until TEXT,
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_items (
  id              INTEGER PRIMARY KEY,
  order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  catalog_item_id INTEGER REFERENCES catalog_items(id),
  description     TEXT NOT NULL,                       -- copia del nombre al cotizar
  quantity_milli  INTEGER NOT NULL CHECK (quantity_milli > 0),  -- 1500 = 1,5 (m, m², unidades)
  unit_price      INTEGER NOT NULL,                    -- precio sin IVA, fijado al cotizar
  tax_rate_bp     INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp IN (0, 500, 1900)),  -- IVA en centésimas de %: 1900 = 19 %
  tax_amount      INTEGER NOT NULL DEFAULT 0,          -- IVA de la línea, en pesos
  line_total      INTEGER NOT NULL                     -- sin IVA
);

CREATE TABLE order_status_history (
  id              INTEGER PRIMARY KEY,
  order_id        INTEGER NOT NULL REFERENCES orders(id),
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE payments (
  id              INTEGER PRIMARY KEY,
  order_id        INTEGER NOT NULL REFERENCES orders(id),
  amount          INTEGER NOT NULL CHECK (amount > 0),
  method          TEXT NOT NULL CHECK (method IN ('EFECTIVO','TRANSFERENCIA','TARJETA','OTRO')),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ COMPRAS ============
CREATE TABLE suppliers (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  notes           TEXT
);

CREATE TABLE purchases (
  id              INTEGER PRIMARY KEY,
  supplier_id     INTEGER NOT NULL REFERENCES suppliers(id),
  invoice_ref     TEXT,
  purchased_at    TEXT NOT NULL,
  total           INTEGER NOT NULL,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE purchase_lines (
  id              INTEGER PRIMARY KEY,
  purchase_id     INTEGER NOT NULL REFERENCES purchases(id),
  material_id     INTEGER NOT NULL REFERENCES materials(id),
  rolls           INTEGER NOT NULL CHECK (rolls > 0),
  width_mm        INTEGER NOT NULL,
  length_mm       INTEGER NOT NULL,                    -- largo de cada rollo
  unit_cost       INTEGER NOT NULL                     -- costo por rollo
);
-- Al confirmar una compra se crean N inventory_units (ROLL) y sus PURCHASE_IN en una sola transacción.
```

Índices: `cuts(unit_id, method, reconciled_count_id)` (cortes a pulso pendientes de conciliar), `inventory_movements(unit_id)`, `inventory_movements(created_at)`, `inventory_units(material_id, status)`, `cuts(order_id)`, `orders(customer_id, status)`, `quote_requests(status, created_at)`, `quote_requests(customer_id)`, `attachments(quote_request_id)`, `sessions(user_id)`, `audit_log(created_at)`.

### Operaciones críticas (cada una en una sola transacción)

| Operación | Qué escribe |
|---|---|
| **Registrar corte medido** | `cuts` (MEASURED) + `CUT_OUT` (−área cortada) en la unidad de origen; por cada retazo: nueva `inventory_unit` (REMNANT) + `REMNANT_IN`; actualiza `balance_mm2`; si el saldo llega a 0, la unidad pasa a `DEPLETED`. |
| **Registrar corte a pulso** | Igual, pero `cuts` (FREEHAND) con el área estimada (de la talla o la digitada) y `waste = 0`. Queda pendiente de conciliar. Una unidad **no** pasa a `DEPLETED` solo por estimaciones: si el saldo llega a 0 con cortes a pulso pendientes, se pide un conteo. |
| **Conteo físico** | `physical_counts`; reparte la diferencia (§1.1): `FREEHAND_ADJUST` por la parte atribuida a los cortes a pulso pendientes (y llena sus campos `reconciled_*`) y `COUNT_ADJUST` por el resto. Ambos movimientos llevan `count_id`. |
| **Confirmar compra** | `purchases`, `purchase_lines`, N rollos + `PURCHASE_IN`; recalcula `materials.cost_per_m2` (promedio ponderado). |
| **Ajuste o baja** | movimiento con `reason` obligatorio + `audit_log`. |

Habrá una prueba que verifique el invariante `balance_mm2 = SUM(area_mm2)` en todas las unidades después de cada operación, y otra que verifique que en cada conteo la suma de `reconciled_area_mm2 − cut_area_mm2` de sus cortes a pulso sea igual a **`−freehand_adjust_mm2`** (sin perder mm² al redondear el reparto). El signo es negativo porque un ajuste negativo (falta material) significa que los cortes gastaron *más* de lo estimado.

### Métricas que salen de este modelo

- **Stock por material** = suma de saldos de sus unidades activas (rollos y retazos por separado).
- **Consumo promedio diario** = suma de `CUT_OUT` de los últimos 30 o 90 días ÷ días. **Días restantes** = stock ÷ consumo promedio.
- **% de desperdicio** por material y por operario = `waste / cut_area`, **solo con cortes medidos** (en los cortes a pulso no se separa).
- **Faltante no registrado** = suma de `COUNT_ADJUST` negativos. La imprecisión de los cortes a pulso, dentro de la tolerancia, no cuenta como faltante.
- **Proporción de cortes a pulso** por material y por operario (cuántos cortes y cuánta área se registran sin medir).
- **Precisión de las tallas** = promedio de `reconciled_area / cut_area` por talla, para recalibrar sus áreas de referencia.
- **Costo de material por trabajo** = área de sus cortes × `cost_per_m2` (en cortes a pulso se usa el área conciliada si ya existe; si no, la estimada, y se muestra como estimada). **Margen aproximado** = total − costo de material.

---

## 5. Seguridad

| Aspecto | Decisión | Justificación |
|---|---|---|
| Contraseñas | **argon2id** (`@node-rs/argon2`, binarios precompilados para Windows), mínimo 10 caracteres y rechazo de las más comunes | Es lo que recomienda OWASP hoy y resiste ataques con GPU. |
| Sesión | **Token aleatorio de 256 bits** en cookie `httpOnly`, `SameSite=Lax` y `Secure` en producción. En BD se guarda solo su hash. Expira tras 12 h de inactividad y a los 7 días como máximo. Se rota al iniciar sesión. | A diferencia de un JWT, se puede revocar al instante (cerrar sesión, desactivar un usuario, cambiar la clave). Al ser un solo servidor, no hay problema de escalado. |
| CSRF | `SameSite=Lax` + token CSRF por sesión, enviado en el header `X-CSRF-Token` en toda petición que modifique datos | Doble capa, porque la sesión viaja en una cookie. |
| Fuerza bruta | Rate limit por IP en `/auth/*` (`@fastify/rate-limit`) + bloqueo de 15 min tras 5 intentos fallidos por cuenta | Cubre tanto ataques a una cuenta como barridos desde una IP. |
| Enumeración | Mismo mensaje y tiempo de respuesta tanto si el correo existe como si no | Evita revelar qué correos son clientes. |
| Autorización | Cada ruta declara su nivel: `public`, `authenticated`, `CLIENT`, `STAFF` (admin o empleado) o `ADMIN`. En las rutas de cliente, todas las consultas filtran por `customer.user_id = sesión.user_id`. **Denegar por defecto**: una ruta sin nivel declarado no arranca. Las pruebas recorren todas las rutas: cliente → 403 en `STAFF` y `ADMIN`; empleado → 403 en `ADMIN`. | La interfaz solo oculta botones; la seguridad la aplica el servidor. |
| Datos expuestos | Las respuestas al cliente y al empleado usan DTOs propios: el cliente nunca ve costos, márgenes, inventario ni notas internas; el empleado ve inventario en m², pero no costos ni márgenes | Así no se filtran campos por accidente. |
| Archivos subidos | Solo imágenes, validadas por contenido; re-codificadas con `sharp` (sin EXIF ni GPS); tamaño y cantidad limitados; guardadas fuera de la carpeta pública con nombre aleatorio; servidas solo por una ruta con control de acceso y `Content-Disposition`. La subida usa `multipart/form-data`, como única excepción a "solo JSON", y sigue exigiendo el header CSRF. | Una subida de archivos es la puerta más común para atacar una app web y para filtrar datos privados (la ubicación en las fotos). |
| Validación | Esquemas (Zod) en cada body, query y param; el ORM usa siempre consultas parametrizadas | Evita inyecciones y datos inválidos. |
| Admins | Nunca por registro público. El primero se crea con el script `npm run create-admin` y los demás los crea otro admin. | Cumple el requisito. |
| Auditoría | `audit_log` de: login de admin, gestión de usuarios, ajustes y bajas, cambios de precios, cancelación de pedidos | Trazabilidad. |
| Headers | `@fastify/helmet` (CSP, HSTS en prod, nosniff) | Defensas básicas del navegador. |
| Secretos | `.env` (no se versiona) + `.env.example`. La app no arranca si falta una variable requerida. | No hay secretos en el código. |
| Respaldo | Script `npm run backup` (copia consistente de SQLite con `VACUUM INTO` + carpeta de fotos), ejecutado a diario y copiado **fuera del VPS** | Lo más probable es perder datos por una falla del servidor o un error humano, no por un ataque. |

---

## 6. Estructura de carpetas

```
negocioCamilo/
├── docs/ARQUITECTURA.md
├── package.json                  # workspaces: server, web
├── .env.example
├── server/
│   ├── src/
│   │   ├── app.ts                # construcción de Fastify (testeable)
│   │   ├── index.ts              # arranque
│   │   ├── config.ts             # lectura y validación de env
│   │   ├── db/
│   │   │   ├── schema.ts         # Drizzle
│   │   │   ├── client.ts
│   │   │   └── migrations/
│   │   ├── auth/                 # sesiones, hashing, csrf, guards
│   │   ├── modules/
│   │   │   ├── users/
│   │   │   ├── customers/
│   │   │   ├── materials/
│   │   │   ├── inventory/        # unidades, movimientos, cortes, conteos  ← lógica crítica
│   │   │   ├── catalog/
│   │   │   ├── quote-requests/   # solicitudes web y fotos
│   │   │   ├── orders/
│   │   │   ├── purchases/
│   │   │   └── reports/
│   │   └── lib/                  # units.ts (mm↔m), money.ts, audit.ts, errors.ts
│   ├── scripts/                  # create-admin.ts, backup.ts, seed-dev.ts
│   ├── data/                     # negocio.db + uploads/ (fotos; fuera de la carpeta pública)
│   └── test/
└── web/
    └── src/
        ├── api/                  # cliente HTTP (envía la cookie y el header CSRF)
        ├── pages/admin/          # inventario, cortes, pedidos, compras, reportes, usuarios
        ├── pages/empleado/       # registrar corte, stock, pedidos en curso (celular primero)
        ├── pages/cliente/        # pedir cotización (con fotos), mis cotizaciones, mis pedidos, perfil
        ├── pages/publico/        # catálogo sin iniciar sesión
        └── components/
```

Cada módulo tiene `routes.ts` (HTTP + esquemas), `service.ts` (lógica de negocio y transacciones) y `*.test.ts`.

---

## 7. Plan por fases

| Fase | Alcance | Pruebas clave |
|---|---|---|
| **1. Base y autenticación** | Monorepo, config, BD y migraciones; registro de clientes, login, logout, sesión, CSRF, rate limit, bloqueo; `create-admin`; gestión de usuarios por el admin; layout del frontend con rutas protegidas | hashing, expiración y revocación de sesión, CSRF, bloqueo, **cliente → 403 en todas las rutas de admin**, un cliente no puede ver datos de otro |
| **2. Materiales e inventario** | **Rol EMPLOYEE** (migración del `CHECK` de roles, nivel de acceso `STAFF`, el admin crea empleados, vista de empleado); CRUD de materiales; alta manual de rollos; libro de movimientos; **registro de cortes medidos y a pulso, con retazos**; tallas de corte a pulso; conteo físico por largo o peso **con conciliación de los cortes a pulso**; ajustes y bajas; vista de stock (con aviso de cortes a pulso sin conciliar) | **empleado → 403 en todas las rutas de admin y sin costos en sus respuestas**, conservación del área, saldo = suma de movimientos, sin stock negativo, inmutabilidad (triggers), conversiones de unidades, conteo por peso, reparto de la diferencia del conteo (dentro y fuera de la tolerancia, sin cortes a pulso pendientes, redondeo sin perder mm²) |
| **3. Clientes, catálogo y pedidos** | Clientes (con o sin cuenta, con datos de facturación); catálogo público sin login; **solicitudes de cotización con fotos**; cotización → pedido con máquina de estados; IVA por ítem; cortes vinculados a pedidos; pagos; portal del cliente | transiciones de estado válidas e inválidas, totales con IVA, el cliente solo ve sus pedidos, solicitudes y fotos, y nunca costos; subida de fotos: rechaza archivos que no son imagen, los que exceden tamaño o cantidad, y elimina EXIF/GPS |
| **4. Compras, alertas, reportes y despliegue** | Proveedores y compras (crean rollos); costo promedio; alertas de stock bajo; consumo promedio y días restantes; % de desperdicio; faltante no registrado; ventas por cliente; margen por trabajo; backup diario fuera del servidor; **puesta en internet** (VPS, dominio, Caddy, systemd) | cálculos de reportes con datos de prueba conocidos; restaurar un respaldo |
| **5. Facturación electrónica** (cuando el contador confirme obligación y proveedor) | Integración con la API del proveedor tecnológico: emitir factura desde un pedido, guardar número y CUFE, notas crédito | contra el ambiente de pruebas del proveedor |

> La puesta en internet puede adelantarse al final de la Fase 3 si el dueño quiere que los clientes empiecen a pedir cotizaciones antes de tener los reportes.

---

## 8. Supuestos tomados (los más conservadores)

1. **No se permite stock negativo.** Si un corte supera el saldo, se rechaza y se pide primero un conteo o ajuste. Esto obliga a mantener el inventario honesto.
2. **Moneda COP, en pesos enteros.** El IVA se registra por ítem desde la Fase 3, pero la factura electrónica es la Fase 5 (§1.4). El sistema registra ventas; no es software contable.
3. **Tres roles: ADMIN, EMPLOYEE y CLIENT** (§1.2). El empleado no ve costos y no hace conteos ni ajustes.
4. **Los retazos se guardan como el rectángulo útil más grande.** Si la forma es irregular, se mide el rectángulo que realmente se puede reutilizar.
5. **El retazo vale lo mismo por m² que su material.** No se le aplica descuento de costo.
6. **El cliente solicita, el admin cotiza.** El cliente envía una solicitud con fotos, pero los precios los pone siempre el admin. El cliente puede ver y aceptar la cotización resultante (§1.3).
7. **Un solo local y una sola bodega.** El campo `location` es texto libre.
8. **Corte a pulso: la tolerancia por defecto es ±50 % del área estimada pendiente.** Lo que pase de ahí se reporta como faltante no explicado. Es un valor de arranque; el dueño lo ajusta cuando vea la precisión real de las tallas.
9. **No se permite un corte a pulso sin estimación.** Siempre se elige una talla o se digita un tamaño aproximado. Si no, el stock no bajaría hasta el conteo y las alertas de stock bajo llegarían tarde.
10. **Un corte a pulso que supera el saldo se rechaza**, igual que uno medido (supuesto 1), y se sugiere contar el rollo: si la estimación no cabe, lo más probable es que el saldo ya esté desfasado.

## 9. Preguntas para el dueño del negocio

### Respondidas (2026-11-24)

- ~~¿Quién usará el sistema dentro del local?~~ → Dueño y **empleados que registran cortes** (§1.2).
- ~~¿Los clientes pueden pedir cotizaciones desde la web?~~ → **Sí, con fotos**, y además consultan el catálogo y sus cotizaciones (§1.3).
- ~~¿Necesitan facturación electrónica DIAN?~~ → **Después**, como Fase 5; el modelo queda preparado desde ahora (§1.4).
- ~~¿PC del local o internet?~~ → **En internet**, como aplicación web (§2.1).

### Abiertas

1. **¿Cómo se corta hoy?** ¿Siempre a lo ancho completo del rollo, o a veces se corta "una esquina"? (El modelo admite ambos casos, pero cambia cómo se diseña el formulario). ¿Qué proporción de los cortes se hace a pulso?
2. **¿Tienen una balanza?** Con una balanza de cocina o de paquetes, el conteo por peso es la forma más rápida y precisa de medir un rollo a medio usar.
3. **¿Se venden calcas prediseñadas como producto contable** (por unidades, p. ej. "kit calcas Pulsar")? Si es así, conviene un inventario por unidades además del de vinilo.
4. **¿Qué tallas de corte a pulso tienen sentido en el local?** Por ejemplo: calca pequeña, filete, tapa lateral, tanque, guardabarro. Con 4 a 6 tallas bien elegidas, registrar un corte a pulso toma un toque y la estimación es razonable.
5. **Para el contador:** ¿el negocio está obligado a facturar electrónicamente? ¿Es responsable de IVA? ¿Ya usa algún proveedor (Alegra, Siigo, etc.)? Define la tarifa de IVA por defecto y la Fase 5.
6. **¿Los empleados pueden hacer conteos físicos?** Por defecto no (§1.2): el conteo es el control sobre los cortes. Si el dueño no está en el local con frecuencia, se puede habilitar.
7. **¿Qué nombre de dominio quieren** para la página (p. ej. `nombredellocal.com`)? Conviene registrarlo pronto, antes de que lo tome otro.

## 10. Notas de implementación

### Fase 2 (2026-11-24)

Diferencias y precisiones respecto al diseño de arriba:

- **Nuevo movimiento `INITIAL_IN`** (alta manual de un rollo). Sirve para cargar el inventario que ya existe
  o un rollo que entra sin compra registrada. Si el rollo está empezado, se da de alta con el largo que le queda.
  Las compras (`PURCHASE_IN`) llegan en la Fase 4.
- **Columnas pendientes para fases siguientes:** `inventory_units.purchase_line_id` (Fase 4) y `cuts.order_id`
  (Fase 3) se agregan con `ALTER TABLE ADD COLUMN` cuando existan esas tablas.
- **Signo de la conciliación:** Σ(`reconciled_area_mm2` − `cut_area_mm2`) = **−**`freehand_adjust_mm2` (ver §4).
  El reparto usa el método del resto mayor con `BigInt`, para no perder mm² ni desbordar con rollos grandes.
- **Inmutabilidad en la BD:** triggers que impiden modificar o borrar `inventory_movements` y `physical_counts`,
  y borrar `cuts`. Un corte solo se puede actualizar para conciliarlo, una sola vez. La BD también impone el signo
  de cada tipo de movimiento y la conservación del área de cada corte (`CHECK`).
- **Configuración** en la tabla `app_settings`, editable por el admin en *Cortes a pulso*:
  `freehandTolerancePct` (50 por defecto) y `freehandPendingAlert` (8 por defecto: a partir de cuántos cortes a pulso
  sin conciliar se marca un rollo como «por medir»). Un rollo también se marca si su saldo llega a 0 con cortes a pulso pendientes.
- **Corte medido sin «área usada»:** se toma como usado todo lo que no es retazo (desperdicio 0). Esto agiliza el
  registro, pero el % de desperdicio solo es real si el operario digita el área usada.
- **Retazos:** se guardan con el lado menor como ancho. Un corte de un retazo debe caber en sus medidas.
- **Códigos automáticos:** `R-001`… para rollos, `RZ-001`… para retazos y `M-001`… para materiales. El admin puede
  dar un código propio a un rollo (p. ej. la etiqueta que ya tiene).
- **Migraciones:** `openDb` desactiva las claves foráneas mientras migra (procedimiento recomendado por SQLite para
  reconstruir tablas) y ejecuta `PRAGMA foreign_key_check` al terminar. Hay una prueba que migra una BD de la
  Fase 1 con datos.

**API** (todo en mm, mm² y pesos enteros):

| Nivel | Rutas |
|---|---|
| `STAFF` (admin y empleado; **nunca** devuelven costos) | `GET /api/staff/materials`, `GET /api/staff/units`, `GET /api/staff/units/:id`, `GET /api/staff/freehand-sizes`, `GET /api/staff/cuts`, `POST /api/staff/cuts` |
| `ADMIN` | `GET/POST/PATCH /api/admin/materials`, `POST/PATCH /api/admin/units`, `GET/POST /api/admin/units/:id/counts`, `POST /api/admin/units/:id/adjust`, `POST /api/admin/units/:id/discard`, `GET/POST/PATCH /api/admin/freehand-sizes`, `GET/PATCH /api/admin/settings` |

**Pantallas:** *Registrar corte* (`/corte`, pantalla de inicio del empleado), *Stock* (`/stock`), detalle de rollo
o retazo (`/stock/:id`, con conteo, ajuste y baja para el admin), *Materiales* (`/admin/materiales`) y
*Cortes a pulso* (`/admin/ajustes`).

### Fase 3 (2026-11-24)

Diferencias y precisiones respecto al diseño:

- **Descuento por línea**, no por pedido. `order_items.discount` reduce la base de la línea, y el IVA se calcula
  por línea sobre esa base ya descontada (así lo exige la factura electrónica). `orders.discount` es la suma
  informativa. Por eso **`total = subtotal + tax_total`**, con `subtotal` ya neto de descuentos (lo impone un `CHECK`).
  Los redondeos usan enteros con `BigInt` (mitad hacia arriba): `server/src/lib/money.ts`.
- **Clientes:** `document_id` se reemplazó por `document_type`, `document_number`, `nit_check_digit` (lo
  **calcula** el sistema con el algoritmo de la DIAN) y `billing_email`. Un cliente con cuenta cambia su nombre y
  celular desde «Mi cuenta»; el admin edita sus datos de facturación y notas internas.
- **Máquina de estados** (`server/src/modules/orders/service.ts`, `TRANSITIONS`):

  | De → a | Quién |
  |---|---|
  | COTIZADO → APROBADO / CANCELADO | cliente (desde su cuenta, si no venció) o admin |
  | APROBADO → EN_PROCESO; EN_PROCESO → TERMINADO; TERMINADO → ENTREGADO o de vuelta a EN_PROCESO | admin o empleado |
  | APROBADO / EN_PROCESO → CANCELADO | solo admin, con motivo |

  La cotización solo se edita en COTIZADO. Su vigencia (`quote_valid_until`) se compara con la fecha de Colombia (UTC−5).
- **El empleado no ve dinero:** sus vistas de pedidos no traen precios, totales, pagos ni costos (lo verifica una
  prueba que recorre todas sus rutas). Sí ve qué hay que hacer, el contacto del cliente, las fotos y el material usado.
- **Costo de material por trabajo** = Σ (área del corte − retazos guardados) × `cost_per_m2`, usando el área
  conciliada en cortes a pulso cuando existe. Si falta conciliar o un material no tiene costo, se marca «aprox.».
  **Margen** = subtotal (sin IVA) − costo de material.
- Un corte solo se puede cargar a un pedido **APROBADO o EN_PROCESO**.
- **Fotos:** se aceptan JPG, PNG, WebP y AVIF. **HEIC no**: el `sharp` precompilado no trae el decodificador
  (patentes). Casi nunca llega, porque el iPhone convierte a JPG al subir desde el navegador; si llega, el
  mensaje explica cómo cambiar el formato. Las fotos van en `UPLOADS_PATH` (por defecto `server/data/uploads`).
- **Límites contra abuso** (configurables en *Catálogo → Cotizaciones*): 3 solicitudes abiertas por cliente,
  5 por día, máx. 5 fotos de 10 MB, y 20 envíos por hora por IP.
- **Configuración nueva:** `defaultTaxRateBp` (0 % por defecto, **pendiente de confirmar con el contador**) y `quoteValidDays` (15).
- **Migraciones 0002 y 0003:** `drizzle-kit` generó en la 0003 un `INSERT` que leía columnas que la tabla vieja
  aún no tenía; se corrigió a mano y hay una prueba que migra una BD de la Fase 2 con datos.

**Pantallas:** catálogo público (`/catalogo`, también es la portada sin sesión); cliente: *Mis trabajos*,
*Pedir cotización*, detalle de solicitud y de cotización/pedido (aceptar o rechazar), datos de facturación en
*Mi cuenta*; personal: *Pedidos*, *Solicitudes* y detalle del pedido (estados, fotos del local, material usado;
el admin además edita la cotización, registra pagos y el número de factura, y ve costo y margen);
admin: *Clientes*, *Catálogo* (con la configuración de cotizaciones) y *Nueva cotización*. Al registrar un
corte se puede elegir el trabajo.

### Fase 4 (2026-11-24)

- **Compras:** `suppliers`, `purchases` y `purchase_lines` (inmutables por trigger: los errores se corrigen con
  ajustes). Confirmar una compra crea, en una transacción, un rollo por unidad con su `PURCHASE_IN` y su
  `purchase_line_id`, y recalcula el **costo promedio ponderado** por m² de cada material:
  `(stock × costo actual + área comprada × costo de compra) / (stock + área comprada)`, con BigInt. El cambio
  de costo queda en `audit_log` con el valor anterior.
- **Reportes** (`server/src/modules/reports/service.ts`, solo admin; rango en días de Colombia):
  - **Stock:** consumo neto diario (área cortada − retazos, conciliada cuando existe), días restantes y alerta si
    el stock está bajo el mínimo o se acaba en menos de `stockAlertDays` (15 por defecto).
  - **Ventas:** pedidos con fecha de **aprobación** en el rango y que no se cancelaron; pagos por medio; cartera
    (todos los saldos pendientes).
  - **Margen por trabajo:** subtotal sin IVA − costo de material. No incluye mano de obra ni gastos fijos.
  - **Desperdicio** (solo cortes medidos), **faltantes** (`unexplained_mm2` de los conteos, con su valor) y
    **cortes a pulso** (proporción por persona y precisión de cada talla). Con 5 o más cortes conciliados se
    sugiere un área de referencia nueva para la talla, que el admin aplica con un clic.
- **Respaldo:** `npm run backup` (`VACUUM INTO` + `integrity_check` + fotos incrementales + rotación) y
  `npm run restore`. Una prueba hace un respaldo, lo abre como BD activa y verifica datos, invariantes y triggers.
- **Despliegue:** `deploy/` (Caddyfile, `vinilos.service` endurecido, timer de respaldo diario con rclone,
  `actualizar.sh`) y la guía `docs/DESPLIEGUE.md`. `/api/health` también verifica la BD.
