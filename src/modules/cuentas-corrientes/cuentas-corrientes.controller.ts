import type { Request, Response } from "express";
import type { SesionAutenticada } from "../auth/auth.types.js";
import { esErrorNegocio, esErrorNegocioConCodigo } from "../ventas/ventas.errors.js";
import {
  consultarCobroSchema,
  consultarCuentasCorrientesSchema,
  consultarEstadoCuentaSchema,
  registrarCobroCuerpoSchema,
  registrarCobroParametrosSchema,
} from "./cuentas-corrientes.schemas.js";
import {
  consultarCobro,
  consultarCuentasCorrientes,
  consultarEstadoCuenta,
  registrarCobro,
} from "./cuentas-corrientes.service.js";

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
 * Los que traen `codigo` lo suman (`DEUDOR_NO_ENCONTRADO`, `FIADO_NO_ENCONTRADO`, `FIADO_NO_PENDIENTE`, `MONTO_EXCEDE_FALTA`,
 * `SIN_CAJA_ABIERTA`, `COBRO_SIMULTANEO`, `COBRO_NO_ENCONTRADO`); cualquier otro mantiene el formato de ventas (por ejemplo los 400 de los pagos).
 * Copia local de la de ventas y deudores (deuda registrada).
 * @returns `true` si el valor era un error de negocio y ya se respondió; `false` si hay que relanzarlo.
 */
function responderErrorNegocio(res: Response, errorCapturado: unknown): boolean {
  if (esErrorNegocioConCodigo(errorCapturado)) {
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

/**
 * Handler de `POST /api/cuentas-corrientes/:idDeudor/cobros`: registra el cobro de uno o varios fiados de un deudor.
 * Valida el parámetro de ruta y el body y delega en el service. No contiene reglas de negocio.
 * La sesión y el rol los exige `requerirRol` en la ruta; el usuario del cobro es el del token (`res.locals.sesion`)
 * y un `idUsuario` en el body se ignora.
 * Respuestas: 201 con el recibo consolidado; 400 con detalle por campo si el parámetro o el body son inválidos (o falla una regla
 * de los pagos); 404 si el deudor no existe (`DEUDOR_NO_ENCONTRADO`) o un fiado no es de ese deudor (`FIADO_NO_ENCONTRADO`);
 * 409 si un fiado ya no está pendiente (`FIADO_NO_PENDIENTE`), un monto supera lo que falta (`MONTO_EXCEDE_FALTA`),
 * no hay caja abierta (`SIN_CAJA_ABIERTA`) o hay otro cobro simultáneo sobre los mismos fiados (`COBRO_SIMULTANEO`).
 * Es todo o nada: ante cualquier error no se guarda nada.
 */
export async function postRegistrarCobro(req: Request, res: Response): Promise<void> {
  // El parámetro de ruta llega como texto: el esquema lo convierte de forma estricta
  const parseoParametros = registrarCobroParametrosSchema.safeParse(req.params);
  if (!parseoParametros.success) {
    res.status(400).json(construirRespuestaValidacion("Parámetros de ruta inválidos", parseoParametros.error.issues));
    return;
  }

  // En Express 5 un POST sin body deja `req.body` en undefined: se trata como objeto vacío para que el error
  // salga con el campo "fiados" y no con un campo vacío
  const parseoCuerpo = registrarCobroCuerpoSchema.safeParse(req.body ?? {});
  if (!parseoCuerpo.success) {
    res.status(400).json(construirRespuestaValidacion("Datos de cobro inválidos", parseoCuerpo.error.issues));
    return;
  }

  // La sesión ya fue verificada por requerirRol: aquí solo se lee para identificar a quien registra el cobro
  const sesion = res.locals.sesion as SesionAutenticada;

  try {
    const resultado = await registrarCobro({
      ...parseoCuerpo.data,
      ...parseoParametros.data,
      idUsuario: sesion.idUsuario,
    });
    res.status(201).json(resultado);
  } catch (errorCapturado) {
    if (responderErrorNegocio(res, errorCapturado)) {
      return;
    }
    throw errorCapturado;
  }
}

/**
 * Handler de `GET /api/cuentas-corrientes/cobros/:idCobroDeudor`: recibo de un cobro ya registrado.
 * Valida el parámetro de ruta y delega en el service. No contiene reglas de negocio ni exige caja abierta.
 * La sesión y el rol los exige `requerirRol` en la ruta, no este handler.
 * Respuestas: 200 con el recibo (deudor con id y nombre, usuario que cobró, fiados cubiertos, pagos y total cobrado);
 * 400 con detalle por parámetro si `idCobroDeudor` es inválido; 404 `COBRO_NO_ENCONTRADO` si el cobro no existe.
 */
export async function getConsultarCobro(req: Request, res: Response): Promise<void> {
  // El parámetro de ruta llega como texto: el esquema lo convierte de forma estricta
  const parseo = consultarCobroSchema.safeParse(req.params);
  if (!parseo.success) {
    res.status(400).json(construirRespuestaValidacion("Parámetros de ruta inválidos", parseo.error.issues));
    return;
  }

  try {
    const resultado = await consultarCobro(parseo.data);
    res.status(200).json(resultado);
  } catch (errorCapturado) {
    if (responderErrorNegocio(res, errorCapturado)) {
      return;
    }
    throw errorCapturado;
  }
}
