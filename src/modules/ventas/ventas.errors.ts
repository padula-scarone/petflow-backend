export class VentaError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "VentaError";
  }
}

export class StockInsuficienteError extends VentaError {
  constructor(productoId: number) {
    super(`Stock insuficiente para el producto ${productoId}`, 409);
    this.name = "StockInsuficienteError";
  }
}
