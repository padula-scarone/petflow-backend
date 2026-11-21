import type { Request, Response } from "express";
import { esErrorNegocio } from "../ventas/ventas.errors.js";
import { esErrorNegocioDeudor } from "./deudores.errors.js";
import {
  actualizarDeudorParametrosSchema,
  consultarDeudoresSchema,
  datosDeudorSchema,
} from "./deudores.schemas.js";
import { actualizarDeudor, consultarDeudores, registrarDeudor } from "./deudores.service.js";

// --- FUNCIONES AUXILIARES ---

/** Incidencia de validación de Zod reducida a lo que necesita la respuesta. */
type IncidenciaValidacion = {
  path: ReadonlyArray<PropertyKey>;
  message: string;
};

/**
 * Arma el cuerpo de la respuesta 400 por datos inválidos: un elemento por cada campo con error.
 * Copia local de la de ventas, que no se exporta: se evita tocar ese módulo. Su extracción a `shared` es deuda registrada.
 * Solo lleva el nombre del campo y el mensaje fijo del esquema: nunca el valor recibido (RNF-VENTAS-03).
 * @param mensaje Mensaje general (por ejemplo "Datos de deudor inválidos").
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
 * Los errores de deudores suman `codigo` y, si lo traen (409), `deudorExistente`; el resto mantiene el formato de ventas.
 * @returns `true` si el valor era un error de negocio y ya se respondió; `false` si hay que relanzarlo.
 */
function responderErrorNegocio(res: Response, errorCapturado: unknown): boolean {
  if (esErrorNegocioDeudor(errorCapturado)) {
    res.status(errorCapturado.status).json({
      exito: false,
      mensaje: errorCapturado.mensaje,
      codigo: errorCapturado.codigo,
      ...(errorCapturado.deudorExistente !== undefined ? { deudorExistente: errorCapturado.deudorExistente } : {}),
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
 * Handler de `POST /api/deudores`: da de alta un deudor.
 * Valida el body y delega en el service. No contiene reglas de negocio ni exige caja abierta.
 * La sesión y el rol los exige `requerirRol` en la ruta, no este handler.
 * Respuestas: 201 si se registra; 400 con detalle por campo si el body es inválido;
 * 409 `DNI_DUPLICADO` con el deudor que ya tiene ese DNI.
 */
export async function postRegistrarDeudor(req: Request, res: Response): Promise<void> {
  // En Express 5 un POST sin body deja `req.body` en undefined: se trata como objeto vacío para que los errores
  // salgan con el nombre de cada campo faltante
  const parseo = datosDeudorSchema.safeParse(req.body ?? {});
  if (!parseo.success) {
    res.status(400).json(construirRespuestaValidacion("Datos de deudor inválidos", parseo.error.issues));
    return;
  }

  try {
    const resultado = await registrarDeudor(parseo.data);
    res.status(201).json(resultado);
  } catch (errorCapturado) {
    // Los errores de negocio (objetos puros) se traducen a su código HTTP;
    // cualquier otro valor (BD caída, bug) no pasa la guarda y sube a Express
    if (responderErrorNegocio(res, errorCapturado)) {
      return;
    }
    throw errorCapturado;
  }
}

/**
 * Handler de `GET /api/deudores`: lista paginada de deudores con búsqueda opcional por nombre o DNI.
 * Valida la query y delega en el service. No contiene reglas de negocio ni exige caja abierta.
 * La sesión y el rol los exige `requerirRol` en la ruta, no este handler.
 * Respuestas: 200 con la página (vacía si está fuera de rango); 400 con detalle por parámetro si la query es inválida.
 */
export async function getConsultarDeudores(req: Request, res: Response): Promise<void> {
  // Los query params llegan siempre como texto: el esquema los convierte de forma estricta
  const parseo = consultarDeudoresSchema.safeParse(req.query);
  if (!parseo.success) {
    res.status(400).json(construirRespuestaValidacion("Parámetros de consulta inválidos", parseo.error.issues));
    return;
  }

  try {
    const resultado = await consultarDeudores(parseo.data);
    res.status(200).json(resultado);
  } catch (errorCapturado) {
    // Igual que en el alta: los errores de negocio se traducen y cualquier otro valor sube a Express
    if (responderErrorNegocio(res, errorCapturado)) {
      return;
    }
    throw errorCapturado;
  }
}

/**
 * Handler de `PUT /api/deudores/:idDeudor`: reemplaza el nombre, el teléfono y el DNI de un deudor.
 * Valida el parámetro de ruta y el body, y delega en el service. No contiene reglas de negocio ni exige caja abierta.
 * La sesión y el rol los exige `requerirRol` en la ruta, no este handler.
 * Respuestas: 200 si se actualiza; 400 con detalle por campo si el id o el body son inválidos;
 * 404 `DEUDOR_NO_ENCONTRADO`; 409 `DNI_DUPLICADO` con el otro deudor que ya tiene ese DNI.
 */
export async function putActualizarDeudor(req: Request, res: Response): Promise<void> {
  // El parámetro de ruta llega como texto: el esquema lo convierte de forma estricta
  const parseoParametros = actualizarDeudorParametrosSchema.safeParse(req.params);
  if (!parseoParametros.success) {
    res.status(400).json(construirRespuestaValidacion("Parámetros de ruta inválidos", parseoParametros.error.issues));
    return;
  }

  // Igual que en el alta: sin body, `req.body` es undefined y se trata como objeto vacío
  const parseoCuerpo = datosDeudorSchema.safeParse(req.body ?? {});
  if (!parseoCuerpo.success) {
    res.status(400).json(construirRespuestaValidacion("Datos de deudor inválidos", parseoCuerpo.error.issues));
    return;
  }

  try {
    // El id de la ruta va al final: aunque el body trajera un `idDeudor`, nunca puede pisar el de la ruta
    const resultado = await actualizarDeudor({ ...parseoCuerpo.data, idDeudor: parseoParametros.data.idDeudor });
    res.status(200).json(resultado);
  } catch (errorCapturado) {
    if (responderErrorNegocio(res, errorCapturado)) {
      return;
    }
    throw errorCapturado;
  }
}
