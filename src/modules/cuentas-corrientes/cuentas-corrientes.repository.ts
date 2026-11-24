import { Prisma } from "../../generated/prisma/client.js";
import { SELECCION_DATOS_ENVIO_VENTA } from "../../shared/datos-envio-venta.js";
import { aDecimal, Decimal } from "../../shared/decimal.js";
import { fechaCalendarioATexto } from "../../shared/fecha-calendario.js";
import { prisma } from "../../shared/prisma.js";
import { crearErrorNegocio } from "../ventas/ventas.errors.js";
import {
  crearErrorCobroSimultaneo,
  crearErrorFiadoNoPendiente,
  crearErrorSinCajaParaCobrar,
} from "./cuentas-corrientes.errors.js";
import type {
  CampoOrdenCuentasCorrientes,
  CobroCalculado,
  CobroLeido,
  CobroRegistrado,
  EstadoCuentaLeido,
  FilaCuentaCorriente,
  FiadoConPagosLeido,
  FiadoLeido,
  FiltroCuentasCorrientes,
  FiltroProximoPago,
  LecturaCobro,
  OrdenCuentasCorrientes,
  PaginaCuentasCorrientes,
  RegistrarCobroInput,
  SentidoOrdenCuentasCorrientes,
} from "./cuentas-corrientes.types.js";

// --- CONSTANTES ---

/**
 * Columnas de un fiado que se leen para calcular lo que falta pagar: las comparten el estado de cuenta y el cobro,
 * para que ambos lean (y por lo tanto calculen) exactamente lo mismo. Los cobros ya aplicados van en el mismo `select`.
 */
const SELECCION_FIADO = {
  idVenta: true,
  numeroComprobante: true,
  fechaHora: true,
  fechaEstimadaPago: true,
  subtotalBruto: true,
  descuentoManual: true,
  detallesCobroDeudor: { select: { monto: true } },
} satisfies Prisma.VentaSelect;

/** Fila de venta leida con `SELECCION_FIADO`. */
type FiadoLeidoDePrisma = Prisma.VentaGetPayload<{ select: typeof SELECCION_FIADO }>;

/**
 * Lo mismo que `SELECCION_FIADO`, pero cada cobro trae ademas su id, su recibo y su fecha: solo lo usa el estado de cuenta, que
 * los muestra. Es una seleccion aparte (y no se amplia la compartida) para que el cobro, que lee los fiados bloqueados, no
 * cargue joins que no necesita. Los cobros van ordenados por fecha ascendente con desempate por id: `monto` sigue siendo lo
 * aplicado a ESTE fiado (`detalles_cobro_deudor`), y la suma de los `monto` es el mismo `yaPagado` de siempre.
 * Suma ademas los datos de envio de la venta (`SELECCION_DATOS_ENVIO_VENTA`), que el estado de cuenta muestra y el cobro no usa.
 */
const SELECCION_FIADO_CON_PAGOS = {
  ...SELECCION_FIADO,
  ...SELECCION_DATOS_ENVIO_VENTA,
  detallesCobroDeudor: {
    orderBy: [{ cobro: { fechaHora: "asc" } }, { idCobroDeudor: "asc" }],
    select: {
      idCobroDeudor: true,
      monto: true,
      cobro: { select: { numeroRecibo: true, fechaHora: true } },
    },
  },
} satisfies Prisma.VentaSelect;

/** Fila de venta leida con `SELECCION_FIADO_CON_PAGOS`. */
type FiadoConPagosDePrisma = Prisma.VentaGetPayload<{ select: typeof SELECCION_FIADO_CON_PAGOS }>;

/**
 * Tiempo maximo de la transaccion del cobro, en milisegundos (el predeterminado de Prisma, escrito a proposito).
 * Incluye la espera del bloqueo de los fiados: si otro cobro los retiene mas que esto, la transaccion se aborta
 * y el cobro responde 409 `COBRO_SIMULTANEO` sin haber guardado nada.
 */
const TIEMPO_MAXIMO_TRANSACCION_COBRO_MS = 5000;

/**
 * Codigos de error de Prisma que significan "otra operacion tenia bloqueado lo mismo": `P2028` (la transaccion vencio
 * o no consiguio conexion) y `P2034` (la base aborto por un conflicto de escritura o un deadlock). Ambos son reintentables.
 */
const CODIGOS_PRISMA_COBRO_SIMULTANEO: ReadonlyArray<string> = ["P2028", "P2034"];

/** Columnas que se leen de un deudor: las cuatro que devuelve la API. Copia local de la de `deudores.repository.ts` (deuda técnica: duplicación mínima). */
const SELECCION_DEUDOR = {
  idDeudor: true,
  nombreCompleto: true,
  telefono: true,
  dni: true,
} satisfies Prisma.DeudorSelect;

