# PetFlow Backend: contexto del repositorio

## Proyecto
API del Sistema de Gestión ERP (PWA) para Mundo Mascotas. Este repositorio contiene solo el backend; el frontend vive en su propio repositorio (`petflow-frontend`, con su propio `CLAUDE.md`). Idioma del proyecto: español (comentarios, docs y commits).

Repositorio: https://github.com/padula-scarone/petflow-backend
Rama de trabajo actual: `feat/1-alta-venta`. Rama principal para PRs: `develop`.

## Metodología y arquitectura
* **Spec-Driven Development:** primero se acuerda el contrato, los tipos y un plan; recién con el OK del usuario se implementa.
* **Screaming Architecture:** carpetas por dominio (`src/modules/<dominio>/`).
* **Capas CSD:** Controller (valida con Zod) → Service (lógica de negocio pura) → Repository (única capa que usa Prisma).
* **Atomicidad:** las operaciones que escriben varias tablas o descuentan stock van en una única `prisma.$transaction()`.
* **Nomenclatura:** archivos en kebab-case (`ventas.controller.ts`), variables y funciones en camelCase, tipos y modelos en PascalCase.

## Estructura
```
petflow-backend/
├── prisma/schema.prisma        Modelo de datos (PascalCase en Prisma, snake_case en BD vía @map/@@map)
├── prisma.config.ts            Config de Prisma 7
├── src/
│   ├── server.ts               App Express, monta los routers
│   ├── shared/prisma.ts        Cliente Prisma compartido
│   ├── modules/ventas/         Módulo de ventas (routes, controller, schemas, types, service, repository, errors)
│   └── generated/prisma/       Cliente generado (ignorado por git)
├── CLAUDE.md                   Este archivo
└── README.md
```

## Estado actual
* **Implementado:** `POST /ventas` (alta de venta cobrada o fiado), con prueba de punta a punta contra Supabase.
* **Esquema:** todas las tablas del diseño DBML están en `schema.prisma` y sincronizadas en Supabase con `db push`. `cambios_mercaderia` existe pero todavía no tiene lógica.
* **Datos semilla de demo:** en Supabase hay un usuario, una caja abierta, una categoría, dos productos (unidad y granel) y dos medios de pago de prueba, más dos ventas de prueba.
* **Pendiente de la demo:** Login (6.1), cobro de fiados, anulación de ventas y cambios de mercadería (CUB 1.4).

## Reglas de negocio vigentes (alta de venta)
* **Fiado:** sin pagos la venta queda `PENDIENTE_PAGO`, exige `clienteReferencia`, no tiene caja, comprobante ni fecha de pago, pero descuenta stock y guarda detalles.
* **Inmutabilidad:** cada detalle congela `precio_unitario_vigente` y `costo_unitario_congelado`.
* **Medios de pago:** el `monto` de cada pago es la porción base. Ajuste neto = `porcentaje_recargo − porcentaje_descuento`; `monto_final = base × (1 + neto%)`. La suma de montos base debe ser igual a `subtotal − descuento manual`; `monto_total` guarda la suma de los `monto_final`.
* **Caja:** se asocia la última sesión `ABIERTA` o se responde 409. No se modifica `saldo_actual` (la Caja Diaria se simula en la demo).
* **Comprobante:** `CMP-` + id con 8 dígitos (ej. `CMP-00000001`), solo en ventas cobradas.
* **Cantidades:** hasta 3 decimales; los productos `UNIDAD` solo admiten enteros.
* **Usuario:** `idUsuario` viaja en el body de forma temporal hasta que exista el Login.
* **Cálculo interno:** montos en centavos enteros, cantidades en milésimas y porcentajes en basis points, para evitar errores de coma flotante.

## Stack

### Backend (`package.json`)
* Express `^5.3.0`, Zod `^4`, dotenv
* Prisma `7.10.1` estricto: `prisma` (CLI), `@prisma/client` y `@prisma/adapter-pg` (destino PostgreSQL en Supabase)
* TypeScript `^7.0.2`, ts-node `^10.9.2`, `@types/node ^26.6.5`, `@types/express ^5.0.6`
* `"type": "module"`, script `test` sin configurar.

## Configuración relevante

### TypeScript
* `tsconfig.json`: `module: nodenext` (los imports llevan extensión `.js`), `strict`, `verbatimModuleSyntax`, `rootDir: ./src`, `outDir: ./dist`, `exclude: ["prisma.config.ts"]`.

### Prisma
* Se usa estrictamente Prisma 7.10.1 con `@prisma/adapter-pg`. No instalar ni migrar a Prisma 8.
* `prisma.config.ts`: `schema = prisma/schema.prisma` y `datasource.url = env("DIRECT_URL")` (conexión directa de Supabase para el CLI).
* En runtime, `src/shared/prisma.ts` crea el `PrismaClient` con `PrismaPg` usando `DATABASE_URL` (pooler de Supabase).
* El cliente se genera en `src/generated/prisma/` (ignorado por git). Regenerar con `npx prisma generate`; subir cambios del esquema con `npx prisma db push`.

### Variables de entorno y secretos
* `.env` y `.env.*` están en `.gitignore`. Nunca commitear credenciales ni pegarlas en docs o en el chat.
* Variables necesarias: `DATABASE_URL` (pooler, runtime) y `DIRECT_URL` (conexión directa, CLI de Prisma). Opcional: `PORT` (3000 por defecto).

## Convenciones
* Todos los commits deben ser atómicos y seguir el estándar Conventional Commits en español. Formato: `tipo(ámbito): descripción breve en minúsculas`. Tipos permitidos: feat, fix, chore, refactor, test, docs.
* Las dependencias del backend se documentan en `docs/backend.md` al agregarlas.
* Cualquier documentación nueva para el equipo va en la carpeta `docs/`.
* La IA no modifica la documentación base (`CLAUDE.md`, `docs/`) sin pedido explícito del usuario.

### Convenciones de código (legibilidad)
Reglas obligatorias para todo el código nuevo:
* **Seccionado de archivos:** dividir los archivos extensos en bloques lógicos con comentarios separadores claros, por ejemplo `// --- VALIDACIONES ---`, `// --- CÁLCULO PURO ---`.
* **Comentarios en línea:** agregar comentarios breves en español arriba de los bloques de lógica, explicando el *qué* y el *por qué*. No comentar lo obvio.
* **Documentación de tipos:** usar JSDoc (`/** ... */`) en español para explicar brevemente las interfaces, types, funciones exportadas y sus propiedades principales.

## Comandos
Desde la raíz del repositorio:
* `npm install`
* `npx prisma generate`: regenera el cliente en `src/generated/prisma/`.
* `npx prisma validate`: valida el esquema.
* `npx prisma db push`: sincroniza el esquema con Supabase.
* `npx tsc --noEmit -p tsconfig.json`: verifica los tipos.

## Pendiente
* Login (6.1): reemplazar `idUsuario` del body por el usuario de la sesión.
* Endpoints restantes de la demo: cobrar fiado, anular venta, cambios de mercadería.
* Crear `docs/backend.md` con el registro de dependencias.
* Configurar un script de `test` real y agregar un manejo de errores global en Express.
* Probar ventas simultáneas sobre el mismo stock y la ausencia de caja abierta contra la BD.
