import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/prisma.js";
import { construirCondicionCambiosActivos } from "../cambios-mercaderia/cambios-mercaderia.repository.js";
import type { DecimalExacto } from "../inventario/inventario.types.js";
import {
  crearErrorAnulacionSimultanea,
  crearErrorDobleCobro,
  crearErrorNegocio,
  crearErrorStockInsuficiente,
} from "./ventas.errors.js";
import type {
  AnulacionPersistida,
  AnularVentaInput,
  CobroFiadoCalculado,
  DecisionAnulacion,
  CobroFiadoPersistido,
  EstadoVenta,
  FiltroHistorialVentas,
  LiquidarFiadoInput,
  MedioPagoVigente,
  PagoCobroCalculado,
  PaginaHistorialVentas,
  ProductoVigente,
  RegistrarVentaInput,
  TotalesVentaCalculados,
  VentaAdeudada,
  VentaAnulable,
  VentaDetallada,
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
  /** Pagos calculados con su recibido y vuelto; vacío en un fiado. */
  pagos: PagoCobroCalculado[];
};

/** Función de cálculo que inyecta el service; recibe lo leído de la BD y devuelve los totales. */
type CalcularVenta = (
  productos: ProductoVigente[],
  medios: MedioPagoVigente[],
) => TotalesVentaCalculados;

/** Función de cálculo del cobro que inyecta el service; recibe la venta (o `null`) y los medios leídos. */
type CalcularCobroFiado = (venta: VentaAdeudada | null, medios: MedioPagoVigente[]) => CobroFiadoCalculado;

/**
 * Función de evaluación de la anulación que inyecta el service; recibe la venta (o `null`) y si hay una caja abierta.
 * Lanza el error de negocio que corresponda o devuelve el estado a anular y el límite de la ventana.
 */
type EvaluarAnulacion = (venta: VentaAnulable | null, hayCajaAbierta: boolean) => DecisionAnulacion;

// --- ALTA DE VENTA ---

/**
 * Guarda una venta completa en una única transacción.
 * Es la única capa del módulo que toca Prisma. Si algo falla (usuario, caja, stock, BD)
 * se revierte todo: no queda stock descontado ni ventas a medias.
 * @param input Cuerpo validado de la venta más el vendedor tomado del token.
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
        // El tipo decide en el service si el pago admite monto recibido (solo efectivo)
        tipo: medio.tipo,
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
        // El esquema Zod garantiza que existe si y solo si hay descuento
        motivoDescuento: input.motivoDescuento ?? null,
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
            // Nulos si el medio no es efectivo o no se informó el recibido
            montoRecibido: centavosOpcionalAString(pago.montoRecibidoCentavos),
            vuelto: centavosOpcionalAString(pago.vueltoCentavos),
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
      pagos: calculo.pagos,
    };
  });
}

// --- COBRO DE FIADO ---

/**
 * Cobra un fiado en una única transacción.
 * Es la única capa que toca Prisma en esta acción. Si algo falla (venta, caja, doble cobro, BD)
 * se revierte todo: no queda la venta cobrada a medias ni pagos sueltos.
 * Usa el nivel de aislamiento predeterminado (READ COMMITTED) a propósito: ante dos cobros simultáneos,
 * el segundo espera el bloqueo de fila del primero y luego ve el estado ya cambiado (409), sin error de serialización.
 * @param input Parámetro de ruta y body validados.
 * @param calcular Cálculo de negocio, ejecutado dentro de la transacción con datos recién leídos.
 * @returns Los datos del cobro persistido.
 * @throws {ErrorNegocio} Las del cálculo (404/409/400), no hay caja abierta (409) o
 * otro cobro cambió el estado de la venta antes de este (409). Se lanza como objeto puro, no como Error.
 */
