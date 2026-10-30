// --- CONSTANTES Y TIPOS ---

/** Valor del campo discriminante que identifica un error de negocio. */
export const TIPO_ERROR_NEGOCIO = "ERROR_NEGOCIO" as const;

/** Códigos HTTP que puede producir una regla de negocio: dato inválido, inexistente o conflicto de estado. */
export type EstadoHttpNegocio = 400 | 404 | 409;

/**
 * Error de negocio del módulo de ventas, modelado como dato puro (sin class ni new).
 * El controller lo reconoce con `esErrorNegocio` y responde con el código HTTP de `status`.
 */
export type ErrorNegocio = {
  /** Discriminante: permite distinguirlo de cualquier otro valor lanzado. */
  tipo: typeof TIPO_ERROR_NEGOCIO;
  /** Mensaje legible que se devuelve al frontend. */
  mensaje: string;
  /** Código HTTP con el que se responde. */
  status: EstadoHttpNegocio;
};

// --- FÁBRICAS ---

/**
 * Crea un error de negocio.
 * @param mensaje Mensaje legible para el frontend.
 * @param status 400 (dato o regla inválida), 404 (no existe) o 409 (conflicto de estado).
 */
export function crearErrorNegocio(mensaje: string, status: EstadoHttpNegocio): ErrorNegocio {
  return { tipo: TIPO_ERROR_NEGOCIO, mensaje, status };
}

/**
 * Crea el error de un producto sin unidades suficientes.
 * Usa 409 porque el pedido es válido pero choca con el estado actual del inventario.
 * @param idProducto Id del producto sin stock suficiente.
 */
export function crearErrorStockInsuficiente(idProducto: number): ErrorNegocio {
  return crearErrorNegocio(`Stock insuficiente para el producto ${idProducto}`, 409);
}

// --- GUARDA DE TIPO ---

/**
 * Indica si un valor capturado en un `catch` es un error de negocio.
 * Exige la forma exacta: descarta `null` y todo lo que no sea un objeto con `tipo` correcto,
 * `mensaje` de texto y `status` permitido. Así los fallos inesperados (BD caída, bugs) siguen subiendo a Express.
 */
export function esErrorNegocio(valor: unknown): valor is ErrorNegocio {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const candidato = valor as Record<string, unknown>;
  return (
    candidato.tipo === TIPO_ERROR_NEGOCIO &&
    typeof candidato.mensaje === "string" &&
    (candidato.status === 400 || candidato.status === 404 || candidato.status === 409)
  );
}
