---
name: sdd-plan
description: Genera la propuesta SDD (contexto, contrato, reglas de negocio, arquitectura CSD y freno de mano) para una acción de un módulo del backend, sin escribir código funcional. Usar al iniciar una nueva acción o endpoint.
argument-hint: <módulo> <nombre de la acción>, por ejemplo "ventas cobrar fiado"
---

# SDD: propuesta de una acción

Recibís el nombre de una acción de un módulo (`$ARGUMENTS`). Tu única tarea es **proponer**, nunca implementar. Respondé en español y en este orden.

## Antes de redactar
1. Leé `CLAUDE.md` (reglas, convenciones y estado actual).
2. Leé `prisma/schema.prisma` para ver qué modelos y campos existen realmente.
3. Si el módulo ya existe en `src/modules/<módulo>/`, leé sus archivos para respetar el estilo y reutilizar tipos y errores.
4. Si algo del pedido es ambiguo o contradice el esquema, listalo como pregunta en el punto 3; no lo resuelvas en silencio.

## Los 5 puntos obligatorios

### 1. Contexto
Módulo, acción, ruta HTTP propuesta y qué tablas toca.

### 2. Contrato de entrada y salida
En texto plano, sin código:
* **Entrada:** qué datos recibe, cuáles son obligatorios u opcionales y qué condiciones los relacionan.
* **Salida:** qué devuelve en éxito y los códigos de error esperados (400, 404, 409).

### 3. Reglas de negocio y sub-acciones
Lista numerada y verificable. Marcá con **[A confirmar]** cada supuesto tuyo o ambigüedad.

### 4. Arquitectura CSD
Qué responsabilidad tiene cada capa para esta acción:
* **Controller:** valida con Zod.
* **Service:** lógica pura (cálculos y reglas), sin Prisma.
* **Repository:** único con Prisma; indicar si necesita `prisma.$transaction()`.
Recordá la nomenclatura (kebab-case en archivos, camelCase, PascalCase) y las reglas de legibilidad de `CLAUDE.md` (seccionado, comentarios del qué y el por qué, JSDoc).

### 5. Freno de mano (estricto)
**No escribas código funcional ni crees ni edites archivos.** Presentá solo:
1. Nombres y estructura de los **esquemas Zod** y **tipos TypeScript** propuestos (se admite un esbozo de campos, no implementación).
2. Un **Plan Lógico** breve por capa.
3. Una lista de **Tareas Técnicas** paso a paso, con los archivos involucrados.

Cerrá pidiendo el OK del usuario. Hasta recibirlo, no pases a implementar.