/** Carácter de escape del `LIKE` de la búsqueda de texto. Se eligió `!` (y no `\`) para no mezclar escapes de JavaScript y de SQL. */
const CARACTER_ESCAPE_LIKE = "!";

// --- TIPOS DEL REPOSITORIO ---

/**
 * Fila cruda del listado, con los nombres físicos de las columnas. Los `numeric` salen como texto, los conteos como entero
 * y las fechas como texto (ver `SQL_SALDOS_POR_DEUDOR` y `buscarPaginaCuentasCorrientes`).
 */
type FilaSqlCuentaCorriente = {
  id_deudor: number;
  nombre_completo: string;
  dni: string;
  saldo_texto: string;
  cantidad_fiados_pendientes: number;
  /** Instante UTC en ISO 8601 (`AAAA-MM-DDTHH:MI:SS.mmmZ`); nulo si no hay fiados pendientes. */
  fiado_desde_texto: string | null;
  /** `AAAA-MM-DD`; nulo si ningún fiado pendiente tiene fecha estimada. */
  proxima_fecha_estimada_pago_texto: string | null;
};

/** Fila cruda del conteo del listado. */
type FilaSqlTotal = {
  total: number;
};

// --- SQL CRUDO: SALDO POR DEUDOR ---

/**
 * Escapa los caracteres que `LIKE` interpreta como comodines (`%` y `_`) y el propio carácter de escape,
 * para que el texto buscado se compare de forma literal. A diferencia de `textoCliente` del historial y de la búsqueda de
 * deudores (donde `%` y `_` siguen siendo comodines, deuda registrada), acá "%" busca un "%" de verdad.
 */
function escaparComodinesLike(texto: string): string {
  return texto.replace(/[!%_]/g, `${CARACTER_ESCAPE_LIKE}$&`);
}

/**
 * SQL común del listado: calcula el saldo de cada deudor. Lo comparten la consulta de la página y la del total,
 * para que el total sea coherente con la lista.
 *
 * ATENCIÓN (SQL crudo): los nombres de tablas y columnas están escritos a mano (`ventas`, `deudores`, `detalles_cobro_deudor`,
 * `estado`, `id_deudor`, etc.). TypeScript NO los valida: si una columna cambia en la base, esto falla recién al ejecutarse.
 * Reglas para todo SQL crudo del proyecto: siempre `Prisma.sql` (los valores van como parámetros, nunca concatenados),
 * `::text` en los `numeric` (llegan exactos y se convierten con `aDecimal`) y `::int` en los conteos (si no, llegan como `bigint`).
 *
 * El importe adeudado (`subtotal_bruto - descuento_manual`) repite en SQL la regla de `calcularImporteAdeudado`
 * (`shared/importe-adeudado.ts`), que usa el estado de cuenta. Si cambia una, hay que cambiar la otra.
 * La resta se hace por fiado (y no sobre sumas) para que un fiado con varios cobros no cuente dos veces su importe.
 *
 * Solo cuentan los fiados: ventas `PENDIENTE_PAGO` con deudor. `yaPagado` es la suma de `detalles_cobro_deudor.monto`.
 * Las dos fechas del listado salen de los mismos fiados pendientes: `fiado_desde` es la `fecha_hora` más antigua y
 * `proxima_fecha_estimada_pago` la `fecha_estimada_pago` más temprana (incluye las ya vencidas). `MIN` ignora los nulos,
 * así que valen `NULL` si el deudor no tiene fiados pendientes o si ninguno tiene fecha estimada.
 * Deja definida la tabla `cuentas` (un deudor por fila, con saldo 0 si no tiene fiados pendientes).
 */
const SQL_SALDOS_POR_DEUDOR = Prisma.sql`
  WITH faltas AS (
    SELECT v.id_deudor,
           v.fecha_hora,
           v.fecha_estimada_pago,
           (v.subtotal_bruto - v.descuento_manual) - COALESCE(SUM(d.monto), 0) AS falta
    FROM ventas v
    LEFT JOIN detalles_cobro_deudor d ON d.id_venta = v.id_venta
    WHERE v.estado = 'PENDIENTE_PAGO' AND v.id_deudor IS NOT NULL
    GROUP BY v.id_venta, v.id_deudor, v.fecha_hora, v.fecha_estimada_pago, v.subtotal_bruto, v.descuento_manual
  ),
  saldos AS (
    SELECT id_deudor,
           SUM(falta) AS saldo,
           COUNT(*) AS cantidad_fiados_pendientes,
           MIN(fecha_hora) AS fiado_desde,
           MIN(fecha_estimada_pago) AS proxima_fecha_estimada_pago
    FROM faltas
    GROUP BY id_deudor
  ),
  cuentas AS (
    SELECT de.id_deudor,
           de.nombre_completo,
           de.dni,
           COALESCE(s.saldo, 0) AS saldo,
           COALESCE(s.cantidad_fiados_pendientes, 0) AS cantidad_fiados_pendientes,
           s.fiado_desde,
           s.proxima_fecha_estimada_pago
    FROM deudores de
    LEFT JOIN saldos s ON s.id_deudor = de.id_deudor
  )
`;

