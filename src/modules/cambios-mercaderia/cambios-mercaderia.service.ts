import { aDecimal, Decimal, redondearACantidad, redondearAMoneda } from "../../shared/decimal.js";
import { evaluarBolsaAbierta } from "../inventario/inventario.service.js";
import {
  calcularDesplazamiento,
  calcularInicioDiaArgentina,
  calcularTotalPaginas,
  LIMITE_MINUTOS_ANULACION,
} from "../ventas/ventas.service.js";
import type { TipoMedioPago } from "../ventas/ventas.types.js";
import {
  crearErrorBolsaAbiertaNoPermitida,
  crearErrorCambioNoEncontrado,
  crearErrorCantidadExcedeVenta,
  crearErrorCantidadNoEntera,
  crearErrorMedioPagoInactivo,
  crearErrorMedioPagoNoExiste,
  crearErrorMedioPagoRequerido,
  crearErrorMontoRecibidoInsuficiente,
  crearErrorMontoRecibidoNoEfectivo,
  crearErrorPesoDevueltoExcedeBolsa,
  crearErrorPesoDevueltoNoPositivo,
  crearErrorProductoEntregadoInactivo,
  crearErrorProductoNoExiste,
  crearErrorProductoNoFiguraEnVenta,
  crearErrorSaldoNegativo,
  crearErrorValorExcedeMaximo,
  crearErrorVentaOriginalAnulada,
  crearErrorVentaOriginalNoExiste,
  crearErrorVentaOriginalPendientePago,
} from "./cambios-mercaderia.errors.js";
import { buscarDetalleCambio, buscarHistorialCambios, registrarCambioAtomico } from "./cambios-mercaderia.repository.js";
import type {
  CambioCalculado,
  CambioDetalle,
  CambioDetalleLeido,
  CambioHistorial,
  CambioRegistrado,
  CambioPersistido,
  ConsultarCambioInput,
  ConsultarCambioResponse,
  ConsultarHistorialCambiosInput,
  ConsultarHistorialCambiosResponse,
  EstadoCambioHistorial,
  FilaHistorialCambio,
  FiltroHistorialCambios,
  IngresoAlStockCalculado,
  LecturaCambio,
  ProductoParaCambio,
  RegistrarCambioInput,
  RegistrarCambioResponse,
  VentaOriginalLeida,
} from "./cambios-mercaderia.types.js";

// --- CONSTANTES ---

/** Máximo de una columna decimal(10,3): 9.999.999,999. */
const MAXIMO_CANTIDAD_COLUMNA = new Decimal("9999999.999");

/** Máximo de una columna decimal(10,2): 99.999.999,99. */
const MAXIMO_IMPORTE_COLUMNA = new Decimal("99999999.99");

/** Milisegundos que dura un minuto, para convertir la ventana de modificación a un instante. */
const MILISEGUNDOS_POR_MINUTO = 60_000;

// --- ORQUESTACIÓN ---

/**
 * Registra un cambio de mercadería: calcula con reglas puras y persiste en una única transacción.
 * El cálculo se inyecta al repositorio como función para que corra dentro de la transacción,
 * con los datos leídos en ese mismo momento. El repositorio relee el cambio creado dentro de esa misma
 * transacción, así que lo que se devuelve es lo que quedó guardado.
 * @param input Cuerpo ya validado por Zod más el usuario del token.
 * @returns Respuesta lista para enviar al frontend: los campos planos de siempre más el detalle completo.
 * @throws {ErrorNegocioCambio} Si alguna regla de negocio no se cumple (nada queda escrito).
 */
