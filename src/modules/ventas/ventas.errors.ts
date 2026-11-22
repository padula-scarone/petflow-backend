// --- CONSTANTES Y TIPOS ---

/** Valor del campo discriminante que identifica un error de negocio. */
export const TIPO_ERROR_NEGOCIO = "ERROR_NEGOCIO" as const;

/**
 * Códigos HTTP que puede producir una regla de negocio: dato inválido, operación fuera de plazo,
 * inexistente o conflicto de estado. El 403 de negocio (ventana vencida) es distinto del 403 de
 * autenticación (rol no permitido): ambos comparten formato y se distinguen por el mensaje.
 */
export type EstadoHttpNegocio = 400 | 403 | 404 | 409;

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
 * @param status 400 (dato o regla inválida), 403 (fuera de plazo), 404 (no existe) o 409 (conflicto de estado).
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

/**
 * Crea el error de intentar cobrar una venta que no es un fiado pendiente (ya cobrada o anulada).
 * Usa 409 porque el pedido es válido pero choca con el estado actual de la venta.
 * @param idVenta Id de la venta que no está pendiente de pago.
 */
export function crearErrorVentaNoPendientePago(idVenta: number): ErrorNegocio {
  return crearErrorNegocio(`La venta ${idVenta} no está pendiente de pago`, 409);
}

/**
 * Crea el error de un cobro simultáneo: otra operación cambió el estado de la venta entre la lectura y la escritura.
 * @param idVenta Id de la venta que ya no estaba pendiente de pago al momento de cobrarla.
 */
export function crearErrorDobleCobro(idVenta: number): ErrorNegocio {
  return crearErrorNegocio(`La venta ${idVenta} ya fue cobrada o cambió de estado`, 409);
}

// --- FÁBRICAS DE ANULACIÓN ---

/**
 * Crea el error de intentar anular una venta que ya está anulada.
 * Usa 409 porque el pedido es válido pero choca con el estado actual de la venta.
 * @param idVenta Id de la venta ya anulada.
 */
export function crearErrorVentaYaAnulada(idVenta: number): ErrorNegocio {
  return crearErrorNegocio(`La venta ${idVenta} ya está anulada`, 409);
}

/**
 * Crea el error de anular fuera de la ventana permitida.
 * Usa 403 con mensaje propio: la acción ya no está permitida para esta venta (no es un problema de rol).
 * @param limiteMinutos Minutos de la ventana, para que el mensaje no quede desfasado de la constante.
 */
export function crearErrorVentanaAnulacionVencida(limiteMinutos: number): ErrorNegocio {
  return crearErrorNegocio(`No se puede anular: pasaron más de ${limiteMinutos} minutos desde la venta`, 403);
}

/**
 * Crea el error de anular una venta con cobro cuando no hay ninguna caja abierta.
 * Usa 409 porque el pedido es válido pero choca con el estado actual de la caja.
 */
export function crearErrorSinCajaParaAnular(): ErrorNegocio {
  return crearErrorNegocio("No hay una caja abierta para anular una venta con cobro", 409);
}

/**
 * Crea el error de una anulación que perdió una carrera: otra operación cambió el estado de la venta
 * (o venció la ventana) entre la lectura y la escritura.
 * @param idVenta Id de la venta que ya no estaba en el estado leído al momento de anularla.
 */
export function crearErrorAnulacionSimultanea(idVenta: number): ErrorNegocio {
  return crearErrorNegocio(`La venta ${idVenta} cambió de estado o venció el plazo mientras se procesaba`, 409);
}

// --- ERRORES CON CODIGO LEGIBLE POR MAQUINA ---

/**
 * Error de negocio con un `codigo` legible por maquina. Lo comparten los modulos que lo agregan
 * (deudores, cuentas corrientes y los 409 de cobros de ventas): el controller solo necesita saber que trae `codigo`.
 */
export type ErrorNegocioConCodigo = ErrorNegocio & { codigo: string };

/** Codigo de los 409 de Liquidar Fiado y de la anulacion (baja y edicion) sobre un fiado que ya tiene cobros. */
export const CODIGO_FIADO_CON_COBROS = "FIADO_CON_COBROS" as const;

/**
 * Crea el error de operar sobre un fiado que ya tiene al menos un cobro registrado (parcial o total).
 * Usa 409 porque el pedido es valido pero choca con el estado actual del fiado: cobrarlo por completo o anularlo
 * desconoceria lo que ya se cobro y su ingreso en caja. Es independiente del estado de la venta
 * (un fiado completado por cobros tambien los tiene).
 * @param idVenta Id del fiado con cobros.
 * @param accionRechazada Lo que se intento hacer, para que el mensaje sea claro ("cobrar por completo" o "anular o modificar").
 */
export function crearErrorFiadoConCobros(idVenta: number, accionRechazada: string): ErrorNegocioConCodigo {
  return {
    ...crearErrorNegocio(
      `El fiado ${idVenta} ya tiene cobros registrados: no se puede ${accionRechazada}`,
      409,
    ),
    codigo: CODIGO_FIADO_CON_COBROS,
  };
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
    (candidato.status === 400 || candidato.status === 403 || candidato.status === 404 || candidato.status === 409)
  );
}

/**
 * Indica si un valor capturado es un error de negocio que ademas trae `codigo` (texto).
 * Es mas estricta que `esErrorNegocio`: un error sin codigo no pasa.
 */
export function esErrorNegocioConCodigo(valor: unknown): valor is ErrorNegocioConCodigo {
  return esErrorNegocio(valor) && typeof (valor as { codigo?: unknown }).codigo === "string";
}
