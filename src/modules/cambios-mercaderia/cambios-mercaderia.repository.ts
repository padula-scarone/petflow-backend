import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/prisma.js";
import { crearErrorStockInsuficiente } from "../ventas/ventas.errors.js";
import { crearErrorSinCajaParaCambio } from "./cambios-mercaderia.errors.js";
import type {
  CambioCalculado,
  CambioPersistido,
  FiltroHistorialCambios,
  LecturaCambio,
  MedioPagoParaCambio,
  PaginaHistorialCambios,
  ProductoParaCambio,
  RegistrarCambioInput,
  VentaOriginalLeida,
} from "./cambios-mercaderia.types.js";

// --- TIPOS DEL REPOSITORIO ---

/** Función de cálculo que inyecta el service; recibe lo leído de la BD y devuelve el cambio calculado o lanza el error de negocio. */
type CalcularCambio = (lectura: LecturaCambio) => CambioCalculado;

/** Una escritura de stock del cambio: descontar lo entregado o ingresar lo devuelto. */
type OperacionStock = {
  idProducto: number;
  tipo: "DESCUENTO" | "INGRESO";
  /** Cantidad a mover, en milésimas. */
  cantidadMilesimas: number;
};

/** Desempate de dos operaciones sobre el mismo producto: primero se descuenta y después se ingresa. */
const ORDEN_DE_TIPO_DE_OPERACION: Record<OperacionStock["tipo"], number> = { DESCUENTO: 0, INGRESO: 1 };

// --- CONDICIÓN DE CAMBIOS ACTIVOS DE UNA VENTA ---

/**
 * Condición de los cambios que cuentan como "ya devuelto" de una venta: los vinculados a ella y en estado ACTIVO.
 * Es la única definición de ese criterio: la comparten el tope de cantidad del alta y las consultas de ventas
 * (cantidad de cambios activos y cantidad ya devuelta por ítem), para que no diverjan.
 * Un cambio ANULADO no cuenta: al anularse, vuelve a quedar disponible lo que había devuelto.
 * @param idVentaOriginal Una venta, o varias (`{ in: [...] }`) para consultar por lote.
 * @returns Fragmento de `where`; el llamador le suma sus propios filtros (por ejemplo, el producto devuelto).
 */
export function construirCondicionCambiosActivos(
  idVentaOriginal: number | { in: number[] },
): Prisma.CambioMercaderiaWhereInput {
  return { idVentaOriginal, estado: "ACTIVO" };
}

// --- ALTA DE CAMBIO ---

/**
 * Guarda un cambio de mercadería completo en una única transacción: ingresa el stock devuelto,
 * descuenta el entregado y crea el registro. Es la única capa del módulo que toca Prisma.
 * Si algo falla (recurso, regla, caja, stock, BD) se revierte todo: no quedan stocks movidos sin cambio registrado.
 * Usa el nivel de aislamiento predeterminado (READ COMMITTED), como el resto de las transacciones del sistema.
 * No toca `saldoActual` de la caja: el ingreso queda como `idCaja` + `saldoResultante`, igual que en las ventas.
 *
 * Deuda técnica: la cantidad máxima devolvible de una venta se lee y se valida sin guarda atómica.
 * Dos cambios simultáneos sobre el mismo ticket y producto pueden pasar los dos la validación y devolver,
 * en conjunto, más de lo vendido. El stock del entregado sí tiene guarda atómica.
 * @param input Cuerpo validado del cambio más el usuario tomado del token.
 * @param calcular Cálculo de negocio, ejecutado dentro de la transacción con datos recién leídos.
 * @returns Los datos del cambio persistido.
 * @throws {ErrorNegocio} Las del cálculo (404/400/409), no hay caja abierta (409) o el stock del entregado
 * no alcanza (409). Se lanza como objeto puro, no como Error.
 */
