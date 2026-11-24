import { crearErrorNegocio } from "../ventas/ventas.errors.js";
import type { ErrorNegocio } from "../ventas/ventas.errors.js";

// Los errores de negocio comparten el tipo y las fabricas de ventas, por importacion
// (el mismo criterio que deudores y cambios-mercaderia). Moverlos a `shared` queda como deuda tecnica registrada.

// --- CODIGO LEGIBLE POR MAQUINA ---

/**
 * Valores posibles de `codigo` en los errores del cobro de fiados de un deudor.
 * `FIADO_CON_COBROS` (409 de Liquidar Fiado y de la anulacion) vive en `ventas.errors.ts` porque lo producen esos flujos.
 * `DEUDOR_NO_ENCONTRADO` (404) lo produce la fabrica del modulo deudores.
 */
export const CODIGOS_ERROR_COBRO = [
  "FIADO_NO_ENCONTRADO",
  "FIADO_NO_PENDIENTE",
  "MONTO_EXCEDE_FALTA",
  "SIN_CAJA_ABIERTA",
  "COBRO_SIMULTANEO",
  // Va al final a proposito: `openapi.ts` desestructura este arreglo por posicion, y asi los cinco anteriores no se mueven
  "COBRO_NO_ENCONTRADO",
] as const;

/** Codigo con el que el front distingue el motivo de un rechazo del cobro sin leer el texto del mensaje. */
export type CodigoErrorCobro = (typeof CODIGOS_ERROR_COBRO)[number];

/**
 * Error de negocio del cobro de fiados: el de ventas mas el `codigo` legible por maquina.
 * Sigue siendo un dato puro (sin class ni new) y `esErrorNegocio` lo sigue reconociendo.
 * Los mensajes nunca llevan datos personales del deudor (RNF-VENTAS-03): solo ids e importes.
 */
export type ErrorNegocioCobro = ErrorNegocio & { codigo: CodigoErrorCobro };

// --- FABRICAS ---

/**
 * Crea el error de un fiado que no existe o no es un fiado del deudor del cobro.
 * Los dos casos responden igual a proposito: no se revela si la venta existe y es de otro deudor.
 * @param idVenta Id del fiado pedido.
 * @param idDeudor Id del deudor del cobro.
 */
export function crearErrorFiadoNoEncontrado(idVenta: number, idDeudor: number): ErrorNegocioCobro {
  return {
    ...crearErrorNegocio(`La venta ${idVenta} no es un fiado del deudor ${idDeudor}`, 404),
    codigo: "FIADO_NO_ENCONTRADO",
  };
}

/**
 * Crea el error de cobrar un fiado que ya no esta pendiente de pago (completado por otro cobro o anulado).
 * Usa 409 porque el pedido es valido pero choca con el estado actual del fiado.
 * @param idVenta Id del fiado que ya no esta pendiente.
 */
export function crearErrorFiadoNoPendiente(idVenta: number): ErrorNegocioCobro {
  return {
    ...crearErrorNegocio(`El fiado ${idVenta} ya no está pendiente de pago`, 409),
    codigo: "FIADO_NO_PENDIENTE",
  };
}

/**
 * Crea el error de abonar a un fiado mas de lo que falta pagar.
 * Usa 409 porque el monto era valido al enviarlo pero choca con el estado actual de la deuda
 * (otro cobro pudo haber bajado lo que falta).
 * @param idVenta Id del fiado.
 * @param monto Monto que se intento abonar, con 2 decimales.
 * @param falta Lo que falta pagar del fiado, con 2 decimales.
 */
export function crearErrorMontoExcedeFalta(idVenta: number, monto: string, falta: string): ErrorNegocioCobro {
  return {
    ...crearErrorNegocio(`El monto ${monto} supera lo que falta pagar (${falta}) del fiado ${idVenta}`, 409),
    codigo: "MONTO_EXCEDE_FALTA",
  };
}

/**
 * Crea el error de cobrar sin una caja abierta.
 * Usa 409 porque el pedido es valido pero choca con el estado actual de la caja.
 */
export function crearErrorSinCajaParaCobrar(): ErrorNegocioCobro {
  return {
    ...crearErrorNegocio("No hay una caja abierta para registrar el cobro", 409),
    codigo: "SIN_CAJA_ABIERTA",
  };
}

/**
 * Crea el error de consultar el recibo de un cobro que no existe.
 * El mensaje lleva solo el id: nunca datos del deudor (RNF-VENTAS-03).
 * @param idCobroDeudor Id del cobro pedido.
 */
export function crearErrorCobroNoEncontrado(idCobroDeudor: number): ErrorNegocioCobro {
  return {
    ...crearErrorNegocio(`El cobro ${idCobroDeudor} no existe`, 404),
    codigo: "COBRO_NO_ENCONTRADO",
  };
}

/**
 * Crea el error de un cobro que no pudo completarse porque otra operacion tenia bloqueados los mismos fiados
 * (la transaccion vencio esperando el bloqueo o la base la abortó por un conflicto). No se guardo nada: se puede reintentar.
 */
export function crearErrorCobroSimultaneo(): ErrorNegocioCobro {
  return {
    ...crearErrorNegocio(
      "Otro cobro está procesando estos fiados en este momento: no se registró nada, reintente en unos segundos",
      409,
    ),
    codigo: "COBRO_SIMULTANEO",
  };
}