// --- SQL CRUDO: ORDEN DEL LISTADO ---

/**
 * Orden de siempre del listado: saldo descendente, desempate por nombre y luego por id ascendentes.
 * Se usa cuando el cliente no pide `ordenarPor`.
 */
const SQL_ORDEN_PREDETERMINADO = Prisma.sql`ORDER BY saldo DESC, nombre_completo ASC, id_deudor ASC`;

/**
 * Columna de la tabla `cuentas` por la que ordena cada valor de `ordenarPor`. Mapa cerrado y tipado (`Record` exige una entrada
 * por cada valor del enumerado): el SQL sale de estas constantes y NUNCA del texto recibido, así no hay inyección posible.
 * Cada nombre es una columna de `cuentas`, no un alias de salida: con `saldo` se ordena el `numeric` (no el texto `saldo_texto`)
 * y las fechas se ordenan como fecha (no como el texto `*_texto`). `nombre_completo` y `cantidad_fiados_pendientes` coinciden
 * con su alias de salida, pero ese alias tiene el mismo valor y tipo comparable, así que el orden es el mismo.
 */
const SQL_COLUMNA_ORDEN: Record<CampoOrdenCuentasCorrientes, Prisma.Sql> = {
  nombre: Prisma.sql`nombre_completo`,
  fiadosPendientes: Prisma.sql`cantidad_fiados_pendientes`,
  saldo: Prisma.sql`saldo`,
  fechaFiado: Prisma.sql`fiado_desde`,
  proximoPago: Prisma.sql`proxima_fecha_estimada_pago`,
};

/** Sentido del orden como fragmento fijo de SQL (mismo criterio que `SQL_COLUMNA_ORDEN`). */
const SQL_SENTIDO_ORDEN: Record<SentidoOrdenCuentasCorrientes, Prisma.Sql> = {
  asc: Prisma.sql`ASC`,
  desc: Prisma.sql`DESC`,
};

/**
 * Arma el `ORDER BY` del listado. Siempre termina en desempates fijos (nombre y luego id ascendentes): sin ellos la paginación
 * podría repetir o saltarse filas que empatan en la columna elegida.
 * `NULLS LAST` va explícito porque PostgreSQL pone los nulos PRIMERO en `DESC`: así los nulos (deudores sin fiados pendientes o
 * sin fecha estimada) quedan siempre al final, sea cual sea el sentido. Para `nombre` no hace falta: `nombre_completo` nunca es nulo.
 * @param orden Orden pedido, o `undefined` para el orden de siempre.
 */
function construirOrden(orden: OrdenCuentasCorrientes | undefined): Prisma.Sql {
  if (orden === undefined) {
    return SQL_ORDEN_PREDETERMINADO;
  }
  const columna = SQL_COLUMNA_ORDEN[orden.campo];
  const sentido = SQL_SENTIDO_ORDEN[orden.sentido];

  if (orden.campo === "nombre") {
    // Dos deudores con el mismo nombre se desempatan por id, que es único
    return Prisma.sql`ORDER BY ${columna} ${sentido}, id_deudor ASC`;
  }
  return Prisma.sql`ORDER BY ${columna} ${sentido} NULLS LAST, nombre_completo ASC, id_deudor ASC`;
}

/**
 * Arma la condición del filtro `proximoPago` sobre la tabla `cuentas`. Se compara contra `proxima_fecha_estimada_pago`
 * (la fecha estimada más temprana entre los fiados pendientes, incluidas las vencidas). Las fechas ya vienen resueltas por el
 * service (aquí no hay "hoy" ni "semana") y van como parámetros con `::date`; el SQL sale solo de estos fragmentos fijos.
 * Todas las variantes exigen al menos un fiado pendiente: sin eso la fecha es nula y `sinFecha` incluiría a todos los
 * deudores sin deuda (que tampoco tienen fecha), cuando solo debe traer a los que sí deben pero no tienen fecha.
 * Un `ELSE` imposible no hace falta: `FiltroProximoPago` es una unión cerrada y TypeScript verifica que se cubran todas.
 */
function construirCondicionProximoPago(filtro: FiltroProximoPago): Prisma.Sql {
  const conFiadosPendientes = Prisma.sql`cantidad_fiados_pendientes > 0`;
  switch (filtro.tipo) {
    case "hoy":
    case "estaSemana":
      return Prisma.sql`${conFiadosPendientes} AND proxima_fecha_estimada_pago BETWEEN ${filtro.fechaDesde}::date AND ${filtro.fechaHasta}::date`;
    case "vencidos":
      return Prisma.sql`${conFiadosPendientes} AND proxima_fecha_estimada_pago < ${filtro.fechaAntesDe}::date`;
    case "sinFecha":
      return Prisma.sql`${conFiadosPendientes} AND proxima_fecha_estimada_pago IS NULL`;
  }
}

