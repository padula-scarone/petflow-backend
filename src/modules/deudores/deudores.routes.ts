import { Router } from "express";
import { requerirRol } from "../auth/auth.middleware.js";
import { getConsultarDeudores, postRegistrarDeudor, putActualizarDeudor } from "./deudores.controller.js";

// --- RUTAS ---

/** Router del módulo de deudores; se monta en `/api/deudores` desde `server.ts`. */
export const deudoresRouter = Router();

// POST /api/deudores: alta de un deudor. Requiere sesión validada; no exige caja abierta (CUB 1.5)
deudoresRouter.post("/", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), postRegistrarDeudor);

// GET /api/deudores: búsqueda paginada por nombre o DNI. Requiere sesión validada; no exige caja abierta
deudoresRouter.get("/", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), getConsultarDeudores);

// PUT /api/deudores/:idDeudor: reemplaza nombre, teléfono y DNI. No hay baja (ni DELETE ni estado). Requiere sesión validada; no exige caja abierta
deudoresRouter.put("/:idDeudor", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), putActualizarDeudor);
