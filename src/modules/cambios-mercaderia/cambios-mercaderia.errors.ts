import { crearErrorNegocio, esErrorNegocio } from "../ventas/ventas.errors.js";
import type { ErrorNegocio, EstadoHttpNegocio } from "../ventas/ventas.errors.js";

// Los errores de negocio comparten el tipo y la guarda `esErrorNegocio` de ventas, por importación.
// Moverlos a `shared` queda como deuda técnica registrada.

// --- CÓDIGO LEGIBLE POR MÁQUINA ---

/**
 * Código con el que el front distingue el caso de un rechazo sin leer el texto del mensaje.
 * Es el enum `CodigoErrorCambio` del front, sin los valores que corresponden a la anulación y edición de cambios
 * (`PLAZO_VENCIDO`, `CAMBIO_YA_ANULADO`, `STOCK_INSUFICIENTE_PARA_REVERTIR`), que todavía no existen en el back.
 * El enum del front no tiene valores propios para "producto inexistente" ni "medio de pago inexistente":
 * esos 404 salen como `DATOS_INVALIDOS`.
 */
export type CodigoErrorCambio =
  | "DATOS_INVALIDOS"
  | "SALDO_NEGATIVO"
  | "VENTA_NO_ENCONTRADA"
  | "CAMBIO_NO_ENCONTRADO"
  | "SIN_CAJA_ABIERTA"
  | "STOCK_INSUFICIENTE"
  | "VENTA_NO_VINCULABLE"
  | "CANTIDAD_EXCEDE_VENTA";

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

// --- FÁBRICAS: CAJA ---

/**
 * Crea el error de registrar un cambio sin ninguna caja abierta.
 * Usa 409 porque el pedido es válido pero choca con el estado actual de la caja.
 */
export function crearErrorSinCajaParaCambio(): ErrorNegocio {
  return crearErrorNegocio("No hay una caja abierta para registrar el cambio", 409);
}

// --- FÁBRICAS: VÍNCULO CON LA VENTA ORIGINAL ---

/**
 * Crea el error de vincular un cambio a una venta anulada.
 * Usa 409 porque el pedido es válido pero choca con el estado actual de la venta.
 * @param idVenta Id de la venta anulada.
 */
export function crearErrorVentaOriginalAnulada(idVenta: number): ErrorNegocio {
  return crearErrorNegocio(`La venta ${idVenta} está anulada: no se puede registrar un cambio sobre ella`, 409);
}

/**
 * Crea el error de vincular un cambio a un fiado sin cobrar.
 * Usa 409 porque el pedido es válido pero choca con el estado actual de la venta.
 */
export function crearErrorVentaOriginalPendientePago(): ErrorNegocio {
  return crearErrorNegocio("La venta está pendiente de pago: liquidá el fiado antes de registrar el cambio", 409);
}

/**
 * Crea el error de devolver un producto que no figura en los detalles de la venta vinculada.
 * @param idProducto Producto devuelto.
 * @param idVenta Venta vinculada.
 */
export function crearErrorProductoNoFiguraEnVenta(idProducto: number, idVenta: number): ErrorNegocio {
  return crearErrorNegocio(`El producto ${idProducto} no figura en los detalles de la venta ${idVenta}`, 400);
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
): ErrorNegocio {
  return crearErrorNegocio(
    `La cantidad a devolver del producto ${idProducto} (${cantidadSolicitada}) supera lo disponible de la venta ${idVenta} (${cantidadDisponible})`,
    409,
  );
}

// --- FÁBRICAS: BOLSA ABIERTA, SALDO Y MEDIO DE PAGO ---

/**
 * Crea el error de marcar bolsa abierta en un producto que no la admite.
 * @param nombreProducto Nombre del producto devuelto.
 * @param motivo Motivo devuelto por `evaluarBolsaAbierta`, redactado para completar "no admite bolsa abierta: ...".
 */
export function crearErrorBolsaAbiertaNoPermitida(nombreProducto: string, motivo: string): ErrorNegocio {
  return crearErrorNegocio(`El producto ${nombreProducto} no admite bolsa abierta: ${motivo}`, 400);
}

/**
 * Crea el error de un valor calculado que no entra en su columna (cantidad ingresada o saldo).
 * @param descripcion Qué valor excede el máximo, por ejemplo "El saldo".
 */
export function crearErrorValorExcedeMaximo(descripcion: string): ErrorNegocio {
  return crearErrorNegocio(`${descripcion} supera el máximo admitido`, 400);
}

/**
 * Crea el error de un saldo negativo: el artículo entregado vale menos que el devuelto y no hay reembolsos.
 * @param saldo Saldo calculado, ya formateado.
 */
export function crearErrorSaldoNegativo(saldo: string): ErrorNegocio {
  return crearErrorNegocio(
    `El saldo es negativo (${saldo}): no se admiten reembolsos, el artículo entregado debe valer al menos lo devuelto`,
    400,
  );
}

/**
 * Crea el error de un saldo a cobrar sin medio de pago.
 * @param saldo Saldo a cobrar, ya formateado.
 */
export function crearErrorMedioPagoRequerido(saldo: string): ErrorNegocio {
  return crearErrorNegocio(`El saldo a cobrar es ${saldo}: se requiere un medio de pago`, 400);
}