export async function registrarCambioAtomico(
  input: RegistrarCambioInput,
  calcular: CalcularCambio,
): Promise<CambioPersistido> {
  return prisma.$transaction(async (transaccion) => {
    // --- LECTURA ---
    const idsProductos = [...new Set([input.idProductoDevuelto, input.idProductoEntregado])];
    const productosLeidos = await transaccion.producto.findMany({
      where: { idProducto: { in: idsProductos } },
      select: {
        idProducto: true,
        nombre: true,
        formatoVenta: true,
        estado: true,
        precioVenta: true,
        costoActual: true,
        pesoUnitario: true,
        productoGranel: { select: { idProducto: true, formatoVenta: true, estado: true } },
      },
    });
    const productos = productosLeidos.map(
      (producto): ProductoParaCambio => ({
        idProducto: producto.idProducto,
        nombre: producto.nombre,
        formatoVenta: producto.formatoVenta,
        activo: producto.estado === "ACTIVO",
        precioCentavos: aCentavos(producto.precioVenta),
        costoCentavos: aCentavos(producto.costoActual),
        pesoUnitarioMilesimas: producto.pesoUnitario === null ? null : aMilesimas(producto.pesoUnitario),
        productoGranel:
          producto.productoGranel === null
            ? null
            : {
                idProducto: producto.productoGranel.idProducto,
                formatoVenta: producto.productoGranel.formatoVenta,
                activo: producto.productoGranel.estado === "ACTIVO",
              },
      }),
    );

    // Solo se lee lo que el body pidió; que no exista lo decide el cálculo (404)
    const ventaOriginal =
      input.idVentaOriginal === undefined ? null : await leerVentaOriginal(transaccion, input.idVentaOriginal);

    // Lo ya devuelto de ese ticket y producto en cambios activos: un cambio anulado vuelve a dejar disponible la cantidad
    let cantidadYaDevueltaMilesimas = 0;
    if (ventaOriginal !== null) {
      const acumulado = await transaccion.cambioMercaderia.aggregate({
        _sum: { cantidadDevuelta: true },
        where: {
          ...construirCondicionCambiosActivos(ventaOriginal.idVenta),
          idProductoDevuelto: input.idProductoDevuelto,
        },
      });
      cantidadYaDevueltaMilesimas =
        acumulado._sum.cantidadDevuelta === null ? 0 : aMilesimas(acumulado._sum.cantidadDevuelta);
    }

    // El medio se lee siempre que venga: el cálculo decide si hace falta (con saldo 0 se ignora)
    const medioPago = input.idMedioPago === undefined ? null : await leerMedioPago(transaccion, input.idMedioPago);

    // --- CÁLCULO ---
    const calculo = calcular({
      devuelto: productos.find((producto) => producto.idProducto === input.idProductoDevuelto) ?? null,
      entregado: productos.find((producto) => producto.idProducto === input.idProductoEntregado) ?? null,
      ventaOriginal,
      cantidadYaDevueltaMilesimas,
      medioPago,
    });

    // --- CAJA ---
    // Mismo patrón que el cobro de un fiado: la caja abierta más reciente. Se exige aunque el saldo sea 0
    // porque `idCaja` es obligatorio en el modelo
    const caja = await transaccion.sesionCaja.findFirst({
      where: { estado: "ABIERTA" },
      orderBy: { fechaApertura: "desc" },
      select: { idCaja: true },
    });
    if (caja === null) {
      throw crearErrorSinCajaParaCambio();
    }

    // --- STOCK ---
    // Orden fijo por producto: dos cambios simultáneos que comparten productos bloquean las filas
    // en el mismo orden y no se traban entre sí (deadlock)
    const operaciones: OperacionStock[] = [
      { idProducto: input.idProductoEntregado, tipo: "DESCUENTO", cantidadMilesimas: calculo.cantidadEntregadaMilesimas },
      {
        idProducto: calculo.idProductoStockIngresado,
        tipo: "INGRESO",
        cantidadMilesimas: calculo.cantidadStockIngresadoMilesimas,
      },
    ];
    operaciones.sort(
      (primera, segunda) =>
        primera.idProducto - segunda.idProducto ||
        ORDEN_DE_TIPO_DE_OPERACION[primera.tipo] - ORDEN_DE_TIPO_DE_OPERACION[segunda.tipo],
    );

    for (const operacion of operaciones) {
      const cantidad = milesimasAString(operacion.cantidadMilesimas);
      if (operacion.tipo === "DESCUENTO") {
        // Descuento condicionado: solo descuenta si todavía alcanza. Si otra operación consumió el stock
        // entre la lectura y este paso (o nunca alcanzó), count vale 0 y se aborta con 409.
        // Con el mismo producto en ambos lados el stock debe cubrir lo entregado sin contar lo que ingresa
        const actualizados = await transaccion.producto.updateMany({
          where: { idProducto: operacion.idProducto, stockFisico: { gte: cantidad } },
          data: { stockFisico: { decrement: cantidad } },
        });
        if (actualizados.count !== 1) {
          throw crearErrorStockInsuficiente(operacion.idProducto);
        }
      } else {
        // Incremento atómico en la BD con el decimal exacto: sin pasar por coma flotante ni leer el stock antes
        await transaccion.producto.update({
          where: { idProducto: operacion.idProducto },
          data: { stockFisico: { increment: cantidad } },
          select: { idProducto: true },
        });
      }
    }

    // --- GUARDADO DEL CAMBIO ---
    const cambioCreado = await transaccion.cambioMercaderia.create({
      data: {
        idVentaOriginal: ventaOriginal === null ? null : ventaOriginal.idVenta,
        idUsuario: input.idUsuario,
        idCaja: caja.idCaja,
        idProductoDevuelto: input.idProductoDevuelto,
        cantidadDevuelta: milesimasAString(calculo.cantidadDevueltaMilesimas),
        esBolsaAbierta: input.esBolsaAbierta,
        precioUnitarioDevuelto: centavosAString(calculo.precioUnitarioDevueltoCentavos),
        idProductoStockIngresado: calculo.idProductoStockIngresado,
        cantidadStockIngresado: milesimasAString(calculo.cantidadStockIngresadoMilesimas),
        idProductoEntregado: input.idProductoEntregado,
        cantidadEntregada: milesimasAString(calculo.cantidadEntregadaMilesimas),
        precioUnitarioEntregado: centavosAString(calculo.precioUnitarioEntregadoCentavos),
        costoUnitarioCongeladoEntregado: centavosAString(calculo.costoUnitarioEntregadoCentavos),
        saldoResultante: centavosAString(calculo.saldoCentavos),
        idMedioPago: calculo.idMedioPago,
      },
      select: { idCambio: true, fechaHora: true },
    });

    return {
      ...calculo,
      idCambio: cambioCreado.idCambio,
      fechaHora: cambioCreado.fechaHora,
      idVentaOriginal: ventaOriginal === null ? null : ventaOriginal.idVenta,
      idProductoDevuelto: input.idProductoDevuelto,
      esBolsaAbierta: input.esBolsaAbierta,
      idProductoEntregado: input.idProductoEntregado,
    };
  });
}

