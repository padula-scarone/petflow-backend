import { Router } from "express";
import { requerirRol } from "../auth/auth.middleware.js";
import { postRegistrarCambio } from "./cambios-mercaderia.controller.js";

// --- RUTAS ---

/** Router del módulo de cambios de mercadería; se monta en `/api/cambios-mercaderia` desde `server.ts`. */
export const cambiosMercaderiaRouter = Router();

// POST /api/cambios-mercaderia: registrar un cambio posventa (con o sin ticket vinculado). Requiere sesión validada y caja abierta (CUB 1.4)
cambiosMercaderiaRouter.post("/", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), postRegistrarCambio);
