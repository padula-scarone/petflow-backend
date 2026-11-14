import type { Request, Response } from "express";
import type { SesionAutenticada } from "../auth/auth.types.js";
import { esErrorNegocio } from "../ventas/ventas.errors.js";
import { esErrorNegocioCambio } from "./cambios-mercaderia.errors.js";
import {
  anularCambioCuerpoSchema,
  anularCambioParametrosSchema,
  consultarCambioSchema,
  consultarHistorialCambiosSchema,
  registrarCambioSchema,
} from "./cambios-mercaderia.schemas.js";
import {
  anularCambio,
  consultarCambio,
  consultarHistorialCambios,
  registrarCambio,
} from "./cambios-mercaderia.service.js";

// --- FUNCIONES AUXILIARES ---

/** Incidencia de validación de Zod reducida a lo que necesita la respuesta. */
type IncidenciaValidacion = {
  path: ReadonlyArray<PropertyKey>;
  message: string;
};

/**
 * Arma el cuerpo de la respuesta 400 por datos inválidos: un elemento por cada campo con error.
 * Copia local de la de ventas, que no se exporta: se evita tocar ese módulo. Su extracción a `shared` es deuda registrada.
 * @param mensaje Mensaje general (por ejemplo "Datos de cambio inválidos").
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
 * Igual que `construirRespuestaValidacion`, más el `codigo` legible por máquina que el front distingue del mensaje.
 * Se usa en el alta y en el detalle; el historial conserva su respuesta de siempre.
 */
function construirRespuestaValidacionConCodigo(mensaje: string, incidencias: ReadonlyArray<IncidenciaValidacion>) {
  return { ...construirRespuestaValidacion(mensaje, incidencias), codigo: "DATOS_INVALIDOS" };
}

/**
 * Responde un error de negocio del alta o del detalle con su código HTTP, su mensaje y su `codigo`.
 * Un error de negocio sin `codigo` (no debería ocurrir en este módulo) se responde igual, sin él.
 * @returns `true` si el valor era un error de negocio y ya se respondió; `false` si hay que relanzarlo.
 */
