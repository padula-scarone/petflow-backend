import { Router } from "express";
import { requerirRol } from "../auth/auth.middleware.js";
import {
  getConsultarHistorial,
  getConsultarVenta,
  postAnularVenta,
  postLiquidarFiado,
  postRegistrarVenta,
} from "./ventas.controller.js";

// --- RUTAS ---

/** Router del módulo de ventas; se monta en `/api/ventas` desde `server.ts`. */
export const ventasRouter = Router();

// POST /api/ventas: registrar una venta (cobrada o fiado). Requiere sesión validada (CUB 1.1)
ventasRouter.post("/", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), postRegistrarVenta);

// GET /api/ventas: historial paginado con filtros (fecha, producto, estado). Requiere sesión validada (CUB 1.2)
ventasRouter.get("/", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), getConsultarHistorial);

// GET /api/ventas/:idVenta: detalle de una venta con ítems y pagos. Requiere sesión validada; no exige caja abierta
ventasRouter.get("/:idVenta", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), getConsultarVenta);

// POST /api/ventas/:idVenta/cobro: liquidar un fiado (cobro total, sin límite de tiempo). Requiere sesión validada y caja abierta (CUB 1.2)
ventasRouter.post("/:idVenta/cobro", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), postLiquidarFiado);

// POST /api/ventas/:idVenta/anulacion: anular una venta (baja y modificacion venta) dentro de 15 min, con reposicion de stock y auditoria. El body exige el motivo. Requiere sesion validada (CUB 1.2)
ventasRouter.post("/:idVenta/anulacion", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), postAnularVenta);
