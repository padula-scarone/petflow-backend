import type { z } from "zod";
import type { registrarVentaSchema } from "./ventas.schemas.js";

export type RegistrarVentaInput = z.infer<typeof registrarVentaSchema>;

export type OrigenVenta = RegistrarVentaInput["origen"];
export type ModalidadEntrega = RegistrarVentaInput["modalidadEntrega"];
export type EstadoVenta = "COMPLETADA" | "PENDIENTE_PAGO";

// Datos leídos de la BD para el cálculo.
// Montos en centavos (enteros), cantidades en milésimas (enteros) y porcentajes en
// centésimas de punto (basis points). Así no hay errores de coma flotante.
export type ProductoVigente = {
  idProducto: number;
  nombre: string;
  formatoVenta: "UNIDAD" | "GRANEL";
  activo: boolean;
  precioCentavos: number;
  costoCentavos: number;
  stockMilesimas: number;
};

export type MedioPagoVigente = {
  idMedioPago: number;
  activo: boolean;
  // Neto del medio: recargo − descuento, en centésimas de punto (ej. 1000 = 10%)
  ajusteBp: number;
};

export type LineaVentaCalculada = {
  idProducto: number;
  cantidadMilesimas: number;
  precioUnitarioCentavos: number;
  costoUnitarioCentavos: number;
  subtotalCentavos: number;
};

export type PagoVentaCalculado = {
  idMedioPago: number;
  montoBaseCentavos: number;
  porcentajeAplicadoBp: number;
  montoFinalCentavos: number;
};

export type TotalesVentaCalculados = {
  lineas: LineaVentaCalculada[];
  pagos: PagoVentaCalculado[];
  subtotalBrutoCentavos: number;
  descuentoManualCentavos: number;
  montoTotalCentavos: number;
  estado: EstadoVenta;
};

export type RegistrarVentaResponse = {
  exito: true;
  mensaje: string;
  venta: {
    idVenta: number;
    numeroComprobante: string | null;
    montoTotal: string;
    estado: EstadoVenta;
    fechaHora: string;
  };
};