export async function liquidarFiadoAtomico(
  input: LiquidarFiadoInput,
  calcular: CalcularCobroFiado,
): Promise<CobroFiadoPersistido> {
  return prisma.$transaction(async (tx) => {
    // --- LECTURA Y CÁLCULO ---
    const ventaLeida = await tx.venta.findUnique({
      where: { idVenta: input.idVenta },
      select: { idVenta: true, numeroComprobante: true, estado: true, subtotalBruto: true, descuentoManual: true },
    });
    const medios = await tx.medioPago.findMany({
      where: { idMedioPago: { in: input.pagos.map((pago) => pago.idMedioPago) } },
    });

    // Se convierte lo leído (Decimal) a enteros antes de calcular, para no operar con decimales
    const calculo = calcular(
      ventaLeida === null
        ? null
        : {
            idVenta: ventaLeida.idVenta,
            numeroComprobante: ventaLeida.numeroComprobante,
            estado: ventaLeida.estado,
            subtotalBrutoCentavos: aCentavos(ventaLeida.subtotalBruto),
            descuentoManualCentavos: aCentavos(ventaLeida.descuentoManual),
          },
      medios.map((medio) => ({
        idMedioPago: medio.idMedioPago,
        tipo: medio.tipo,
        activo: medio.estado === "ACTIVO",
        ajusteBp: aBasisPoints(medio.porcentajeRecargo) - aBasisPoints(medio.porcentajeDescuento),
      })),
    );

    // --- CAJA ---
    // El ingreso va a la caja abierta del día en curso, no a la del día del fiado (que no tenía caja).
    // La caja se simula como siempre abierta: se toma la más reciente, igual que en el alta.
    const caja = await tx.sesionCaja.findFirst({
      where: { estado: "ABIERTA" },
      orderBy: { fechaApertura: "desc" },
      select: { idCaja: true },
    });
    if (!caja) {
      throw crearErrorNegocio("No hay una caja abierta para registrar el cobro", 409);
    }

    // --- CAMBIO DE ESTADO CONDICIONADO ---
    // Va ANTES de crear los pagos: toma el bloqueo de la fila. Si otro cobro simultáneo ya la cambió,
    // el where no coincide y count vale 0: se aborta con 409 sin llegar a duplicar pagos (unique idVenta+idMedioPago).
    const fechaHoraPago = new Date();
    const actualizadas = await tx.venta.updateMany({
      where: { idVenta: input.idVenta, estado: "PENDIENTE_PAGO" },
      data: {
        estado: "COMPLETADA",
        fechaHoraPago,
        idCaja: caja.idCaja,
        montoTotal: centavosAString(calculo.montoTotalCentavos),
      },
    });
    if (actualizadas.count !== 1) {
      throw crearErrorDobleCobro(input.idVenta);
    }

    // --- GUARDADO DE LOS PAGOS ---
    // El numeroComprobante no se toca: el recibo conserva el número del ticket de deuda
    await tx.pagoVenta.createMany({
      data: calculo.pagos.map((pago) => ({
        idVenta: input.idVenta,
        idMedioPago: pago.idMedioPago,
        montoBase: centavosAString(pago.montoBaseCentavos),
        porcentajeAplicado: basisPointsAString(pago.porcentajeAplicadoBp),
        montoFinal: centavosAString(pago.montoFinalCentavos),
        // Nulos si el medio no es efectivo o no se informó el recibido
        montoRecibido: centavosOpcionalAString(pago.montoRecibidoCentavos),
        vuelto: centavosOpcionalAString(pago.vueltoCentavos),
      })),
    });

    return {
      idVenta: input.idVenta,
      numeroComprobante: calculo.numeroComprobante,
      montoTotalCentavos: calculo.montoTotalCentavos,
      fechaHoraPago,
      pagos: calculo.pagos,
    };
  });
}

// --- ANULACIÓN DE VENTA ---

