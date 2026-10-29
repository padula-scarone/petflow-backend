import { registrarVentaAtomica } from "./ventas.repository.js";
import { StockInsuficienteError, VentaError } from "./ventas.errors.js";
import type {
  MedioPagoVigente,
  ProductoVigente,
  RegistrarVentaInput,
  RegistrarVentaResponse,
  TotalesVentaCalculados,
} from "./ventas.types.js";

// --- ORQUESTACIÓN ---

/**
 * Registra una venta: calcula con reglas puras y persiste en una única transacción.
 * El cálculo se inyecta al repositorio como función para que corra dentro de la transacción,
 * con los datos leídos en ese mismo momento.
 * @param input Cuerpo ya validado por Zod.
 * @returns Respuesta lista para enviar al frontend.
 * @throws {VentaError} Si alguna regla de negocio no se cumple (nada queda escrito).
 */
export async function registrarVenta(input: RegistrarVentaInput): Promise<RegistrarVentaResponse> {
  const venta = await registrarVentaAtomica(input, (productos, medios) =>
    calcularVenta(input, productos, medios),
  );

  const esFiado = venta.estado === "PENDIENTE_PAGO";

  return {
    exito: true,
    mensaje: esFiado
      ? "Venta registrada como pendiente de pago y stock descontado"
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
 * @throws {VentaError} Producto o medio inexistente/inactivo, cantidad inválida, descuento excesivo o pagos que no cuadran.
 * @throws {StockInsuficienteError} Si algún producto no alcanza.
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
      throw new VentaError(`El producto ${item.idProducto} no existe`, 404);
    }
    if (!producto.activo) {
      throw new VentaError(`El producto ${producto.nombre} está inactivo`, 400);
    }

    // Un producto por unidad no se puede vender fraccionado (1.5 bolsas no tiene sentido)
    const cantidadMilesimas = aMilesimas(item.cantidad);
    if (producto.formatoVenta === "UNIDAD" && cantidadMilesimas % 1000 !== 0) {
      throw new VentaError(
        `El producto ${producto.nombre} se vende por unidad: la cantidad debe ser entera`,
        400,
      );
    }
    if (cantidadMilesimas > producto.stockMilesimas) {
      throw new StockInsuficienteError(producto.idProducto);
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
    throw new VentaError("El descuento no puede superar el subtotal", 400);
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
      throw new VentaError(`El medio de pago ${pago.idMedioPago} no existe`, 404);
    }
    if (!medio.activo) {
      throw new VentaError(`El medio de pago ${pago.idMedioPago} está inactivo`, 400);
    }
    // Un descuento del 100% o más haría que el cliente pague cero o negativo
    if (10000 + medio.ajusteBp <= 0) {
      throw new VentaError(`El medio de pago ${pago.idMedioPago} tiene un ajuste inválido`, 400);
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
    throw new VentaError(
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
