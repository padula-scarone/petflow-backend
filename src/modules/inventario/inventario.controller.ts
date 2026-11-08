import type { Request, Response } from "express";
import { consultarProductosSchema } from "./inventario.schemas.js";
import { buscarProductos } from "./inventario.service.js";

// --- FUNCIONES AUXILIARES ---

/** Incidencia de validación de Zod reducida a lo que necesita la respuesta. */
type IncidenciaValidacion = {
  path: ReadonlyArray<PropertyKey>;
  message: string;
};

/**
 * Arma el cuerpo de la respuesta 400 por datos inválidos: un elemento por cada campo con error.
 * Copia local de la de ventas, que no se exporta: se evita tocar ese módulo. Su extracción a `shared` es deuda registrada.
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

// --- HANDLERS ---

/**
 * Handler de `GET /api/productos`: productos activos, con búsqueda opcional por nombre.
 * Valida la query y delega en el service. No contiene reglas de negocio ni exige caja abierta.
 * La sesión validada (cualquier rol) la exige `requerirRol` en la ruta, no este handler.
 * Respuestas: 200 con la lista (vacía si no hay coincidencias); 400 con detalle por parámetro si la query es inválida.
 */
export async function getBuscarProductos(req: Request, res: Response): Promise<void> {
  // Los query params llegan siempre como texto: safeParse permite responder el detalle del campo inválido
  const parseo = consultarProductosSchema.safeParse(req.query);
  if (!parseo.success) {
    res.status(400).json(construirRespuestaValidacion("Parámetros de consulta inválidos", parseo.error.issues));
    return;
  }

  const resultado = await buscarProductos(parseo.data);
  res.status(200).json(resultado);
}
