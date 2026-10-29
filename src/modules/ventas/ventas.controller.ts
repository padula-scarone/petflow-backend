import type { Request, Response } from "express";
import { VentaError } from "./ventas.errors.js";
import { registrarVentaSchema } from "./ventas.schemas.js";
import { registrarVenta } from "./ventas.service.js";

export async function postRegistrarVenta(req: Request, res: Response): Promise<void> {
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
    if (error instanceof VentaError) {
      res.status(error.status).json({ exito: false, mensaje: error.message });
      return;
    }
    throw error;
  }
}
