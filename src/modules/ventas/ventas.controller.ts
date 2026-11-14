import type { Request, Response } from "express";
import type { SesionAutenticada } from "../auth/auth.types.js";
import { esErrorNegocio } from "./ventas.errors.js";
import {
  anularVentaCuerpoSchema,
  anularVentaParametrosSchema,
  consultarHistorialSchema,
  consultarVentaSchema,
  liquidarFiadoParametrosSchema,
  liquidarFiadoSchema,
  registrarVentaSchema,
} from "./ventas.schemas.js";
import { anularVenta, consultarHistorial, consultarVenta, liquidarFiado, registrarVenta } from "./ventas.service.js";

// --- FUNCIONES AUXILIARES ---

/** Incidencia de validación de Zod reducida a lo que necesita la respuesta. */
type IncidenciaValidacion = {
  path: ReadonlyArray<PropertyKey>;
  message: string;
};

/**
 * Arma el cuerpo de la respuesta 400 por datos inválidos: un elemento por cada campo con error.
 * Se centraliza para que todos los endpoints del módulo respondan con el mismo formato.
 * @param mensaje Mensaje general (por ejemplo "Datos de venta inválidos").
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

// --- HANDLERS ---

/**
 * Handler de `POST /api/ventas`.
 * Valida el body y delega en el service. No contiene reglas de negocio.
 * El vendedor es el usuario del token (`res.locals.sesion`, que deja `requerirRol`); un `idUsuario` en el body se ignora.
 * Respuestas: 201 si se registra; 400 con detalle por campo si el body es inválido;
 * el código del error de negocio (400/404/409) si falla una regla de negocio.
 */
export async function postRegistrarVenta(req: Request, res: Response): Promise<void> {
  // safeParse no lanza: permite responder el detalle de cada campo inválido
  const parseo = registrarVentaSchema.safeParse(req.body);
  if (!parseo.success) {
    res.status(400).json(construirRespuestaValidacion("Datos de venta inválidos", parseo.error.issues));
    return;
  }

  // La sesión ya fue verificada por requerirRol: aquí solo se lee para identificar al vendedor
  const sesion = res.locals.sesion as SesionAutenticada;

  try {
    const resultado = await registrarVenta({ ...parseo.data, idUsuario: sesion.idUsuario });
    res.status(201).json(resultado);
  } catch (errorCapturado) {
    // Los errores de negocio (objetos puros) se traducen a su código HTTP;
    // cualquier otro valor (BD caída, bug) no pasa la guarda y sube a Express
    if (esErrorNegocio(errorCapturado)) {
      res.status(errorCapturado.status).json({ exito: false, mensaje: errorCapturado.mensaje });
      return;
    }
    throw errorCapturado;
  }
}

/**
 * Handler de `GET /api/ventas`: lista paginada del historial con filtros opcionales.
 * Valida la query y delega en el service. No contiene reglas de negocio ni exige caja abierta.
 * La sesión validada (cualquier rol) la exige `requerirRol` en la ruta, no este handler.
 * Filtros opcionales (AND entre sí): fechas, producto, estado, `origen`, `medioPago` (id de un medio con un único pago, o `MIXTO` para más de un pago), `textoCliente` y `numeroComprobante`.
 * Respuestas: 200 con la página (vacía si está fuera de rango) y la hora del servidor; 400 con detalle por parámetro si la query es inválida.
 */
