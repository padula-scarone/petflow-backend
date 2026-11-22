import type { Request, Response } from "express";
import { esErrorNegocioDeudor } from "../deudores/deudores.errors.js";
import { esErrorNegocio } from "../ventas/ventas.errors.js";
import { consultarCuentasCorrientesSchema, consultarEstadoCuentaSchema } from "./cuentas-corrientes.schemas.js";
import { consultarCuentasCorrientes, consultarEstadoCuenta } from "./cuentas-corrientes.service.js";

// --- FUNCIONES AUXILIARES ---

/** Incidencia de validación de Zod reducida a lo que necesita la respuesta. */
type IncidenciaValidacion = {
  path: ReadonlyArray<PropertyKey>;
  message: string;
};

/**
 * Arma el cuerpo de la respuesta 400 por datos inválidos: un elemento por cada campo con error.
 * Copia local de la de ventas y deudores (que no la exportan): su extracción a `shared` es deuda registrada.
 * Solo lleva el nombre del campo y el mensaje fijo del esquema: nunca el valor recibido (RNF-VENTAS-03).
 * @param mensaje Mensaje general (por ejemplo "Parámetros de consulta inválidos").
 * @param incidencias Incidencias reportadas por Zod.
 */
function construirRespuestaValidacion(mensaje: string, incidencias: ReadonlyArray<IncidenciaValidacion>) {
  return {
    exito: false,
    mensaje,
    errores: incidencias.map((incidencia) => ({
      campo: incidencia.path.join("."),
      mensaje: incidencia.message,
    })),
  };
}

/**
 * Responde un error de negocio con su código HTTP y su mensaje.
 * El de un deudor inexistente suma `codigo` (`DEUDOR_NO_ENCONTRADO`); cualquier otro mantiene el formato de ventas.
 * Copia local de la de ventas y deudores (deuda registrada).
 * @returns `true` si el valor era un error de negocio y ya se respondió; `false` si hay que relanzarlo.
 */
function responderErrorNegocio(res: Response, errorCapturado: unknown): boolean {
  if (esErrorNegocioDeudor(errorCapturado)) {
    res.status(errorCapturado.status).json({
      exito: false,
      mensaje: errorCapturado.mensaje,
      codigo: errorCapturado.codigo,
    });
    return true;
  }
  if (esErrorNegocio(errorCapturado)) {
    res.status(errorCapturado.status).json({ exito: false, mensaje: errorCapturado.mensaje });
    return true;
  }
  return false;
}

// --- HANDLERS ---

/**
 * Handler de `GET /api/cuentas-corrientes`: lista paginada de deudores con su saldo.
 * Valida la query y delega en el service. No contiene reglas de negocio ni exige caja abierta.
 * La sesión y el rol los exige `requerirRol` en la ruta, no este handler.
 * Respuestas: 200 con la página (vacía si está fuera de rango); 400 con detalle por parámetro si la query es inválida.
 */
export async function getConsultarCuentasCorrientes(req: Request, res: Response): Promise<void> {
  // Los query params llegan siempre como texto: el esquema los convierte de forma estricta
  const parseo = consultarCuentasCorrientesSchema.safeParse(req.query);
  if (!parseo.success) {
    res.status(400).json(construirRespuestaValidacion("Parámetros de consulta inválidos", parseo.error.issues));
    return;
  }

  try {
    const resultado = await consultarCuentasCorrientes(parseo.data);
    res.status(200).json(resultado);
  } catch (errorCapturado) {
    // Los errores de negocio (objetos puros) se traducen a su código HTTP; cualquier otro valor sube a Express
    if (responderErrorNegocio(res, errorCapturado)) {
      return;
    }
    throw errorCapturado;
  }
}

/**
 * Handler de `GET /api/cuentas-corrientes/:idDeudor`: estado de cuenta de un deudor (sin paginar).
 * Valida el parámetro de ruta y delega en el service. No contiene reglas de negocio ni exige caja abierta.
 * La sesión y el rol los exige `requerirRol` en la ruta, no este handler.
 * Respuestas: 200 con el deudor, su saldo y sus fiados pendientes; 400 con detalle por parámetro si `idDeudor` es inválido;
 * 404 `DEUDOR_NO_ENCONTRADO` si el deudor no existe.
 */
export async function getConsultarEstadoCuenta(req: Request, res: Response): Promise<void> {
  // El parámetro de ruta llega como texto: el esquema lo convierte de forma estricta
  const parseo = consultarEstadoCuentaSchema.safeParse(req.params);
  if (!parseo.success) {
    res.status(400).json(construirRespuestaValidacion("Parámetros de ruta inválidos", parseo.error.issues));
    return;
  }

  try {
    const resultado = await consultarEstadoCuenta(parseo.data);
    res.status(200).json(resultado);
  } catch (errorCapturado) {
    if (responderErrorNegocio(res, errorCapturado)) {
      return;
    }
    throw errorCapturado;
  }
}
