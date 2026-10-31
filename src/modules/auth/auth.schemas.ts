import { z } from "zod";

// --- CONSTANTES ---

/** Largo máximo de `username`: coincide con el límite de la columna `usuarios.username`. */
export const LONGITUD_MAXIMA_USERNAME = 50;

/** Roles del sistema. Replica el enum `RolUsuario` de la BD, igual que `ventas` replica sus estados. */
export const ROLES_USUARIO = ["VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"] as const;

// --- ESQUEMAS ---

/**
 * Contrato de entrada de `POST /api/auth/login`.
 * `clave` no se recorta ni tiene máximo: los espacios pueden formar parte de la clave.
 */
export const iniciarSesionSchema = z.object({
  username: z.string().trim().min(1).max(LONGITUD_MAXIMA_USERNAME),
  clave: z.string().min(1),
});

/**
 * Payload mínimo del JWT. Se valida al verificar el token porque lo decodificado es un dato no confiable:
 * aunque la firma sea válida, su forma podría no ser la esperada.
 */
export const payloadTokenSchema = z.object({
  idUsuario: z.number().int().positive(),
  rol: z.enum(ROLES_USUARIO),
});
