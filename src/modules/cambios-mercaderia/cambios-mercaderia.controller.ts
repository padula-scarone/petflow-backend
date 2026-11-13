import type { Request, Response } from "express";
import type { SesionAutenticada } from "../auth/auth.types.js";
import { esErrorNegocio } from "../ventas/ventas.errors.js";
import { consultarHistorialCambiosSchema, registrarCambioSchema } from "./cambios-mercaderia.schemas.js";
import { consultarHistorialCambios, registrarCambio } from "./cambios-mercaderia.service.js";

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

// --- HANDLERS ---

/**
 * Handler de `POST /api/cambios-mercaderia`: registra un cambio de mercadería posventa.
 * Valida el body y delega en el service. No contiene reglas de negocio.
 * El usuario es el del token (`res.locals.sesion`, que deja `requerirRol`); un `idUsuario` en el body se ignora.
 * Respuestas: 201 si se registra; 400 con detalle por campo si el body es inválido o con mensaje si falla una regla de negocio;
 * 404 si un producto, la venta o el medio de pago no existen; 409 si la venta está anulada o pendiente de pago,
 * se excede lo devolvible, no hay caja abierta o no alcanza el stock del entregado.
 */
export async function postRegistrarCambio(req: Request, res: Response): Promise<void> {
  // En Express 5 un POST sin body deja `req.body` en undefined: se trata como objeto vacío para que los errores
  // salgan con el nombre de cada campo faltante
  const parseo = registrarCambioSchema.safeParse(req.body ?? {});
  if (!parseo.success) {
    res.status(400).json(construirRespuestaValidacion("Datos de cambio inválidos", parseo.error.issues));
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
    if (esErrorNegocio(errorCapturado)) {
      res.status(errorCapturado.status).json({ exito: false, mensaje: errorCapturado.mensaje });
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
