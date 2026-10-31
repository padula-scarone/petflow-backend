// --- CONSTANTES Y TIPOS ---

/** Valor del campo discriminante que identifica un error de autenticación o autorización. */
export const TIPO_ERROR_AUTENTICACION = "ERROR_AUTENTICACION" as const;

/** Mensaje único para toda credencial rechazada: no revela si falló el usuario o la clave. */
export const MENSAJE_CREDENCIALES_INVALIDAS = "Credenciales inválidas";

/** Códigos HTTP del módulo: 401 (no hay sesión válida) y 403 (hay sesión, pero sin permiso). */
export type EstadoHttpAutenticacion = 401 | 403;

/**
 * Error de autenticación o autorización, modelado como dato puro (sin class ni new).
 * Tiene su propio discriminante para no mezclarse con `ErrorNegocio` de `ventas`.
 */
export type ErrorAutenticacion = {
  /** Discriminante: permite distinguirlo de cualquier otro valor lanzado. */
  tipo: typeof TIPO_ERROR_AUTENTICACION;
  /** Mensaje legible que se devuelve al frontend. */
  mensaje: string;
  /** Código HTTP con el que se responde. */
  status: EstadoHttpAutenticacion;
};

// --- FÁBRICAS ---

/**
 * Crea un error de autenticación o autorización.
 * @param mensaje Mensaje legible para el frontend.
 * @param status 401 (sin sesión válida) o 403 (rol no permitido).
 */
export function crearErrorAutenticacion(mensaje: string, status: EstadoHttpAutenticacion): ErrorAutenticacion {
  return { tipo: TIPO_ERROR_AUTENTICACION, mensaje, status };
}

/** Login rechazado: usuario inexistente, clave errónea o usuario inactivo (siempre el mismo mensaje). */
export function crearErrorCredencialesInvalidas(): ErrorAutenticacion {
  return crearErrorAutenticacion(MENSAJE_CREDENCIALES_INVALIDAS, 401);
}

/** La petición no trae un `Authorization: Bearer <token>` utilizable. */
export function crearErrorTokenAusente(): ErrorAutenticacion {
  return crearErrorAutenticacion("Falta el token de sesión", 401);
}

/** El token tiene firma, formato o contenido inválidos. */
export function crearErrorTokenInvalido(): ErrorAutenticacion {
  return crearErrorAutenticacion("Token de sesión inválido", 401);
}

/** El token es válido pero superó su vigencia: el frontend puede pedir iniciar sesión de nuevo. */
export function crearErrorTokenVencido(): ErrorAutenticacion {
  return crearErrorAutenticacion("Token de sesión vencido", 401);
}

/** La sesión es válida pero su rol no está permitido en la ruta. */
export function crearErrorRolNoPermitido(): ErrorAutenticacion {
  return crearErrorAutenticacion("No tiene permiso para realizar esta acción", 403);
}

// --- GUARDA DE TIPO ---

/**
 * Indica si un valor capturado en un `catch` es un error de autenticación.
 * Exige la forma exacta, así los fallos inesperados (BD caída, bugs) siguen subiendo a Express.
 */
export function esErrorAutenticacion(valor: unknown): valor is ErrorAutenticacion {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const candidato = valor as Record<string, unknown>;
  return (
    candidato.tipo === TIPO_ERROR_AUTENTICACION &&
    typeof candidato.mensaje === "string" &&
    (candidato.status === 401 || candidato.status === 403)
  );
}
