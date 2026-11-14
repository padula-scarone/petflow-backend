import { crearErrorNegocio, crearErrorStockInsuficiente, esErrorNegocio } from "../ventas/ventas.errors.js";
import type { ErrorNegocio, EstadoHttpNegocio } from "../ventas/ventas.errors.js";

// Los errores de negocio comparten el tipo y la guarda `esErrorNegocio` de ventas, por importación.
// Moverlos a `shared` queda como deuda técnica registrada.

// --- CÓDIGO LEGIBLE POR MÁQUINA ---

/** Valores posibles de `codigo` en los errores del módulo; la documentación OpenAPI toma de acá su lista. */
export const CODIGOS_ERROR_CAMBIO = [
  "DATOS_INVALIDOS",
  "SALDO_NEGATIVO",
  "VENTA_NO_ENCONTRADA",
  "CAMBIO_NO_ENCONTRADO",
  "SIN_CAJA_ABIERTA",
  "STOCK_INSUFICIENTE",
  "VENTA_NO_VINCULABLE",
  "CANTIDAD_EXCEDE_VENTA",
  "PLAZO_VENCIDO",
  "CAMBIO_YA_ANULADO",
  "STOCK_INSUFICIENTE_PARA_REVERTIR",
] as const;

/**
 * Código con el que el front distingue el caso de un rechazo sin leer el texto del mensaje.
 * Es el enum `CodigoErrorCambio` del front; los tres últimos valores (`PLAZO_VENCIDO`, `CAMBIO_YA_ANULADO` y
 * `STOCK_INSUFICIENTE_PARA_REVERTIR`) corresponden a la anulación de un cambio (baja y modificación).
 * El enum del front no tiene valores propios para "producto inexistente" ni "medio de pago inexistente":
 * esos 404 salen como `DATOS_INVALIDOS`.
 */
export type CodigoErrorCambio = (typeof CODIGOS_ERROR_CAMBIO)[number];

/**
 * Error de negocio del módulo de cambios: el de ventas más el `codigo` legible por máquina.
 * Sigue siendo un dato puro (sin class ni new) y `esErrorNegocio` lo sigue reconociendo.
 */
export type ErrorNegocioCambio = ErrorNegocio & {
  codigo: CodigoErrorCambio;
};

// --- FÁBRICA Y GUARDA ---

/**
 * Crea un error de negocio de cambios: el de ventas con su código.
 * @param mensaje Mensaje legible para el frontend.
 * @param status 400, 404 o 409 (el mismo criterio que en ventas).
 * @param codigo Código legible por máquina que acompaña al mensaje.
 */
export function crearErrorNegocioCambio(
  mensaje: string,
  status: EstadoHttpNegocio,
  codigo: CodigoErrorCambio,
): ErrorNegocioCambio {
  return { ...crearErrorNegocio(mensaje, status), codigo };
}

/**
 * Indica si un valor capturado es un error de negocio de cambios (con su `codigo`).
 * Es más estricta que `esErrorNegocio`: un error de ventas sin código no pasa.
 */
export function esErrorNegocioCambio(valor: unknown): valor is ErrorNegocioCambio {
  return esErrorNegocio(valor) && typeof (valor as { codigo?: unknown }).codigo === "string";
}

// --- FÁBRICAS: DETALLE ---

/**
 * Crea el error de consultar un cambio que no existe.
 * @param idCambio Id del cambio buscado.
 */
export function crearErrorCambioNoEncontrado(idCambio: number): ErrorNegocioCambio {
  return crearErrorNegocioCambio(`El cambio ${idCambio} no existe`, 404, "CAMBIO_NO_ENCONTRADO");
}

// --- FÁBRICAS: CAJA Y STOCK ---

/**
 * Crea el error de registrar un cambio sin ninguna caja abierta.
 * Usa 409 porque el pedido es válido pero choca con el estado actual de la caja.
 */
export function crearErrorSinCajaParaCambio(): ErrorNegocioCambio {
  return crearErrorNegocioCambio("No hay una caja abierta para registrar el cambio", 409, "SIN_CAJA_ABIERTA");
}

