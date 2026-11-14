import type { Prisma } from "../../generated/prisma/client.js";
import { aDecimal, Decimal } from "../../shared/decimal.js";
import { prisma } from "../../shared/prisma.js";
import { crearErrorSinCajaParaCambio, crearErrorStockInsuficienteCambio } from "./cambios-mercaderia.errors.js";
import type {
  CambioCalculado,
  CambioDetalleLeido,
  CambioPersistido,
  FiltroHistorialCambios,
  LecturaCambio,
  MedioPagoParaCambio,
  PaginaHistorialCambios,
  ProductoParaCambio,
  RegistrarCambioInput,
  ResultadoAltaCambio,
  VentaOriginalLeida,
} from "./cambios-mercaderia.types.js";

// --- TIPOS DEL REPOSITORIO ---

/** Función de cálculo que inyecta el service; recibe lo leído de la BD y devuelve el cambio calculado o lanza el error de negocio. */
type CalcularCambio = (lectura: LecturaCambio) => CambioCalculado;

/** Una escritura de stock del cambio: descontar lo entregado o ingresar lo devuelto. */
type OperacionStock = {
  idProducto: number;
  tipo: "DESCUENTO" | "INGRESO";
  /** Cantidad a mover. */
  cantidad: Decimal;
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
 * descuenta el entregado, crea el registro y lo relee con el mismo detalle que consulta `GET /:idCambio`.
 * Es la única capa del módulo que toca Prisma.
 * Si algo falla (recurso, regla, caja, stock, BD) se revierte todo: no quedan stocks movidos sin cambio registrado.
 * La relectura va antes de confirmar: lo que se responde es exactamente lo que quedó guardado.
 * Usa el nivel de aislamiento predeterminado (READ COMMITTED), como el resto de las transacciones del sistema.
 * No toca `saldoActual` de la caja: el ingreso queda como `idCaja` + `saldoResultante`, igual que en las ventas.
 *
 * Deuda técnica: la cantidad máxima devolvible de una venta se lee y se valida sin guarda atómica.
 * Dos cambios simultáneos sobre el mismo ticket y producto pueden pasar los dos la validación y devolver,
 * en conjunto, más de lo vendido. El stock del entregado sí tiene guarda atómica.
 * @param input Cuerpo validado del cambio más el usuario tomado del token.
 * @param calcular Cálculo de negocio, ejecutado dentro de la transacción con datos recién leídos.
 * @returns Los datos del cambio persistido y el cambio releído (detalle completo).
 * @throws {ErrorNegocioCambio} Las del cálculo (404/400/409), no hay caja abierta (409) o el stock del entregado
 * no alcanza (409). Se lanza como objeto puro, no como Error.
 */
export async function registrarCambioAtomico(
  input: RegistrarCambioInput,
  calcular: CalcularCambio,
): Promise<ResultadoAltaCambio> {
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
        precioVenta: aDecimal(producto.precioVenta),
        costoActual: aDecimal(producto.costoActual),
        pesoUnitario: producto.pesoUnitario === null ? null : aDecimal(producto.pesoUnitario),
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
    let cantidadYaDevuelta = new Decimal(0);
    if (ventaOriginal !== null) {
      const acumulado = await transaccion.cambioMercaderia.aggregate({
        _sum: { cantidadDevuelta: true },
        where: {
          ...construirCondicionCambiosActivos(ventaOriginal.idVenta),
          idProductoDevuelto: input.idProductoDevuelto,
        },
      });
      cantidadYaDevuelta = acumulado._sum.cantidadDevuelta === null ? new Decimal(0) : aDecimal(acumulado._sum.cantidadDevuelta);
    }

    // El medio se lee siempre que venga: el cálculo decide si hace falta (con saldo 0 se ignora)
    const medioPago = input.idMedioPago === undefined ? null : await leerMedioPago(transaccion, input.idMedioPago);

    // --- CÁLCULO ---
    const calculo = calcular({
      devuelto: productos.find((producto) => producto.idProducto === input.idProductoDevuelto) ?? null,
      entregado: productos.find((producto) => producto.idProducto === input.idProductoEntregado) ?? null,
      ventaOriginal,
      cantidadYaDevuelta,
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
      { idProducto: input.idProductoEntregado, tipo: "DESCUENTO", cantidad: calculo.cantidadEntregada },
      { idProducto: calculo.idProductoStockIngresado, tipo: "INGRESO", cantidad: calculo.cantidadStockIngresado },
    ];
    operaciones.sort(
      (primera, segunda) =>
        primera.idProducto - segunda.idProducto ||
        ORDEN_DE_TIPO_DE_OPERACION[primera.tipo] - ORDEN_DE_TIPO_DE_OPERACION[segunda.tipo],
    );

    for (const operacion of operaciones) {
      const cantidad = operacion.cantidad.toFixed(3);
      if (operacion.tipo === "DESCUENTO") {
        // Descuento condicionado: solo descuenta si todavía alcanza. Si otra operación consumió el stock
        // entre la lectura y este paso (o nunca alcanzó), count vale 0 y se aborta con 409.
        // Con el mismo producto en ambos lados el stock debe cubrir lo entregado sin contar lo que ingresa
        const actualizados = await transaccion.producto.updateMany({
          where: { idProducto: operacion.idProducto, stockFisico: { gte: cantidad } },
          data: { stockFisico: { decrement: cantidad } },
        });
        if (actualizados.count !== 1) {
          throw crearErrorStockInsuficienteCambio(operacion.idProducto);
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
        cantidadDevuelta: calculo.cantidadDevuelta.toFixed(3),
        esBolsaAbierta: input.esBolsaAbierta,
        precioUnitarioDevuelto: calculo.precioUnitarioDevuelto.toFixed(2),
        idProductoStockIngresado: calculo.idProductoStockIngresado,
        cantidadStockIngresado: calculo.cantidadStockIngresado.toFixed(3),
        idProductoEntregado: input.idProductoEntregado,
        cantidadEntregada: calculo.cantidadEntregada.toFixed(3),
        precioUnitarioEntregado: calculo.precioUnitarioEntregado.toFixed(2),
        costoUnitarioCongeladoEntregado: calculo.costoUnitarioEntregado.toFixed(2),
        saldoResultante: calculo.saldo.toFixed(2),
        idMedioPago: calculo.idMedioPago,
        motivoCambio: input.motivoCambio,
        // Nulos si no hubo saldo, si el medio no es efectivo o si no se informó el recibido
        montoRecibido: calculo.montoRecibido === null ? null : calculo.montoRecibido.toFixed(2),
        vuelto: calculo.vuelto === null ? null : calculo.vuelto.toFixed(2),
      },
      select: { idCambio: true, fechaHora: true },
    });

    // --- RELECTURA ---
    // Dentro de la misma transacción: ve lo que se acaba de escribir y nada puede cambiarlo antes de responder
    const detalle = await leerDetalleCambio(transaccion, cambioCreado.idCambio);
    if (detalle === null) {
      // Inalcanzable: el cambio se creó en esta misma transacción. El error revierte todo y sube a Express como 500
      throw new Error(`No se pudo releer el cambio ${cambioCreado.idCambio} recién creado`);
    }

    return {
      persistido: {
        ...calculo,
        idCambio: cambioCreado.idCambio,
        fechaHora: cambioCreado.fechaHora,
        idVentaOriginal: ventaOriginal === null ? null : ventaOriginal.idVenta,
        idProductoDevuelto: input.idProductoDevuelto,
        esBolsaAbierta: input.esBolsaAbierta,
        idProductoEntregado: input.idProductoEntregado,
      },
      detalle,
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
      cantidad: aDecimal(detalle.cantidad),
      precioUnitario: aDecimal(detalle.precioUnitarioVigente),
    })),
  };
}

