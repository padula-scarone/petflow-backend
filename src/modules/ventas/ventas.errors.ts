// --- ERRORES DE NEGOCIO ---

/**
 * Error de negocio del módulo de ventas.
 * El controller lo captura y responde con el código HTTP indicado en `status`.
 */
export class VentaError extends Error {
  /**
   * @param message Mensaje legible que se devuelve al frontend.
   * @param status Código HTTP: 400 (dato o regla inválida), 404 (no existe) o 409 (conflicto de estado).
   */
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "VentaError";
  }
}

/**
 * Se lanza cuando un producto no tiene unidades suficientes.
 * Usa 409 porque el pedido es válido pero choca con el estado actual del inventario.
 */
export class StockInsuficienteError extends VentaError {
  /** @param productoId Id del producto sin stock suficiente. */
  constructor(productoId: number) {
    super(`Stock insuficiente para el producto ${productoId}`, 409);
    this.name = "StockInsuficienteError";
  }
}
