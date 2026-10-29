import { Router } from "express";
import { postRegistrarVenta } from "./ventas.controller.js";

// --- RUTAS ---

/** Router del módulo de ventas; se monta en `/ventas` desde `server.ts`. */
export const ventasRouter = Router();

// POST /ventas: registrar una venta (cobrada o fiado)
ventasRouter.post("/", postRegistrarVenta);