function responderErrorNegocio(res: Response, errorCapturado: unknown): boolean {
  if (esErrorNegocioCambio(errorCapturado)) {
    res
      .status(errorCapturado.status)
      .json({ exito: false, mensaje: errorCapturado.mensaje, codigo: errorCapturado.codigo });
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
 * Handler de `POST /api/cambios-mercaderia`: registra un cambio de mercadería posventa.
 * Valida el body y delega en el service. No contiene reglas de negocio.
 * El usuario es el del token (`res.locals.sesion`, que deja `requerirRol`); un `idUsuario` en el body se ignora.
 * Respuestas: 201 si se registra; 400 con detalle por campo si el body es inválido o con mensaje si falla una regla de negocio;
 * 404 si un producto, la venta o el medio de pago no existen; 409 si la venta está anulada o pendiente de pago,
 * se excede lo devolvible, no hay caja abierta o no alcanza el stock del entregado.
 * Todo error de negocio o de validación trae además `codigo`, legible por máquina (ver `CodigoErrorCambio`).
 */
export async function postRegistrarCambio(req: Request, res: Response): Promise<void> {
  // En Express 5 un POST sin body deja `req.body` en undefined: se trata como objeto vacío para que los errores
  // salgan con el nombre de cada campo faltante
  const parseo = registrarCambioSchema.safeParse(req.body ?? {});
  if (!parseo.success) {
    res.status(400).json(construirRespuestaValidacionConCodigo("Datos de cambio inválidos", parseo.error.issues));
    return;
  }

  // La sesión ya fue verificada por requerirRol: aquí solo se lee para identificar al usuario
  const sesion = res.locals.sesion as SesionAutenticada;

  try {
    const resultado = await registrarCambio({ ...parseo.data, idUsuario: sesion.idUsuario });
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
 * Handler de `GET /api/cambios-mercaderia`: lista paginada del historial de cambios con filtros opcionales.
 * Valida la query y delega en el service. No contiene reglas de negocio ni exige caja abierta.
 * La sesión validada (cualquier rol) la exige `requerirRol` en la ruta, no este handler.
 * Respuestas: 200 con la página (vacía si está fuera de rango); 400 con detalle por parámetro si la query es inválida.
 */
export async function getConsultarHistorialCambios(req: Request, res: Response): Promise<void> {
  // Los query params llegan siempre como texto: el esquema los convierte de forma estricta
  const parseo = consultarHistorialCambiosSchema.safeParse(req.query);
  if (!parseo.success) {
    res.status(400).json(construirRespuestaValidacion("Parámetros de consulta inválidos", parseo.error.issues));
    return;
  }

  try {
    const resultado = await consultarHistorialCambios(parseo.data);
    res.status(200).json(resultado);
  } catch (errorCapturado) {
    // Igual que en el alta: los errores de negocio se traducen y cualquier otro valor sube a Express
    if (esErrorNegocio(errorCapturado)) {
      res.status(errorCapturado.status).json({ exito: false, mensaje: errorCapturado.mensaje });
      return;
    }
    throw errorCapturado;
  }
}

/**
 * Handler de `GET /api/cambios-mercaderia/:idCambio`: detalle de un cambio.
 * Valida el parámetro y delega en el service. No contiene reglas de negocio ni exige caja abierta.
 * La sesión validada (cualquier rol) la exige `requerirRol` en la ruta, no este handler.
 * Respuestas: 200 con el cambio; 400 si `idCambio` no es un entero válido; 404 si el cambio no existe.
 */
export async function getConsultarCambio(req: Request, res: Response): Promise<void> {
  // Los parámetros de ruta llegan siempre como texto: el esquema los convierte de forma estricta
  const parseo = consultarCambioSchema.safeParse(req.params);
  if (!parseo.success) {
    res.status(400).json(construirRespuestaValidacionConCodigo("Parámetros de consulta inválidos", parseo.error.issues));
    return;
  }

  try {
    const resultado = await consultarCambio(parseo.data);
    res.status(200).json(resultado);
  } catch (errorCapturado) {
    // Los errores de negocio (objetos puros) se traducen; cualquier otro valor sube a Express
    if (responderErrorNegocio(res, errorCapturado)) {
      return;
    }
    throw errorCapturado;
  }
}

/**
 * Handler de `POST /api/cambios-mercaderia/:idCambio/anulacion`: anula un cambio y revierte su stock (baja y modificación).
 * Valida el parámetro de ruta y el body (el motivo es obligatorio) y delega en el service. No contiene reglas de negocio.
 * La sesión y el rol los exige `requerirRol` en la ruta, no este handler.
 * Quien anula es el usuario del token (`res.locals.sesion`); un `idUsuario` en el body se ignora.
 * Respuestas: 200 si se anula; 400 con detalle por campo si `idCambio` o el motivo son inválidos; 403 si venció la ventana de tiempo;
 * 404 si el cambio no existe; 409 si ya está anulado (o lo anuló otra operación a la vez), tuvo saldo cobrado y no hay caja abierta,
 * o no alcanza el stock para revertir. Todo error de negocio o de validación trae además `codigo`.
 */
export async function postAnularCambio(req: Request, res: Response): Promise<void> {
  // El parámetro de ruta llega como texto: el esquema lo convierte de forma estricta
  const parseoParametros = anularCambioParametrosSchema.safeParse(req.params);
  if (!parseoParametros.success) {
    res
      .status(400)
      .json(construirRespuestaValidacionConCodigo("Parámetros de ruta inválidos", parseoParametros.error.issues));
    return;
  }

  // En Express 5 un POST sin body deja `req.body` en undefined: se trata como objeto vacío para que el error
  // salga con el campo "motivo" y no con un campo vacío. Un body que no es objeto (por ejemplo un arreglo) sigue dando 400
  const parseoCuerpo = anularCambioCuerpoSchema.safeParse(req.body ?? {});
  if (!parseoCuerpo.success) {
    res.status(400).json(construirRespuestaValidacionConCodigo("Datos de anulación inválidos", parseoCuerpo.error.issues));
    return;
  }

  // La sesión ya fue verificada por requerirRol: aquí solo se lee para identificar a quien anula
  const sesion = res.locals.sesion as SesionAutenticada;

  try {
    const resultado = await anularCambio({ ...parseoParametros.data, ...parseoCuerpo.data, idUsuario: sesion.idUsuario });
    res.status(200).json(resultado);
  } catch (errorCapturado) {
    // Los errores de negocio (objetos puros, incluido el 403 de ventana vencida) se traducen;
    // cualquier otro valor sube a Express
    if (responderErrorNegocio(res, errorCapturado)) {
      return;
    }
    throw errorCapturado;
  }
}
