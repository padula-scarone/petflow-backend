// --- DATOS LEÍDOS DE LA BASE ---

/**
 * Decimal exacto de la BD (el `Decimal` de Prisma lo cumple de forma estructural).
 * Se declara aquí para que el service formatee sin importar Prisma ni pasar por `number`.
 * Duplicado a propósito del de inventario: evita acoplar un módulo con otro.
 */
export type DecimalExacto = {
  /** Texto con exactamente `decimales` posiciones decimales. */
  toFixed(decimales: number): string;
};

/** Clasificación del medio de pago. "Fiado" no es un medio de pago: es una venta sin pagos. */
export type TipoMedioPago = "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "BILLETERA_VIRTUAL";

/** Medio de pago activo tal como lo lee el repository. */
export type MedioPagoLeido = {
  idMedioPago: number;
  nombre: string;
  tipo: TipoMedioPago;
  porcentajeRecargo: DecimalExacto;
  porcentajeDescuento: DecimalExacto;
};

// --- TIPOS DE SALIDA ---

/** Medio de pago que se expone al front. Los porcentajes van como texto exacto con 2 decimales. */
export type MedioPagoDisponible = {
  idMedioPago: number;
  nombre: string;
  tipo: TipoMedioPago;
  /** Recargo porcentual que suma al pago, por ejemplo "10.00". */
  porcentajeRecargo: string;
  /** Descuento porcentual que resta del pago, por ejemplo "5.00". */
  porcentajeDescuento: string;
};

/** Cuerpo de la respuesta 200 de `GET /api/medios-pago`. */
export type ListarMediosPagoResponse = {
  exito: true;
  mediosPago: MedioPagoDisponible[];
};
