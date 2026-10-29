import { registrarVentaAtomica } from "./ventas.repository.js";
import { StockInsuficienteError, VentaError } from "./ventas.errors.js";
import type {
  MedioPagoVigente,
  ProductoVigente,
  RegistrarVentaInput,
  RegistrarVentaResponse,
  TotalesVentaCalculados,
} from "./ventas.types.js";

// Orquesta el alta: calcula con reglas puras y persiste en una única transacción.
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

// Cálculo puro de la venta: no accede a la base de datos.
export function calcularVenta(
  input: RegistrarVentaInput,
  productos: ProductoVigente[],
  medios: MedioPagoVigente[],
): TotalesVentaCalculados {
  const productosPorId = new Map(productos.map((producto) => [producto.idProducto, producto]));
  const mediosPorId = new Map(medios.map((medio) => [medio.idMedioPago, medio]));

  const lineas = input.items.map((item) => {
    const producto = productosPorId.get(item.idProducto);
    if (!producto) {
      throw new VentaError(`El producto ${item.idProducto} no existe`, 404);
    }
    if (!producto.activo) {
      throw new VentaError(`El producto ${producto.nombre} está inactivo`, 400);
    }

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
    montoTotalCentavos: pagos.reduce((suma, pago) => suma + pago.montoFinalCentavos, 0),
    estado: "COMPLETADA",
  };
}

export function formatearCentavos(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

function aCentavos(monto: number): number {
  return Math.round(monto * 100);
}

function aMilesimas(cantidad: number): number {
  return Math.round(cantidad * 1000);
}
