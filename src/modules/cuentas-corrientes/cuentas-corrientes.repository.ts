import { Prisma } from "../../generated/prisma/client.js";
import { aDecimal } from "../../shared/decimal.js";
import { fechaCalendarioATexto } from "../../shared/fecha-calendario.js";
import { prisma } from "../../shared/prisma.js";
import type {
  EstadoCuentaLeido,
  FilaCuentaCorriente,
  FiltroCuentasCorrientes,
  PaginaCuentasCorrientes,
} from "./cuentas-corrientes.types.js";

// --- CONSTANTES ---

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

/** Fila cruda del listado, con los nombres físicos de las columnas. Los `numeric` salen como texto y los conteos como entero. */
type FilaSqlCuentaCorriente = {
  id_deudor: number;
  nombre_completo: string;
  dni: string;
  saldo_texto: string;
  cantidad_fiados_pendientes: number;
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
 * Deja definida la tabla `cuentas` (un deudor por fila, con saldo 0 si no tiene fiados pendientes).
 */
const SQL_SALDOS_POR_DEUDOR = Prisma.sql`
  WITH faltas AS (
    SELECT v.id_deudor,
           (v.subtotal_bruto - v.descuento_manual) - COALESCE(SUM(d.monto), 0) AS falta
    FROM ventas v
    LEFT JOIN detalles_cobro_deudor d ON d.id_venta = v.id_venta
    WHERE v.estado = 'PENDIENTE_PAGO' AND v.id_deudor IS NOT NULL
    GROUP BY v.id_venta, v.id_deudor, v.subtotal_bruto, v.descuento_manual
  ),
  saldos AS (
    SELECT id_deudor, SUM(falta) AS saldo, COUNT(*) AS cantidad_fiados_pendientes
    FROM faltas
    GROUP BY id_deudor
  ),
  cuentas AS (
    SELECT de.id_deudor,
           de.nombre_completo,
           de.dni,
           COALESCE(s.saldo, 0) AS saldo,
           COALESCE(s.cantidad_fiados_pendientes, 0) AS cantidad_fiados_pendientes
    FROM deudores de
    LEFT JOIN saldos s ON s.id_deudor = de.id_deudor
  )
`;

/**
 * Arma el `WHERE` del listado sobre la tabla `cuentas` de `SQL_SALDOS_POR_DEUDOR`: el filtro de saldo y el de texto.
 * Los valores van como parámetros de `Prisma.sql`; el texto solo se arma en el patrón, con sus comodines escapados.
 */
function construirCondicionCuentas(filtro: FiltroCuentasCorrientes): Prisma.Sql {
  const condiciones: Prisma.Sql[] = [];

  // Por defecto solo los que deben. Con `incluirSinDeuda` no se filtra por saldo
  if (!filtro.incluirSinDeuda) {
    condiciones.push(Prisma.sql`saldo > 0`);
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
 * Orden fijo: saldo descendente (sobre el `numeric`, no sobre el texto), desempate por nombre ascendente y luego por id ascendente;
 * sin desempate la paginación podría repetir o saltarse filas. El orden alfabético depende de la intercalación de la base.
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

  const [filas, totales] = await prisma.$transaction(
    [
      // `saldo_texto` (y no `saldo`) como alias: en un ORDER BY un nombre que coincide con una columna de salida se interpreta
      // como esa columna; con `saldo` ordenaría el texto ("9.00" después de "10.00") en lugar del numérico
      prisma.$queryRaw<FilaSqlCuentaCorriente[]>`
        ${SQL_SALDOS_POR_DEUDOR}
        SELECT id_deudor,
               nombre_completo,
               dni,
               saldo::text AS saldo_texto,
               cantidad_fiados_pendientes::int AS cantidad_fiados_pendientes
        FROM cuentas
        ${condicion}
        ORDER BY saldo DESC, nombre_completo ASC, id_deudor ASC
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
      }),
    ),
    totalRegistros: totales[0]?.total ?? 0,
  };
}

// --- ESTADO DE CUENTA DE UN DEUDOR ---

/**
 * Lee un deudor y sus fiados pendientes con lo ya cobrado de cada uno, en una sola foto de la base (`RepeatableRead`).
 * Un fiado es una venta `PENDIENTE_PAGO` con ese deudor: las `COMPLETADA` y las `ANULADA` no cuentan.
 * Los cobros de cada fiado van en el mismo `select` de la venta (sin consulta por fila).
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
        select: {
          idVenta: true,
          numeroComprobante: true,
          fechaHora: true,
          fechaEstimadaPago: true,
          subtotalBruto: true,
          descuentoManual: true,
          detallesCobroDeudor: { select: { monto: true } },
        },
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );

  // Se convierte lo leído (Decimal de Prisma) al Decimal aislado, y la fecha de calendario a texto
  return {
    deudor,
    fiados: fiados.map((fiado) => ({
      idVenta: fiado.idVenta,
      numeroComprobante: fiado.numeroComprobante,
      fechaHora: fiado.fechaHora,
      fechaEstimadaPago: fechaCalendarioATexto(fiado.fechaEstimadaPago),
      subtotalBruto: aDecimal(fiado.subtotalBruto),
      descuentoManual: aDecimal(fiado.descuentoManual),
      montosCobrados: fiado.detallesCobroDeudor.map((detalle) => aDecimal(detalle.monto)),
    })),
  };
}