// --- LECTURAS AUXILIARES ---

/** Cliente de transacción de Prisma, tal como lo recibe el callback de `$transaction`. */
type ClienteTransaccion = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Lee la venta a la que se vincula el cambio con sus detalles, ordenados por `idDetalle`
 * (el primero de un producto repetido es el que fija el precio).
 * @returns La venta, o `null` si no existe (el cálculo decide el 404).
 */
async function leerVentaOriginal(transaccion: ClienteTransaccion, idVenta: number): Promise<VentaOriginalLeida | null> {
  const venta = await transaccion.venta.findUnique({
    where: { idVenta },
    select: {
      idVenta: true,
      estado: true,
      detalles: {
        orderBy: { idDetalle: "asc" },
        select: { idProducto: true, cantidad: true, precioUnitarioVigente: true },
      },
    },
  });
  if (venta === null) {
    return null;
  }
  return {
    idVenta: venta.idVenta,
    estado: venta.estado,
    detalles: venta.detalles.map((detalle) => ({
      idProducto: detalle.idProducto,
      cantidadMilesimas: aMilesimas(detalle.cantidad),
      precioUnitarioCentavos: aCentavos(detalle.precioUnitarioVigente),
    })),
  };
}

/**
 * Lee un medio de pago.
 * @returns El medio con su estado, o `null` si no existe (el cálculo decide el 404).
 */
async function leerMedioPago(transaccion: ClienteTransaccion, idMedioPago: number): Promise<MedioPagoParaCambio | null> {
  const medio = await transaccion.medioPago.findUnique({
    where: { idMedioPago },
    select: { idMedioPago: true, estado: true },
  });
  return medio === null ? null : { idMedioPago: medio.idMedioPago, activo: medio.estado === "ACTIVO" };
}

// --- CONSULTA DE HISTORIAL ---

/**
 * Traduce el filtro del historial a la condición de Prisma.
 * Cada filtro presente suma una condición y todas se combinan con AND (son claves del mismo objeto).
 * Se arma con propiedades condicionales porque el tsconfig no admite asignar `undefined` a una propiedad opcional.
 */
function construirCondicionHistorial(filtro: FiltroHistorialCambios): Prisma.CambioMercaderiaWhereInput {
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
    // El producto puede ser el devuelto o el entregado. No se mira el producto que recibió el stock (el granel de una bolsa abierta)
    ...(filtro.idProducto !== undefined
      ? { OR: [{ idProductoDevuelto: filtro.idProducto }, { idProductoEntregado: filtro.idProducto }] }
      : {}),
    // Con venta original = `idVentaOriginal` no nulo; sin ella, nulo
    ...(filtro.vinculo !== undefined
      ? { idVentaOriginal: filtro.vinculo === "VINCULADO" ? { not: null } : null }
      : {}),
    ...(filtro.idMedioPago !== undefined ? { idMedioPago: filtro.idMedioPago } : {}),
  };
}

