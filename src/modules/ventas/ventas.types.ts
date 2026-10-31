import type { z } from "zod";
import type { registrarVentaSchema } from "./ventas.schemas.js";

// --- TIPOS DE ENTRADA ---

/** Cuerpo validado de `POST /ventas`, inferido del esquema Zod. */
export type RegistrarVentaInput = z.infer<typeof registrarVentaSchema>;

/** Canal por el que se originó la venta. */
export type OrigenVenta = RegistrarVentaInput["origen"];

/** Forma de entrega de la mercadería. */
export type ModalidadEntrega = RegistrarVentaInput["modalidadEntrega"];

/** Estados con los que puede nacer una venta: cobrada o fiado. */
export type EstadoVenta = "COMPLETADA" | "PENDIENTE_PAGO";

// --- DATOS LEÍDOS DE LA BASE ---
// Montos en centavos (enteros), cantidades en milésimas (enteros) y porcentajes en
// centésimas de punto (basis points). Así no hay errores de coma flotante.

/** Producto con sus valores vigentes al momento de vender. */
export type ProductoVigente = {
  idProducto: number;
  nombre: string;
  /** UNIDAD solo admite cantidades enteras; GRANEL admite decimales. */
  formatoVenta: "UNIDAD" | "GRANEL";
  activo: boolean;
  /** Precio de venta actual, en centavos. */
  precioCentavos: number;
  /** Costo actual, en centavos. Se congela en el detalle de la venta. */
  costoCentavos: number;
  /** Stock físico disponible, en milésimas. */
  stockMilesimas: number;
};

/** Medio de pago con su ajuste porcentual ya resuelto. */
export type MedioPagoVigente = {
  idMedioPago: number;
  activo: boolean;
  /** Neto del medio: recargo − descuento, en basis points (ej. 1000 = 10%). */
  ajusteBp: number;
};

// --- RESULTADO DEL CÁLCULO ---

/** Una línea de la venta con el precio y costo congelados. */
export type LineaVentaCalculada = {
  idProducto: number;
  cantidadMilesimas: number;
  precioUnitarioCentavos: number;
  costoUnitarioCentavos: number;
  /** precio unitario × cantidad, redondeado a centavos. */
  subtotalCentavos: number;
};

/** Un pago con el ajuste del medio ya aplicado. */
export type PagoVentaCalculado = {
  idMedioPago: number;
  /** Porción base aportada por este medio, antes del ajuste. */
  montoBaseCentavos: number;
  /** Ajuste aplicado (recargo − descuento) en basis points. */
  porcentajeAplicadoBp: number;
  /** Lo que efectivamente paga el cliente por este medio: base × (1 + ajuste). */
  montoFinalCentavos: number;
};

/** Resultado completo de `calcularVenta`, listo para persistir. */
export type TotalesVentaCalculados = {
  lineas: LineaVentaCalculada[];
  /** Vacío en un fiado. */
  pagos: PagoVentaCalculado[];
  subtotalBrutoCentavos: number;
  descuentoManualCentavos: number;
  /** Fiado: subtotal − descuento. Cobrada: suma de los montos finales de los pagos. */
  montoTotalCentavos: number;
  estado: EstadoVenta;
};

// --- RESPUESTA HTTP ---

/** Respuesta exitosa de `POST /ventas`. Los montos viajan como texto con 2 decimales. */
export type RegistrarVentaResponse = {
  exito: true;
  mensaje: string;
  venta: {
    idVenta: number;
    /** Siempre presente: toda venta emite comprobante al instante (ticket de pago si queda COMPLETADA, ticket de deuda si queda PENDIENTE_PAGO). */
    numeroComprobante: string;
    montoTotal: string;
    estado: EstadoVenta;
    /** Fecha y hora en formato ISO 8601. */
    fechaHora: string;
  };
};