export async function registrarCambio(input: RegistrarCambioInput): Promise<RegistrarCambioResponse> {
  const { persistido, detalle } = await registrarCambioAtomico(input, (lectura) => calcularCambio(input, lectura));

  return {
    exito: true,
    mensaje: persistido.saldo.gt(0)
      ? "Cambio registrado, stock actualizado y saldo asentado en caja"
      : "Cambio registrado y stock actualizado",
    // El reloj se toma después de confirmar la transacción: es lo más cercano al momento en que el front recibe la respuesta
    fechaHoraServidor: new Date().toISOString(),
    // Los campos planos van primero: si el detalle repite un nombre (idCambio, fechaHora, estado, saldoResultante), prevalece el detalle
    cambio: { ...convertirCamposPlanosDelCambio(persistido), ...construirDetalleCambio(detalle) },
  };
}

// --- CÁLCULO PURO ---

/**
 * Aplica todas las reglas de negocio de un cambio sin acceder a la base de datos.
 * Es pura a propósito: así se prueba con datos de ejemplo sin conectarse a Supabase.
 * El orden de las comprobaciones es parte del contrato: 404 (devuelto, entregado, venta), 400 (entregado inactivo,
 * cantidades, bolsa abierta y peso devuelto), vínculo con la venta (409 estado, 400 producto ausente, 409 exceso) y por
 * último el saldo, el medio de pago y el efectivo. El vínculo va antes que el saldo porque el precio del devuelto sale del ticket.
 * La falta de caja y el stock insuficiente del entregado los resuelve el repositorio después de este cálculo.
 * Todo importe y todo peso se calcula con Decimal exacto, sin pasar por `number`.
 * @param input Cuerpo validado del cambio.
 * @param lectura Recursos leídos de la BD dentro de la transacción.
 * @returns Cantidades, precios, crédito, saldo, cobro y producto que recibe el ingreso, listos para persistir.
 * @throws {ErrorNegocioCambio} Recurso inexistente (404), regla de bolsa, peso, cantidad, saldo, medio o efectivo inválido (400),
 * venta anulada, pendiente de pago o cantidad excedida (409). Se lanza como objeto puro, no como Error.
 */
export function calcularCambio(input: RegistrarCambioInput, lectura: LecturaCambio): CambioCalculado {
  // --- RECURSOS ---
  const { devuelto, entregado, ventaOriginal } = lectura;
  if (devuelto === null) {
    throw crearErrorProductoNoExiste(input.idProductoDevuelto);
  }
  if (entregado === null) {
    throw crearErrorProductoNoExiste(input.idProductoEntregado);
  }
  if (input.idVentaOriginal !== undefined && ventaOriginal === null) {
    throw crearErrorVentaOriginalNoExiste(input.idVentaOriginal);
  }

  // --- ENTREGADO Y CANTIDADES ---
  // El devuelto puede estar inactivo (se pudo desactivar después de venderlo); el entregado sale hoy del local
  if (!entregado.activo) {
    throw crearErrorProductoEntregadoInactivo(entregado.nombre);
  }
  // La BD guarda 3 decimales: se normaliza la cantidad igual que lo hacía el redondeo a milésimas
  const cantidadDevuelta = redondearACantidad(aDecimal(input.cantidadDevuelta));
  const cantidadEntregada = redondearACantidad(aDecimal(input.cantidadEntregada));
  validarCantidadEntera(devuelto, cantidadDevuelta);
  validarCantidadEntera(entregado, cantidadEntregada);

  // --- INGRESO AL STOCK ---
  const ingreso = calcularIngresoAlStock(input, devuelto, cantidadDevuelta);

  // --- VÍNCULO CON LA VENTA ORIGINAL ---
  // Con ticket, el devuelto vale lo que se pagó por él; sin ticket, su precio actual
  const precioUnitarioDevuelto =
    ventaOriginal === null
      ? devuelto.precioVenta
      : validarVentaOriginal(ventaOriginal, devuelto.idProducto, cantidadDevuelta, lectura.cantidadYaDevuelta);

  // --- VALORES, SALDO Y COBRO ---
  const valorDevuelto = calcularCreditoDevuelto(precioUnitarioDevuelto, cantidadDevuelta, ingreso);
  const valorEntregado = calcularSubtotal(entregado.precioVenta, cantidadEntregada);
  const saldo = calcularSaldo(valorDevuelto, valorEntregado);
  const cobro = resolverCobro(input, lectura, saldo);

  return {
    cantidadDevuelta,
    idProductoStockIngresado: ingreso.idProductoStockIngresado,
    cantidadStockIngresado: ingreso.cantidadStockIngresado,
    precioUnitarioDevuelto,
    cantidadEntregada,
    precioUnitarioEntregado: entregado.precioVenta,
    // El costo se congela del entregado; el del devuelto no se guarda (el modelo no tiene dónde)
    costoUnitarioEntregado: entregado.costoActual,
    valorDevuelto,
    valorEntregado,
    saldo,
    ...cobro,
  };
}