/**
 * Crea el error del producto entregado sin unidades suficientes.
 * El mensaje es el mismo que el de ventas (se toma de su fábrica para que no diverjan).
 * @param idProducto Id del producto sin stock suficiente.
 */
export function crearErrorStockInsuficienteCambio(idProducto: number): ErrorNegocioCambio {
  return crearErrorNegocioCambio(crearErrorStockInsuficiente(idProducto).mensaje, 409, "STOCK_INSUFICIENTE");
}

// --- FÁBRICAS: ANULACIÓN ---

/**
 * Crea el error de anular un cambio que ya está anulado (o que otra anulación simultánea anuló antes).
 * Usa 409 porque el pedido es válido pero choca con el estado actual del cambio.
 * @param idCambio Id del cambio ya anulado.
 */
export function crearErrorCambioYaAnulado(idCambio: number): ErrorNegocioCambio {
  return crearErrorNegocioCambio(`El cambio ${idCambio} ya está anulado`, 409, "CAMBIO_YA_ANULADO");
}

/**
 * Crea el error de anular un cambio fuera de la ventana permitida.
 * Usa 403 con mensaje propio de cambios: la acción ya no está permitida para este cambio (no es un problema de rol).
 * No reutiliza la fábrica de ventas porque su mensaje habla de la venta y no lleva `codigo`.
 * @param limiteMinutos Minutos de la ventana, para que el mensaje no quede desfasado de la constante.
 */
export function crearErrorPlazoVencidoCambio(limiteMinutos: number): ErrorNegocioCambio {
  return crearErrorNegocioCambio(
    `No se puede anular ni modificar el cambio: pasaron más de ${limiteMinutos} minutos desde que se registró`,
    403,
    "PLAZO_VENCIDO",
  );
}

/**
 * Crea el error de anular un cambio con saldo cobrado cuando no hay ninguna caja abierta.
 * Usa 409 porque el pedido es válido pero choca con el estado actual de la caja.
 */
export function crearErrorSinCajaParaAnularCambio(): ErrorNegocioCambio {
  return crearErrorNegocioCambio(
    "No hay una caja abierta para anular un cambio con saldo cobrado",
    409,
    "SIN_CAJA_ABIERTA",
  );
}

/**
 * Crea el error de no poder revertir el ingreso al stock de un cambio porque ya no alcanza (por ejemplo, el granel
 * que entró con una bolsa abierta ya se vendió).
 * Usa 409 porque el pedido es válido pero choca con el estado actual del inventario.
 * @param nombreProducto Nombre del producto cuyo stock no alcanza.
 * @param cantidad Cantidad que había que descontar, ya formateada.
 */
export function crearErrorStockInsuficienteParaRevertir(nombreProducto: string, cantidad: string): ErrorNegocioCambio {
  return crearErrorNegocioCambio(
    `No se puede revertir el cambio: el stock de ${nombreProducto} no alcanza para descontar ${cantidad}, que ingresaron con él`,
    409,
    "STOCK_INSUFICIENTE_PARA_REVERTIR",
  );
}

// --- FÁBRICAS: RECURSOS Y DATOS ---

/**
 * Crea el error de un producto (devuelto o entregado) que no existe.
 * El enum del front no tiene un valor propio para este caso: sale como `DATOS_INVALIDOS` con status 404.
 * @param idProducto Id del producto buscado.
 */
export function crearErrorProductoNoExiste(idProducto: number): ErrorNegocioCambio {
  return crearErrorNegocioCambio(`El producto ${idProducto} no existe`, 404, "DATOS_INVALIDOS");
}

/**
 * Crea el error de vincular el cambio a una venta que no existe.
 * @param idVenta Id de la venta buscada.
 */
export function crearErrorVentaOriginalNoExiste(idVenta: number): ErrorNegocioCambio {
  return crearErrorNegocioCambio(`La venta ${idVenta} no existe`, 404, "VENTA_NO_ENCONTRADA");
}

/**
 * Crea el error de entregar un producto inactivo: el entregado sale hoy del local.
 * @param nombreProducto Nombre del producto entregado.
 */
export function crearErrorProductoEntregadoInactivo(nombreProducto: string): ErrorNegocioCambio {
  return crearErrorNegocioCambio(`El producto ${nombreProducto} está inactivo`, 400, "DATOS_INVALIDOS");
}

