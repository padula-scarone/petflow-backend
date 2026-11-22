import { z } from "zod";
import { ID_DEUDOR_MAXIMO } from "../deudores/deudores.schemas.js";
import {
  CANTIDAD_POR_PAGINA_MAXIMA,
  CANTIDAD_POR_PAGINA_PREDETERMINADA,
  enteroDesdeTexto,
  PAGINA_MAXIMA,
} from "../ventas/ventas.schemas.js";

// --- CONSTANTES ---

/** Largo máximo de `texto`: el mismo que `busqueda` de deudores y `textoCliente` del historial (columna VARCHAR(100)). */
export const TEXTO_BUSQUEDA_LONGITUD_MAXIMA = 100;

// --- AUXILIARES ---

/**
 * Booleano recibido como texto en una query: solo se admite `true` o `false`, en minúsculas.
 * Es estricto a propósito (igual que `MIXTO` en el historial): `TRUE`, `1` o `yes` dan 400 en lugar de interpretarse en silencio.
 */
const booleanoDesdeTexto = z
  .enum(["true", "false"], { error: "Debe ser true o false (en minúsculas)" })
  .transform((valor) => valor === "true");

// --- LISTADO DE DEUDORES CON SALDO ---

/**
 * Contrato de entrada de `GET /api/cuentas-corrientes` (query params, todos opcionales).
 * Los valores llegan como texto; la conversión a número es estricta (ver `enteroDesdeTexto` de ventas).
 * `texto` coincide de forma parcial, sin distinguir mayúsculas, con el nombre o el DNI; si queda vacío tras el recorte
 * equivale a no filtrar (lo resuelve el service). `incluirSinDeuda` vale `false` si se omite: solo salen los deudores con saldo.
 */
export const consultarCuentasCorrientesSchema = z.object({
  pagina: enteroDesdeTexto(1, PAGINA_MAXIMA).default(1),
  cantidadPorPagina: enteroDesdeTexto(1, CANTIDAD_POR_PAGINA_MAXIMA).default(CANTIDAD_POR_PAGINA_PREDETERMINADA),
  texto: z.string().trim().max(TEXTO_BUSQUEDA_LONGITUD_MAXIMA).optional(),
  incluirSinDeuda: booleanoDesdeTexto.default(false),
});

// --- ESTADO DE CUENTA DE UN DEUDOR ---

/**
 * Contrato de entrada del parámetro de ruta de `GET /api/cuentas-corrientes/:idDeudor`.
 * El id llega como texto y la conversión es estricta (entero positivo hasta `ID_DEUDOR_MAXIMO`).
 */
export const consultarEstadoCuentaSchema = z.object({
  idDeudor: enteroDesdeTexto(1, ID_DEUDOR_MAXIMO),
});