// --- REGLAS AUXILIARES ---

/**
 * Exige cantidad entera a un producto por unidad (1.5 bolsas no tiene sentido).
 * @throws {ErrorNegocioCambio} 400 si el producto es UNIDAD y la cantidad tiene decimales.
 */
function validarCantidadEntera(producto: ProductoParaCambio, cantidad: Decimal): void {
  if (producto.formatoVenta === "UNIDAD" && !cantidad.isInteger()) {
    throw crearErrorCantidadNoEntera(producto.nombre);
  }
}

/**
 * Decide qué producto recibe el ingreso y cuánto entra.
 * Bolsa cerrada (o devuelto a granel): ingresa el mismo producto y la misma cantidad.
 * Bolsa abierta: ingresan al granel los kilos que informa el vendedor (`pesoDevuelto`); si no lo informa, el peso
 * nominal de las bolsas (peso por bolsa × cantidad), que es el comportamiento de antes. El peso devuelto no puede
 * superar ese peso nominal ni ser cero.
 * @throws {ErrorNegocioCambio} 400 si el producto no admite bolsa abierta, si el peso es inválido o si los kilos no entran en la columna.
 */
function calcularIngresoAlStock(
  input: RegistrarCambioInput,
  devuelto: ProductoParaCambio,
  cantidadDevuelta: Decimal,
): IngresoAlStockCalculado {
  if (!input.esBolsaAbierta) {
    return { idProductoStockIngresado: devuelto.idProducto, cantidadStockIngresado: cantidadDevuelta, pesoNominalUnitario: null };
  }

  // La misma regla que decide `permiteBolsaAbierta` en el catálogo: así no pueden divergir
  const motivo = evaluarBolsaAbierta({
    formatoVenta: devuelto.formatoVenta,
    // Solo decide si el peso está cargado y es positivo; el cálculo posterior usa el Decimal exacto
    pesoUnitarioMilesimas: devuelto.pesoUnitario === null ? null : devuelto.pesoUnitario.mul(1000).toNumber(),
    productoGranel: devuelto.productoGranel,
  });
  const { productoGranel, pesoUnitario } = devuelto;
  // Las comprobaciones de nulo son inalcanzables si `motivo` es nulo; sirven para que TypeScript lo sepa
  if (motivo !== null || productoGranel === null || pesoUnitario === null) {
    throw crearErrorBolsaAbiertaNoPermitida(devuelto.nombre, motivo ?? "no tiene producto a granel o peso cargado");
  }

  // Producto UNIDAD ya validado como entero: la cantidad son bolsas completas
  const pesoMaximo = cantidadDevuelta.mul(pesoUnitario);
  const pesoDevuelto =
    input.pesoDevuelto === undefined ? pesoMaximo : redondearACantidad(aDecimal(input.pesoDevuelto));
  if (!pesoDevuelto.gt(0)) {
    throw crearErrorPesoDevueltoNoPositivo();
  }
  if (pesoDevuelto.gt(pesoMaximo)) {
    throw crearErrorPesoDevueltoExcedeBolsa(formatearCantidad(pesoDevuelto), formatearCantidad(pesoMaximo));
  }
  if (pesoDevuelto.gt(MAXIMO_CANTIDAD_COLUMNA)) {
    throw crearErrorValorExcedeMaximo("La cantidad que ingresa al granel");
  }
  return {
    idProductoStockIngresado: productoGranel.idProducto,
    cantidadStockIngresado: pesoDevuelto,
    pesoNominalUnitario: pesoUnitario,
  };
}

