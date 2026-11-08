import { Router } from "express";
import { requerirRol } from "../auth/auth.middleware.js";
import { getBuscarProductos } from "./inventario.controller.js";

// --- RUTAS ---

/** Router del módulo de inventario; se monta en `/api/productos` desde `server.ts`. */
export const inventarioRouter = Router();

// GET /api/productos: productos activos con búsqueda opcional por nombre. Requiere sesión validada; no exige caja abierta
inventarioRouter.get("/", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), getBuscarProductos);