/**
 * Lee un medio de pago.
 * @returns El medio con su estado y su tipo (decide si admite monto recibido), o `null` si no existe (el cálculo decide el 404).
 */
async function leerMedioPago(transaccion: ClienteTransaccion, idMedioPago: number): Promise<MedioPagoParaCambio | null> {
  const medio = await transaccion.medioPago.findUnique({
    where: { idMedioPago },
    select: { idMedioPago: true, estado: true, tipo: true },
  });
  return medio === null ? null : { idMedioPago: medio.idMedioPago, activo: medio.estado === "ACTIVO", tipo: medio.tipo };
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
      cantidadDevuelta: aDecimal(fila.cantidadDevuelta),
      esBolsaAbierta: fila.esBolsaAbierta,
      cantidadStockIngresado: fila.cantidadStockIngresado === null ? null : aDecimal(fila.cantidadStockIngresado),
      idProductoEntregado: fila.idProductoEntregado,
      nombreProductoEntregado: fila.productoEntregado.nombre,
      formatoVentaProductoEntregado: fila.productoEntregado.formatoVenta,
      cantidadEntregada: aDecimal(fila.cantidadEntregada),
      saldoResultante: aDecimal(fila.saldoResultante),
      idMedioPago: fila.idMedioPago,
      nombreMedioPago: fila.medioPago?.nombre ?? null,
    })),
    totalRegistros,
  };
}

// --- DETALLE DE CAMBIO ---

/**
 * Lee un cambio completo con una sola consulta: el cambio y, por relación, la venta, los tres productos,
 * el medio de pago y los dos usuarios (vendedor y quien anuló). Así no hay una consulta por relación (N+1)
 * y todo sale de la misma lectura.
 * Recibe el cliente para poder usarse dentro de la transacción del alta (relectura del cambio recién creado)
 * y dentro de la lectura de solo lectura del detalle.
 * Los nombres de producto, de medio de pago y de usuario son los vigentes: no se congelan en el cambio.
 * @returns El cambio, o `null` si no existe (el service decide el 404).
 */
