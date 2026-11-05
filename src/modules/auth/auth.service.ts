import "dotenv/config";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { buscarUsuarioPorUsername } from "./auth.repository.js";
import {
  crearErrorCredencialesInvalidas,
  crearErrorRolNoPermitido,
  crearErrorTokenAusente,
  crearErrorTokenInvalido,
  crearErrorTokenVencido,
} from "./auth.errors.js";
import { payloadTokenSchema } from "./auth.schemas.js";
import type {
  IniciarSesionInput,
  IniciarSesionResponse,
  RolUsuario,
  SesionAutenticada,
} from "./auth.types.js";

// --- CONSTANTES ---

/** Vigencia del token. No hay refresh token: al vencer, el usuario inicia sesión de nuevo. */
const DURACION_TOKEN = "8h";

/** Misma vigencia en segundos (8 h), para informarla al frontend. */
const DURACION_TOKEN_SEGUNDOS = 8 * 60 * 60;

/** Algoritmo fijado al firmar y al verificar: evita aceptar tokens firmados con otro (por ejemplo `none`). */
const ALGORITMO_TOKEN = "HS256";

/** Formato exacto del encabezado `Authorization`. */
const PATRON_ENCABEZADO_BEARER = /^Bearer (\S+)$/;

// Se lee una sola vez y al cargar el módulo: si falta, el servidor no arranca
// en lugar de firmar tokens con un secreto vacío.
const JWT_SECRETO = process.env.JWT_SECRETO;
if (!JWT_SECRETO) {
  throw new Error("Falta la variable de entorno JWT_SECRETO");
}

// --- INICIO DE SESIÓN ---

/**
 * Inicia sesión: valida las credenciales y emite el token.
 * Usuario inexistente, clave errónea y usuario inactivo responden exactamente igual
 * (401 genérico), para no revelar cuál de las condiciones falló.
 * @param input Cuerpo ya validado por Zod.
 * @throws {ErrorAutenticacion} 401 si las credenciales no son válidas.
 */
export async function iniciarSesion(input: IniciarSesionInput): Promise<IniciarSesionResponse> {
  const usuario = await buscarUsuarioPorUsername(input.username);
  if (usuario === null) {
    throw crearErrorCredencialesInvalidas();
  }

  // El salt está dentro del hash: bcrypt lo extrae solo al comparar
  const claveCoincide = await bcrypt.compare(input.clave, usuario.passwordHash);
  if (!claveCoincide || usuario.estado !== "ACTIVO") {
    throw crearErrorCredencialesInvalidas();
  }

  const token = firmarToken({ idUsuario: usuario.idUsuario, rol: usuario.rol });

  return {
    exito: true,
    mensaje: "Sesión iniciada",
    token,
    tipoToken: "Bearer",
    vigenciaSegundos: DURACION_TOKEN_SEGUNDOS,
    usuario: {
      idUsuario: usuario.idUsuario,
      username: usuario.username,
      nombre: usuario.nombre,
      rol: usuario.rol,
    },
  };
}

// --- TOKEN ---

/** Firma el JWT con el payload mínimo (id y rol). */
function firmarToken(sesion: SesionAutenticada): string {
  return jwt.sign(sesion, JWT_SECRETO as string, {
    algorithm: ALGORITMO_TOKEN,
    expiresIn: DURACION_TOKEN,
  });
}

/**
 * Obtiene el token del encabezado `Authorization: Bearer <token>`.
 * @param encabezado Valor del encabezado, o `undefined` si la petición no lo trae.
 * @throws {ErrorAutenticacion} 401 si falta o no tiene el formato esperado.
 */
export function extraerTokenBearer(encabezado: string | undefined): string {
  const coincidencia = encabezado === undefined ? null : PATRON_ENCABEZADO_BEARER.exec(encabezado);
  const token = coincidencia?.[1];
  if (token === undefined) {
    throw crearErrorTokenAusente();
  }
  return token;
}

/**
 * Verifica firma, algoritmo, vigencia y forma del payload de un token.
 * @returns La sesión contenida en el token.
 * @throws {ErrorAutenticacion} 401 si el token es inválido o está vencido.
 */
export function verificarToken(token: string): SesionAutenticada {
  let decodificado: string | jwt.JwtPayload;
  try {
    decodificado = jwt.verify(token, JWT_SECRETO as string, { algorithms: [ALGORITMO_TOKEN] });
  } catch (errorCapturado) {
    // Se distingue el vencimiento para que el frontend pueda pedir iniciar sesión de nuevo
    if (errorCapturado instanceof jwt.TokenExpiredError) {
      throw crearErrorTokenVencido();
    }
    throw crearErrorTokenInvalido();
  }

  // Una firma válida no garantiza que el contenido tenga la forma esperada
  const parseo = payloadTokenSchema.safeParse(decodificado);
  if (!parseo.success) {
    throw crearErrorTokenInvalido();
  }
  return parseo.data;
}

// --- AUTORIZACIÓN ---

/**
 * Comprueba que el rol de la sesión esté entre los permitidos.
 * @throws {ErrorAutenticacion} 403 si el rol no está permitido.
 */
export function comprobarRolPermitido(sesion: SesionAutenticada, rolesPermitidos: ReadonlyArray<RolUsuario>): void {
  if (!rolesPermitidos.includes(sesion.rol)) {
    throw crearErrorRolNoPermitido();
  }
}
