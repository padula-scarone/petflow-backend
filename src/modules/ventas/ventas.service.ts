import { buscarHistorialVentas, registrarVentaAtomica } from "./ventas.repository.js";
import { crearErrorNegocio, crearErrorStockInsuficiente } from "./ventas.errors.js";
import { descomponerFechaCalendario } from "./ventas.schemas.js";
import type {
  ConsultarHistorialInput,
  ConsultarHistorialResponse,
  FilaHistorialVenta,
  FiltroHistorialVentas,
  MedioPagoVigente,
  ProductoVigente,
  RegistrarVentaInput,
  RegistrarVentaResponse,
  TotalesVentaCalculados,
  VentaHistorial,
} from "./ventas.types.js";

// --- CONSTANTES ---

/** Horas que Argentina (UTC-3, sin horario de verano) está por detrás de UTC. */
const HORAS_DESFASE_ARGENTINA_RESPECTO_UTC = 3;

// --- ORQUESTACIÓN ---

/**
 * Registra una venta: calcula con reglas puras y persiste en una única transacción.
 * El cálculo se inyecta al repositorio como función para que corra dentro de la transacción,
 * con los datos leídos en ese mismo momento.
 * @param input Cuerpo ya validado por Zod.
 * @returns Respuesta lista para enviar al frontend.
 * @throws {ErrorNegocio} Si alguna regla de negocio no se cumple (nada queda escrito).
 */
export async function registrarVenta(input: RegistrarVentaInput): Promise<RegistrarVentaResponse> {
  const venta = await registrarVentaAtomica(input, (productos, medios) =>
    calcularVenta(input, productos, medios),
  );

  const esFiado = venta.estado === "PENDIENTE_PAGO";

  return {
    exito: true,
    mensaje: esFiado
      ? "Venta registrada como pendiente de pago, stock descontado y ticket de deuda emitido"
      : "Venta registrada y stock descontado",
    venta: {
      idVenta: venta.idVenta,
      numeroComprobante: venta.numeroComprobante,
      montoTotal: formatearCentavos(venta.montoTotalCentavos),
      estado: venta.estado,
      fechaHora: venta.fechaHora.toISOString(),
    },
  };
}

// --- CÁLCULO PURO ---

/**
 * Aplica todas las reglas de negocio de una venta sin acceder a la base de datos.
 * Es pura a propósito: así se prueba con datos de ejemplo sin conectarse a Supabase.
 * @param input Cuerpo validado de la venta.
 * @param productos Productos leídos de la BD con sus valores vigentes.
 * @param medios Medios de pago leídos de la BD.
 * @returns Líneas, pagos, totales y estado final de la venta.
 * @throws {ErrorNegocio} Producto o medio inexistente/inactivo, cantidad inválida, descuento excesivo,
 * pagos que no cuadran o stock insuficiente en algún producto. Se lanza como objeto puro, no como Error.
 */
