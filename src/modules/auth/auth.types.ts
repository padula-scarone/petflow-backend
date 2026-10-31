import type { z } from "zod";
import type { iniciarSesionSchema, payloadTokenSchema, ROLES_USUARIO } from "./auth.schemas.js";

// --- TIPOS DE ENTRADA ---

/** Cuerpo validado de `POST /api/auth/login`, inferido del esquema Zod. */
export type IniciarSesionInput = z.infer<typeof iniciarSesionSchema>;

/** Rol con el que un usuario opera en el sistema. */
export type RolUsuario = (typeof ROLES_USUARIO)[number];

/** Estado de un usuario en la BD. Solo `ACTIVO` puede iniciar sesión. */
export type EstadoUsuario = "ACTIVO" | "INACTIVO";

// --- SESIÓN ---

/**
 * Datos de la sesión que viajan dentro del JWT y que el middleware deja en `res.locals.sesion`.
 * Es el payload mínimo: el payload y la sesión son lo mismo.
 */
export type SesionAutenticada = z.infer<typeof payloadTokenSchema>;

// --- DATOS LEÍDOS DE LA BASE ---

/** Usuario con su hash, tal como lo lee el repository. No sale nunca del servidor. */
export type UsuarioConCredenciales = {
  idUsuario: number;
  username: string;
  nombre: string;
  rol: RolUsuario;
  /** Hash bcrypt de la clave (el salt viaja dentro del propio hash). */
  passwordHash: string;
  estado: EstadoUsuario;
};

// --- RESPUESTA ---

/** Datos públicos del usuario que se devuelven al iniciar sesión. Nunca incluyen el hash. */
export type UsuarioSesion = {
  idUsuario: number;
  username: string;
  nombre: string;
  rol: RolUsuario;
};

/** Respuesta exitosa de `POST /api/auth/login`. */
export type IniciarSesionResponse = {
  exito: true;
  mensaje: string;
  /** JWT firmado: el frontend lo envía como `Authorization: Bearer <token>`. */
  token: string;
  tipoToken: "Bearer";
  /** Segundos de vigencia del token desde su emisión (8 h = 28800). */
  vigenciaSegundos: number;
  usuario: UsuarioSesion;
};
