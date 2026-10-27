# Documentación del Backend

## Estado actual
* `src/` existe pero está vacía: todavía no hay código del servidor.
* `prisma/schema.prisma` existe pero está vacío: el modelo de datos aún no está definido.
* `.env` existe pero está vacío: faltan las variables de entorno (por ejemplo, la URL de conexión a Supabase).
* `package.json` usa `"type": "module"`, así que los archivos `.ts` se tratan como ES modules.

## Registro de Dependencias

### Inicialización y Servidor
* **Express** (`npm install express`): Framework base para levantar el servidor y crear las rutas de la API REST. Versión: `^5.3.0`.
* **TypeScript y Tipados** (`npm install -D typescript @types/node @types/express ts-node`): Motor para usar TypeScript estricto y diccionarios de traducción para que el IDE reconozca los comandos de Node/Express sin errores. Versiones: `typescript ^7.0.2`, `@types/node ^26.6.5`, `@types/express ^5.0.6`, `ts-node ^10.9.2`.

### Base de Datos
* **Prisma** (`npm install -D prisma`): Herramienta CLI para traducir el diseño DBML a PostgreSQL y gestionar la conexión con Supabase. Versión: `prisma ^8.0.0-rc.27`.

## Configuraciones

### TypeScript (`tsconfig.json`)
* `"rootDir": "./src"` para el código fuente y `"outDir": "./dist"` para la compilación.
* `"module": "nodenext"`, `"strict": true`, `"verbatimModuleSyntax": true`.
* `"exclude": ["prisma.config.ts"]` en el nivel raíz del archivo, para que `tsc` no tome ese archivo como parte de `src/`.
* Mientras `src/` esté vacía, `tsc --noEmit` falla con `TS18003: No inputs were found`. No es un error de configuración: se resuelve al agregar archivos `.ts` en `src/`.

### Prisma (`prisma.config.ts`)
* Define la sección `skills` con `agents: ["claude", "cursor"]`.
* Los directorios de skills que genera Prisma son `.claude/` y `.cursor/`. Los directorios `.agents/` y `.devin/` se eliminaron y no deben volver a generarse.

### Scripts (`package.json`)
* No hay script `postinstall`. Se quitó `prisma skills sync` para que `npm install` no vuelva a crear las carpetas de skills de Prisma.
* El script `test` es el valor por defecto de `npm init` y todavía no hay tests.