/**
 * Anula una venta y repone su stock en una única transacción.
 * Es la única capa que toca Prisma en esta acción. Si algo falla (venta, ventana, caja, carrera, BD)
 * se revierte todo: no queda la venta anulada sin stock repuesto ni stock repuesto sin anular.
 * Usa el nivel de aislamiento predeterminado (READ COMMITTED) a propósito: ante dos operaciones simultáneas
 * sobre la misma venta, la segunda espera el bloqueo de fila de la primera y luego ve el estado ya cambiado (409),
 * sin error de serialización.
 * Baja lógica: no se borra ni se edita ningún pago ni `idCaja`; la reversión de caja es pasar a ANULADA.
 * La auditoría (fecha, usuario y motivo) se escribe en el mismo UPDATE que el estado.
 * @param input Parámetro de ruta, motivo validado y usuario del token.
 * @param evaluar Evaluación de negocio, ejecutada dentro de la transacción con datos recién leídos.
 * @returns Los datos de la anulación persistida.
 * @throws {ErrorNegocio} Las de la evaluación (404/409/403/409) o una operación simultánea que cambió
 * el estado de la venta antes de esta (409). Se lanza como objeto puro, no como Error.
 */
export async function anularVentaAtomica(
  input: AnularVentaInput,
  evaluar: EvaluarAnulacion,
): Promise<AnulacionPersistida> {
  return prisma.$transaction(async (transaccion) => {
    // --- LECTURA Y EVALUACIÓN ---
    const ventaLeida = await transaccion.venta.findUnique({
      where: { idVenta: input.idVenta },
      select: { idVenta: true, numeroComprobante: true, estado: true, fechaHora: true, fechaHoraPago: true },
    });

    // Cualquier caja abierta sirve (no hace falta la del cobro original). Se lee siempre y el service decide
    // si hace falta: así la regla "solo una venta con cobro exige caja" queda fuera del repositorio
    const cajaAbierta = await transaccion.sesionCaja.findFirst({
      where: { estado: "ABIERTA" },
      select: { idCaja: true },
    });

    const decision = evaluar(ventaLeida, cajaAbierta !== null);

    // --- CAMBIO DE ESTADO CONDICIONADO ---
    // El estado y la ventana se exigen en el where del UPDATE y no en un if después del SELECT:
    // entre la lectura y la escritura otra transacción pudo cobrar o anular esta venta, y un if sobre
    // lo leído la dejaría pasar dos veces. El UPDATE toma el bloqueo de fila y, si otra transacción la cambió,
    // vuelve a evaluar el where sobre la fila nueva: no coincide, count vale 0 y se aborta con 409.
    // Prisma no tiene COALESCE: "fechaHoraPago ?? fechaHora" se expresa con OR
    // (pago reciente, o sin pago y venta reciente).
    const actualizadas = await transaccion.venta.updateMany({
      where: {
        idVenta: input.idVenta,
        estado: decision.estadoAnterior,
        OR: [
          { fechaHoraPago: { gte: decision.limiteVentana } },
          { fechaHoraPago: null, fechaHora: { gte: decision.limiteVentana } },
        ],
      },
      // La auditoría va en el mismo UPDATE que el estado: o se anula con su quién, cuándo y por qué, o no se escribe nada.
      // Una venta ya ANULADA nunca coincide con el where, así que su auditoría original no se pisa.
      // Quien anula sale del token (input.idUsuario), no del vendedor original de la venta.
      data: {
        estado: "ANULADA",
        fechaHoraAnulacion: decision.fechaHoraAnulacion,
        idUsuarioAnulacion: input.idUsuario,
        motivoAnulacion: input.motivo,
      },
    });
    if (actualizadas.count !== 1) {
      throw crearErrorAnulacionSimultanea(input.idVenta);
    }

    // --- REPOSICIÓN DE STOCK ---
    // Va DESPUÉS de verificar el count: solo la transacción que ganó la transición repone, así el stock
    // vuelve una sola vez. Los detalles se leen aquí adentro, ya con la venta bloqueada por esta transacción.
    const detalles = await transaccion.detalleVenta.findMany({
      where: { idVenta: input.idVenta },
      // Orden fijo por producto: dos anulaciones simultáneas que comparten productos bloquean las filas
      // en el mismo orden y no se traban entre sí (deadlock)
      orderBy: [{ idProducto: "asc" }, { idDetalle: "asc" }],
      select: { idProducto: true, cantidad: true },
    });
    for (const detalle of detalles) {
      // Incremento atómico en la BD con el decimal exacto leído: sin pasar por coma flotante ni leer el stock antes.
      // Sin tope ni conversión UNIDAD/GRANEL: se devuelve al mismo producto la cantidad que salió
      await transaccion.producto.update({
        where: { idProducto: detalle.idProducto },
        data: { stockFisico: { increment: detalle.cantidad } },
      });
    }

    return {
      idVenta: input.idVenta,
      numeroComprobante: decision.numeroComprobante,
      estadoAnterior: decision.estadoAnterior,
      fechaHoraAnulacion: decision.fechaHoraAnulacion,
      motivo: input.motivo,
    };
  });
}