async function leerDetalleCambio(transaccion: ClienteTransaccion, idCambio: number): Promise<CambioDetalleLeido | null> {
  const cambio = await transaccion.cambioMercaderia.findUnique({
    where: { idCambio },
    select: {
      idCambio: true,
      fechaHora: true,
      estado: true,
      motivoCambio: true,
      esBolsaAbierta: true,
      cantidadDevuelta: true,
      precioUnitarioDevuelto: true,
      cantidadStockIngresado: true,
      cantidadEntregada: true,
      precioUnitarioEntregado: true,
      saldoResultante: true,
      montoRecibido: true,
      vuelto: true,
      fechaHoraAnulacion: true,
      motivoAnulacion: true,
      idVentaOriginal: true,
      ventaOriginal: { select: { numeroComprobante: true } },
      idProductoDevuelto: true,
      productoDevuelto: { select: { nombre: true, formatoVenta: true } },
      idProductoStockIngresado: true,
      productoStockIngresado: { select: { nombre: true } },
      idProductoEntregado: true,
      productoEntregado: { select: { nombre: true, formatoVenta: true } },
      idMedioPago: true,
      medioPago: { select: { nombre: true } },
      usuario: { select: { idUsuario: true, nombre: true } },
      usuarioAnulacion: { select: { idUsuario: true, nombre: true } },
    },
  });
  if (cambio === null) {
    return null;
  }

  return {
    idCambio: cambio.idCambio,
    fechaHora: cambio.fechaHora,
    estado: cambio.estado,
    motivoCambio: cambio.motivoCambio,
    ventaOriginal:
      cambio.idVentaOriginal === null
        ? null
        : { idVenta: cambio.idVentaOriginal, numeroComprobante: cambio.ventaOriginal?.numeroComprobante ?? null },
    productoDevuelto: {
      idProducto: cambio.idProductoDevuelto,
      nombre: cambio.productoDevuelto.nombre,
      formatoVenta: cambio.productoDevuelto.formatoVenta,
      cantidadDevuelta: aDecimal(cambio.cantidadDevuelta),
      esBolsaAbierta: cambio.esBolsaAbierta,
      precioUnitario: aDecimal(cambio.precioUnitarioDevuelto),
    },
    productoStockIngresado: {
      idProducto: cambio.idProductoStockIngresado,
      nombre: cambio.productoStockIngresado.nombre,
      cantidadStockIngresado: aDecimal(cambio.cantidadStockIngresado),
    },
    productoEntregado: {
      idProducto: cambio.idProductoEntregado,
      nombre: cambio.productoEntregado.nombre,
      formatoVenta: cambio.productoEntregado.formatoVenta,
      cantidadEntregada: aDecimal(cambio.cantidadEntregada),
      precioUnitario: aDecimal(cambio.precioUnitarioEntregado),
    },
    saldoResultante: aDecimal(cambio.saldoResultante),
    medioPago:
      cambio.idMedioPago === null || cambio.medioPago === null
        ? null
        : { idMedioPago: cambio.idMedioPago, nombre: cambio.medioPago.nombre },
    montoRecibido: cambio.montoRecibido === null ? null : aDecimal(cambio.montoRecibido),
    vuelto: cambio.vuelto === null ? null : aDecimal(cambio.vuelto),
    vendedor: { idUsuario: cambio.usuario.idUsuario, nombre: cambio.usuario.nombre },
    // Solo hay auditoría completa en un cambio anulado después de registrarla; en cualquier otro caso es nula
    anulacion:
      cambio.fechaHoraAnulacion === null || cambio.motivoAnulacion === null || cambio.usuarioAnulacion === null
        ? null
        : {
            fechaHora: cambio.fechaHoraAnulacion,
            usuario: { idUsuario: cambio.usuarioAnulacion.idUsuario, nombre: cambio.usuarioAnulacion.nombre },
            motivo: cambio.motivoAnulacion,
          },
  };
}

/**
 * Busca un cambio completo para `GET /api/cambios-mercaderia/:idCambio`. Es solo lectura.
 * Corre en una transacción `RepeatableRead` como el resto de las consultas del sistema: todas las lecturas
 * ven la misma foto de la base aunque el motor resuelva las relaciones con más de una consulta.
 * @returns El cambio, o `null` si no existe.
 */
export async function buscarDetalleCambio(idCambio: number): Promise<CambioDetalleLeido | null> {
  return prisma.$transaction((transaccion) => leerDetalleCambio(transaccion, idCambio), {
    isolationLevel: "RepeatableRead",
  });
}
