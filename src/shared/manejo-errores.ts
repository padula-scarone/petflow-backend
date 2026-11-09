import type { NextFunction, Request, Response } from "express";

// --- TIPOS ---

/** Cuerpo de toda respuesta de error de la API (el mismo formato que usan los controllers). */
type RespuestaError = {
  exito: false;
  mensaje: string;
};

/**
 * Error que lanza el lector de cuerpos de Express (`express.json()`) cuando no puede procesar la peticion.
 * Trae el codigo HTTP en `status` y un identificador del problema en `type`.
 */
type ErrorLecturaCuerpo = {
  status: number;
  type: string;
};

// --- CONSTANTES ---

/** Mensaje del 404 por ruta inexistente. */
const MENSAJE_RUTA_INEXISTENTE = "Ruta no encontrada";

/** Mensaje del 400 por JSON mal formado. */
const MENSAJE_JSON_INVALIDO = "El cuerpo de la petición no es un JSON válido";

/** Mensaje del 413 por cuerpo mayor al limite del lector (100 kilobytes por defecto). */
const MENSAJE_CUERPO_DEMASIADO_GRANDE = "El cuerpo de la petición supera el tamaño máximo permitido";

/** Mensaje del 415 por codificacion no soportada. */
const MENSAJE_CODIFICACION_NO_SOPORTADA = "La codificación del cuerpo de la petición no está soportada";

/** Mensaje del 500: generico a proposito, para no filtrar detalles internos al cliente. */
const MENSAJE_ERROR_INTERNO = "Error interno del servidor";

/**
 * Errores de lectura del cuerpo que se responden con un mensaje fijo, segun el `type` que informa Express.
 * Los mensajes son fijos a proposito: nunca se devuelve el `message` original del error.
 * El JSON invalido (`entity.parse.failed`) no esta aca porque se reconoce por ser un `SyntaxError`.
 */
const RESPUESTAS_POR_TIPO_ERROR_CUERPO: Readonly<Record<string, { status: number; mensaje: string }>> = {
  "entity.too.large": { status: 413, mensaje: MENSAJE_CUERPO_DEMASIADO_GRANDE },
  "charset.unsupported": { status: 415, mensaje: MENSAJE_CODIFICACION_NO_SOPORTADA },
  "encoding.unsupported": { status: 415, mensaje: MENSAJE_CODIFICACION_NO_SOPORTADA },
};

// --- FUNCIONES AUXILIARES ---

/**
 * Indica si un valor desconocido tiene la forma de un error de lectura del cuerpo de Express.
 * Se verifica la estructura porque en `catch` y en los manejadores de error el valor llega como `unknown`.
 * @param valor Error capturado.
 */
function esErrorLecturaCuerpo(valor: unknown): valor is ErrorLecturaCuerpo {
  return (
    typeof valor === "object" &&
    valor !== null &&
    "status" in valor &&
    typeof valor.status === "number" &&
    "type" in valor &&
    typeof valor.type === "string"
  );
}

/**
 * Indica si el error es el de JSON mal formado: un `SyntaxError` del lector con status 400.
 * Exigir ambas condiciones evita confundirlo con un `SyntaxError` propio del codigo (que seria un bug, 500).
 * @param valor Error capturado.
 */
function esErrorJsonInvalido(valor: unknown): boolean {
  return valor instanceof SyntaxError && "status" in valor && valor.status === 400;
}

// --- MANEJADORES ---

/**
 * Manejador del 404: responde en JSON cuando ninguna ruta atendio la peticion.
 * Debe registrarse despues de todas las rutas y de `/docs`, porque Express lo ejecuta solo si nadie respondio antes.
 */
export function manejarRutaInexistente(_req: Request, res: Response): void {
  const respuesta: RespuestaError = { exito: false, mensaje: MENSAJE_RUTA_INEXISTENTE };
  res.status(404).json(respuesta);
}

/**
 * Manejador de errores de lectura del cuerpo: JSON invalido (400), cuerpo demasiado grande (413)
 * y codificacion no soportada (415). Cualquier otro error pasa al siguiente manejador sin tocarse.
 * Se registra antes que `manejarErrorInesperado`, que es el ultimo recurso.
 * Respuestas con mensaje fijo: nunca se devuelve el `message` del error original.
 * Firma de 4 argumentos: es lo que permite a Express reconocerlo como manejador de errores.
 */
export function manejarErrorLecturaCuerpo(errorCapturado: unknown, _req: Request, res: Response, next: NextFunction): void {
  // Si ya se enviaron los encabezados no se puede cambiar la respuesta: lo resuelve el manejador por defecto
  if (res.headersSent) {
    next(errorCapturado);
    return;
  }

  if (esErrorJsonInvalido(errorCapturado)) {
    const respuesta: RespuestaError = { exito: false, mensaje: MENSAJE_JSON_INVALIDO };
    res.status(400).json(respuesta);
    return;
  }

  if (esErrorLecturaCuerpo(errorCapturado)) {
    const respuestaConocida = RESPUESTAS_POR_TIPO_ERROR_CUERPO[errorCapturado.type];
    if (respuestaConocida) {
      const respuesta: RespuestaError = { exito: false, mensaje: respuestaConocida.mensaje };
      res.status(respuestaConocida.status).json(respuesta);
      return;
    }
  }

  // No es un error de lectura del cuerpo: lo atiende el manejador siguiente
  next(errorCapturado);
}

/**
 * Manejador de errores inesperados (bug, base caida): responde 500 con un mensaje generico.
 * El detalle (con el stack) se registra solo en la consola del servidor y nunca viaja en la respuesta.
 * Debe ser el ultimo middleware que se registre. Firma de 4 argumentos por la misma razon que el anterior.
 */
export function manejarErrorInesperado(errorCapturado: unknown, req: Request, res: Response, next: NextFunction): void {
  // Registro para diagnostico: ruta afectada y error completo (con stack) solo en el servidor
  console.error(`Error inesperado en ${req.method} ${req.path}:`, errorCapturado);

  // Si ya se enviaron los encabezados no se puede responder de nuevo: se delega para cerrar la conexion
  if (res.headersSent) {
    next(errorCapturado);
    return;
  }

  const respuesta: RespuestaError = { exito: false, mensaje: MENSAJE_ERROR_INTERNO };
  res.status(500).json(respuesta);
}