// --- LECTURAS AGRUPADAS DE CAMBIOS Y PAGOS ---
// Una consulta por conjunto de ventas (no una por fila): evitan el N+1 del historial y del detalle.

/**
 * Cliente de consulta que aceptan las lecturas agrupadas: el cliente normal de Prisma o el de una transacción interactiva.
 * Solo se exige lo que usan, para poder reutilizarlas dentro y fuera de una transacción.
 */
type ClienteConsulta = Pick<typeof prisma, "cambioMercaderia" | "pagoVenta">;

/**
 * Cuenta los cambios ACTIVOS vinculados a cada venta de un conjunto, en una sola consulta.
 * El criterio de "cambio activo de una venta" es el mismo del tope de cantidad del alta de cambios
 * (`construirCondicionCambiosActivos`). Las ventas sin cambios no aparecen en el resultado: el llamador asume 0.
 * @param idsVentas Ids de la página; vacío no consulta.
 */
async function contarCambiosActivosPorVenta(
  cliente: ClienteConsulta,
  idsVentas: number[],
): Promise<Map<number, number>> {
  const cantidades = new Map<number, number>();
  if (idsVentas.length === 0) {
    return cantidades;
  }

  const grupos = await cliente.cambioMercaderia.groupBy({
    by: ["idVentaOriginal"],
    where: construirCondicionCambiosActivos({ in: idsVentas }),
    _count: { _all: true },
  });
  for (const grupo of grupos) {
    // El where ya excluye los cambios sin venta; la guarda es solo para el tipo (la columna es nullable)
    if (grupo.idVentaOriginal !== null) {
      cantidades.set(grupo.idVentaOriginal, grupo._count._all);
    }
  }
  return cantidades;
}

/**
 * Consulta lo ya devuelto de cada producto de una venta: suma de `cantidadDevuelta` de los cambios ACTIVOS
 * vinculados a ella, agrupada por producto devuelto. Es la misma suma que valida el tope del alta de cambios
 * (mismo criterio vía `construirCondicionCambiosActivos`), pero para todos los productos de una vez.
 * No se resuelve aquí (devuelve la consulta sin esperar) para poder sumarla a un `$transaction([...])` con la lectura de la venta.
 */
function consultarCantidadYaDevueltaPorProducto(cliente: ClienteConsulta, idVenta: number) {
  return cliente.cambioMercaderia.groupBy({
    by: ["idProductoDevuelto"],
    where: construirCondicionCambiosActivos(idVenta),
    _sum: { cantidadDevuelta: true },
  });
}

/**
 * Busca los ids de las ventas con más de un pago. Prisma no puede contar una relación dentro de un `where`,
 * así que se agrupan los pagos por venta y se filtra con `having`. Un fiado pendiente (sin pagos) nunca aparece.
 * Las ventas ANULADAS conservan sus pagos y sí aparecen.
 */