/**
 * Valida el vínculo con la venta original y devuelve el precio al que se vendió el producto devuelto.
 * Si el producto figura en más de un detalle (datos antiguos), se suman las cantidades y se toma el precio del primero.
 * @param cantidadYaDevuelta Lo devuelto antes en cambios activos de esta venta y este producto.
 * @returns Precio unitario del devuelto en pesos, sin prorratear el descuento manual de la venta.
 * @throws {ErrorNegocioCambio} Venta anulada o pendiente de pago (409), producto ausente (400) o cantidad excedida (409).
 */
function validarVentaOriginal(
  ventaOriginal: VentaOriginalLeida,
  idProductoDevuelto: number,
  cantidadDevuelta: Decimal,
  cantidadYaDevuelta: Decimal,
): Decimal {
  if (ventaOriginal.estado === "ANULADA") {
    throw crearErrorVentaOriginalAnulada(ventaOriginal.idVenta);
  }
  if (ventaOriginal.estado === "PENDIENTE_PAGO") {
    throw crearErrorVentaOriginalPendientePago();
  }

  const detallesDelProducto = ventaOriginal.detalles.filter((detalle) => detalle.idProducto === idProductoDevuelto);
  const primerDetalle = detallesDelProducto[0];
  if (primerDetalle === undefined) {
    throw crearErrorProductoNoFiguraEnVenta(idProductoDevuelto, ventaOriginal.idVenta);
  }

  const cantidadVendida = detallesDelProducto.reduce((suma, detalle) => suma.plus(detalle.cantidad), new Decimal(0));
  const cantidadRestante = cantidadVendida.minus(cantidadYaDevuelta);
  // Con datos inconsistentes (más devuelto que vendido) lo disponible es 0, nunca negativo
  const cantidadDisponible = cantidadRestante.isNegative() ? new Decimal(0) : cantidadRestante;
  if (cantidadDevuelta.gt(cantidadDisponible)) {
    throw crearErrorCantidadExcedeVenta(
      idProductoDevuelto,
      ventaOriginal.idVenta,
      formatearCantidad(cantidadDevuelta),
      formatearCantidad(cantidadDisponible),
    );
  }
  return primerDetalle.precioUnitario;
}

/** Precio unitario × cantidad, redondeado a centavos. El producto es exacto: no hay desborde posible. */
function calcularSubtotal(precioUnitario: Decimal, cantidad: Decimal): Decimal {
  return redondearAMoneda(precioUnitario.mul(cantidad));
}

/**
 * Calcula el crédito del producto devuelto, redondeado a centavos.
 * Bolsa cerrada (o a granel): `precio unitario × cantidad devuelta`.
 * Bolsa abierta: el precio de la BOLSA (no el del granel) por la fracción que se devuelve:
 * `precio de la bolsa × (peso devuelto ÷ peso nominal)`. Se multiplica primero y se divide al final, con 40
 * dígitos de precisión, y se redondea una sola vez a 2 decimales (la mitad hacia arriba).
 * Ejemplo: bolsa de 15 kg a 60000 devuelta con 14,5 kg → 60000 × 14,5 ÷ 15 = 58000,00.
 * Sin peso devuelto, el peso es el nominal y el resultado coincide con `precio × cantidad` (sin pérdida de exactitud).
 * @param precioUnitarioDevuelto Precio unitario del devuelto (del ticket o vigente); con bolsa abierta, el de la bolsa.
 * @param cantidadDevuelta Unidades devueltas (bolsas enteras con bolsa abierta).
 * @param ingreso Peso devuelto (en `cantidadStockIngresado`) y peso nominal de una bolsa, si es bolsa abierta.
 */
