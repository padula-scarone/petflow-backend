import { z } from "zod";
import {
  CANTIDAD_POR_PAGINA_MAXIMA,
  CANTIDAD_POR_PAGINA_PREDETERMINADA,
  enteroDesdeTexto,
  PAGINA_MAXIMA,
} from "../ventas/ventas.schemas.js";

// --- CONSTANTES ---

/** Tope de `idDeudor`: máximo de una columna integer de PostgreSQL (más allá, la BD falla con 500). */
export const ID_DEUDOR_MAXIMO = 2_147_483_647;

/** Largo máximo de `nombreCompleto`: coincide con la columna VARCHAR(100). */
export const NOMBRE_COMPLETO_LONGITUD_MAXIMA = 100;

/** Largo máximo de `busqueda`: el mismo que `textoCliente` del historial de ventas. */
export const BUSQUEDA_LONGITUD_MAXIMA = 100;

// --- DATOS DEL DEUDOR ---
// Los mensajes son textos fijos que nunca repiten el valor recibido: el DNI y el teléfono
// no deben viajar fuera del cuerpo estructurado (RNF-VENTAS-03).

/**
 * Teléfono con código de país. Se acepta con espacios, guiones y un `+` solo al inicio; se guarda solo con dígitos.
 * Se valida en dos pasos: primero los caracteres permitidos, después de normalizar, la cantidad de dígitos (11 a 15).
 * No se exige que empiece con 54. La salida del esquema ya es el valor normalizado.
 */
const telefonoSchema = z
  .string({ error: "El teléfono es obligatorio y debe ser texto" })
  .trim()
  .regex(/^\+?[\d\s-]+$/, "El teléfono solo admite dígitos, espacios, guiones y un + al inicio")
  .transform((telefono) => telefono.replace(/[\s+-]/g, ""))
  .pipe(z.string().regex(/^\d{11,15}$/, "El teléfono debe tener entre 11 y 15 dígitos"));

/**
 * Contrato de entrada del body de `POST /api/deudores` y de `PUT /api/deudores/:idDeudor`.
 * La edición reemplaza los tres datos, así que ambos endpoints comparten el mismo esquema.
 * El DNI se recorta en los extremos y debe tener 7 u 8 dígitos, sin puntos; se guarda como texto.
 * Las claves desconocidas (por ejemplo un `idDeudor` en el body) se descartan sin error.
 */
export const datosDeudorSchema = z.object({
  nombreCompleto: z
    .string({ error: "El nombre completo es obligatorio y debe ser texto" })
    .trim()
    .min(1, "El nombre completo no puede estar vacío")
    .max(NOMBRE_COMPLETO_LONGITUD_MAXIMA, `El nombre completo admite hasta ${NOMBRE_COMPLETO_LONGITUD_MAXIMA} caracteres`),
  telefono: telefonoSchema,
  dni: z
    .string({ error: "El DNI es obligatorio y debe ser texto" })
    .trim()
    .regex(/^\d{7,8}$/, "El DNI debe tener 7 u 8 dígitos, sin puntos"),
});

// --- CONSULTA DE DEUDORES ---

/**
 * Contrato de entrada de `GET /api/deudores` (query params, todos opcionales).
 * Los valores llegan como texto; la conversión a número es estricta (ver `enteroDesdeTexto` de ventas).
 * `busqueda` coincide de forma parcial, sin distinguir mayúsculas, con el nombre o el DNI; si queda vacía
 * tras el recorte equivale a no filtrar (lo resuelve el service, igual que `textoCliente` en el historial).
 */
export const consultarDeudoresSchema = z.object({
  pagina: enteroDesdeTexto(1, PAGINA_MAXIMA).default(1),
  cantidadPorPagina: enteroDesdeTexto(1, CANTIDAD_POR_PAGINA_MAXIMA).default(CANTIDAD_POR_PAGINA_PREDETERMINADA),
  busqueda: z.string().trim().max(BUSQUEDA_LONGITUD_MAXIMA).optional(),
});

// --- EDICIÓN DE UN DEUDOR: PARÁMETRO DE RUTA ---

/**
 * Contrato de entrada del parámetro de ruta de `PUT /api/deudores/:idDeudor`.
 * El id llega como texto y la conversión es estricta (entero positivo hasta `ID_DEUDOR_MAXIMO`).
 */
export const actualizarDeudorParametrosSchema = z.object({
  idDeudor: enteroDesdeTexto(1, ID_DEUDOR_MAXIMO),
});
