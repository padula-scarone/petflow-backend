import { Router } from "express";
import { requerirRol } from "../auth/auth.middleware.js";
import { getConsultarHistorial, postRegistrarVenta } from "./ventas.controller.js";

// --- RUTAS ---

/** Router del módulo de ventas; se monta en `/api/ventas` desde `server.ts`. */
export const ventasRouter = Router();

// POST /api/ventas: registrar una venta (cobrada o fiado). Requiere sesión validada (CUB 1.1)
ventasRouter.post("/", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), postRegistrarVenta);

// GET /api/ventas: historial paginado con filtros (fecha, producto, estado). Requiere sesión validada (CUB 1.2)
ventasRouter.get("/", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), getConsultarHistorial);
