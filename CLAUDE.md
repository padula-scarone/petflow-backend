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


# Stack fijado en esta rama (`feat/1-alta-venta`)
- **Prisma 7.10.1** con `@prisma/adapter-pg` (`prisma`, `@prisma/client`). No migrar a Prisma 8: decisión del arquitecto, la versión rc quedó descartada por inestable.
- `prisma.config.ts` usa `DIRECT_URL` (CLI); `src/shared/prisma.ts` usa `DATABASE_URL` (pooler) en runtime.
- El cliente se genera en `src/generated/prisma/` (ignorado por git).
- Módulo `ventas` implementado: `POST /api/ventas` (alta de venta cobrada o fiado; el vendedor sale del token, el descuento manual exige `motivoDescuento` y los pagos en efectivo admiten `montoRecibido` con vuelto calculado por el servidor; responde con `pagos[]`), `GET /api/ventas` (historial paginado con filtros por fecha, producto y estado), `GET /api/ventas/:idVenta` (detalle de una venta con ítems y pagos, en cualquier estado, incluidos `motivoDescuento`, `montoRecibido` y `vuelto`, nulos si no aplican) y `POST /api/ventas/:idVenta/cobro` (liquidar un fiado: cobro total con vuelto en efectivo y control de doble cobro) y `POST /api/ventas/:idVenta/anulacion` (baja y modificación de venta, una sola operación: body `{ motivo }` obligatorio de 1 a 200 caracteres; pasa a `ANULADA` una venta `COMPLETADA` o `PENDIENTE_PAGO` y repone el stock en una transacción; ventana de `LIMITE_MINUTOS_ANULACION` = 15 min desde `fechaHoraPago ?? fechaHora`, 403 si venció; una venta con cobro exige alguna caja abierta; una `ANULADA` no se anula ni se cobra, 409; deja auditoría en el mismo UPDATE del estado: quién anula sale del token, cuándo del reloj del servidor y por qué del motivo; `GET /api/ventas/:idVenta` devuelve `anulacion` con fecha, motivo y usuario, o `null` si no está anulada o se anuló antes de la auditoría; un total o cierre de caja futuro debe sumar solo ventas `COMPLETADA`). `ErrorNegocio` admite 403 con mensaje propio, distinto del 403 de autenticación. Detalle de reglas: `../petflow-workspace/SSOT.md`.
- `ventas.motivo_descuento VARCHAR(200) NULL` se aplica a mano en Supabase; Prisma solo lo mapea.
- `ventas.fecha_hora_anulacion TIMESTAMPTZ(6) NULL`, `ventas.id_usuario_anulacion INTEGER NULL` (FK a `usuarios`) y `ventas.motivo_anulacion VARCHAR(200) NULL` también se aplican a mano en Supabase; Prisma solo las mapea (`Venta.usuarioAnulacion` / `Usuario.ventasAnuladas`, relación `VentaUsuarioAnulacion`). El SQL va antes que el código que las usa: el alta de venta hace un `update` sin `select` que las pediría y fallaría si faltan.
- Módulo `cambios-mercaderia` implementado: `POST /api/cambios-mercaderia` (alta de cambio posventa; roles VENDEDOR, GESTOR_COMERCIAL y GERENTE; el usuario sale del token). Body: `idVentaOriginal?`, `idProductoDevuelto`, `cantidadDevuelta`, `esBolsaAbierta?` (por defecto `false`), `idProductoEntregado`, `cantidadEntregada` e `idMedioPago?`. En una transacción ingresa el stock del devuelto, descuenta el del entregado (guarda `stockFisico gte`, 409 si no alcanza; con el mismo producto en ambos lados el stock debe cubrir lo entregado sin contar lo que ingresa) y crea el cambio en la caja ABIERTA más reciente (409 si no hay, aunque el saldo sea 0 porque `idCaja` es obligatorio). Saldo = entregado − devuelto en centavos: negativo 400 (no hay reembolsos), 0 deja `idMedioPago` nulo e ignora el del body, mayor a 0 exige un medio activo; sin recargo, descuento, vuelto ni comprobante, y no toca `SesionCaja.saldoActual` (un total de caja futuro suma, además de las ventas `COMPLETADA`, el `saldoResultante` de los cambios `ACTIVO` de esa caja). Bolsa abierta: solo si el devuelto es UNIDAD con `idProductoGranel` apuntando a un producto GRANEL ACTIVO y `pesoUnitario` > 0; ingresan al granel `cantidadDevuelta × pesoUnitario` kilos (el peso sale del producto, no lo informa el vendedor) y `cantidadStockIngresado` guarda esa cantidad (unidades si no es bolsa abierta, kilos si lo es). Con `idVentaOriginal` la venta debe estar `COMPLETADA` (409 si `ANULADA` o `PENDIENTE_PAGO`), el devuelto debe figurar en sus detalles (400) y la cantidad no puede superar lo vendido menos lo devuelto en cambios `ACTIVO` de ese ticket (409); el devuelto vale el precio del detalle (sin prorratear el descuento manual) y, sin ticket, el precio vigente. Entregado: ACTIVO (400 si no); devuelto: puede estar inactivo. Orden de evaluación en `calcularCambio` (404, 400, ticket, saldo y medio) y luego caja y stock en el repository. Solo existe el alta: Baja, Modificación e Historial de Cambios no están implementados.
- `GET /api/productos` suma `permiteBolsaAbierta` a cada producto, con la misma regla que valida el alta de un cambio: `evaluarBolsaAbierta` / `permiteBolsaAbierta` viven en `inventario.service.ts` y el service de cambios las importa.
- `productos.peso_unitario DECIMAL(10,3) NULL` (kilos por unidad) y `cambios_mercaderia.cantidad_stock_ingresado DECIMAL(10,3) NOT NULL` se aplican a mano en Supabase; Prisma solo las mapea (`Producto.pesoUnitario`, `CambioMercaderia.cantidadStockIngresado`). El SQL va antes que el código que las usa: el alta y la anulación de ventas leen y actualizan productos sin `select`, y fallarían si falta `peso_unitario`.
- Deuda técnica de cambios: la cantidad máxima devolvible de un ticket se valida sin guarda atómica (dos cambios simultáneos sobre el mismo ticket y producto podrían devolver más de lo vendido); los errores de negocio se importan de `ventas.errors.ts` y deberían vivir en `shared`; `construirRespuestaValidacion`, los conversores de centavos y milésimas y `conDecimalesMaximos` están copiados en los módulos que los usan; la regla de bolsa abierta está en inventario y cambios la importa (cruce entre módulos); el alta no valida que el usuario del token siga activo; Baja Venta no mira los cambios `ACTIVO` vinculados (anular la venta repone todo el stock y revierte todo el cobro aunque ya se haya devuelto parte); no hay tests automáticos.
- **Preparado para deploy (Render + Supabase compartida):** el código transversal vive en `src/shared/` y se monta en `src/server.ts`.
  - **Errores en JSON** (`manejo-errores.ts`), siempre con la forma `{ exito: false, mensaje }`: 404 por ruta inexistente, 400 por JSON inválido, 413 por cuerpo mayor a 100 kb, 415 por codificación no soportada y 500 genérico por error inesperado (el stack va solo a `console.error`, nunca a la respuesta). Los mensajes de 400/413/415/500 son fijos: no se devuelve el `message` del error. Los errores que ya controla cada módulo (400, 401, 403, 404, 409) no cambian.
  - **Orden en `server.ts`:** 404, luego `manejarErrorLecturaCuerpo` y al final `manejarErrorInesperado` (firma de 4 argumentos), todo después de las rutas y de `/docs`.
  - **`GET /api/salud`** (`salud.ts`): público y sin Prisma, responde 200 `{ exito: true, estado: "ok" }`. Documentado en `openapi.ts`.
  - **Zod en castellano:** `configurarZodEnCastellano()` (`configuracion-zod.ts`) llama una sola vez a `z.config(z.locales.es())` al arrancar. Los mensajes propios de cada esquema no se tocan.
  - **Scripts:** `build` = `prisma generate && tsc -p tsconfig.json` y `start` = `node dist/server.js`. `prisma generate` exige `DIRECT_URL` (la lee `prisma.config.ts`) aunque no se conecte a la base, por eso hay que definirla también en el build de Render. `engines.node` = `^22.12.0 || ^24.0.0` (Prisma 7).
  - **Render:** Build Command `npm ci --include=dev && npm run build` (`typescript` y `prisma` están en devDependencies) y Start Command `npm start`.

# Criterio sobre el SSOT
- La fuente de verdad es `../petflow-workspace/SSOT.md`, pero no es una biblia: puede faltar algo o estar desactualizado. Se respeta salvo que Nahuel indique lo contrario.
- Ante un hueco o una contradicción, no lo resuelvas en silencio: avisalo. Si es imprescindible para el front o el back y Nahuel lo autoriza, se actualiza primero el SSOT y después se desarrolla. Lo que no sea imprescindible no se desarrolla.
- Las acciones del Cuadro no se renombran; las sub-acciones se pueden agregar o cambiar. Back y Front tienen estado propio en el Cuadro.
- El SSOT solo se edita desde una sesión de CC abierta en `petflow-workspace`; desde este repo se prepara el texto propuesto y se informa.
- Nada se agrega a los registros de cambios del SSOT sin autorización de Nahuel.
