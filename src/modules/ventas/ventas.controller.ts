import type { Request, Response } from "express";
import { esErrorNegocio } from "./ventas.errors.js";
import { registrarVentaSchema } from "./ventas.schemas.js";
import { registrarVenta } from "./ventas.service.js";

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
 * Handler de `POST /ventas`.
 * Valida el body y delega en el service. No contiene reglas de negocio.
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

  try {
    const resultado = await registrarVenta(parseo.data);
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