function calcularCreditoDevuelto(
  precioUnitarioDevuelto: Decimal,
  cantidadDevuelta: Decimal,
  ingreso: IngresoAlStockCalculado,
): Decimal {
  if (ingreso.pesoNominalUnitario === null) {
    return calcularSubtotal(precioUnitarioDevuelto, cantidadDevuelta);
  }
  return redondearAMoneda(
    precioUnitarioDevuelto.mul(ingreso.cantidadStockIngresado).div(ingreso.pesoNominalUnitario),
  );
}

/**
 * Calcula el saldo a favor del local: el valor de lo entregado menos el crédito del devuelto, con Decimal exacto.
 * Cada lado ya viene redondeado a centavos por separado, igual que el subtotal de una línea de venta.
 * @throws {ErrorNegocioCambio} 400 si el saldo es negativo (no hay reembolsos) o no entra en su columna.
 */
function calcularSaldo(valorDevuelto: Decimal, valorEntregado: Decimal): Decimal {
  const saldo = valorEntregado.minus(valorDevuelto);

  if (saldo.lt(0)) {
    throw crearErrorSaldoNegativo(saldo.toFixed(2));
  }
  if (saldo.gt(MAXIMO_IMPORTE_COLUMNA)) {
    throw crearErrorValorExcedeMaximo("El saldo");
  }
  return saldo;
}

/**
 * Resuelve el cobro del saldo: medio de pago, monto recibido y vuelto.
 * Con saldo 0 no hay cobro: el medio, el monto recibido y el vuelto son nulos, y los que traiga el body se ignoran.
 * Con saldo mayor a 0 el medio es obligatorio, debe existir y estar activo. No hay recargo ni descuento: el monto
 * a cobrar es el saldo. El monto recibido solo corresponde al efectivo (ver `calcularMontoRecibidoYVueltoCambio`).
 * @throws {ErrorNegocioCambio} 400 si falta, está inactivo o el efectivo es inválido; 404 si el medio no existe.
 */
function resolverCobro(
  input: RegistrarCambioInput,
  lectura: LecturaCambio,
  saldo: Decimal,
): Pick<CambioCalculado, "idMedioPago" | "montoRecibido" | "vuelto"> {
  if (saldo.isZero()) {
    return { idMedioPago: null, montoRecibido: null, vuelto: null };
  }
  if (input.idMedioPago === undefined) {
    throw crearErrorMedioPagoRequerido(saldo.toFixed(2));
  }
  if (lectura.medioPago === null) {
    throw crearErrorMedioPagoNoExiste(input.idMedioPago);
  }
  if (!lectura.medioPago.activo) {
    throw crearErrorMedioPagoInactivo(input.idMedioPago);
  }
  return {
    idMedioPago: lectura.medioPago.idMedioPago,
    ...calcularMontoRecibidoYVueltoCambio(lectura.medioPago.idMedioPago, lectura.medioPago.tipo, input.montoRecibido, saldo),
  };
}

/**
 * Valida el monto recibido del saldo de un cambio y calcula su vuelto, con Decimal exacto.
 * Solo el efectivo admite monto recibido. Si no se informa, no se asume pago exacto: ambos quedan nulos.
 * ATENCIÓN: es la misma regla, con las mismas validaciones y los mismos mensajes, que
 * `calcularMontoRecibidoYVuelto` de `ventas.service.ts` (que trabaja con centavos enteros). Si cambia una,
 * hay que cambiar la otra.
 * @param idMedioPago Medio del pago, para el mensaje de error.
 * @param tipo Tipo del medio.
 * @param montoRecibido Monto recibido en pesos, si el cliente lo informó.
 * @param montoFinal Monto a cobrar: el saldo (el cambio no aplica recargo ni descuento).
 * @throws {ErrorNegocioCambio} 400 si el medio no es efectivo o el recibido no alcanza el monto final.
 */
