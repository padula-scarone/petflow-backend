import type { Request, Response } from "express";
import { VentaError } from "./ventas.errors.js";
import { registrarVentaSchema } from "./ventas.schemas.js";
import { registrarVenta } from "./ventas.service.js";

// --- HANDLERS ---

/**
 * Handler de `POST /ventas`.
 * Valida el body y delega en el service. No contiene reglas de negocio.
 * Respuestas: 201 si se registra; 400 con detalle por campo si el body es inválido;
 * el código de `VentaError` (400/404/409) si falla una regla de negocio.
 */
export async function postRegistrarVenta(req: Request, res: Response): Promise<void> {
  // safeParse no lanza: permite responder el detalle de cada campo inválido
  const parseo = registrarVentaSchema.safeParse(req.body);
  if (!parseo.success) {
    res.status(400).json({
      exito: false,
      mensaje: "Datos de venta inválidos",
      errores: parseo.error.issues.map((issue) => ({
        campo: issue.path.join("."),
        mensaje: issue.message,
      })),
    });
    return;
  }

  try {
    const resultado = await registrarVenta(parseo.data);
    res.status(201).json(resultado);
  } catch (error) {
    // Los errores de negocio se traducen a su código HTTP; cualquier otro (BD caída, bug) sube a Express
    if (error instanceof VentaError) {
      res.status(error.status).json({ exito: false, mensaje: error.message });
      return;
    }
    throw error;
  }
}