export function calcularVenta(
  input: RegistrarVentaInput,
  productos: ProductoVigente[],
  medios: MedioPagoVigente[],
): TotalesVentaCalculados {
  const productosPorId = new Map(productos.map((producto) => [producto.idProducto, producto]));
  const mediosPorId = new Map(medios.map((medio) => [medio.idMedioPago, medio]));

  // Cada línea congela precio y costo vigentes: cambios futuros de precio no alteran ventas pasadas
  const lineas = input.items.map((item) => {
    const producto = productosPorId.get(item.idProducto);
    if (!producto) {
      throw crearErrorNegocio(`El producto ${item.idProducto} no existe`, 404);
    }
    if (!producto.activo) {
      throw crearErrorNegocio(`El producto ${producto.nombre} está inactivo`, 400);
    }

    // Un producto por unidad no se puede vender fraccionado (1.5 bolsas no tiene sentido)
    const cantidadMilesimas = aMilesimas(item.cantidad);
    if (producto.formatoVenta === "UNIDAD" && cantidadMilesimas % 1000 !== 0) {
      throw crearErrorNegocio(
        `El producto ${producto.nombre} se vende por unidad: la cantidad debe ser entera`,
        400,
      );
    }
    if (cantidadMilesimas > producto.stockMilesimas) {
      throw crearErrorStockInsuficiente(producto.idProducto);
    }

    return {
      idProducto: producto.idProducto,
      cantidadMilesimas,
      precioUnitarioCentavos: producto.precioCentavos,
      costoUnitarioCentavos: producto.costoCentavos,
      subtotalCentavos: Math.round((producto.precioCentavos * cantidadMilesimas) / 1000),
    };
  });

  const subtotalBrutoCentavos = lineas.reduce((suma, linea) => suma + linea.subtotalCentavos, 0);

  // El descuento manual es un monto fijo y no puede dejar el total en negativo
  const descuentoManualCentavos = aCentavos(input.descuentoManual ?? 0);
  if (descuentoManualCentavos > subtotalBrutoCentavos) {
    throw crearErrorNegocio("El descuento no puede superar el subtotal", 400);
  }
  const aCobrarCentavos = subtotalBrutoCentavos - descuentoManualCentavos;

  // Fiado: sin pagos no hay medio de pago, así que no hay recargo ni impacto en caja
  if (input.pagos.length === 0) {
    return {
      lineas,
      pagos: [],
      subtotalBrutoCentavos,
      descuentoManualCentavos,
      montoTotalCentavos: aCobrarCentavos,
      estado: "PENDIENTE_PAGO",
    };
  }

  // El monto de cada pago es la porción base que aporta ese medio.
  // El recargo (o descuento) del medio se aplica sobre esa porción: final = base × (1 + neto)
  const pagos = input.pagos.map((pago) => {
    const medio = mediosPorId.get(pago.idMedioPago);
    if (!medio) {
      throw crearErrorNegocio(`El medio de pago ${pago.idMedioPago} no existe`, 404);
    }
    if (!medio.activo) {
      throw crearErrorNegocio(`El medio de pago ${pago.idMedioPago} está inactivo`, 400);
    }
    // Un descuento del 100% o más haría que el cliente pague cero o negativo
    if (10000 + medio.ajusteBp <= 0) {
      throw crearErrorNegocio(`El medio de pago ${pago.idMedioPago} tiene un ajuste inválido`, 400);
    }

    const montoBaseCentavos = aCentavos(pago.monto);
    return {
      idMedioPago: medio.idMedioPago,
      montoBaseCentavos,
      porcentajeAplicadoBp: medio.ajusteBp,
      montoFinalCentavos: Math.round((montoBaseCentavos * (10000 + medio.ajusteBp)) / 10000),
    };
  });

  // El cuadre se hace sobre las porciones base: es exacto y no depende de redondeos del recargo
  const sumaBaseCentavos = pagos.reduce((suma, pago) => suma + pago.montoBaseCentavos, 0);
  if (sumaBaseCentavos !== aCobrarCentavos) {
    throw crearErrorNegocio(
      `La suma de los pagos (${formatearCentavos(sumaBaseCentavos)}) no coincide con el total a cobrar (${formatearCentavos(aCobrarCentavos)})`,
      400,
    );
  }

  return {
    lineas,
    pagos,
    subtotalBrutoCentavos,
    descuentoManualCentavos,
    // El total es lo que paga el cliente, recargos incluidos
    montoTotalCentavos: pagos.reduce((suma, pago) => suma + pago.montoFinalCentavos, 0),
    estado: "COMPLETADA",
  };
}

// --- UTILIDADES DE MONEDA Y CANTIDAD ---

/**
 * Convierte centavos enteros a texto con 2 decimales.
 * @example formatearCentavos(415000) // "4150.00"
 */
