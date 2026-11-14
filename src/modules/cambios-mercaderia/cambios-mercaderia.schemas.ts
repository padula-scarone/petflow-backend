import { z } from "zod";
import {
  anularVentaCuerpoSchema,
  CANTIDAD_POR_PAGINA_MAXIMA,
  CANTIDAD_POR_PAGINA_PREDETERMINADA,
  enteroDesdeTexto,
  fechaCalendarioSchema,
  ID_PRODUCTO_MAXIMO,
  ID_VENTA_MAXIMO,
  MONTO_RECIBIDO_MAXIMO,
  PAGINA_MAXIMA,
} from "../ventas/ventas.schemas.js";

// --- CONSTANTES ---

/** Tope de `idMedioPago`: máximo de una columna integer de PostgreSQL (más allá, la BD falla con 500). */
export const ID_MEDIO_PAGO_MAXIMO = 2_147_483_647;

/**
 * Tope de una cantidad: máximo de una columna decimal(10,3). A diferencia de la venta, la cantidad devuelta
 * no está acotada por el stock, así que sin este tope un valor enorme haría fallar la BD con 500.
 */
export const CANTIDAD_MAXIMA = 9_999_999.999;

/** Largo máximo de `motivoCambio`: coincide con la columna VARCHAR(200). */
export const MOTIVO_CAMBIO_LONGITUD_MAXIMA = 200;

// --- HELPERS DE VALIDACIÓN ---

/**
 * Crea un validador que acepta hasta `decimales` posiciones decimales.
 * Copia local de la de ventas, que no se exporta: se evita tocar ese módulo. Su extracción a `shared` es deuda registrada.
 * Se compara contra un margen mínimo porque los números de JS no representan decimales exactos.
 */
function conDecimalesMaximos(decimales: number) {
  const factor = 10 ** decimales;
  return (valor: number) => Math.abs(Math.round(valor * factor) - valor * factor) < 1e-6;
}

/** Cantidad de un producto: positiva, hasta 3 decimales (el mismo formato que el alta de venta) y dentro del tope de la columna. */
const cantidadSchema = z
  .number()
  .positive()
  .max(CANTIDAD_MAXIMA, `La cantidad no puede superar ${CANTIDAD_MAXIMA}`)
  .refine(conDecimalesMaximos(3), "La cantidad admite hasta 3 decimales");

/** Peso devuelto de una bolsa abierta, en kilos: positivo, hasta 3 decimales y dentro del tope de la columna del granel. */
const pesoDevueltoSchema = z
  .number()
  .positive()
  .max(CANTIDAD_MAXIMA, `El peso devuelto no puede superar ${CANTIDAD_MAXIMA}`)
  .refine(conDecimalesMaximos(3), "El peso devuelto admite hasta 3 decimales");

// --- ESQUEMA PRINCIPAL ---

/**
 * Contrato de entrada de `POST /api/cambios-mercaderia`.
 * El usuario no viaja en el body: sale del token. Si llega `idUsuario`, Zod lo descarta sin error (el objeto no es estricto).
 * Tampoco viajan el producto que ingresa al stock, el saldo, los precios ni el vuelto: los calcula el servidor
 * (un `vuelto` en el body se descarta igual que `idUsuario`).
 * Las reglas que dependen de la base (formato del producto, ticket, tope del peso, saldo, medio de pago, efectivo)
 * las valida el service.
 */
export const registrarCambioSchema = z
  .object({
    /** Ticket de la venta que originó el cambio; sin él, el cambio es aislado. */
    idVentaOriginal: z.number().int().positive().max(ID_VENTA_MAXIMO).optional(),
    idProductoDevuelto: z.number().int().positive().max(ID_PRODUCTO_MAXIMO),
    /** Unidades devueltas; con bolsa abierta son bolsas enteras. */
    cantidadDevuelta: cantidadSchema,
    /** Bolsa abierta: el contenido se suma al granel del producto devuelto. */
    esBolsaAbierta: z.boolean().default(false),
    /** Kilos que se devuelven de la bolsa abierta (el total, si son varias bolsas); sin él se usa el peso nominal. */
    pesoDevuelto: pesoDevueltoSchema.optional(),
    idProductoEntregado: z.number().int().positive().max(ID_PRODUCTO_MAXIMO),
    cantidadEntregada: cantidadSchema,
    /** Obligatorio solo si el saldo es mayor a 0; con saldo 0 se ignora. */
    idMedioPago: z.number().int().positive().max(ID_MEDIO_PAGO_MAXIMO).optional(),
    /** Solo con un medio en efectivo y saldo mayor a 0; el service lo valida (el esquema no conoce el tipo del medio). */
    montoRecibido: z
      .number()
      .positive()
      .max(MONTO_RECIBIDO_MAXIMO)
      .refine(conDecimalesMaximos(2), "El monto recibido admite hasta 2 decimales")
      .optional(),
    /** Texto del motivo del cambio; el front lo arma a partir del motivo elegido. Se recorta antes de medirlo. */
    motivoCambio: z
      .string({ error: "El motivo del cambio es obligatorio y debe ser texto" })
      .trim()
      .min(1, "El motivo del cambio no puede estar vacío")
      .max(MOTIVO_CAMBIO_LONGITUD_MAXIMA, `El motivo del cambio admite hasta ${MOTIVO_CAMBIO_LONGITUD_MAXIMA} caracteres`),
  })
  // Informar el peso sin marcar bolsa abierta se rechaza: descartarlo en silencio dejaría ingresar al stock otra cantidad
  .superRefine((cambio, contexto) => {
    if (cambio.pesoDevuelto !== undefined && !cambio.esBolsaAbierta) {
      contexto.addIssue({
        code: "custom",
        path: ["pesoDevuelto"],
        message: "El peso devuelto solo se informa con bolsa abierta",
      });
    }
  });

