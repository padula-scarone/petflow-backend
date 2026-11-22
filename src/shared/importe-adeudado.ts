import type { Decimal } from "./decimal.js";

// --- IMPORTE ADEUDADO DE UN FIADO ---

/**
 * Calcula el importe que se debe de un fiado: el subtotal bruto menos el descuento manual de la venta.
 * Es la única definición de esa regla: la usan el cobro de un fiado (ventas) y el estado de cuenta (cuentas corrientes).
 * Vive en `shared` para que ninguno de los dos módulos dependa del otro.
 * La resta es lineal, así que la función no sabe de unidades: devuelve pesos si recibe pesos y centavos si recibe centavos
 * (el cobro de un fiado trabaja con centavos enteros; el estado de cuenta, con pesos exactos).
 * No usa el `montoTotal` guardado: el descuento manual solo se carga en el alta y el cobro se calcula sobre lo que se debe.
 * @param subtotalBruto Subtotal de la venta, sin descuento manual.
 * @param descuentoManual Descuento manual de la venta (0 si no tuvo).
 * @returns Lo que se debe del fiado, antes de cualquier recargo o descuento de un medio de pago.
 */
export function calcularImporteAdeudado(subtotalBruto: Decimal, descuentoManual: Decimal): Decimal {
  return subtotalBruto.minus(descuentoManual);
}
