import { crearErrorNegocio, esErrorNegocio } from "../ventas/ventas.errors.js";
import type { ErrorNegocio } from "../ventas/ventas.errors.js";
import type { Deudor } from "./deudores.types.js";

// Los errores de negocio comparten el tipo y la guarda `esErrorNegocio` de ventas, por importación
// (el mismo criterio que cambios-mercaderia). Moverlos a `shared` queda como deuda técnica registrada.

// --- CÓDIGO LEGIBLE POR MÁQUINA ---

/** Valores posibles de `codigo` en los errores del módulo. */
export const CODIGOS_ERROR_DEUDOR = ["DEUDOR_NO_ENCONTRADO", "DNI_DUPLICADO"] as const;

/** Código con el que el front distingue el caso de un rechazo sin leer el texto del mensaje. */
export type CodigoErrorDeudor = (typeof CODIGOS_ERROR_DEUDOR)[number];

/**
 * Error de negocio del módulo de deudores: el de ventas más el `codigo` legible por máquina.
 * Sigue siendo un dato puro (sin class ni new) y `esErrorNegocio` lo sigue reconociendo.
 * Los datos personales nunca van en `mensaje` (RNF-VENTAS-03): el deudor existente viaja en su propio campo.
 */
export type ErrorNegocioDeudor = ErrorNegocio & {
  codigo: CodigoErrorDeudor;
  /** Solo en `DNI_DUPLICADO`: el deudor que ya tiene ese DNI, para que el front lo seleccione. */
  deudorExistente?: Deudor;
};

// --- FÁBRICAS ---

/**
 * Crea el error de editar un deudor que no existe.
 * @param idDeudor Id del deudor buscado (no es un dato personal, puede ir en el mensaje).
 */
export function crearErrorDeudorNoEncontrado(idDeudor: number): ErrorNegocioDeudor {
  return { ...crearErrorNegocio(`El deudor ${idDeudor} no existe`, 404), codigo: "DEUDOR_NO_ENCONTRADO" };
}

/**
 * Crea el error de un DNI que ya pertenece a otro deudor.
 * Usa 409 porque el pedido es válido pero choca con el estado actual de los datos.
 * @param deudorExistente El deudor que ya tiene ese DNI.
 */
export function crearErrorDniDuplicado(deudorExistente: Deudor): ErrorNegocioDeudor {
  return {
    ...crearErrorNegocio("Ya existe un deudor con ese DNI", 409),
    codigo: "DNI_DUPLICADO",
    deudorExistente,
  };
}

// --- GUARDA DE TIPO ---

/**
 * Indica si un valor capturado es un error de negocio de deudores (con su `codigo`).
 * Es más estricta que `esErrorNegocio`: un error de ventas sin código no pasa.
 */
export function esErrorNegocioDeudor(valor: unknown): valor is ErrorNegocioDeudor {
  return esErrorNegocio(valor) && typeof (valor as { codigo?: unknown }).codigo === "string";
}
