import type { NextFunction, Request, RequestHandler, Response } from "express";
import { esErrorAutenticacion } from "./auth.errors.js";
import { comprobarRolPermitido, extraerTokenBearer, verificarToken } from "./auth.service.js";
import type { RolUsuario } from "./auth.types.js";

// --- MIDDLEWARE ---

/**
 * Exige una sesión válida cuyo rol esté entre los permitidos. Reutilizable en cualquier módulo:
 * `router.get("/", requerirRol("GERENTE"), handler)`.
 * Si todo es correcto, deja `{ idUsuario, rol }` en `res.locals.sesion` para el controller.
 * Respuestas: 401 sin token válido (ausente, inválido o vencido) y 403 si el rol no está permitido.
 * No contiene reglas: delega la verificación en el service.
 * @param rolesPermitidos Roles que pueden acceder a la ruta.
 */
export function requerirRol(...rolesPermitidos: RolUsuario[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const token = extraerTokenBearer(req.headers.authorization);
      const sesion = verificarToken(token);
      comprobarRolPermitido(sesion, rolesPermitidos);
      res.locals.sesion = sesion;
      next();
    } catch (errorCapturado) {
      // Los errores de autenticación se traducen a su código HTTP;
      // cualquier otro valor (bug) sube al manejador de errores de Express
      if (esErrorAutenticacion(errorCapturado)) {
        res.status(errorCapturado.status).json({ exito: false, mensaje: errorCapturado.mensaje });
        return;
      }
      next(errorCapturado);
    }
  };
}
