import { z } from "zod";
import {
  CANTIDAD_POR_PAGINA_MAXIMA,
  CANTIDAD_POR_PAGINA_PREDETERMINADA,
  enteroDesdeTexto,
  fechaCalendarioSchema,
  ID_PRODUCTO_MAXIMO,
  ID_VENTA_MAXIMO,
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

// --- ESQUEMA PRINCIPAL ---

/**
 * Contrato de entrada de `POST /api/cambios-mercaderia`.
 * El usuario no viaja en el body: sale del token. Si llega `idUsuario`, Zod lo descarta sin error (el objeto no es estricto).
 * Tampoco viajan el producto que ingresa al stock, el saldo ni los precios: los calcula el servidor.
 * Las reglas que dependen de la base (formato del producto, ticket, saldo, medio de pago) las valida el service.
 */
export const registrarCambioSchema = z.object({
  /** Ticket de la venta que originó el cambio; sin él, el cambio es aislado. */
  idVentaOriginal: z.number().int().positive().max(ID_VENTA_MAXIMO).optional(),
  idProductoDevuelto: z.number().int().positive().max(ID_PRODUCTO_MAXIMO),
  cantidadDevuelta: cantidadSchema,
  /** Bolsa abierta: el contenido se suma al granel del producto devuelto. */
  esBolsaAbierta: z.boolean().default(false),
  idProductoEntregado: z.number().int().positive().max(ID_PRODUCTO_MAXIMO),
  cantidadEntregada: cantidadSchema,
  /** Obligatorio solo si el saldo es mayor a 0; con saldo 0 se ignora. */
  idMedioPago: z.number().int().positive().max(ID_MEDIO_PAGO_MAXIMO).optional(),
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
