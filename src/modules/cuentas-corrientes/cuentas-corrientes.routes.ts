import { Router } from "express";
import { requerirRol } from "../auth/auth.middleware.js";
import {
  getConsultarCobro,
  getConsultarCuentasCorrientes,
  getConsultarEstadoCuenta,
  postRegistrarCobro,
} from "./cuentas-corrientes.controller.js";

// --- RUTAS ---

/** Router del módulo de cuentas corrientes; se monta en `/api/cuentas-corrientes` desde `server.ts`. Tres lecturas y el cobro de fiados. */
export const cuentasCorrientesRouter = Router();

// GET /api/cuentas-corrientes: deudores con su saldo, paginado (por defecto solo los que deben). Requiere sesión validada; no exige caja abierta (CUB 1.5)
cuentasCorrientesRouter.get("/", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), getConsultarCuentasCorrientes);

// GET /api/cuentas-corrientes/cobros/:idCobroDeudor: recibo de un cobro ya registrado. Requiere sesión validada; no exige caja abierta.
// Va ANTES de `/:idDeudor` a proposito. No chocan (`/:idDeudor` solo coincide con un segmento y esta ruta tiene dos), pero declarar
// primero la ruta con parte literal evita que un cambio futuro en las rutas con parametro la tape sin que nadie lo note
cuentasCorrientesRouter.get("/cobros/:idCobroDeudor", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), getConsultarCobro);

// GET /api/cuentas-corrientes/:idDeudor: estado de cuenta de un deudor (sus fiados pendientes y el saldo). Requiere sesión validada; no exige caja abierta
cuentasCorrientesRouter.get("/:idDeudor", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), getConsultarEstadoCuenta);

// POST /api/cuentas-corrientes/:idDeudor/cobros: cobrar uno o varios fiados del deudor (pagos parciales, varios medios, recibo consolidado).
// Requiere sesión validada y caja abierta (CUB 1.5 paso 6, RF-VENTAS-13)
cuentasCorrientesRouter.post("/:idDeudor/cobros", requerirRol("VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"), postRegistrarCobro);
