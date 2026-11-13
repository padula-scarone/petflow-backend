import { crearErrorNegocio } from "../ventas/ventas.errors.js";
import type { ErrorNegocio } from "../ventas/ventas.errors.js";

// Los errores de negocio comparten el tipo y la guarda `esErrorNegocio` de ventas, por importación.
// Moverlos a `shared` queda como deuda técnica registrada.

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
