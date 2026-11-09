import type { Request, Response } from "express";

// --- HANDLERS ---

/**
 * Handler de `GET /api/salud`.
 * Sirve para que la plataforma de deploy (Render) compruebe que el proceso esta vivo.
 * Es publico (se registra sin `requerirRol`) y no consulta la base de datos a proposito:
 * si dependiera de Prisma, una caida de la base reiniciaria el servicio sin que reiniciarlo la arregle.
 * Respuesta: 200 `{ exito: true, estado: "ok" }`.
 */
export function getSalud(_req: Request, res: Response): void {
  res.status(200).json({ exito: true, estado: "ok" });
}