function calcularMontoRecibidoYVueltoCambio(
  idMedioPago: number,
  tipo: TipoMedioPago,
  montoRecibido: number | undefined,
  montoFinal: Decimal,
): Pick<CambioCalculado, "montoRecibido" | "vuelto"> {
  if (montoRecibido === undefined) {
    return { montoRecibido: null, vuelto: null };
  }
  if (tipo !== "EFECTIVO") {
    throw crearErrorMontoRecibidoNoEfectivo(idMedioPago);
  }

  const montoRecibidoEnPesos = redondearAMoneda(aDecimal(montoRecibido));
  if (montoRecibidoEnPesos.lt(montoFinal)) {
    throw crearErrorMontoRecibidoInsuficiente(montoRecibidoEnPesos.toFixed(2), montoFinal.toFixed(2), idMedioPago);
  }

  return { montoRecibido: montoRecibidoEnPesos, vuelto: montoRecibidoEnPesos.minus(montoFinal) };
}

// --- RESPUESTA ---

/**
 * Convierte lo calculado y persistido a los campos planos que el alta ya devolvía (los que el detalle no tiene).
 * Se conservan para no romper a quien los lea; el resto del cambio sale de `construirDetalleCambio`.
 * Cantidades como texto con 3 decimales y montos con 2.
 */
function convertirCamposPlanosDelCambio(cambio: CambioPersistido): Omit<CambioRegistrado, keyof CambioDetalle> {
  return {
    idVentaOriginal: cambio.idVentaOriginal,
    idProductoDevuelto: cambio.idProductoDevuelto,
    cantidadDevuelta: formatearCantidad(cambio.cantidadDevuelta),
    esBolsaAbierta: cambio.esBolsaAbierta,
    precioUnitarioDevuelto: formatearImporte(cambio.precioUnitarioDevuelto),
    idProductoStockIngresado: cambio.idProductoStockIngresado,
    cantidadStockIngresado: formatearCantidad(cambio.cantidadStockIngresado),
    idProductoEntregado: cambio.idProductoEntregado,
    cantidadEntregada: formatearCantidad(cambio.cantidadEntregada),
    precioUnitarioEntregado: formatearImporte(cambio.precioUnitarioEntregado),
    idMedioPago: cambio.idMedioPago,
  };
}

// --- CONSULTA DE HISTORIAL ---

/**
 * Consulta una página del historial de cambios con sus filtros.
 * @param consulta Query ya validada por Zod (con valores por defecto aplicados).
 * @returns Los cambios de la página, los metadatos de paginación y la hora del servidor. Una página fuera de rango devuelve lista vacía.
 */
