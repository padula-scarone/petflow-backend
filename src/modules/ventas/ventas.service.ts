import {
  anularVentaAtomica,
  buscarHistorialVentas,
  buscarVentaPorId,
  liquidarFiadoAtomico,
  registrarVentaAtomica,
} from "./ventas.repository.js";
import {
  crearErrorNegocio,
  crearErrorSinCajaParaAnular,
  crearErrorStockInsuficiente,
  crearErrorVentaNoPendientePago,
  crearErrorVentaYaAnulada,
  crearErrorVentanaAnulacionVencida,
} from "./ventas.errors.js";
import { descomponerFechaCalendario } from "./ventas.schemas.js";
import type {
  AnulacionPersistida,
  AnularVentaInput,
  AnularVentaResponse,
  CobroFiadoCalculado,
  CobroFiadoPersistido,
  ConsultarHistorialInput,
  ConsultarHistorialResponse,
  ConsultarVentaInput,
  ConsultarVentaResponse,
  DecisionAnulacion,
  EstadoVentaHistorial,
  FilaHistorialVenta,
  FiltroHistorialVentas,
  ItemVentaConsultado,
  ItemVentaDetallado,
  LiquidarFiadoInput,
  LiquidarFiadoResponse,
  MedioPagoVigente,
  PagoCobrado,
  PagoCobroCalculado,
  PagoVentaConsultado,
  PagoVentaCalculado,
  PagoVentaDetallado,
  ProductoVigente,
  RegistrarVentaInput,
  RegistrarVentaResponse,
  TipoMedioPago,
  TotalesVentaCalculados,
  VentaAdeudada,
  VentaAnulable,
  VentaDetallada,
  VentaHistorial,
} from "./ventas.types.js";

// --- CONSTANTES ---

/** Horas que Argentina (UTC-3, sin horario de verano) está por detrás de UTC. */
const HORAS_DESFASE_ARGENTINA_RESPECTO_UTC = 3;

/**
 * Minutos que dura la ventana para anular una venta, contados desde el pago (o desde la venta si no hay pago).
 * Se exporta para que los cambios de mercadería reutilicen la misma regla.
 */
export const LIMITE_MINUTOS_ANULACION = 15;

/** Milisegundos que dura un minuto, para convertir la ventana a un instante. */
const MILISEGUNDOS_POR_MINUTO = 60_000;

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
      // Con el recibido y el vuelto ya calculados, el front los muestra sin consultar de nuevo la venta
      pagos: venta.pagos.map(convertirPagoCobrado),
    },
  };
}

// --- CÁLCULO PURO ---

/**
 * Aplica todas las reglas de negocio de una venta sin acceder a la base de datos.
 * Es pura a propósito: así se prueba con datos de ejemplo sin conectarse a Supabase.
 * @param input Cuerpo validado de la venta.
 * @param productos Productos leídos de la BD con sus valores vigentes.
 * @param medios Medios de pago leídos de la BD, con su tipo.
 * @returns Líneas, pagos (con recibido y vuelto si corresponde), totales y estado final de la venta.
 * @throws {ErrorNegocio} Producto o medio inexistente/inactivo, cantidad inválida, descuento excesivo,
 * pagos que no cuadran, stock insuficiente en algún producto, monto recibido en un medio que no es efectivo
 * o menor al monto final. Se lanza como objeto puro, no como Error.
 */
