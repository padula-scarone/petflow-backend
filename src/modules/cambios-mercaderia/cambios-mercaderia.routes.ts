import { Router } from "express";
import { requerirRol } from "../auth/auth.middleware.js";
import {
  getConsultarCambio,
  getConsultarHistorialCambios,
  postAnularCambio,
  postRegistrarCambio,
} from "./cambios-mercaderia.controller.js";

// --- RUTAS ---

/** Router del módulo de cambios de mercadería; se monta en `/api/cambios-mercaderia` desde `server.ts`. */
export const cambiosMercaderiaRouter = Router();

// POST /api/cambios-mercaderia: registrar un cambio posventa (con o sin ticket vinculado). Requiere sesión validada y caja abierta (CUB 1.4)
cambiosMercaderiaRouter.post("/", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), postRegistrarCambio);

// GET /api/cambios-mercaderia: historial paginado con filtros (fecha, producto, estado, vínculo, medio de pago). Requiere sesión validada; no exige caja abierta
cambiosMercaderiaRouter.get("/", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), getConsultarHistorialCambios);

// GET /api/cambios-mercaderia/:idCambio: detalle de un cambio. Requiere sesión validada; no exige caja abierta
cambiosMercaderiaRouter.get("/:idCambio", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), getConsultarCambio);

// POST /api/cambios-mercaderia/:idCambio/anulacion: baja y modificacion de un cambio (anula y repone/revierte stock; modificar = anular y volver a cargar con el alta). Requiere sesion validada; exige caja abierta solo si el cambio cobro saldo
cambiosMercaderiaRouter.post("/:idCambio/anulacion", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), postAnularCambio);