export async function consultarHistorialCambios(
  consulta: ConsultarHistorialCambiosInput,
): Promise<ConsultarHistorialCambiosResponse> {
  const filtro = calcularFiltroHistorialCambios(consulta);
  const desplazamiento = calcularDesplazamiento(consulta.pagina, consulta.cantidadPorPagina);

  const paginaEncontrada = await buscarHistorialCambios(filtro, desplazamiento, consulta.cantidadPorPagina);

  return {
    exito: true,
    // El reloj se toma recién después de leer: es lo más cercano al momento en que el front recibe la respuesta
    fechaHoraServidor: new Date().toISOString(),
    cambios: paginaEncontrada.filas.map(convertirFilaHistorialCambio),
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
export function calcularFiltroHistorialCambios(consulta: ConsultarHistorialCambiosInput): FiltroHistorialCambios {
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
    ...(consulta.vinculo !== undefined ? { vinculo: consulta.vinculo } : {}),
    ...(consulta.idMedioPago !== undefined ? { idMedioPago: consulta.idMedioPago } : {}),
  };
}

/**
 * Calcula hasta cuándo se puede anular o editar un cambio: su fecha y hora más la ventana de anulación de ventas.
 * @returns El instante límite, o `null` si el cambio está anulado (ya no tiene ventana).
 */
export function calcularLimiteModificacionCambio(fechaHora: Date, estado: EstadoCambioHistorial): Date | null {
  if (estado === "ANULADO") {
    return null;
  }
  return new Date(fechaHora.getTime() + LIMITE_MINUTOS_ANULACION * MILISEGUNDOS_POR_MINUTO);
}

/** Convierte una fila del repositorio al formato de la respuesta (fechas ISO, cantidades con 3 decimales y saldo con 2). */
function convertirFilaHistorialCambio(fila: FilaHistorialCambio): CambioHistorial {
  const limiteModificacion = calcularLimiteModificacionCambio(fila.fechaHora, fila.estado);

  return {
    idCambio: fila.idCambio,
    fechaHora: fila.fechaHora.toISOString(),
    estado: fila.estado,
    fechaHoraLimiteModificacion: limiteModificacion === null ? null : limiteModificacion.toISOString(),
    idVentaOriginal: fila.idVentaOriginal,
    numeroComprobanteVentaOriginal: fila.numeroComprobanteVentaOriginal,
    idProductoDevuelto: fila.idProductoDevuelto,
    nombreProductoDevuelto: fila.nombreProductoDevuelto,
    formatoVentaProductoDevuelto: fila.formatoVentaProductoDevuelto,
    cantidadDevuelta: formatearCantidad(fila.cantidadDevuelta),
    esBolsaAbierta: fila.esBolsaAbierta,
    // Sin bolsa abierta el alta guarda aquí las unidades devueltas, que ya figuran en `cantidadDevuelta`: no se repiten
    cantidadStockIngresado:
      fila.esBolsaAbierta && fila.cantidadStockIngresado !== null ? formatearCantidad(fila.cantidadStockIngresado) : null,
    idProductoEntregado: fila.idProductoEntregado,
    nombreProductoEntregado: fila.nombreProductoEntregado,
    formatoVentaProductoEntregado: fila.formatoVentaProductoEntregado,
    cantidadEntregada: formatearCantidad(fila.cantidadEntregada),
    saldoResultante: formatearImporte(fila.saldoResultante),
    idMedioPago: fila.idMedioPago,
    nombreMedioPago: fila.nombreMedioPago,
  };
}

// --- DETALLE DE CAMBIO ---

/**
 * Consulta un cambio completo por su id. No exige caja abierta ni distingue roles: lo decide la ruta.
 * @param consulta Parámetro de ruta ya validado por Zod.
 * @returns El cambio con sus valores calculados y la hora del servidor.
 * @throws {ErrorNegocioCambio} 404 si el cambio no existe. Se lanza como objeto puro, no como Error.
 */
export async function consultarCambio(consulta: ConsultarCambioInput): Promise<ConsultarCambioResponse> {
  const cambioLeido = await buscarDetalleCambio(consulta.idCambio);
  if (cambioLeido === null) {
    throw crearErrorCambioNoEncontrado(consulta.idCambio);
  }

  return {
    exito: true,
    // El reloj se toma recién después de leer: es lo más cercano al momento en que el front recibe la respuesta
    fechaHoraServidor: new Date().toISOString(),
    cambio: construirDetalleCambio(cambioLeido),
  };
}

/**
 * Arma el cambio de la respuesta a partir de lo leído. Lo comparten el detalle y el alta (que relee el cambio
 * recién creado), así los dos devuelven exactamente el mismo contenido.
 * Todo el cálculo es con Decimal exacto: el valor de lo entregado se redondea a centavos igual que en el alta
 * y el crédito del devuelto sale de restar el saldo a ese valor.
 * @param cambio Cambio tal como lo entrega el repositorio.
 */
export function construirDetalleCambio(cambio: CambioDetalleLeido): CambioDetalle {
  const valorEntregado = calcularSubtotal(cambio.productoEntregado.precioUnitario, cambio.productoEntregado.cantidadEntregada);
  // El saldo se guardó como (valor entregado − crédito), cada lado redondeado a centavos: el crédito es exactamente
  // la resta inversa. No se recalcula con el peso nominal porque no se guarda y `productos.peso_unitario` puede cambiar después
  const valorDevuelto = valorEntregado.minus(cambio.saldoResultante);
  const limiteModificacion = calcularLimiteModificacionCambio(cambio.fechaHora, cambio.estado);
  const { productoDevuelto, productoStockIngresado, productoEntregado, medioPago } = cambio;

  return {
    idCambio: cambio.idCambio,
    fechaHora: cambio.fechaHora.toISOString(),
    estado: cambio.estado,
    fechaHoraLimiteModificacion: limiteModificacion === null ? null : limiteModificacion.toISOString(),
    motivoCambio: cambio.motivoCambio,
    ventaVinculada: cambio.ventaOriginal,
    articuloDevuelto: {
      idProducto: productoDevuelto.idProducto,
      nombreProducto: productoDevuelto.nombre,
      formatoVenta: productoDevuelto.formatoVenta,
      cantidadDevuelta: formatearCantidad(productoDevuelto.cantidadDevuelta),
      esBolsaAbierta: productoDevuelto.esBolsaAbierta,
      precioUnitario: formatearImporte(productoDevuelto.precioUnitario),
      subtotal: formatearImporte(valorDevuelto),
    },
    productoStockIngresado: {
      idProducto: productoStockIngresado.idProducto,
      nombreProducto: productoStockIngresado.nombre,
      // Sin bolsa abierta la columna guarda las unidades devueltas, que ya figuran en `cantidadDevuelta`: no se repiten
      cantidadStockIngresado: productoDevuelto.esBolsaAbierta
        ? formatearCantidad(productoStockIngresado.cantidadStockIngresado)
        : null,
    },
    articuloEntregado: {
      idProducto: productoEntregado.idProducto,
      nombreProducto: productoEntregado.nombre,
      formatoVenta: productoEntregado.formatoVenta,
      cantidadEntregada: formatearCantidad(productoEntregado.cantidadEntregada),
      precioUnitario: formatearImporte(productoEntregado.precioUnitario),
      subtotal: formatearImporte(valorEntregado),
    },
    valorDevuelto: formatearImporte(valorDevuelto),
    valorEntregado: formatearImporte(valorEntregado),
    saldoResultante: formatearImporte(cambio.saldoResultante),
    pagoSaldo:
      medioPago === null
        ? null
        : {
            idMedioPago: medioPago.idMedioPago,
            nombreMedioPago: medioPago.nombre,
            montoRecibido: cambio.montoRecibido === null ? null : formatearImporte(cambio.montoRecibido),
            vuelto: cambio.vuelto === null ? null : formatearImporte(cambio.vuelto),
          },
    vendedor: cambio.vendedor,
    anulacion:
      cambio.anulacion === null
        ? null
        : {
            fechaHora: cambio.anulacion.fechaHora.toISOString(),
            usuario: cambio.anulacion.usuario,
            motivo: cambio.anulacion.motivo,
          },
  };
}

// --- UTILIDADES DE MONEDA Y CANTIDAD ---

/**
 * Convierte un importe a texto con 2 decimales.
 * @example formatearImporte(new Decimal("1500")) // "1500.00"
 */
function formatearImporte(importe: Decimal): string {
  return importe.toFixed(2);
}

/**
 * Convierte una cantidad o un peso a texto con 3 decimales.
 * @example formatearCantidad(new Decimal("1.875")) // "1.875"
 */
function formatearCantidad(cantidad: Decimal): string {
  return cantidad.toFixed(3);
}
