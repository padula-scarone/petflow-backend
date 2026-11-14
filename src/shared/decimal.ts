import { Decimal as DecimalDePrisma } from "@prisma/client/runtime/client";

// --- CONSTRUCTOR DECIMAL AISLADO ---

/**
 * Decimal exacto para los cálculos de dinero y de peso: precisión de 40 dígitos significativos y redondeo
 * "half up" (la mitad se redondea hacia arriba, como `Math.round` con importes positivos).
 * Es un constructor propio (`clone`), no `Decimal.set`: así no se toca la configuración global del `Decimal`
 * que usa Prisma en el resto de los módulos. Los valores de Prisma se convierten con `aDecimal`.
 */
export const Decimal = DecimalDePrisma.clone({ precision: 40, rounding: DecimalDePrisma.ROUND_HALF_UP });

/** Tipo de un valor creado con el `Decimal` aislado. */
export type Decimal = InstanceType<typeof Decimal>;

// --- FUNCIONES AUXILIARES ---

/**
 * Convierte un valor leído de Prisma (o un número del body) a un `Decimal` aislado.
 * Pasa por texto a propósito: el `toString` de un decimal de Prisma es exacto y el de un `number` es la
 * representación más corta que escribió quien llamó a la API (por ejemplo `14.5`), sin ruido binario.
 */
export function aDecimal(valor: { toString(): string }): Decimal {
  return new Decimal(valor.toString());
}

/** Redondea un importe a 2 decimales (centavos), la mitad hacia arriba. */
export function redondearAMoneda(valor: Decimal): Decimal {
  return valor.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Redondea una cantidad o un peso a 3 decimales (milésimas), la mitad hacia arriba. */
export function redondearACantidad(valor: Decimal): Decimal {
  return valor.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}