/**
 * Busca una página del historial de cambios y el total de registros que cumplen el filtro.
 * Es solo lectura. Orden fijo: fecha descendente con desempate por id descendente; sin desempate
 * la paginación podría repetir o saltarse filas que comparten la misma fecha.
 * Los nombres de producto y de medio de pago son los vigentes: no se congelan en el cambio.
 * @param filtro Filtros ya traducidos (fechas como instantes).
 * @param desplazamiento Cantidad de filas a saltar.
 * @param cantidadPorPagina Cantidad máxima de filas a devolver.
 */
export async function buscarHistorialCambios(
  filtro: FiltroHistorialCambios,
  desplazamiento: number,
  cantidadPorPagina: number,
): Promise<PaginaHistorialCambios> {
  // El mismo where en las filas y en el conteo, para que el total sea coherente con la lista
  const condicion = construirCondicionHistorial(filtro);

  // RepeatableRead: ambas consultas ven la misma foto de la BD aunque entre un cambio nuevo a mitad de camino
  const [filas, totalRegistros] = await prisma.$transaction(
    [
      prisma.cambioMercaderia.findMany({
        where: condicion,
        orderBy: [{ fechaHora: "desc" }, { idCambio: "desc" }],
        skip: desplazamiento,
        take: cantidadPorPagina,
        // Solo las columnas de la grilla: sin precios unitarios ni costos congelados
        select: {
          idCambio: true,
          fechaHora: true,
          estado: true,
          idVentaOriginal: true,
          ventaOriginal: { select: { numeroComprobante: true } },
          idProductoDevuelto: true,
          productoDevuelto: { select: { nombre: true, formatoVenta: true } },
          cantidadDevuelta: true,
          esBolsaAbierta: true,
          cantidadStockIngresado: true,
          idProductoEntregado: true,
          productoEntregado: { select: { nombre: true, formatoVenta: true } },
          cantidadEntregada: true,
          saldoResultante: true,
          idMedioPago: true,
          medioPago: { select: { nombre: true } },
        },
      }),
      prisma.cambioMercaderia.count({ where: condicion }),
    ],
    { isolationLevel: "RepeatableRead" },
  );

  return {
    filas: filas.map((fila) => ({
      idCambio: fila.idCambio,
      fechaHora: fila.fechaHora,
      estado: fila.estado,
      idVentaOriginal: fila.idVentaOriginal,
      numeroComprobanteVentaOriginal: fila.ventaOriginal?.numeroComprobante ?? null,
      idProductoDevuelto: fila.idProductoDevuelto,
      nombreProductoDevuelto: fila.productoDevuelto.nombre,
      formatoVentaProductoDevuelto: fila.productoDevuelto.formatoVenta,
      cantidadDevueltaMilesimas: aMilesimas(fila.cantidadDevuelta),
      esBolsaAbierta: fila.esBolsaAbierta,
      cantidadStockIngresadoMilesimas: aMilesimasOpcional(fila.cantidadStockIngresado),
      idProductoEntregado: fila.idProductoEntregado,
      nombreProductoEntregado: fila.productoEntregado.nombre,
      formatoVentaProductoEntregado: fila.productoEntregado.formatoVenta,
      cantidadEntregadaMilesimas: aMilesimas(fila.cantidadEntregada),
      saldoResultanteCentavos: aCentavos(fila.saldoResultante),
      idMedioPago: fila.idMedioPago,
      nombreMedioPago: fila.medioPago?.nombre ?? null,
    })),
    totalRegistros,
  };
}

// --- UTILIDADES ---
// Copias locales de las de ventas, que no se exportan: se evita tocar ese módulo. Su extracción a `shared` es deuda registrada.

// Conversiones desde Decimal de Prisma a enteros internos
/** Pesos (decimal de BD) a centavos enteros. */
function aCentavos(valor: { toNumber(): number }): number {
  return Math.round(valor.toNumber() * 100);
}

/** Cantidad (decimal de BD) a milésimas enteras. */
function aMilesimas(valor: { toNumber(): number }): number {
  return Math.round(valor.toNumber() * 1000);
}

/** Igual que `aMilesimas`, pero conserva `null` por si una columna decimal llegara sin valor. */
function aMilesimasOpcional(valor: { toNumber(): number } | null): number | null {
  return valor === null ? null : aMilesimas(valor);
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