export function calcularVenta(
  input: RegistrarVentaInput,
  productos: ProductoVigente[],
  medios: MedioPagoVigente[],
): TotalesVentaCalculados {
  const productosPorId = new Map(productos.map((producto) => [producto.idProducto, producto]));

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

  // El vuelto es solo registro: el total y la caja siguen saliendo de los montos finales
  const pagos = adjuntarMontoRecibidoYVuelto(
    input.pagos,
    calcularPagosVenta(input.pagos, medios, aCobrarCentavos),
    medios,
  );

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

// --- CÁLCULO PURO DE PAGOS ---

/**
 * Aplica a cada pago el ajuste vigente de su medio y verifica que las porciones base cuadren con el importe.
 * Es compartida por el alta de venta y por el cobro de un fiado: ambos calculan los pagos igual.
 * @param pagosSolicitados Pagos del cuerpo: medio y porción base en pesos.
 * @param medios Medios de pago leídos de la BD (puede traer más datos que los usados aquí).
 * @param importeCentavos Importe que los pagos deben cubrir exactamente, antes de recargos o descuentos.
 * @returns Un pago calculado por cada pago solicitado, en el mismo orden.
 * @throws {ErrorNegocio} Medio inexistente (404), medio inactivo o con ajuste inválido (400),
 * o suma de porciones base distinta del importe (400). Se lanza como objeto puro, no como Error.
 */
export function calcularPagosVenta(
  pagosSolicitados: ReadonlyArray<{ idMedioPago: number; monto: number }>,
  medios: MedioPagoVigente[],
  importeCentavos: number,
): PagoVentaCalculado[] {
  const mediosPorId = new Map(medios.map((medio) => [medio.idMedioPago, medio]));

  // El monto de cada pago es la porción base que aporta ese medio.
  // El recargo (o descuento) del medio se aplica sobre esa porción: final = base × (1 + neto)
  const pagos = pagosSolicitados.map((pago) => {
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
  if (sumaBaseCentavos !== importeCentavos) {
    throw crearErrorNegocio(
      `La suma de los pagos (${formatearCentavos(sumaBaseCentavos)}) no coincide con el total a cobrar (${formatearCentavos(importeCentavos)})`,
      400,
    );
  }

  return pagos;
}

/**
 * Completa cada pago calculado con su monto recibido y su vuelto.
 * Es compartida por el alta de venta y por el cobro de un fiado: ambos tratan el efectivo igual.
 * @param pagosSolicitados Pagos del cuerpo, con el monto recibido opcional.
 * @param pagosCalculados Resultado de `calcularPagosVenta` para esos mismos pagos.
 * @param medios Medios de pago leídos de la BD, con su tipo.
 * @returns Un pago por cada solicitado, en el mismo orden.
 * @throws {ErrorNegocio} 400 si el recibido va en un medio que no es efectivo o no alcanza el monto final.
 */
function adjuntarMontoRecibidoYVuelto(
  pagosSolicitados: ReadonlyArray<{ idMedioPago: number; montoRecibido?: number | undefined }>,
  pagosCalculados: PagoVentaCalculado[],
  medios: MedioPagoVigente[],
): PagoCobroCalculado[] {
  // Los medios no se repiten (lo garantiza el esquema), así que el medio identifica de forma única cada pago
  const pagosCalculadosPorMedio = new Map(pagosCalculados.map((pago) => [pago.idMedioPago, pago]));
  const tiposPorMedio = new Map(medios.map((medio) => [medio.idMedioPago, medio.tipo]));

  return pagosSolicitados.map((pagoSolicitado): PagoCobroCalculado => {
    const pagoCalculado = pagosCalculadosPorMedio.get(pagoSolicitado.idMedioPago);
    if (pagoCalculado === undefined) {
      // Inalcanzable: calcularPagosVenta devuelve un pago por cada solicitado; es una defensa
      throw crearErrorNegocio(`El medio de pago ${pagoSolicitado.idMedioPago} no se pudo calcular`, 400);
    }
    return {
      ...pagoCalculado,
      ...calcularMontoRecibidoYVuelto(
        pagoSolicitado.idMedioPago,
        tiposPorMedio.get(pagoSolicitado.idMedioPago),
        pagoSolicitado.montoRecibido,
        pagoCalculado.montoFinalCentavos,
      ),
    };
  });
}

// --- UTILIDADES DE MONEDA Y CANTIDAD ---

/**
 * Convierte centavos enteros a texto con 2 decimales.
 * @example formatearCentavos(415000) // "4150.00"
 */
export function formatearCentavos(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

/** Igual que `formatearCentavos`, pero conserva `null` (ventas anteriores o montos que no aplican). */
function formatearCentavosOpcional(centavos: number | null): string | null {
  return centavos === null ? null : formatearCentavos(centavos);
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
    // El reloj se toma una sola vez y recién después de leer: es lo más cercano al momento en que el front recibe la respuesta
    fechaHoraServidor: new Date().toISOString(),
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
    ...(consulta.origen !== undefined ? { origen: consulta.origen } : {}),
    ...(consulta.medioPago !== undefined ? { medioPago: consulta.medioPago } : {}),
    // Un texto vacío tras el recorte equivale a no filtrar (el front lo manda así cuando el campo está limpio)
    ...(consulta.textoCliente !== undefined && consulta.textoCliente !== ""
      ? { textoCliente: consulta.textoCliente }
      : {}),
    ...(consulta.numeroComprobante !== undefined && consulta.numeroComprobante !== ""
      ? { numeroComprobante: consulta.numeroComprobante }
      : {}),
  };
}

// --- LÍMITE DE MODIFICACIÓN DE UNA VENTA ---

/**
 * Calcula hasta cuándo se puede editar o anular una venta: `LIMITE_MINUTOS_ANULACION` minutos desde el pago
 * (o desde la venta si no hay pago, como en un fiado pendiente).
 * ATENCIÓN: es la misma regla que aplica `evaluarAnulacion` (referencia `fechaHoraPago ?? fechaHora` y la misma
 * constante). Si cambia una, hay que cambiar la otra.
 * @returns El instante límite, o `null` si la venta está ANULADA (ya no tiene ventana).
 */
export function calcularLimiteModificacionVenta(venta: {
  estado: EstadoVentaHistorial;
  fechaHora: Date;
  fechaHoraPago: Date | null;
}): Date | null {
  if (venta.estado === "ANULADA") {
    return null;
  }
  const fechaReferencia = venta.fechaHoraPago ?? venta.fechaHora;
  return new Date(fechaReferencia.getTime() + LIMITE_MINUTOS_ANULACION * MILISEGUNDOS_POR_MINUTO);
}

/**
 * Devuelve el instante UTC en que empieza un día en Argentina.
 * @param fecha Fecha `AAAA-MM-DD`.
 * @param diasAdicionales Días a sumar al día indicado (0 = el mismo día, 1 = el siguiente).
 * @example calcularInicioDiaArgentina("2026-10-30", 0) // 2026-10-30T03:00:00.000Z
 */
export function calcularInicioDiaArgentina(fecha: string, diasAdicionales: number): Date {
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

/** Convierte una fila del repositorio al formato de la respuesta (fechas ISO y monto con 2 decimales). */
function convertirFilaHistorial(fila: FilaHistorialVenta): VentaHistorial {
  const limiteModificacion = calcularLimiteModificacionVenta(fila);

  return {
    idVenta: fila.idVenta,
    numeroComprobante: fila.numeroComprobante,
    fechaHora: fila.fechaHora.toISOString(),
    estado: fila.estado,
    fechaHoraLimiteModificacion: limiteModificacion === null ? null : limiteModificacion.toISOString(),
    montoTotal: formatearCentavos(fila.montoTotalCentavos),
    clienteReferencia: fila.clienteReferencia,
    origen: fila.origen,
    modalidadEntrega: fila.modalidadEntrega,
    cantidadCambiosActivos: fila.cantidadCambiosActivos,
  };
}

// --- CONSULTA DE UNA VENTA ---

/**
 * Devuelve el detalle de una venta con sus ítems y pagos. Es solo lectura y sirve en cualquier estado.
 * Los importes salen tal como se guardaron: no se recalcula nada con precios o porcentajes actuales.
 * @param consulta Parámetros de ruta ya validados por Zod.
 * @throws {ErrorNegocio} 404 si la venta no existe. Se lanza como objeto puro, no como Error.
 */
export async function consultarVenta(consulta: ConsultarVentaInput): Promise<ConsultarVentaResponse> {
  const venta = await buscarVentaPorId(consulta.idVenta);
  if (venta === null) {
    throw crearErrorNegocio(`La venta ${consulta.idVenta} no existe`, 404);
  }

  // El reloj se toma una sola vez y recién después de leer, igual que en el historial
  return { exito: true, fechaHoraServidor: new Date().toISOString(), venta: convertirVentaDetallada(venta) };
}

/**
 * Convierte la venta del repositorio al formato de la respuesta.
 * El tipo de comprobante no se agrega: el frontend lo deduce de `estado` (pagos vacíos y
 * `fechaHoraPago` nulo en un fiado; pagos y `fechaHoraPago` con valor en una venta cobrada).
 */
function convertirVentaDetallada(venta: VentaDetallada): ConsultarVentaResponse["venta"] {
  const limiteModificacion = calcularLimiteModificacionVenta(venta);

  return {
    idVenta: venta.idVenta,
    numeroComprobante: venta.numeroComprobante,
    fechaHora: venta.fechaHora.toISOString(),
    // Un fiado no cobrado no tiene fecha de pago
    fechaHoraPago: venta.fechaHoraPago === null ? null : venta.fechaHoraPago.toISOString(),
    estado: venta.estado,
    fechaHoraLimiteModificacion: limiteModificacion === null ? null : limiteModificacion.toISOString(),
    origen: venta.origen,
    modalidadEntrega: venta.modalidadEntrega,
    clienteReferencia: venta.clienteReferencia,
    vendedor: venta.vendedor,
    subtotalBruto: formatearCentavos(venta.subtotalBrutoCentavos),
    descuentoManual: formatearCentavos(venta.descuentoManualCentavos),
    motivoDescuento: venta.motivoDescuento,
    montoTotal: formatearCentavos(venta.montoTotalCentavos),
    items: venta.items.map(convertirItemVenta),
    pagos: venta.pagos.map(convertirPagoVenta),
    // Solo una venta anulada tiene auditoría; las anuladas antes de registrarla también devuelven null
    anulacion:
      venta.anulacion === null
        ? null
        : {
            fechaHora: venta.anulacion.fechaHora.toISOString(),
            motivo: venta.anulacion.motivo,
            usuario: venta.anulacion.usuario,
          },
  };
}

/** Convierte un ítem al formato de la respuesta: precio con 2 decimales y cantidades con 3. */
function convertirItemVenta(item: ItemVentaDetallado): ItemVentaConsultado {
  return {
    idProducto: item.idProducto,
    nombreProducto: item.nombreProducto,
    formatoVenta: item.formatoVenta,
    cantidad: formatearMilesimas(item.cantidadMilesimas),
    precioUnitario: formatearCentavos(item.precioUnitarioCentavos),
    subtotal: formatearCentavos(item.subtotalCentavos),
    // El decimal exacto de la base se formatea sin pasar por Number; sin cambios activos de ese producto no hay suma
    cantidadYaDevuelta: item.cantidadYaDevuelta === null ? formatearMilesimas(0) : item.cantidadYaDevuelta.toFixed(3),
  };
}

/** Convierte un pago al formato de la respuesta: montos y porcentaje con 2 decimales; recibido y vuelto pueden ser nulos. */
function convertirPagoVenta(pago: PagoVentaDetallado): PagoVentaConsultado {
  return {
    idMedioPago: pago.idMedioPago,
    nombreMedioPago: pago.nombreMedioPago,
    montoBase: formatearCentavos(pago.montoBaseCentavos),
    porcentajeAplicado: formatearBasisPoints(pago.porcentajeAplicadoBp),
    montoFinal: formatearCentavos(pago.montoFinalCentavos),
    montoRecibido: formatearCentavosOpcional(pago.montoRecibidoCentavos),
    vuelto: formatearCentavosOpcional(pago.vueltoCentavos),
  };
}

/**
 * Convierte milésimas enteras a texto con 3 decimales.
 * @example formatearMilesimas(2500) // "2.500"
 */
function formatearMilesimas(milesimas: number): string {
  return (milesimas / 1000).toFixed(3);
}

/**
 * Convierte basis points a texto de porcentaje con 2 decimales; conserva el signo del descuento.
 * @example formatearBasisPoints(-500) // "-5.00"
 */
function formatearBasisPoints(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2);
}

// --- COBRO DE FIADO: ORQUESTACIÓN ---

/**
 * Cobra un fiado: calcula con reglas puras y persiste en una única transacción.
 * El cálculo se inyecta al repositorio como función para que corra dentro de la transacción,
 * con la venta leída en ese mismo momento.
 * @param input Parámetro de ruta y body ya validados por Zod.
 * @returns Respuesta lista para enviar al frontend.
 * @throws {ErrorNegocio} Si alguna regla de negocio no se cumple (nada queda escrito).
 */
export async function liquidarFiado(input: LiquidarFiadoInput): Promise<LiquidarFiadoResponse> {
  const cobro = await liquidarFiadoAtomico(input, (venta, medios) => calcularCobroFiado(input, venta, medios));

  return {
    exito: true,
    mensaje: "Fiado cobrado, venta completada y recibo de pago emitido",
    venta: convertirCobroPersistido(cobro),
  };
}

// --- COBRO DE FIADO: CÁLCULO PURO ---

/**
 * Aplica las reglas de negocio del cobro de un fiado sin acceder a la base de datos.
 * Es pura a propósito: así se prueba con datos de ejemplo sin conectarse a Supabase.
 * @param input Parámetro de ruta y body validados.
 * @param venta Venta leída de la BD, o `null` si no existe.
 * @param medios Medios de pago leídos de la BD, con su tipo.
 * @returns Pagos con vuelto, importe adeudado y total cobrado.
 * @throws {ErrorNegocio} Venta inexistente (404), venta que no está pendiente de pago (409),
 * medio inexistente (404), inactivo o con ajuste inválido (400), suma de pagos que no cuadra (400),
 * monto recibido en un medio que no es efectivo (400) o menor al monto final (400).
 * Se lanza como objeto puro, no como Error.
 */
export function calcularCobroFiado(
  input: LiquidarFiadoInput,
  venta: VentaAdeudada | null,
  medios: MedioPagoVigente[],
): CobroFiadoCalculado {
  if (venta === null) {
    throw crearErrorNegocio(`La venta ${input.idVenta} no existe`, 404);
  }
  if (venta.estado !== "PENDIENTE_PAGO") {
    throw crearErrorVentaNoPendientePago(venta.idVenta);
  }

  // Se cobra lo que se debe (subtotal − descuento) y no el montoTotal guardado:
  // el cobro es total y el descuento manual solo se carga en el alta
  const importeAdeudadoCentavos = venta.subtotalBrutoCentavos - venta.descuentoManualCentavos;
  const pagos = adjuntarMontoRecibidoYVuelto(
    input.pagos,
    calcularPagosVenta(input.pagos, medios, importeAdeudadoCentavos),
    medios,
  );

  return {
    pagos,
    importeAdeudadoCentavos,
    // El total es lo que paga el cliente, recargos incluidos; puede diferir del importe del fiado
    montoTotalCentavos: pagos.reduce((suma, pago) => suma + pago.montoFinalCentavos, 0),
    numeroComprobante: venta.numeroComprobante,
  };
}

/**
 * Valida el monto recibido de un pago y calcula su vuelto.
 * Solo el efectivo admite monto recibido. Si no se informa, no se asume pago exacto: ambos quedan nulos.
 * @param idMedioPago Medio del pago, para el mensaje de error.
 * @param tipo Tipo del medio.
 * @param montoRecibido Monto recibido en pesos, si el cliente lo informó.
 * @param montoFinalCentavos Monto final de la línea, con el ajuste del medio ya aplicado.
 * @throws {ErrorNegocio} 400 si el medio no es efectivo o el recibido no alcanza el monto final.
 */
function calcularMontoRecibidoYVuelto(
  idMedioPago: number,
  tipo: TipoMedioPago | undefined,
  montoRecibido: number | undefined,
  montoFinalCentavos: number,
): Pick<PagoCobroCalculado, "montoRecibidoCentavos" | "vueltoCentavos"> {
  if (montoRecibido === undefined) {
    return { montoRecibidoCentavos: null, vueltoCentavos: null };
  }
  if (tipo !== "EFECTIVO") {
    throw crearErrorNegocio(`El medio de pago ${idMedioPago} no es efectivo: no admite monto recibido`, 400);
  }

  const montoRecibidoCentavos = aCentavos(montoRecibido);
  if (montoRecibidoCentavos < montoFinalCentavos) {
    throw crearErrorNegocio(
      `El monto recibido (${formatearCentavos(montoRecibidoCentavos)}) es menor al monto final (${formatearCentavos(montoFinalCentavos)}) del medio de pago ${idMedioPago}`,
      400,
    );
  }

  return { montoRecibidoCentavos, vueltoCentavos: montoRecibidoCentavos - montoFinalCentavos };
}

// --- COBRO DE FIADO: RESPUESTA ---

/** Convierte el cobro persistido al formato de la respuesta: fecha ISO y montos con 2 decimales. */
function convertirCobroPersistido(cobro: CobroFiadoPersistido): LiquidarFiadoResponse["venta"] {
  return {
    idVenta: cobro.idVenta,
    numeroComprobante: cobro.numeroComprobante,
    estado: "COMPLETADA",
    montoTotal: formatearCentavos(cobro.montoTotalCentavos),
    fechaHoraPago: cobro.fechaHoraPago.toISOString(),
    pagos: cobro.pagos.map(convertirPagoCobrado),
  };
}

/** Convierte un pago al formato de la respuesta del alta y del cobro; recibido y vuelto siguen nulos si no aplican. */
function convertirPagoCobrado(pago: PagoCobroCalculado): PagoCobrado {
  return {
    idMedioPago: pago.idMedioPago,
    montoFinal: formatearCentavos(pago.montoFinalCentavos),
    montoRecibido: formatearCentavosOpcional(pago.montoRecibidoCentavos),
    vuelto: formatearCentavosOpcional(pago.vueltoCentavos),
  };
}

// --- ANULACIÓN DE VENTA: ORQUESTACIÓN ---

/**
 * Anula una venta (baja venta y modificación venta son esta misma operación): evalúa las reglas puras
 * y persiste la transición y la reposición de stock en una única transacción.
 * La evaluación se inyecta al repositorio como función para que corra dentro de la transacción,
 * con la venta y la caja leídas en ese mismo momento y con el reloj tomado en ese instante.
 * La anulación deja auditoría (quién, cuándo y por qué) en la misma operación que cambia el estado.
 * @param input Parámetro de ruta y motivo ya validados por Zod, más el usuario del token.
 * @returns Respuesta lista para enviar al frontend.
 * @throws {ErrorNegocio} Si alguna regla de negocio no se cumple (nada queda escrito).
 */
export async function anularVenta(input: AnularVentaInput): Promise<AnularVentaResponse> {
  const anulacion = await anularVentaAtomica(input, (venta, hayCajaAbierta) =>
    // El reloj se toma aquí, dentro de la transacción: así la espera de conexión o de bloqueos no le regala tiempo a la ventana
    evaluarAnulacion(input, venta, new Date(), hayCajaAbierta),
  );

  return {
    exito: true,
    mensaje:
      anulacion.estadoAnterior === "COMPLETADA"
        ? "Venta anulada, cobro revertido y stock repuesto"
        : "Venta pendiente de pago anulada y stock repuesto",
    venta: convertirAnulacionPersistida(anulacion),
  };
}

// --- ANULACIÓN DE VENTA: REGLAS PURAS ---

/**
 * Calcula el instante mínimo vigente para anular: ahora menos la ventana.
 * @param ahora Instante de referencia (reloj del servidor).
 */
export function calcularLimiteVentana(ahora: Date): Date {
  return new Date(ahora.getTime() - LIMITE_MINUTOS_ANULACION * MILISEGUNDOS_POR_MINUTO);
}

/**
 * Aplica las reglas de negocio de la anulación sin acceder a la base de datos ni al reloj.
 * Es pura a propósito: así se prueba con datos de ejemplo sin conectarse a Supabase.
 * El orden de las comprobaciones es parte del contrato: 404, 409 (ya anulada), 403 (ventana), 409 (sin caja).
 * @param input Entrada validada de la anulación (solo se usa el id de la venta; el motivo y el usuario los persiste el repositorio).
 * @param venta Venta leída de la BD, o `null` si no existe.
 * @param ahora Instante actual del servidor.
 * @param hayCajaAbierta Si existe al menos una sesión de caja abierta (cualquiera).
 * @returns El estado anterior, el límite de la ventana y el instante de la anulación, para que el repositorio
 * condicione la transición y registre la auditoría con ese mismo instante.
 * @throws {ErrorNegocio} Venta inexistente (404), ya anulada (409), ventana vencida (403) o
 * venta con cobro sin caja abierta (409). Se lanza como objeto puro, no como Error.
 */
export function evaluarAnulacion(
  input: AnularVentaInput,
  venta: VentaAnulable | null,
  ahora: Date,
  hayCajaAbierta: boolean,
): DecisionAnulacion {
  if (venta === null) {
    throw crearErrorNegocio(`La venta ${input.idVenta} no existe`, 404);
  }
  // Narrowing: tras descartar ANULADA, el estado leído es uno de los anulables
  if (venta.estado === "ANULADA") {
    throw crearErrorVentaYaAnulada(venta.idVenta);
  }

  // La ventana corre desde el pago si lo hay (un fiado cobrado vuelve a tener 15 min) y si no, desde la venta.
  // ATENCIÓN: es la misma regla que expone `calcularLimiteModificacionVenta` al front (`fechaHoraLimiteModificacion`).
  // Si cambia una, hay que cambiar la otra.
  const limiteVentana = calcularLimiteVentana(ahora);
  const fechaReferencia = venta.fechaHoraPago ?? venta.fechaHora;
  if (fechaReferencia < limiteVentana) {
    throw crearErrorVentanaAnulacionVencida(LIMITE_MINUTOS_ANULACION);
  }

  // Solo una venta con cobro (COMPLETADA) revierte caja y por eso exige una caja abierta; el fiado pendiente solo repone stock
  if (venta.estado === "COMPLETADA" && !hayCajaAbierta) {
    throw crearErrorSinCajaParaAnular();
  }

  // El mismo `ahora` fija el límite de la ventana y el instante de la anulación: un único reloj por operación
  return {
    numeroComprobante: venta.numeroComprobante,
    estadoAnterior: venta.estado,
    limiteVentana,
    fechaHoraAnulacion: ahora,
  };
}

// --- ANULACIÓN DE VENTA: RESPUESTA ---

/** Convierte la anulación persistida al formato de la respuesta: la venta queda siempre ANULADA. */
function convertirAnulacionPersistida(anulacion: AnulacionPersistida): AnularVentaResponse["venta"] {
  return {
    idVenta: anulacion.idVenta,
    numeroComprobante: anulacion.numeroComprobante,
    estado: "ANULADA",
    estadoAnterior: anulacion.estadoAnterior,
    anulacion: { fechaHora: anulacion.fechaHoraAnulacion.toISOString(), motivo: anulacion.motivo },
  };
}
