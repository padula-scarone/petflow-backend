import { z } from "zod";

// --- CONSULTA DE PRODUCTOS: CONSTANTES ---

/** Largo máximo de `busqueda`: coincide con el largo de la columna `nombre` (varchar(100)). */
export const BUSQUEDA_LONGITUD_MAXIMA = 100;

// --- CONSULTA DE PRODUCTOS: ESQUEMA ---

/**
 * Contrato de entrada de `GET /api/productos` (query params, todos opcionales).
 * `busqueda` repetida llega como arreglo y `z.string()` la rechaza, así que responde 400 sin regla extra.
 */
export const consultarProductosSchema = z.object({
  busqueda: z.string().trim().max(BUSQUEDA_LONGITUD_MAXIMA).optional(),
});