// --- CONSULTA DE HISTORIAL: CONSTANTES ---

/** Estados que se pueden filtrar en el historial de cambios. Sin filtro se devuelven todos. */
export const ESTADOS_CAMBIO_HISTORIAL = ["ACTIVO", "ANULADO"] as const;

/** Vínculos que se pueden filtrar: cambios con o sin venta original (`idVentaOriginal`). */
export const VINCULOS_CAMBIO_HISTORIAL = ["VINCULADO", "DESVINCULADO"] as const;

// --- CONSULTA DE HISTORIAL: ESQUEMA ---

/**
 * Contrato de entrada de `GET /api/cambios-mercaderia` (query params, todos opcionales).
 * Los valores llegan como texto; la conversión a número es estricta (ver `enteroDesdeTexto` de ventas).
 * Las fechas son inclusivas en ambos extremos y se interpretan en hora de Argentina.
 * `idProducto` coincide con el producto devuelto o con el entregado. Todos los filtros se combinan con AND.
 */
export const consultarHistorialCambiosSchema = z
  .object({
    pagina: enteroDesdeTexto(1, PAGINA_MAXIMA).default(1),
    cantidadPorPagina: enteroDesdeTexto(1, CANTIDAD_POR_PAGINA_MAXIMA).default(CANTIDAD_POR_PAGINA_PREDETERMINADA),
    fechaDesde: fechaCalendarioSchema.optional(),
    fechaHasta: fechaCalendarioSchema.optional(),
    idProducto: enteroDesdeTexto(1, ID_PRODUCTO_MAXIMO).optional(),
    estado: z.enum(ESTADOS_CAMBIO_HISTORIAL).optional(),
    vinculo: z.enum(VINCULOS_CAMBIO_HISTORIAL).optional(),
    idMedioPago: enteroDesdeTexto(1, ID_MEDIO_PAGO_MAXIMO).optional(),
  })
  // Con el formato AAAA-MM-DD la comparación de texto equivale a la cronológica.
  // Es una copia de la regla del historial de ventas: esa vive dentro de su propio esquema y no se puede reutilizar sin tocarlo
  .superRefine((consulta, contexto) => {
    if (
      consulta.fechaDesde !== undefined &&
      consulta.fechaHasta !== undefined &&
      consulta.fechaDesde > consulta.fechaHasta
    ) {
      contexto.addIssue({
        code: "custom",
        path: ["fechaDesde"],
        message: "fechaDesde no puede ser posterior a fechaHasta",
      });
    }
  });

// --- DETALLE DE UN CAMBIO: PARÁMETRO DE RUTA ---

/** Tope de `idCambio`: máximo de una columna integer de PostgreSQL (más allá, la BD falla con 500). */
export const ID_CAMBIO_MAXIMO = 2_147_483_647;

/**
 * Contrato de entrada de `GET /api/cambios-mercaderia/:idCambio`: el id llega como texto por la ruta
 * y la conversión a número es estricta (ver `enteroDesdeTexto` de ventas).
 */
export const consultarCambioSchema = z.object({
  idCambio: enteroDesdeTexto(1, ID_CAMBIO_MAXIMO),
});

// --- ANULACIÓN DE UN CAMBIO ---

/**
 * Contrato de entrada del parámetro de ruta de `POST /api/cambios-mercaderia/:idCambio/anulacion`.
 * Reutiliza el esquema del detalle (entero positivo hasta `ID_CAMBIO_MAXIMO`, conversión estricta) en lugar de
 * declarar uno idéntico: así el tope del id no puede divergir entre rutas.
 */
export const anularCambioParametrosSchema = consultarCambioSchema;

/**
 * Contrato de entrada del body de `POST /api/cambios-mercaderia/:idCambio/anulacion`: `{ motivo }` obligatorio,
 * de 1 a 200 caracteres tras recortar. Es el mismo esquema que la anulación de ventas (baja y modificación son
 * una sola operación y no hay un campo que las distinga). Un `idUsuario` en el body se descarta: quien anula
 * sale siempre del token.
 */
export const anularCambioCuerpoSchema = anularVentaCuerpoSchema;