export async function getConsultarHistorial(req: Request, res: Response): Promise<void> {
  // Los query params llegan siempre como texto: el esquema los convierte de forma estricta
  const parseo = consultarHistorialSchema.safeParse(req.query);
  if (!parseo.success) {
    res.status(400).json(construirRespuestaValidacion("Parámetros de consulta inválidos", parseo.error.issues));
    return;
  }

  try {
    const resultado = await consultarHistorial(parseo.data);
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
 * Handler de `GET /api/ventas/:idVenta`: detalle de una venta con sus ítems y pagos.
 * Valida el parámetro de ruta y delega en el service. No contiene reglas de negocio ni exige caja abierta.
 * La sesión y el rol los exige `requerirRol` en la ruta, no este handler.
 * Respuestas: 200 con la venta y la hora del servidor; 400 con detalle por parámetro si `idVenta` es inválido; 404 si la venta no existe.
 */
export async function getConsultarVenta(req: Request, res: Response): Promise<void> {
  // El parámetro de ruta llega como texto: el esquema lo convierte de forma estricta
  const parseo = consultarVentaSchema.safeParse(req.params);
  if (!parseo.success) {
    res.status(400).json(construirRespuestaValidacion("Parámetros de ruta inválidos", parseo.error.issues));
    return;
  }

  try {
    const resultado = await consultarVenta(parseo.data);
    res.status(200).json(resultado);
  } catch (errorCapturado) {
    // Igual que en los otros handlers: el 404 de negocio se traduce y cualquier otro valor sube a Express
    if (esErrorNegocio(errorCapturado)) {
      res.status(errorCapturado.status).json({ exito: false, mensaje: errorCapturado.mensaje });
      return;
    }
    throw errorCapturado;
  }
}

/**
 * Handler de `POST /api/ventas/:idVenta/cobro`: cobra un fiado (liquidar fiado).
 * Valida el parámetro de ruta y el body, y delega en el service. No contiene reglas de negocio.
 * La sesión y el rol los exige `requerirRol` en la ruta, no este handler.
 * Respuestas: 200 si se cobra; 400 con detalle por campo si los datos son inválidos o falla una regla de negocio;
 * 404 si la venta no existe; 409 si no está pendiente de pago, no hay caja abierta o hubo un doble cobro.
 */
export async function postLiquidarFiado(req: Request, res: Response): Promise<void> {
  // El parámetro de ruta llega como texto: el esquema lo convierte de forma estricta
  const parseoParametros = liquidarFiadoParametrosSchema.safeParse(req.params);
  if (!parseoParametros.success) {
    res.status(400).json(construirRespuestaValidacion("Parámetros de ruta inválidos", parseoParametros.error.issues));
    return;
  }

  const parseoCuerpo = liquidarFiadoSchema.safeParse(req.body);
  if (!parseoCuerpo.success) {
    res.status(400).json(construirRespuestaValidacion("Datos de cobro inválidos", parseoCuerpo.error.issues));
    return;
  }

  try {
    const resultado = await liquidarFiado({ ...parseoParametros.data, ...parseoCuerpo.data });
    res.status(200).json(resultado);
  } catch (errorCapturado) {
    // Igual que en los otros handlers: los errores de negocio se traducen y cualquier otro valor sube a Express
    if (esErrorNegocio(errorCapturado)) {
      res.status(errorCapturado.status).json({ exito: false, mensaje: errorCapturado.mensaje });
      return;
    }
    throw errorCapturado;
  }
}

/**
 * Handler de `POST /api/ventas/:idVenta/anulacion`: anula una venta y repone su stock (baja y modificación venta).
 * Valida el parámetro de ruta y el body (el motivo es obligatorio) y delega en el service. No contiene reglas de negocio.
 * La sesión y el rol los exige `requerirRol` en la ruta, no este handler.
 * Quien anula es el usuario del token (`res.locals.sesion`); un `idUsuario` en el body se ignora.
 * Respuestas: 200 si se anula; 400 con detalle por campo si `idVenta` o el motivo son inválidos; 403 si venció la ventana de tiempo;
 * 404 si la venta no existe; 409 si ya está anulada, cambió de estado durante el proceso o tuvo cobro y no hay caja abierta.
 */
export async function postAnularVenta(req: Request, res: Response): Promise<void> {
  // El parámetro de ruta llega como texto: el esquema lo convierte de forma estricta
  const parseoParametros = anularVentaParametrosSchema.safeParse(req.params);
  if (!parseoParametros.success) {
    res.status(400).json(construirRespuestaValidacion("Parámetros de ruta inválidos", parseoParametros.error.issues));
    return;
  }

  // En Express 5 un POST sin body deja `req.body` en undefined: se trata como objeto vacío para que el error
  // salga con el campo "motivo" y no con un campo vacío. Un body que no es objeto (por ejemplo un arreglo) sigue dando 400
  const parseoCuerpo = anularVentaCuerpoSchema.safeParse(req.body ?? {});
  if (!parseoCuerpo.success) {
    res.status(400).json(construirRespuestaValidacion("Datos de anulación inválidos", parseoCuerpo.error.issues));
    return;
  }

  // La sesión ya fue verificada por requerirRol: aquí solo se lee para identificar a quien anula
  const sesion = res.locals.sesion as SesionAutenticada;

  try {
    const resultado = await anularVenta({ ...parseoParametros.data, ...parseoCuerpo.data, idUsuario: sesion.idUsuario });
    res.status(200).json(resultado);
  } catch (errorCapturado) {
    // Igual que en los otros handlers: los errores de negocio se traducen (incluido el 403 de ventana vencida)
    // y cualquier otro valor sube a Express
    if (esErrorNegocio(errorCapturado)) {
      res.status(errorCapturado.status).json({ exito: false, mensaje: errorCapturado.mensaje });
      return;
    }
    throw errorCapturado;
  }
}
