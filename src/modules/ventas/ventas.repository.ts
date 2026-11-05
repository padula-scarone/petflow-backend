import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/prisma.js";
import { crearErrorNegocio, crearErrorStockInsuficiente } from "./ventas.errors.js";
import type {
  EstadoVenta,
  FiltroHistorialVentas,
  MedioPagoVigente,
  PaginaHistorialVentas,
  ProductoVigente,
  RegistrarVentaInput,
  TotalesVentaCalculados,
} from "./ventas.types.js";

// --- TIPOS DEL REPOSITORIO ---

/** Datos de la venta ya guardada que necesita el service para armar la respuesta. */
export type VentaPersistida = {
  idVenta: number;
  /** Siempre presente: se emite para toda venta, cobrada o fiado. */
  numeroComprobante: string;
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
 * @throws {ErrorNegocio} Usuario inexistente o inactivo (404/400), no hay caja abierta (409) o
 * otra venta consumió el stock antes de descontarlo (409). Se lanza como objeto puro, no como Error.
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
      throw crearErrorNegocio(`El usuario ${input.idUsuario} no existe`, 404);
    }
    if (usuario.estado !== "ACTIVO") {
      throw crearErrorNegocio(`El usuario ${input.idUsuario} está inactivo`, 400);
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
        throw crearErrorNegocio("No hay una caja abierta para registrar la venta", 409);
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
        throw crearErrorStockInsuficiente(linea.idProducto);
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

    // Toda venta emite comprobante al instante (ticket de pago o ticket de deuda).
    // Depende del id, así que se asigna después del insert, dentro de la misma transacción:
    // si algo falla, hace rollback y nunca queda una venta sin comprobante.
    const numeroComprobante = formatearComprobante(venta.idVenta);
    await tx.venta.update({
      where: { idVenta: venta.idVenta },
      data: { numeroComprobante },
    });

    return {
      idVenta: venta.idVenta,
      numeroComprobante,
      montoTotalCentavos: calculo.montoTotalCentavos,
      estado: calculo.estado,
      fechaHora: venta.fechaHora,
    };
  });
}

// --- CONSULTA DE HISTORIAL ---

/**
 * Traduce el filtro del historial a la condición de Prisma.
 * Cada filtro presente suma una condición y todas se combinan con AND (son claves del mismo objeto).
 * Se arma con propiedades condicionales porque el tsconfig no admite asignar `undefined` a una propiedad opcional.
 */
function construirCondicionHistorial(filtro: FiltroHistorialVentas): Prisma.VentaWhereInput {
  const hayFiltroDeFecha = filtro.fechaDesdeInclusiva !== undefined || filtro.fechaHastaExclusiva !== undefined;

  return {
    ...(hayFiltroDeFecha
      ? {
          fechaHora: {
            ...(filtro.fechaDesdeInclusiva !== undefined ? { gte: filtro.fechaDesdeInclusiva } : {}),
            ...(filtro.fechaHastaExclusiva !== undefined ? { lt: filtro.fechaHastaExclusiva } : {}),
          },
        }
      : {}),
    ...(filtro.estado !== undefined ? { estado: filtro.estado } : {}),
    // "some" evita duplicar la venta cuando el producto aparece en más de un detalle
    ...(filtro.idProducto !== undefined ? { detalles: { some: { idProducto: filtro.idProducto } } } : {}),
  };
}

/**
 * Busca una página del historial de ventas y el total de registros que cumplen el filtro.
 * Orden fijo: fecha descendente con desempate por id descendente; sin desempate la paginación
 * podría repetir o saltarse filas que comparten la misma fecha.
 * @param filtro Filtros ya traducidos (fechas como instantes).
 * @param desplazamiento Cantidad de filas a saltar.
 * @param cantidadPorPagina Cantidad máxima de filas a devolver.
 */
export async function buscarHistorialVentas(
  filtro: FiltroHistorialVentas,
  desplazamiento: number,
  cantidadPorPagina: number,
): Promise<PaginaHistorialVentas> {
  // El mismo where en las filas y en el conteo, para que el total sea coherente con la lista
  const condicion = construirCondicionHistorial(filtro);

  // RepeatableRead: ambas consultas ven la misma foto de la BD aunque entre una venta nueva a mitad de camino
  const [filas, totalRegistros] = await prisma.$transaction(
    [
      prisma.venta.findMany({
        where: condicion,
        orderBy: [{ fechaHora: "desc" }, { idVenta: "desc" }],
        skip: desplazamiento,
        take: cantidadPorPagina,
        // Solo las columnas de la grilla: payload liviano
        select: {
          idVenta: true,
          numeroComprobante: true,
          fechaHora: true,
          estado: true,
          montoTotal: true,
          clienteReferencia: true,
          origen: true,
          modalidadEntrega: true,
        },
      }),
      prisma.venta.count({ where: condicion }),
    ],
    { isolationLevel: "RepeatableRead" },
  );

  return {
    filas: filas.map((fila) => ({
      idVenta: fila.idVenta,
      numeroComprobante: fila.numeroComprobante,
      fechaHora: fila.fechaHora,
      estado: fila.estado,
      montoTotalCentavos: aCentavos(fila.montoTotal),
      clienteReferencia: fila.clienteReferencia,
      origen: fila.origen,
      modalidadEntrega: fila.modalidadEntrega,
    })),
    totalRegistros,
  };
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