/**
 * Crea el error de una cantidad con decimales en un producto que se vende por unidad.
 * @param nombreProducto Nombre del producto.
 */
export function crearErrorCantidadNoEntera(nombreProducto: string): ErrorNegocioCambio {
  return crearErrorNegocioCambio(
    `El producto ${nombreProducto} se vende por unidad: la cantidad debe ser entera`,
    400,
    "DATOS_INVALIDOS",
  );
}

// --- FÁBRICAS: VÍNCULO CON LA VENTA ORIGINAL ---

/**
 * Crea el error de vincular un cambio a una venta anulada.
 * Usa 409 porque el pedido es válido pero choca con el estado actual de la venta.
 * @param idVenta Id de la venta anulada.
 */
export function crearErrorVentaOriginalAnulada(idVenta: number): ErrorNegocioCambio {
  return crearErrorNegocioCambio(
    `La venta ${idVenta} está anulada: no se puede registrar un cambio sobre ella`,
    409,
    "VENTA_NO_VINCULABLE",
  );
}

/**
 * Crea el error de vincular un cambio a un fiado sin cobrar.
 * Usa 409 porque el pedido es válido pero choca con el estado actual de la venta.
 */
export function crearErrorVentaOriginalPendientePago(): ErrorNegocioCambio {
  return crearErrorNegocioCambio(
    "La venta está pendiente de pago: liquidá el fiado antes de registrar el cambio",
    409,
    "VENTA_NO_VINCULABLE",
  );
}

/**
 * Crea el error de devolver un producto que no figura en los detalles de la venta vinculada.
 * @param idProducto Producto devuelto.
 * @param idVenta Venta vinculada.
 */
export function crearErrorProductoNoFiguraEnVenta(idProducto: number, idVenta: number): ErrorNegocioCambio {
  return crearErrorNegocioCambio(
    `El producto ${idProducto} no figura en los detalles de la venta ${idVenta}`,
    400,
    "DATOS_INVALIDOS",
  );
}

/**
 * Crea el error de devolver más de lo disponible de una venta (vendido menos lo ya devuelto en cambios activos).
 * Usa 409 porque el pedido es válido pero choca con lo ya devuelto de esa venta.
 * @param idProducto Producto devuelto.
 * @param idVenta Venta vinculada.
 * @param cantidadSolicitada Cantidad a devolver, ya formateada.
 * @param cantidadDisponible Cantidad todavía devolvible, ya formateada.
 */
export function crearErrorCantidadExcedeVenta(
  idProducto: number,
  idVenta: number,
  cantidadSolicitada: string,
  cantidadDisponible: string,
): ErrorNegocioCambio {
  return crearErrorNegocioCambio(
    `La cantidad a devolver del producto ${idProducto} (${cantidadSolicitada}) supera lo disponible de la venta ${idVenta} (${cantidadDisponible})`,
    409,
    "CANTIDAD_EXCEDE_VENTA",
  );
}

// --- FÁBRICAS: BOLSA ABIERTA Y PESO DEVUELTO ---

/**
 * Crea el error de marcar bolsa abierta en un producto que no la admite.
 * @param nombreProducto Nombre del producto devuelto.
 * @param motivo Motivo devuelto por `evaluarBolsaAbierta`, redactado para completar "no admite bolsa abierta: ...".
 */
export function crearErrorBolsaAbiertaNoPermitida(nombreProducto: string, motivo: string): ErrorNegocioCambio {
  return crearErrorNegocioCambio(`El producto ${nombreProducto} no admite bolsa abierta: ${motivo}`, 400, "DATOS_INVALIDOS");
}

/**
 * Crea el error de un peso devuelto mayor al que pesan las bolsas devueltas.
 * @param pesoDevuelto Peso informado, ya formateado.
 * @param pesoMaximo Peso nominal de las bolsas devueltas (peso por bolsa × cantidad), ya formateado.
 */