/**
 * Arma el `WHERE` del listado sobre la tabla `cuentas` de `SQL_SALDOS_POR_DEUDOR`: el filtro de saldo, el de texto y el de próximo pago.
 * Lo usan la consulta de la página y la del total, por eso los dos filtran igual.
 * Los valores van como parámetros de `Prisma.sql`; el texto solo se arma en el patrón, con sus comodines escapados.
 */
function construirCondicionCuentas(filtro: FiltroCuentasCorrientes): Prisma.Sql {
  const condiciones: Prisma.Sql[] = [];

  // Por defecto solo los que deben. Con `incluirSinDeuda` no se filtra por saldo
  if (!filtro.incluirSinDeuda) {
    condiciones.push(Prisma.sql`saldo > 0`);
  }
  // Con `proximoPago` solo cuentan los deudores con fiados pendientes, sea cual sea `incluirSinDeuda` (lo exige la propia condición)
  if (filtro.proximoPago !== undefined) {
    condiciones.push(construirCondicionProximoPago(filtro.proximoPago));
  }
  // Nombre o DNI, parcial y sin distinguir mayúsculas (ILIKE), con los comodines del texto escapados
  if (filtro.texto !== undefined) {
    const patron = `%${escaparComodinesLike(filtro.texto)}%`;
    condiciones.push(Prisma.sql`(nombre_completo ILIKE ${patron} ESCAPE '!' OR dni ILIKE ${patron} ESCAPE '!')`);
  }

  return condiciones.length > 0 ? Prisma.sql`WHERE ${Prisma.join(condiciones, " AND ")}` : Prisma.empty;
}

// --- LISTADO DE DEUDORES CON SALDO ---

/**
 * Busca una página de deudores con su saldo y el total que cumple el filtro.
 * El filtro de saldo, el orden y la paginación se resuelven en la base (SQL crudo): Prisma no puede filtrar ni ordenar
 * por un saldo calculado con una suma de otra tabla, y cargar todos los deudores en memoria no escala.
 * Orden: el pedido en `filtro.orden` (ver `construirOrden`) o, sin él, saldo descendente (sobre el `numeric`, no sobre el texto),
 * desempate por nombre ascendente y luego por id ascendente; sin desempate la paginación podría repetir o saltarse filas.
 * El orden alfabético depende de la intercalación de la base.
 * Las fechas (`fiado_desde` y `proxima_fecha_estimada_pago`) salen como texto armado por la base con `to_char`: así no dependen
 * de cómo el adaptador devuelve `timestamptz` y `date` (la regla de siempre para los tipos que no son texto ni entero).
 * La página y el total salen de una transacción `RepeatableRead` (la misma foto de la base). El total es una consulta aparte
 * y no `COUNT(*) OVER()`: con una página fuera de rango no hay filas y el total saldría 0.
 * @param filtro Filtro ya traducido.
 * @param desplazamiento Cantidad de filas a saltar.
 * @param cantidadPorPagina Cantidad máxima de filas a devolver.
 */
export async function buscarPaginaCuentasCorrientes(
  filtro: FiltroCuentasCorrientes,
  desplazamiento: number,
  cantidadPorPagina: number,
): Promise<PaginaCuentasCorrientes> {
  const condicion = construirCondicionCuentas(filtro);
  const orden = construirOrden(filtro.orden);

  const [filas, totales] = await prisma.$transaction(
    [
      // Los alias de salida de las columnas `numeric` y de fecha (`saldo_texto`, `fiado_desde_texto` y
      // `proxima_fecha_estimada_pago_texto`) son distintos del nombre de la columna por la que se ordena: en un ORDER BY un
      // nombre que coincide con una columna de salida se interpreta como esa columna; con `saldo` ordenaría el texto
      // ("9.00" después de "10.00") en lugar del numérico. El instante sale en UTC y con el formato de `Date.toISOString()`
      prisma.$queryRaw<FilaSqlCuentaCorriente[]>`
        ${SQL_SALDOS_POR_DEUDOR}
        SELECT id_deudor,
               nombre_completo,
               dni,
               saldo::text AS saldo_texto,
               cantidad_fiados_pendientes::int AS cantidad_fiados_pendientes,
               to_char(fiado_desde AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fiado_desde_texto,
               to_char(proxima_fecha_estimada_pago, 'YYYY-MM-DD') AS proxima_fecha_estimada_pago_texto
        FROM cuentas
        ${condicion}
        ${orden}
        LIMIT ${cantidadPorPagina} OFFSET ${desplazamiento}
      `,
      prisma.$queryRaw<FilaSqlTotal[]>`
        ${SQL_SALDOS_POR_DEUDOR}
        SELECT COUNT(*)::int AS total FROM cuentas
        ${condicion}
      `,
    ],
    { isolationLevel: "RepeatableRead" },
  );

  return {
    filas: filas.map(
      (fila): FilaCuentaCorriente => ({
        idDeudor: fila.id_deudor,
        nombreCompleto: fila.nombre_completo,
        dni: fila.dni,
        saldo: aDecimal(fila.saldo_texto),
        cantidadFiadosPendientes: fila.cantidad_fiados_pendientes,
        // El texto ya es un instante ISO en UTC: `new Date` lo lee sin corrimiento
        fiadoDesde: fila.fiado_desde_texto === null ? null : new Date(fila.fiado_desde_texto),
        proximaFechaEstimadaPago: fila.proxima_fecha_estimada_pago_texto,
      }),
    ),
    totalRegistros: totales[0]?.total ?? 0,
  };
}

