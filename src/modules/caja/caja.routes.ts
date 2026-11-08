import { Router } from "express";
import { requerirRol } from "../auth/auth.middleware.js";
import { getListarMediosPago } from "./caja.controller.js";

// --- RUTAS ---

/** Router del módulo de caja; se monta en `/api/medios-pago` desde `server.ts`. */
export const cajaRouter = Router();

// GET /api/medios-pago: medios de pago activos. Requiere sesión validada; no exige caja abierta
cajaRouter.get("/", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), getListarMediosPago);