export function formatearCentavos(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

/** Convierte un monto decimal a centavos enteros, redondeando para absorber el error de coma flotante. */
function aCentavos(monto: number): number {
  return Math.round(monto * 100);
}

/** Convierte una cantidad decimal a milésimas enteras (la BD guarda 3 decimales). */
function aMilesimas(cantidad: number): number {
  return Math.round(cantidad * 1000);
}

// --- CONSULTA DE HISTORIAL ---

/**
 * Consulta una página del historial de ventas con sus filtros.
 * @param consulta Query ya validada por Zod (con valores por defecto aplicados).
 * @returns Las ventas de la página y los metadatos de paginación. Una página fuera de rango devuelve lista vacía.
 */
export async function consultarHistorial(consulta: ConsultarHistorialInput): Promise<ConsultarHistorialResponse> {
  const filtro = calcularFiltroHistorial(consulta);
  const desplazamiento = calcularDesplazamiento(consulta.pagina, consulta.cantidadPorPagina);

  const paginaEncontrada = await buscarHistorialVentas(filtro, desplazamiento, consulta.cantidadPorPagina);

  return {
    exito: true,
    ventas: paginaEncontrada.filas.map(convertirFilaHistorial),
    paginacion: {
      pagina: consulta.pagina,
      cantidadPorPagina: consulta.cantidadPorPagina,
      totalRegistros: paginaEncontrada.totalRegistros,
      totalPaginas: calcularTotalPaginas(paginaEncontrada.totalRegistros, consulta.cantidadPorPagina),
    },
  };
}

// --- CÁLCULO PURO DEL HISTORIAL ---

/**
 * Traduce los filtros de la query a los valores que consulta el repositorio.
 * Solo se incluyen los filtros presentes.
 * @throws {ErrorNegocio} Si una fecha no existe en el calendario (el esquema Zod ya lo impide; es una defensa).
 */
export function calcularFiltroHistorial(consulta: ConsultarHistorialInput): FiltroHistorialVentas {
  return {
    // Desde: 00:00 (hora argentina) del día indicado, inclusivo
    ...(consulta.fechaDesde !== undefined
      ? { fechaDesdeInclusiva: calcularInicioDiaArgentina(consulta.fechaDesde, 0) }
      : {}),
    // Hasta: el día indicado debe quedar incluido completo, así que el límite es 00:00 del día siguiente, exclusivo
    ...(consulta.fechaHasta !== undefined
      ? { fechaHastaExclusiva: calcularInicioDiaArgentina(consulta.fechaHasta, 1) }
      : {}),
    ...(consulta.idProducto !== undefined ? { idProducto: consulta.idProducto } : {}),
    ...(consulta.estado !== undefined ? { estado: consulta.estado } : {}),
  };
}

/**
 * Devuelve el instante UTC en que empieza un día en Argentina.
 * @param fecha Fecha `AAAA-MM-DD`.
 * @param diasAdicionales Días a sumar al día indicado (0 = el mismo día, 1 = el siguiente).
 * @example calcularInicioDiaArgentina("2026-10-30", 0) // 2026-10-30T03:00:00.000Z
 */
function calcularInicioDiaArgentina(fecha: string, diasAdicionales: number): Date {
  const partes = descomponerFechaCalendario(fecha);
  if (partes === null) {
    throw crearErrorNegocio(`La fecha ${fecha} no existe en el calendario`, 400);
  }

  // Date.UTC normaliza el desborde de día (31 + 1 pasa al mes siguiente) sin contar días por mes
  return new Date(
    Date.UTC(partes.ejercicio, partes.mes - 1, partes.dia + diasAdicionales, HORAS_DESFASE_ARGENTINA_RESPECTO_UTC),
  );
}

/** Cantidad de filas a saltar para llegar a una página (la página 1 no salta ninguna). */
export function calcularDesplazamiento(pagina: number, cantidadPorPagina: number): number {
  return (pagina - 1) * cantidadPorPagina;
}

/** Total de páginas: techo de registros / tamaño de página; 0 si no hay registros. */
export function calcularTotalPaginas(totalRegistros: number, cantidadPorPagina: number): number {
  return Math.ceil(totalRegistros / cantidadPorPagina);
}

/** Convierte una fila del repositorio al formato de la respuesta (fecha ISO y monto con 2 decimales). */
function convertirFilaHistorial(fila: FilaHistorialVenta): VentaHistorial {
  return {
    idVenta: fila.idVenta,
    numeroComprobante: fila.numeroComprobante,
    fechaHora: fila.fechaHora.toISOString(),
    estado: fila.estado,
    montoTotal: formatearCentavos(fila.montoTotalCentavos),
    clienteReferencia: fila.clienteReferencia,
    origen: fila.origen,
    modalidadEntrega: fila.modalidadEntrega,
  };
}
