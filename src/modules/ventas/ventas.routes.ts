import { Router } from "express";
import { getConsultarHistorial, postRegistrarVenta } from "./ventas.controller.js";

// --- RUTAS ---

/** Router del módulo de ventas; se monta en `/api/ventas` desde `server.ts`. */
export const ventasRouter = Router();

// POST /api/ventas: registrar una venta (cobrada o fiado)
ventasRouter.post("/", postRegistrarVenta);

// GET /api/ventas: historial paginado con filtros (fecha, producto, estado)
ventasRouter.get("/", getConsultarHistorial);
