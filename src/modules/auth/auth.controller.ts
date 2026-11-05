import type { Request, Response } from "express";
import { esErrorAutenticacion } from "./auth.errors.js";
import { iniciarSesionSchema } from "./auth.schemas.js";
import { iniciarSesion } from "./auth.service.js";

// --- FUNCIONES AUXILIARES ---

/** Incidencia de validación de Zod reducida a lo que necesita la respuesta. */
type IncidenciaValidacion = {
  path: ReadonlyArray<PropertyKey>;
  message: string;
};

// DEUDA TECNICA: copia privada y equivalente de `construirRespuestaValidacion` de `ventas.controller.ts`
// (misma forma de respuesta 400). Se duplica para no tocar `ventas` en esta tarea; cuando se
// extraiga a `src/shared/`, ambos controllers deben importarla desde ahí.
/**
 * Arma el cuerpo de la respuesta 400 por datos inválidos: un elemento por cada campo con error.
 * @param mensaje Mensaje general (por ejemplo "Datos de inicio de sesión inválidos").
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
 * Handler de `POST /api/auth/login`.
 * Valida el body y delega en el service. No contiene reglas de negocio.
 * Respuestas: 200 con el token y los datos del usuario; 400 con detalle por campo si el body es inválido;
 * 401 con mensaje genérico si las credenciales no son válidas.
 */
export async function postIniciarSesion(req: Request, res: Response): Promise<void> {
  // safeParse no lanza: permite responder el detalle de cada campo inválido
  const parseo = iniciarSesionSchema.safeParse(req.body);
  if (!parseo.success) {
    res.status(400).json(construirRespuestaValidacion("Datos de inicio de sesión inválidos", parseo.error.issues));
    return;
  }

  try {
    const resultado = await iniciarSesion(parseo.data);
    res.status(200).json(resultado);
  } catch (errorCapturado) {
    // Los errores de autenticación (objetos puros) se traducen a su código HTTP;
    // cualquier otro valor (BD caída, bug) no pasa la guarda y sube a Express
    if (esErrorAutenticacion(errorCapturado)) {
      res.status(errorCapturado.status).json({ exito: false, mensaje: errorCapturado.mensaje });
      return;
    }
    throw errorCapturado;
  }
}