async function buscarIdsVentasConPagoMixto(cliente: ClienteConsulta): Promise<number[]> {
  const grupos = await cliente.pagoVenta.groupBy({
    by: ["idVenta"],
    having: { idPagoVenta: { _count: { gt: 1 } } },
  });
  return grupos.map((grupo) => grupo.idVenta);
}

// --- CONSULTA DE HISTORIAL ---

/**
 * Traduce el filtro del historial a la condición de Prisma.
 * Cada filtro presente suma una condición y todas se combinan con AND (son claves del mismo objeto).
 * Se arma con propiedades condicionales porque el tsconfig no admite asignar `undefined` a una propiedad opcional.
 * @param idsVentasMixtas Ids de las ventas con más de un pago; solo se usan con el filtro `"MIXTO"`.
 */
function construirCondicionHistorial(filtro: FiltroHistorialVentas, idsVentasMixtas: number[]): Prisma.VentaWhereInput {
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
    ...(filtro.origen !== undefined ? { origen: filtro.origen } : {}),
    // Medio puntual: al menos un pago con ese medio ("some"). Una venta mixta que lo usó también coincide, igual que
    // en el filtro del front (que no distingue la mixta al filtrar por un medio). "MIXTO": más de un pago, por sus ids
    ...(typeof filtro.medioPago === "number" ? { pagos: { some: { idMedioPago: filtro.medioPago } } } : {}),
    ...(filtro.medioPago === "MIXTO" ? { idVenta: { in: idsVentasMixtas } } : {}),
    // "contains" con mode insensitive: coincidencia parcial sin distinguir mayúsculas. `%` y `_` actúan como comodines de LIKE
    ...(filtro.textoCliente !== undefined
      ? { clienteReferencia: { contains: filtro.textoCliente, mode: "insensitive" } }
      : {}),
    ...(filtro.numeroComprobante !== undefined
      ? { numeroComprobante: { contains: filtro.numeroComprobante, mode: "insensitive" } }
      : {}),
  };
}

/**
 * Busca una página del historial de ventas y el total de registros que cumplen el filtro.
 * Orden fijo: fecha descendente con desempate por id descendente; sin desempate la paginación
 * podría repetir o saltarse filas que comparten la misma fecha.
 * Todo corre en una transacción `RepeatableRead` (ids de ventas mixtas si hace falta, lista, total y cambios activos),
 * así que la página, el total y los conteos salen de la misma foto de la base.
 * @param filtro Filtros ya traducidos (fechas como instantes).
 * @param desplazamiento Cantidad de filas a saltar.
 * @param cantidadPorPagina Cantidad máxima de filas a devolver.
 */