export function crearErrorPesoDevueltoExcedeBolsa(pesoDevuelto: string, pesoMaximo: string): ErrorNegocioCambio {
  return crearErrorNegocioCambio(
    `El peso devuelto (${pesoDevuelto} kg) supera el peso de lo devuelto (${pesoMaximo} kg)`,
    400,
    "DATOS_INVALIDOS",
  );
}

/**
 * Crea el error de un peso devuelto que, redondeado a 3 decimales, queda en cero.
 * El esquema ya exige un peso positivo con hasta 3 decimales: es una defensa para el cálculo puro.
 */
export function crearErrorPesoDevueltoNoPositivo(): ErrorNegocioCambio {
  return crearErrorNegocioCambio("El peso devuelto debe ser mayor a cero", 400, "DATOS_INVALIDOS");
}

/**
 * Crea el error de un valor calculado que no entra en su columna (cantidad ingresada o saldo).
 * @param descripcion Qué valor excede el máximo, por ejemplo "El saldo".
 */
export function crearErrorValorExcedeMaximo(descripcion: string): ErrorNegocioCambio {
  return crearErrorNegocioCambio(`${descripcion} supera el máximo admitido`, 400, "DATOS_INVALIDOS");
}

// --- FÁBRICAS: SALDO, MEDIO DE PAGO Y COBRO EN EFECTIVO ---

/**
 * Crea el error de un saldo negativo: el artículo entregado vale menos que el devuelto y no hay reembolsos.
 * @param saldo Saldo calculado, ya formateado.
 */
export function crearErrorSaldoNegativo(saldo: string): ErrorNegocioCambio {
  return crearErrorNegocioCambio(
    `El saldo es negativo (${saldo}): no se admiten reembolsos, el artículo entregado debe valer al menos lo devuelto`,
    400,
    "SALDO_NEGATIVO",
  );
}

/**
 * Crea el error de un saldo a cobrar sin medio de pago.
 * @param saldo Saldo a cobrar, ya formateado.
 */
export function crearErrorMedioPagoRequerido(saldo: string): ErrorNegocioCambio {
  return crearErrorNegocioCambio(`El saldo a cobrar es ${saldo}: se requiere un medio de pago`, 400, "DATOS_INVALIDOS");
}

/**
 * Crea el error de un medio de pago que no existe.
 * El enum del front no tiene un valor propio para este caso: sale como `DATOS_INVALIDOS` con status 404.
 * @param idMedioPago Id del medio buscado.
 */
export function crearErrorMedioPagoNoExiste(idMedioPago: number): ErrorNegocioCambio {
  return crearErrorNegocioCambio(`El medio de pago ${idMedioPago} no existe`, 404, "DATOS_INVALIDOS");
}

/**
 * Crea el error de cobrar el saldo con un medio de pago inactivo.
 * @param idMedioPago Id del medio inactivo.
 */
export function crearErrorMedioPagoInactivo(idMedioPago: number): ErrorNegocioCambio {
  return crearErrorNegocioCambio(`El medio de pago ${idMedioPago} está inactivo`, 400, "DATOS_INVALIDOS");
}

/**
 * Crea el error de informar un monto recibido con un medio que no es efectivo.
 * Mismo mensaje que el del cobro de una venta.
 * @param idMedioPago Id del medio del pago.
 */
export function crearErrorMontoRecibidoNoEfectivo(idMedioPago: number): ErrorNegocioCambio {
  return crearErrorNegocioCambio(
    `El medio de pago ${idMedioPago} no es efectivo: no admite monto recibido`,
    400,
    "DATOS_INVALIDOS",
  );
}

/**
 * Crea el error de un monto recibido menor al saldo a cobrar.
 * Mismo mensaje que el del cobro de una venta.
 * @param montoRecibido Monto recibido, ya formateado.
 * @param montoFinal Monto a cobrar (el saldo), ya formateado.
 * @param idMedioPago Id del medio del pago.
 */
export function crearErrorMontoRecibidoInsuficiente(
  montoRecibido: string,
  montoFinal: string,
  idMedioPago: number,
): ErrorNegocioCambio {
  return crearErrorNegocioCambio(
    `El monto recibido (${montoRecibido}) es menor al monto final (${montoFinal}) del medio de pago ${idMedioPago}`,
    400,
    "DATOS_INVALIDOS",
  );
}
