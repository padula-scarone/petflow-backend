import type { Request, Response } from "express";
import { listarMediosPago } from "./caja.service.js";

// --- HANDLERS ---

/**
 * Handler de `GET /api/medios-pago`: medios de pago activos.
 * No tiene parámetros que validar ni reglas de negocio, y no exige caja abierta.
 * La sesión validada (cualquier rol) la exige `requerirRol` en la ruta, no este handler.
 * Respuestas: 200 con la lista.
 */
export async function getListarMediosPago(_req: Request, res: Response): Promise<void> {
  const resultado = await listarMediosPago();
  res.status(200).json(resultado);
}
