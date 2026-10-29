import { prisma } from "../../shared/prisma.js";
import { StockInsuficienteError, VentaError } from "./ventas.errors.js";
import type {
  EstadoVenta,
  MedioPagoVigente,
  ProductoVigente,
  RegistrarVentaInput,
  TotalesVentaCalculados,
} from "./ventas.types.js";

// --- TIPOS DEL REPOSITORIO ---

/** Datos de la venta ya guardada que necesita el service para armar la respuesta. */
export type VentaPersistida = {
  idVenta: number;
  /** Nulo en un fiado. */
  numeroComprobante: string | null;
  montoTotalCentavos: number;
  estado: EstadoVenta;
  fechaHora: Date;
};

/** Función de cálculo que inyecta el service; recibe lo leído de la BD y devuelve los totales. */
type CalcularVenta = (
  productos: ProductoVigente[],
  medios: MedioPagoVigente[],
) => TotalesVentaCalculados;

// --- ALTA DE VENTA ---

/**
 * Guarda una venta completa en una única transacción.
 * Es la única capa del módulo que toca Prisma. Si algo falla (usuario, caja, stock, BD)
 * se revierte todo: no queda stock descontado ni ventas a medias.
 * @param input Cuerpo validado de la venta.
 * @param calcular Cálculo de negocio, ejecutado dentro de la transacción con datos recién leídos.
 * @returns Los datos de la venta persistida.
 * @throws {VentaError} Usuario inexistente o inactivo, o no hay caja abierta.
 * @throws {StockInsuficienteError} Si otra venta consumió el stock antes de descontarlo.
 */
export async function registrarVentaAtomica(
  input: RegistrarVentaInput,
  calcular: CalcularVenta,
): Promise<VentaPersistida> {
  return prisma.$transaction(async (tx) => {
    // --- VALIDACIÓN DEL VENDEDOR ---
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

    // --- LECTURA Y CÁLCULO ---
    const productos = await tx.producto.findMany({
      where: { idProducto: { in: input.items.map((item) => item.idProducto) } },
    });
    const medios = await tx.medioPago.findMany({
      where: { idMedioPago: { in: input.pagos.map((pago) => pago.idMedioPago) } },
    });

    // Se convierte lo leído (Decimal) a enteros antes de calcular, para no operar con decimales
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

    // --- CAJA ---
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

    // --- DESCUENTO DE STOCK ---
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

    // --- GUARDADO DE LA VENTA ---
    const cobrada = calculo.estado === "COMPLETADA";

    // La venta, sus detalles y sus pagos se crean juntos con escritura anidada
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

// --- UTILIDADES ---

/**
 * Arma el número de comprobante a partir del id de la venta.
 * @example formatearComprobante(1) // "CMP-00000001"
 */
function formatearComprobante(idVenta: number): string {
  return `CMP-${String(idVenta).padStart(8, "0")}`;
}

// Conversiones desde Decimal de Prisma a enteros internos
/** Pesos (decimal de BD) a centavos enteros. */
function aCentavos(valor: { toNumber(): number }): number {
  return Math.round(valor.toNumber() * 100);
}

/** Cantidad (decimal de BD) a milésimas enteras. */
function aMilesimas(valor: { toNumber(): number }): number {
  return Math.round(valor.toNumber() * 1000);
}

/** Porcentaje (decimal de BD) a basis points: 10.00% pasa a 1000. */
function aBasisPoints(valor: { toNumber(): number }): number {
  return Math.round(valor.toNumber() * 100);
}

// Conversiones desde enteros internos a strings para columnas Decimal
// Se usan strings para que Prisma reciba el valor exacto, sin pasar por coma flotante
/** Centavos enteros a texto con 2 decimales. */
function centavosAString(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

/** Milésimas enteras a texto con 3 decimales. */
function milesimasAString(milesimas: number): string {
  return (milesimas / 1000).toFixed(3);
}

/** Basis points a texto de porcentaje con 2 decimales: 1000 pasa a "10.00". */
function basisPointsAString(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2);
}