export async function buscarHistorialVentas(
  filtro: FiltroHistorialVentas,
  desplazamiento: number,
  cantidadPorPagina: number,
): Promise<PaginaHistorialVentas> {
  // Transacción interactiva (y no el arreglo de consultas) porque hay lecturas que dependen de otras:
  // los ids mixtos arman el where y los ids de la página arman el conteo de cambios.
  // RepeatableRead: todas ven la misma foto de la BD aunque entre una venta o un cambio nuevo a mitad de camino
  return prisma.$transaction(
    async (transaccion) => {
      // Solo el filtro "MIXTO" necesita saber qué ventas tienen más de un pago
      const idsVentasMixtas = filtro.medioPago === "MIXTO" ? await buscarIdsVentasConPagoMixto(transaccion) : [];

      // El mismo where en las filas y en el conteo, para que el total sea coherente con la lista
      const condicion = construirCondicionHistorial(filtro, idsVentasMixtas);

      const filas = await transaccion.venta.findMany({
        where: condicion,
        orderBy: [{ fechaHora: "desc" }, { idVenta: "desc" }],
        skip: desplazamiento,
        take: cantidadPorPagina,
        // Solo las columnas de la grilla: payload liviano. `fechaHoraPago` sirve para calcular el límite de modificación
        select: {
          idVenta: true,
          numeroComprobante: true,
          fechaHora: true,
          fechaHoraPago: true,
          estado: true,
          montoTotal: true,
          clienteReferencia: true,
          origen: true,
          modalidadEntrega: true,
        },
      });
      const totalRegistros = await transaccion.venta.count({ where: condicion });

      // Una sola consulta agrupada para toda la página (no una por venta)
      const cambiosActivosPorVenta = await contarCambiosActivosPorVenta(
        transaccion,
        filas.map((fila) => fila.idVenta),
      );

      return {
        filas: filas.map((fila) => ({
          idVenta: fila.idVenta,
          numeroComprobante: fila.numeroComprobante,
          fechaHora: fila.fechaHora,
          fechaHoraPago: fila.fechaHoraPago,
          estado: fila.estado,
          montoTotalCentavos: aCentavos(fila.montoTotal),
          clienteReferencia: fila.clienteReferencia,
          origen: fila.origen,
          modalidadEntrega: fila.modalidadEntrega,
          // Las ventas sin cambios no vienen del groupBy: valen 0
          cantidadCambiosActivos: cambiosActivosPorVenta.get(fila.idVenta) ?? 0,
        })),
        totalRegistros,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

// --- CONSULTA DE UNA VENTA ---

/**
 * Busca una venta por id con sus ítems y pagos. Es solo lectura.
 * El `select` pide únicamente lo que el contrato devuelve; el costo congelado nunca sale de la base.
 * `motivoDescuento`, `montoRecibido` y `vuelto` son nulos en las ventas que no los tienen.
 * Ítems y pagos van ordenados por id para que la respuesta sea determinista.
 * La venta y lo ya devuelto por producto se leen en un `$transaction([...])` con `RepeatableRead` explícito
 * (el nivel por defecto, READ COMMITTED, no garantiza la misma foto entre las dos lecturas).
 * @param idVenta Id de la venta, ya validado.
 * @returns La venta, o `null` si no existe (el service decide el 404).
 */
export async function buscarVentaPorId(idVenta: number): Promise<VentaDetallada | null> {
  // Las consultas se declaran sin esperar y se ejecutan juntas en el $transaction de más abajo
  const consultaVenta = prisma.venta.findUnique({
    where: { idVenta },
    select: {
      idVenta: true,
      numeroComprobante: true,
      fechaHora: true,
      fechaHoraPago: true,
      estado: true,
      origen: true,
      modalidadEntrega: true,
      clienteReferencia: true,
      subtotalBruto: true,
      descuentoManual: true,
      motivoDescuento: true,
      montoTotal: true,
      usuario: { select: { idUsuario: true, nombre: true } },
      // Auditoría de la anulación: nula en ventas no anuladas y en las anuladas antes de registrarla
      fechaHoraAnulacion: true,
      motivoAnulacion: true,
      usuarioAnulacion: { select: { idUsuario: true, nombre: true } },
      detalles: {
        orderBy: { idDetalle: "asc" },
        select: {
          cantidad: true,
          precioUnitarioVigente: true,
          subtotal: true,
          producto: { select: { idProducto: true, nombre: true, formatoVenta: true } },
        },
      },
      pagos: {
        orderBy: { idPagoVenta: "asc" },
        select: {
          montoBase: true,
          porcentajeAplicado: true,
          montoFinal: true,
          montoRecibido: true,
          vuelto: true,
          medioPago: { select: { idMedioPago: true, nombre: true } },
        },
      },
    },
  });

  const [venta, devueltoPorProducto] = await prisma.$transaction(
    [consultaVenta, consultarCantidadYaDevueltaPorProducto(prisma, idVenta)],
    { isolationLevel: "RepeatableRead" },
  );

  // 404 antes de armar nada: sin venta no hay ítems a los que asignarles lo ya devuelto
  if (venta === null) {
    return null;
  }

  // Suma de lo devuelto por producto: se busca por idProducto al armar cada ítem
  const cantidadYaDevueltaPorProducto = new Map<number, DecimalExacto>();
  for (const grupo of devueltoPorProducto) {
    if (grupo._sum.cantidadDevuelta !== null) {
      cantidadYaDevueltaPorProducto.set(grupo.idProductoDevuelto, grupo._sum.cantidadDevuelta);
    }
  }

  // Se convierte lo leído (Decimal) a enteros para que el service formatee sin coma flotante
  return {
    idVenta: venta.idVenta,
    numeroComprobante: venta.numeroComprobante,
    fechaHora: venta.fechaHora,
    fechaHoraPago: venta.fechaHoraPago,
    estado: venta.estado,
    origen: venta.origen,
    modalidadEntrega: venta.modalidadEntrega,
    clienteReferencia: venta.clienteReferencia,
    vendedor: { idUsuario: venta.usuario.idUsuario, nombre: venta.usuario.nombre },
    subtotalBrutoCentavos: aCentavos(venta.subtotalBruto),
    descuentoManualCentavos: aCentavos(venta.descuentoManual),
    motivoDescuento: venta.motivoDescuento,
    montoTotalCentavos: aCentavos(venta.montoTotal),
    items: venta.detalles.map((detalle) => ({
      idProducto: detalle.producto.idProducto,
      nombreProducto: detalle.producto.nombre,
      formatoVenta: detalle.producto.formatoVenta,
      cantidadMilesimas: aMilesimas(detalle.cantidad),
      precioUnitarioCentavos: aCentavos(detalle.precioUnitarioVigente),
      subtotalCentavos: aCentavos(detalle.subtotal),
      // Es el total del producto en la venta: si figura en dos líneas (datos antiguos) ambas llevan el mismo valor,
      // igual que el tope del alta de cambios, que suma por producto
      cantidadYaDevuelta: cantidadYaDevueltaPorProducto.get(detalle.producto.idProducto) ?? null,
    })),
    pagos: venta.pagos.map((pago) => ({
      idMedioPago: pago.medioPago.idMedioPago,
      nombreMedioPago: pago.medioPago.nombre,
      montoBaseCentavos: aCentavos(pago.montoBase),
      porcentajeAplicadoBp: aBasisPoints(pago.porcentajeAplicado),
      montoFinalCentavos: aCentavos(pago.montoFinal),
      // Nulos en ventas anteriores, en medios que no son efectivo o si no se informó el recibido
      montoRecibidoCentavos: pago.montoRecibido === null ? null : aCentavos(pago.montoRecibido),
      vueltoCentavos: pago.vuelto === null ? null : aCentavos(pago.vuelto),
    })),
    // Solo se arma si están las tres columnas: es lo que escribe una anulación completa; cualquier otro caso es nulo
    anulacion:
      venta.fechaHoraAnulacion === null || venta.motivoAnulacion === null || venta.usuarioAnulacion === null
        ? null
        : {
            fechaHora: venta.fechaHoraAnulacion,
            motivo: venta.motivoAnulacion,
            usuario: { idUsuario: venta.usuarioAnulacion.idUsuario, nombre: venta.usuarioAnulacion.nombre },
          },
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

/** Igual que `centavosAString`, pero conserva `null` para las columnas decimales que admiten nulo. */
function centavosOpcionalAString(centavos: number | null): string | null {
  return centavos === null ? null : centavosAString(centavos);
}

/** Milésimas enteras a texto con 3 decimales. */
function milesimasAString(milesimas: number): string {
  return (milesimas / 1000).toFixed(3);
}

/** Basis points a texto de porcentaje con 2 decimales: 1000 pasa a "10.00". */
function basisPointsAString(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2);
}
