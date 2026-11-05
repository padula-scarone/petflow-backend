import { Router } from "express";
import { postIniciarSesion } from "./auth.controller.js";

// --- RUTAS ---

/** Router del módulo de seguridad; se monta en `/api/auth` desde `server.ts`. */
export const authRouter = Router();

// POST /api/auth/login: iniciar sesión (pública, no pasa por requerirRol)
authRouter.post("/login", postIniciarSesion);