// --- ESTADO DE CUENTA DE UN DEUDOR ---

/**
 * Lee un deudor y sus fiados pendientes con lo ya cobrado de cada uno, en una sola foto de la base (`RepeatableRead`).
 * Un fiado es una venta `PENDIENTE_PAGO` con ese deudor: las `COMPLETADA` y las `ANULADA` no cuentan.
 * Los cobros de cada fiado (con su recibo y fecha) van en el mismo `select` de la venta (sin consulta por fila).
 * Orden fijo: del más viejo al más nuevo (`fechaHora` ascendente, desempate por `idVenta` ascendente).
 * @param idDeudor Id del deudor, ya validado.
 * @returns El deudor (o `null` si no existe: el service decide el 404) y sus fiados pendientes.
 */
export async function buscarEstadoCuentaDeudor(idDeudor: number): Promise<EstadoCuentaLeido> {
  const [deudor, fiados] = await prisma.$transaction(
    [
      prisma.deudor.findUnique({ where: { idDeudor }, select: SELECCION_DEUDOR }),
      prisma.venta.findMany({
        where: { idDeudor, estado: "PENDIENTE_PAGO" },
        orderBy: [{ fechaHora: "asc" }, { idVenta: "asc" }],
        select: SELECCION_FIADO_CON_PAGOS,
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );

  return { deudor, fiados: fiados.map(convertirFiadoConPagosLeido) };
}

// --- CONVERSION DE UN FIADO LEIDO ---

/** Convierte un fiado leido de Prisma al Decimal aislado, y su fecha de calendario a texto. Lo usan el estado de cuenta y el cobro. */
function convertirFiadoLeido(fiado: FiadoLeidoDePrisma): FiadoLeido {
  return {
    idVenta: fiado.idVenta,
    numeroComprobante: fiado.numeroComprobante,
    fechaHora: fiado.fechaHora,
    fechaEstimadaPago: fechaCalendarioATexto(fiado.fechaEstimadaPago),
    subtotalBruto: aDecimal(fiado.subtotalBruto),
    descuentoManual: aDecimal(fiado.descuentoManual),
    montosCobrados: fiado.detallesCobroDeudor.map((detalle) => aDecimal(detalle.monto)),
  };
}

/**
 * Convierte un fiado leido con sus cobros detallados: lo mismo que `convertirFiadoLeido` mas `pagos`.
 * `montosCobrados` sale de los mismos detalles que `pagos`, asi que `yaPagado` y la suma de los `monto` coinciden por construccion.
 */
function convertirFiadoConPagosLeido(fiado: FiadoConPagosDePrisma): FiadoConPagosLeido {
  return {
    ...convertirFiadoLeido(fiado),
    // Tal como estan guardados: la direccion y el destinatario son nulos con retiro o si no se cargaron
    modalidadEntrega: fiado.modalidadEntrega,
    direccionEnvio: fiado.direccionEnvio,
    destinatarioEnvio: fiado.destinatarioEnvio,
    pagos: fiado.detallesCobroDeudor.map((detalle) => ({
      idCobroDeudor: detalle.idCobroDeudor,
      numeroRecibo: detalle.cobro.numeroRecibo,
      fechaHora: detalle.cobro.fechaHora,
      monto: aDecimal(detalle.monto),
    })),
  };
}

// ===== COBRO DE FIADOS =====

/** Funcion de calculo que inyecta el service: recibe lo leido (con los fiados ya bloqueados) y devuelve el cobro calculado. */
type CalcularCobro = (lectura: LecturaCobro) => CobroCalculado;

/** Arma el numero de recibo a partir del id del cobro. @example formatearRecibo(1) // "REC-00000001" */
function formatearRecibo(idCobroDeudor: number): string {
  return `REC-${String(idCobroDeudor).padStart(8, "0")}`;
}

/** Indica si un error capturado es de Prisma y significa que otra operacion tenia bloqueado lo mismo (reintentable). */
function esErrorDeCobroSimultaneo(valor: unknown): boolean {
  return (
    typeof valor === "object" &&
    valor !== null &&
    typeof (valor as { code?: unknown }).code === "string" &&
    CODIGOS_PRISMA_COBRO_SIMULTANEO.includes((valor as { code: string }).code)
  );
}

/**
 * Registra el cobro de uno o varios fiados de un deudor en una unica transaccion.
 * Es la unica capa que toca Prisma en esta accion. Si algo falla (usuario, deudor, fiado, monto, medio, caja, BD)
 * se revierte todo: no queda un cobro a medias, ni un detalle suelto, ni un fiado completado sin su cobro.
 *
 * Concurrencia (dos cobros sobre el mismo fiado no pueden dejar un pago de mas): los fiados pedidos se bloquean con
 * `SELECT ... FOR UPDATE` ordenado por `id_venta` (todos los cobros toman los bloqueos en el mismo orden: sin deadlocks) y
 * RECIEN DESPUES se leen con sus cobros. Se usa el aislamiento predeterminado (READ COMMITTED) a proposito: cada sentencia
 * ve lo confirmado por quien tenia el bloqueo antes, asi que el segundo cobro calcula con la falta vigente y responde 409
 * (`MONTO_EXCEDE_FALTA` o `FIADO_NO_PENDIENTE`) en lugar de pagar de mas. El mismo bloqueo ordena este cobro con Liquidar Fiado y
 * con la anulacion (que toman la fila con su `updateMany`). Si la espera supera `TIEMPO_MAXIMO_TRANSACCION_COBRO_MS`,
 * responde 409 `COBRO_SIMULTANEO` (reintentar).
 *
 * El fiado conserva `id_caja` en null y su `monto_total`: la caja vive en el cobro. Un fiado se completa (`COMPLETADA` y
 * `fecha_hora_pago` = fecha del cobro) en la misma transaccion en que su falta llega a 0.
 * @param input Parametro de ruta, body validado y usuario del token.
 * @param calcular Calculo de negocio, ejecutado dentro de la transaccion con datos recien leidos.
 * @returns El calculo guardado y lo persistido (recibo, fecha y fiados pendientes que le quedan al deudor).
 * @throws {ErrorNegocio} Usuario inexistente o inactivo (404/400), las del calculo (404/409/400), no hay caja abierta (409),
 * un fiado dejo de estar pendiente entre el bloqueo y el cambio de estado (409) o cobro simultaneo (409 `COBRO_SIMULTANEO`).
 * Se lanza como objeto puro, no como Error.
 */
export async function registrarCobroAtomico(input: RegistrarCobroInput, calcular: CalcularCobro): Promise<CobroRegistrado> {
  try {
    return await prisma.$transaction(
      async (transaccion) => {
        // --- VALIDACION DEL USUARIO ---
        // Igual que el alta de venta: el middleware solo verifica el token, no que el usuario siga existiendo y activo
        const usuario = await transaccion.usuario.findUnique({
          where: { idUsuario: input.idUsuario },
          select: { estado: true },
        });
        if (!usuario) {
          throw crearErrorNegocio(`El usuario ${input.idUsuario} no existe`, 404);
        }
        if (usuario.estado !== "ACTIVO") {
          throw crearErrorNegocio(`El usuario ${input.idUsuario} está inactivo`, 400);
        }

        // --- DEUDOR, BLOQUEO Y LECTURA ---
        const deudor = await transaccion.deudor.findUnique({
          where: { idDeudor: input.idDeudor },
          select: SELECCION_DEUDOR,
        });

        // Sin deudor no hay nada que bloquear: el calculo responde el 404
        let fiados: Array<FiadoLeidoDePrisma & { estado: LecturaCobro["fiados"][number]["estado"] }> = [];
        if (deudor !== null) {
          // El filtro por deudor deja afuera lo que no le pertenece: no se bloquea ni se revela una venta ajena.
          // Prisma no tiene FOR UPDATE: SQL crudo (Prisma.sql: los valores van como parametros, nunca concatenados).
          // ORDER BY id_venta fija el orden en que se toman los bloqueos, igual para todos los cobros
          const bloqueadas = await transaccion.$queryRaw<Array<{ id_venta: number }>>(Prisma.sql`
            SELECT id_venta
            FROM ventas
            WHERE id_deudor = ${input.idDeudor}
              AND id_venta IN (${Prisma.join(input.fiados.map((fiado) => fiado.idVenta))})
            ORDER BY id_venta
            FOR UPDATE
          `);

          // Se lee DESPUES de bloquear: en READ COMMITTED esta sentencia ya ve los cobros y estados que confirmo
          // quien tenia el bloqueo antes (leer antes mostraria una falta vieja)
          fiados = await transaccion.venta.findMany({
            where: { idVenta: { in: bloqueadas.map((fila) => fila.id_venta) } },
            orderBy: { idVenta: "asc" },
            select: { ...SELECCION_FIADO, estado: true },
          });
        }

        const medios = await transaccion.medioPago.findMany({
          where: { idMedioPago: { in: input.pagos.map((pago) => pago.idMedioPago) } },
        });

        // --- CALCULO ---
        // El ajuste del medio en basis points (recargo menos descuento) con Decimal: un porcentaje de 2 decimales por 100 es entero exacto
        const calculo = calcular({
          deudor,
          fiados: fiados.map((fiado) => ({ ...convertirFiadoLeido(fiado), estado: fiado.estado })),
          medios: medios.map((medio) => ({
            idMedioPago: medio.idMedioPago,
            nombre: medio.nombre,
            // El tipo decide en el service si el pago admite monto recibido (solo efectivo)
            tipo: medio.tipo,
            activo: medio.estado === "ACTIVO",
            ajusteBp: aDecimal(medio.porcentajeRecargo).minus(aDecimal(medio.porcentajeDescuento)).times(100).toNumber(),
          })),
        });

        // --- CAJA ---
        // El ingreso va a la caja abierta mas reciente (la caja se simula como siempre abierta, igual que en el alta y en
        // Liquidar Fiado). Queda en el cobro: el fiado conserva `id_caja` en null
        const caja = await transaccion.sesionCaja.findFirst({
          where: { estado: "ABIERTA" },
          orderBy: { fechaApertura: "desc" },
          select: { idCaja: true },
        });
        if (!caja) {
          throw crearErrorSinCajaParaCobrar();
        }

        // --- GUARDADO DEL COBRO ---
        // Un unico reloj: la fecha del cobro es tambien la `fecha_hora_pago` de los fiados que se completan.
        // Se toma despues de los bloqueos, no antes: la espera no atrasa el instante registrado
        const fechaHora = new Date();
        const cobro = await transaccion.cobroDeudor.create({
          data: {
            idDeudor: input.idDeudor,
            idCaja: caja.idCaja,
            idUsuario: input.idUsuario,
            fechaHora,
          },
          select: { idCobroDeudor: true },
        });

        // El recibo depende del id, asi que se asigna despues del insert, dentro de la misma transaccion:
        // si algo falla hace rollback y nunca queda un cobro sin recibo
        const numeroRecibo = formatearRecibo(cobro.idCobroDeudor);
        await transaccion.cobroDeudor.update({
          where: { idCobroDeudor: cobro.idCobroDeudor },
          data: { numeroRecibo },
        });

        await transaccion.detalleCobroDeudor.createMany({
          data: calculo.fiados.map((fiado) => ({
            idCobroDeudor: cobro.idCobroDeudor,
            idVenta: fiado.idVenta,
            // El Decimal exacto se envia como texto: sin pasar por coma flotante
            monto: fiado.montoAbonado.toFixed(2),
          })),
        });

        await transaccion.pagoCobroDeudor.createMany({
          data: calculo.pagos.map((pago) => ({
            idCobroDeudor: cobro.idCobroDeudor,
            idMedioPago: pago.idMedioPago,
            montoBase: new Decimal(pago.montoBaseCentavos).div(100).toFixed(2),
            porcentajeAplicado: new Decimal(pago.porcentajeAplicadoBp).div(100).toFixed(2),
            montoFinal: new Decimal(pago.montoFinalCentavos).div(100).toFixed(2),
            // Nulos si el medio no es efectivo o no se informo el recibido
            montoRecibido: pago.montoRecibidoCentavos === null ? null : new Decimal(pago.montoRecibidoCentavos).div(100).toFixed(2),
            vuelto: pago.vueltoCentavos === null ? null : new Decimal(pago.vueltoCentavos).div(100).toFixed(2),
          })),
        });

        // --- FIADOS QUE LLEGARON A CERO ---
        // Un fiado PENDIENTE_PAGO nunca debe quedar con falta 0: pasa a COMPLETADA en esta misma transaccion.
        // `monto_total` e `id_caja` no se tocan (la caja vive en el cobro). El where por estado es una defensa: el bloqueo
        // ya garantiza que nadie lo cambio, pero si el count no es 1 se aborta todo en lugar de dejar un estado inconsistente
        for (const fiado of calculo.fiados) {
          if (!fiado.faltaDespues.isZero()) {
            continue;
          }
          const completados = await transaccion.venta.updateMany({
            where: { idVenta: fiado.idVenta, estado: "PENDIENTE_PAGO" },
            data: { estado: "COMPLETADA", fechaHoraPago: fechaHora },
          });
          if (completados.count !== 1) {
            throw crearErrorFiadoNoPendiente(fiado.idVenta);
          }
        }

        // --- RELECTURA PARA EL SALDO ---
        // Los fiados pendientes del deudor ya con este cobro: de ahi sale `saldoDeudorDespues` con la misma formula
        // del estado de cuenta (misma lectura, mismo calculo). Un cobro de OTRO fiado del mismo deudor que se confirme
        // en este instante puede estar reflejado: el saldo es el de la base al leer, no el de antes menos lo abonado
        const pendientesDespues = await transaccion.venta.findMany({
          where: { idDeudor: input.idDeudor, estado: "PENDIENTE_PAGO" },
          orderBy: [{ fechaHora: "asc" }, { idVenta: "asc" }],
          select: SELECCION_FIADO,
        });

        return {
          calculo,
          persistido: {
            idCobroDeudor: cobro.idCobroDeudor,
            numeroRecibo,
            fechaHora,
            fiadosPendientesDespues: pendientesDespues.map(convertirFiadoLeido),
          },
        };
      },
      { timeout: TIEMPO_MAXIMO_TRANSACCION_COBRO_MS },
    );
  } catch (errorCapturado) {
    // Un bloqueo que no se libero a tiempo (o un conflicto que la base aborto) no es un error del servidor: no se guardo nada
    // y reintentar es valido. Cualquier otro valor (errores de negocio, BD caida) sigue su camino
    if (esErrorDeCobroSimultaneo(errorCapturado)) {
      throw crearErrorCobroSimultaneo();
    }
    throw errorCapturado;
  }
}

// ===== RECIBO DE UN COBRO =====

/**
 * Busca un cobro de deudor por id con todo lo que muestra su recibo: el deudor (solo id y nombre), el usuario que cobro,
 * los fiados cubiertos con lo aplicado a cada uno y los pagos con su medio. Es solo lectura.
 * Una sola consulta con `select` anidado (sin consulta por fila) y SIN transaccion de solo lectura: un cobro es inmutable
 * (no existe la anulacion de cobros y nadie modifica sus detalles ni sus pagos), asi que no hay una segunda escritura que pueda
 * mostrar una foto mezclada. Si algun dia se pudiera anular o corregir un cobro, esta lectura debera pasar a `RepeatableRead`.
 * El `select` pide solo lo que el contrato devuelve: nunca el DNI ni el telefono del deudor (RNF-VENTAS-03).
 * Fiados y pagos van ordenados por su id: es el orden en que se guardaron, que es el orden en que se pidieron.
 * @param idCobroDeudor Id del cobro, ya validado.
 * @returns El cobro, o `null` si no existe (el service decide el 404).
 */
export async function buscarCobroPorId(idCobroDeudor: number): Promise<CobroLeido | null> {
  const cobro = await prisma.cobroDeudor.findUnique({
    where: { idCobroDeudor },
    select: {
      idCobroDeudor: true,
      numeroRecibo: true,
      fechaHora: true,
      deudor: { select: { idDeudor: true, nombreCompleto: true } },
      usuario: { select: { idUsuario: true, nombre: true } },
      detalles: {
        orderBy: { idDetalleCobroDeudor: "asc" },
        select: {
          monto: true,
          venta: { select: { idVenta: true, numeroComprobante: true, ...SELECCION_DATOS_ENVIO_VENTA } },
        },
      },
      pagos: {
        orderBy: { idPagoCobroDeudor: "asc" },
        select: {
          montoBase: true,
          porcentajeAplicado: true,
          montoFinal: true,
          montoRecibido: true,
          vuelto: true,
          medioPago: { select: { idMedioPago: true, nombre: true } },
        },
      },
    },
  });

  if (cobro === null) {
    return null;
  }

  // Lo leido (Decimal de Prisma) se pasa al Decimal aislado para que el service calcule con aritmetica exacta
  return {
    idCobroDeudor: cobro.idCobroDeudor,
    numeroRecibo: cobro.numeroRecibo,
    fechaHora: cobro.fechaHora,
    deudor: cobro.deudor,
    usuario: cobro.usuario,
    fiados: cobro.detalles.map((detalle) => ({
      idVenta: detalle.venta.idVenta,
      numeroComprobante: detalle.venta.numeroComprobante,
      monto: aDecimal(detalle.monto),
      // Los datos de envio de la venta, tal como estan guardados (nulos con retiro o si no se cargaron)
      modalidadEntrega: detalle.venta.modalidadEntrega,
      direccionEnvio: detalle.venta.direccionEnvio,
      destinatarioEnvio: detalle.venta.destinatarioEnvio,
    })),
    pagos: cobro.pagos.map((pago) => ({
      idMedioPago: pago.medioPago.idMedioPago,
      nombreMedioPago: pago.medioPago.nombre,
      montoBase: aDecimal(pago.montoBase),
      porcentajeAplicado: aDecimal(pago.porcentajeAplicado),
      montoFinal: aDecimal(pago.montoFinal),
      // Nulos si el medio no es efectivo o no se informo el recibido
      montoRecibido: pago.montoRecibido === null ? null : aDecimal(pago.montoRecibido),
      vuelto: pago.vuelto === null ? null : aDecimal(pago.vuelto),
    })),
  };
}
