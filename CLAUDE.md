# Referencia de Contexto Global
Para consultar el modelo de datos relacional, los Casos de Uso Base (CUB) y las reglas de negocio completas, debes leer obligatoriamente: `../petflow-workspace/SSOT.md`.

# Stack Tecnológico
- **Entorno:** Node.js, Express, TypeScript.
- **Validación Transversal:** Zod (para inferencia de tipos y validación de esquemas HTTP).
- **Base de Datos:** PostgreSQL alojado en Supabase, operado exclusivamente mediante Prisma ORM.
- **Seguridad:** Autenticación con JWT (sesiones en headers) y encriptación con bcryptjs.

# Paradigmas y Arquitectura
- **Screaming Architecture (Feature-Sliced):** El código se agrupa por módulos de negocio en la carpeta `/modules/` (ej. `/modules/ventas/`), conteniendo su controlador, servicio y esquemas aislados.
- **POO Estructural (Sin Clases):** Se usan interfaces y types puros para los datos. Prohibido instanciar con `class` o `new`.
- **Patrón CSD (Controlador - Servicio - Datos):**
  1. *Controlador:* Recibe petición HTTP, delega validación a Zod y retorna respuestas. CERO lógica de negocio.
  2. *Servicio:* Centraliza matemática, reglas de negocio y orquesta el flujo.
  3. *Datos:* Prisma ejecuta las sentencias.

# Reglas de Base de Datos y Transaccionalidad
- **Transacciones Atómicas:** Toda operación cruzada (ej. descontar stock + registrar venta + afectar caja) debe ejecutarse dentro de un `prisma.$transaction()`. Ante fallo parcial, rollback automático.
- **Inmutabilidad de Registros:** Prohibido el `DELETE` físico. Toda eliminación es un `UPDATE` de estado (baja lógica).
- **Mapeo de Nombres (PostgreSQL):** La base de datos física usa `snake_case`. En Prisma, el modelo es `PascalCase` y las propiedades `camelCase`, utilizando `@map("nombre_real")` y `@@map("tabla_real")` para conectar ambos mundos.

# Estándares y Convenciones
- **Regla de Oro:** CERO abreviaciones. Las variables deben ser explícitas en español.
- **Archivos, Carpetas y Rutas REST:** `kebab-case` (ej. `ventas.controller.ts`, `/api/cambios-mercaderia`).
- **Variables y Funciones:** `camelCase` (ej. `calcularTotal()`).
- **Constantes y Enums:** `UPPER_SNAKE_CASE` (ej. `PENDIENTE_PAGO`).
- **Comentarios y Documentación:**
  - Archivos extensos deben usar separadores lógicos (ej. `// --- ESTADOS ---`).
  - Los comentarios en línea explican el *qué* y el *por qué*, nunca lo obvio.
  - Documentar tipos e interfaces obligatoriamente con estándar JSDoc (`/** ... */`).
- **Caracteres Permitidos (ASCII):** Prohibido usar tildes, diéresis o la letra "ñ" en el código fuente (nombres de variables, funciones, archivos, bases de datos o ramas). Escribe en español limitándote al alfabeto inglés. Para palabras con "ñ", utiliza sinónimos semánticos en lugar de reemplazarla por "n" (ej. prohibido usar `año` o `anio`, usa `periodo` o `ejercicio`; en lugar de `tamano`, usa `dimension` o `medida`).

# Control de Versiones (Git)
- **Ramas:** `tipo/id-nombre-tarea` (ej. `feat/2-alta-venta`, `fix/8-validacion-zod`).
- **Commits (Conventional Commits):** `tipo(alcance): accion en imperativo y minuscula`.
  - *Tipos:* `feat`, `fix`, `style`, `refactor`, `docs`, `chore`.
  - *Alcances permitidos:* `ventas`, `caja`, `auth`, `api`, `db`.

