import { prisma } from "../../shared/prisma.js";
import { StockInsuficienteError, VentaError } from "./ventas.errors.js";
import type {
  EstadoVenta,
  MedioPagoVigente,
  ProductoVigente,
  RegistrarVentaInput,
  TotalesVentaCalculados,
} from "./ventas.types.js";

export type VentaPersistida = {
  idVenta: number;
  numeroComprobante: string | null;
  montoTotalCentavos: number;
  estado: EstadoVenta;
  fechaHora: Date;
};

type CalcularVenta = (
  productos: ProductoVigente[],
  medios: MedioPagoVigente[],
) => TotalesVentaCalculados;

// Única capa que toca Prisma. Todo ocurre dentro de una transacción:
// si algo falla (usuario, caja, stock, BD), no queda nada escrito.
export async function registrarVentaAtomica(
  input: RegistrarVentaInput,
  calcular: CalcularVenta,
): Promise<VentaPersistida> {
  return prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.findUnique({
      where: { idUsuario: input.idUsuario },
      select: { estado: true },
    });
    if (!usuario) {
      throw new VentaError(`El usuario ${input.idUsuario} no existe`, 404);
    }
    if (usuario.estado !== "ACTIVO") {
      throw new VentaError(`El usuario ${input.idUsuario} está inactivo`, 400);
    }

    const productos = await tx.producto.findMany({
      where: { idProducto: { in: input.items.map((item) => item.idProducto) } },
    });
    const medios = await tx.medioPago.findMany({
      where: { idMedioPago: { in: input.pagos.map((pago) => pago.idMedioPago) } },
    });

    const calculo = calcular(
      productos.map((producto) => ({
        idProducto: producto.idProducto,
        nombre: producto.nombre,
        formatoVenta: producto.formatoVenta,
        activo: producto.estado === "ACTIVO",
        precioCentavos: aCentavos(producto.precioVenta),
        costoCentavos: aCentavos(producto.costoActual),
        stockMilesimas: aMilesimas(producto.stockFisico),
      })),
      medios.map((medio) => ({
        idMedioPago: medio.idMedioPago,
        activo: medio.estado === "ACTIVO",
        ajusteBp: aBasisPoints(medio.porcentajeRecargo) - aBasisPoints(medio.porcentajeDescuento),
      })),
    );

    // Impacto en caja: la caja se simula como siempre abierta. Solo las ventas cobradas se asocian a ella.
    // Los fiados no tienen caja ni impacto en caja.
    let idCaja: number | null = null;
    if (calculo.estado === "COMPLETADA") {
      const caja = await tx.sesionCaja.findFirst({
        where: { estado: "ABIERTA" },
        orderBy: { fechaApertura: "desc" },
        select: { idCaja: true },
      });
      if (!caja) {
        throw new VentaError("No hay una caja abierta para registrar la venta", 409);
      }
      idCaja = caja.idCaja;
    }

    // Descuento de stock condicionado: solo descuenta si todavía alcanza.
    // Si otra venta consumió el stock entre la lectura y este paso, count vale 0 y se aborta.
    for (const linea of calculo.lineas) {
      const cantidad = milesimasAString(linea.cantidadMilesimas);
      const actualizados = await tx.producto.updateMany({
        where: { idProducto: linea.idProducto, stockFisico: { gte: cantidad } },
        data: { stockFisico: { decrement: cantidad } },
      });
      if (actualizados.count !== 1) {
        throw new StockInsuficienteError(linea.idProducto);
      }
    }

    const cobrada = calculo.estado === "COMPLETADA";

    const venta = await tx.venta.create({
      data: {
        origen: input.origen,
        modalidadEntrega: input.modalidadEntrega,
        estado: calculo.estado,
        clienteReferencia: input.clienteReferencia ?? null,
        subtotalBruto: centavosAString(calculo.subtotalBrutoCentavos),
        descuentoManual: centavosAString(calculo.descuentoManualCentavos),
        montoTotal: centavosAString(calculo.montoTotalCentavos),
        fechaHoraPago: cobrada ? new Date() : null,
        idUsuario: input.idUsuario,
        idCaja,
        detalles: {
          create: calculo.lineas.map((linea) => ({
            idProducto: linea.idProducto,
            cantidad: milesimasAString(linea.cantidadMilesimas),
            precioUnitarioVigente: centavosAString(linea.precioUnitarioCentavos),
            costoUnitarioCongelado: centavosAString(linea.costoUnitarioCentavos),
            subtotal: centavosAString(linea.subtotalCentavos),
          })),
        },
        pagos: {
          create: calculo.pagos.map((pago) => ({
            idMedioPago: pago.idMedioPago,
            montoBase: centavosAString(pago.montoBaseCentavos),
            porcentajeAplicado: basisPointsAString(pago.porcentajeAplicadoBp),
            montoFinal: centavosAString(pago.montoFinalCentavos),
          })),
        },
      },
      select: { idVenta: true, fechaHora: true },
    });

    // El comprobante depende del id, así que se asigna después del insert, dentro de la misma transacción
    const numeroComprobante = cobrada ? formatearComprobante(venta.idVenta) : null;
    if (numeroComprobante) {
      await tx.venta.update({
        where: { idVenta: venta.idVenta },
        data: { numeroComprobante },
      });
    }

    return {
      idVenta: venta.idVenta,
      numeroComprobante,
      montoTotalCentavos: calculo.montoTotalCentavos,
      estado: calculo.estado,
      fechaHora: venta.fechaHora,
    };
  });
}

function formatearComprobante(idVenta: number): string {
  return `CMP-${String(idVenta).padStart(8, "0")}`;
}

// Conversiones desde Decimal de Prisma a enteros internos
function aCentavos(valor: { toNumber(): number }): number {
  return Math.round(valor.toNumber() * 100);
}

function aMilesimas(valor: { toNumber(): number }): number {
  return Math.round(valor.toNumber() * 1000);
}

function aBasisPoints(valor: { toNumber(): number }): number {
  return Math.round(valor.toNumber() * 100);
}

// Conversiones desde enteros internos a strings para columnas Decimal
function centavosAString(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

function milesimasAString(milesimas: number): string {
  return (milesimas / 1000).toFixed(3);
}

function basisPointsAString(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2);
}
