# PetFlow-PWA: contexto del repositorio

## Proyecto
Sistema de Gestión ERP basado en arquitectura PWA para Mundo Mascotas. Es un monorepo con dos partes: frontend y backend. Idioma del proyecto: español (comentarios, docs y commits).

Repositorio: https://github.com/padula-scarone/PetFlow-PWA
Rama de trabajo actual: `chore/1-crear-estructura-base`. Rama principal para PRs: `develop`.

## Estructura
```
PetFlow-PWA/
├── backend/     Express + TypeScript + Prisma (Supabase/PostgreSQL)
├── frontend/    React 19 + Vite 8 + TypeScript (PWA)
├── CLAUDE.md    Este archivo (contexto para Claude)
├── tsconfig.json   Config TS de la raíz (sin rootDir; solo referencia)
└── README.md
```

Documentación por parte:
* `backend/docs/backend.md`: registro de dependencias y configuración del backend.
* `frontend/docs/frontend.md`: registro de dependencias del frontend (todavía vacío).

## Estado actual
* **Frontend:** scaffold de Vite. `src/App.tsx` solo renderiza `<h1>PetFlow</h1>`.
* **Backend:** `src/` vacía, `prisma/schema.prisma` vacío, `.env` vacío. Todavía no hay código del servidor ni modelo de datos.

## Stack

### Backend (`backend/package.json`)
* Express `^5.3.0`
* Prisma `^8.0.0-rc.27` (CLI y ORM, destino PostgreSQL en Supabase)
* TypeScript `^7.0.2`, ts-node `^10.9.2`, `@types/node ^26.6.5`, `@types/express ^5.0.6`
* `"type": "module"`, sin script `postinstall`, script `test` sin configurar.

### Frontend (`frontend/package.json`)
* React `^19.3.1`, react-dom `^19.3.1`
* Vite `^8.3.4`, `@vitejs/plugin-react ^6.1.2`
* TypeScript `~6.0.3`
* ESLint `^10.13.0` con `typescript-eslint`, `eslint-plugin-react-hooks` y `eslint-plugin-react-refresh`
* Scripts: `dev`, `build` (`tsc -b && vite build`), `lint`, `preview`.

## Configuración relevante

### TypeScript
* `backend/tsconfig.json`: `module: nodenext`, `strict`, `verbatimModuleSyntax`, `rootDir: ./src`, `outDir: ./dist`, `exclude: ["prisma.config.ts"]`.
* Mientras `backend/src/` esté vacía, `tsc --noEmit` falla con `TS18003: No inputs were found`. Es esperado.

### Prisma
* `backend/prisma.config.ts`: `skills.agents = ["claude", "cursor"]`.
* Las carpetas de skills de Prisma son `backend/.claude/` y `backend/.cursor/`. No volver a crear `.agents/` ni `.devin/`.

### Variables de entorno y secretos
* `.env` y `.env.*` están en `.gitignore`. Nunca commitear credenciales ni pegarlas en docs o en el chat.
* `backend/.env` existe pero está vacío. Faltan las variables de conexión a Supabase.

## Convenciones
* Commits en español con prefijo de tipo, por ejemplo `build: ...` o `chore: ...`.
* Todos los commits deben ser atómicos y seguir el estándar Conventional Commits en español. Formato: `tipo(ámbito): descripción breve en minúsculas`. Tipos permitidos: feat, fix, chore, refactor, test, docs.
* Las dependencias del backend se documentan en `backend/docs/backend.md` al agregarlas.
* Cualquier documentación nueva para el equipo va en la carpeta `docs/` de la parte correspondiente.

## Comandos
Backend (desde `backend/`):
* `npm install`
* `npx tsc --noEmit -p tsconfig.json` (falla hasta que haya código en `src/`)

Frontend (desde `frontend/`):
* `npm run dev`
* `npm run build`
* `npm run lint`

## Pendiente
* Definir `backend/prisma/schema.prisma` (el diseño DBML se traduce a PostgreSQL).
* Escribir el servidor Express en `backend/src/`.
* Completar `backend/.env` con las variables de Supabase, sin commitearlas.
* Completar `frontend/docs/frontend.md`.
* Configurar un script de `test` real en el backend.
