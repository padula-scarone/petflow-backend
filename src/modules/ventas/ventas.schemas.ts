import { z } from "zod";

// --- HELPERS DE VALIDACIÓN ---

/**
 * Máximo de una columna integer de PostgreSQL. Un id mayor haría fallar la consulta con 500,
 * así que los ids del body se acotan aquí y responden 400. Va primero porque se evalúa al cargar el módulo.
 */
const ID_ENTERO_MAXIMO = 2_147_483_647;

/**
 * Crea un validador que acepta hasta `decimales` posiciones decimales.
 * Se compara contra un margen mínimo porque los números de JS no representan decimales exactos.
 */
function conDecimalesMaximos(decimales: number) {
  const factor = 10 ** decimales;
  return (valor: number) => Math.abs(Math.round(valor * factor) - valor * factor) < 1e-6;
}

/**
 * Reporta como error cada repetición posterior a la primera aparición de un medio de pago.
 * La BD tiene unique (id_venta, id_medio_pago): un medio solo puede aparecer una vez por venta.
 * Es compartida por el alta de venta y por el cobro de un fiado.
 */
function validarMediosNoRepetidos(pagos: ReadonlyArray<{ idMedioPago: number }>, contexto: z.RefinementCtx): void {
  pagos.forEach((pago, index) => {
    const repetido = pagos.findIndex((otro) => otro.idMedioPago === pago.idMedioPago);
    if (repetido !== index) {
      contexto.addIssue({
        code: "custom",
        path: ["pagos", index, "idMedioPago"],
        message: "Un medio de pago no puede repetirse en la misma venta",
      });
    }
  });
}

// Cantidades: decimal(10,3) en BD. Montos: decimal(12,2) en BD.
const decimalesCantidad = conDecimalesMaximos(3);
const decimalesMonto = conDecimalesMaximos(2);

// --- ESQUEMAS DE ÍTEMS Y PAGOS ---

/** Un producto solicitado y su cantidad (admite decimales para productos a granel). */
const itemVentaSchema = z.object({
  idProducto: z.number().int().positive().max(ID_ENTERO_MAXIMO),
  cantidad: z
    .number()
    .positive()
    .refine(decimalesCantidad, "La cantidad admite hasta 3 decimales"),
});

/** Un pago parcial: el medio utilizado y la porción base que aporta (sin recargo). */
const pagoVentaSchema = z.object({
  idMedioPago: z.number().int().positive().max(ID_ENTERO_MAXIMO),
  monto: z
    .number()
    .positive()
    .refine(decimalesMonto, "El monto admite hasta 2 decimales"),
});

// --- ESQUEMAS DE PAGO CON MONTO RECIBIDO ---
// Van antes de `registrarVentaSchema` porque se evalúan al cargar el módulo: usarlos más arriba que su declaración fallaría.

/** Tope de `montoRecibido`: máximo de una columna decimal(12,2); más allá, la BD falla con 500. */
export const MONTO_RECIBIDO_MAXIMO = 9_999_999_999.99;

/** Largo máximo de `motivoDescuento`: coincide con la columna VARCHAR(200). */
export const MOTIVO_DESCUENTO_LONGITUD_MAXIMA = 200;

/**
 * Un pago con el monto recibido opcional. Lo comparten el alta de venta y el cobro de un fiado.
 * `montoRecibido` solo corresponde a un medio en efectivo, pero eso lo valida el service (el esquema no conoce el tipo del medio).
 */
const pagoConMontoRecibidoSchema = pagoVentaSchema.extend({
  montoRecibido: z
    .number()
    .positive()
    .max(MONTO_RECIBIDO_MAXIMO)
    .refine(decimalesMonto, "El monto recibido admite hasta 2 decimales")
    .optional(),
});

// --- ESQUEMA PRINCIPAL ---

/**
 * Contrato de entrada de `POST /api/ventas`.
 * Si `pagos` viene vacío la venta es un fiado y `clienteReferencia` pasa a ser obligatorio.
 * El vendedor no viaja en el body: sale del token. Si llega `idUsuario`, Zod lo descarta sin error (el objeto no es estricto).
 */
export const registrarVentaSchema = z
  .object({
    origen: z.enum(["MOSTRADOR", "DIGITAL"]),
    modalidadEntrega: z.enum(["RETIRO", "ENVIO"]),
    clienteReferencia: z.string().trim().min(1).max(100).optional(),
    items: z.array(itemVentaSchema).min(1),
    pagos: z.array(pagoConMontoRecibidoSchema),
    descuentoManual: z
      .number()
      .nonnegative()
      .refine(decimalesMonto, "El descuento admite hasta 2 decimales")
      .optional(),
    // Una cadena vacía (o solo espacios) se rechaza: el front omite el campo cuando no hay descuento
    motivoDescuento: z
      .string()
      .trim()
      .min(1, "El motivo del descuento no puede estar vacío")
      .max(MOTIVO_DESCUENTO_LONGITUD_MAXIMA, `El motivo del descuento admite hasta ${MOTIVO_DESCUENTO_LONGITUD_MAXIMA} caracteres`)
      .optional(),
  })
  // Reglas que cruzan varios campos y no se pueden expresar en cada campo por separado
  .superRefine((data, ctx) => {
    // Un fiado necesita saber quién es el deudor
    if (data.pagos.length === 0 && !data.clienteReferencia) {
      ctx.addIssue({
        code: "custom",
        path: ["clienteReferencia"],
        message: "Una venta al fiado requiere el nombre o referencia del cliente",
      });
    }

    // Se reporta como error cada repetición posterior a la primera aparición del producto
    data.items.forEach((item, index) => {
      const repetido = data.items.findIndex((otro) => otro.idProducto === item.idProducto);
      if (repetido !== index) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "idProducto"],
          message: "Un producto no puede repetirse en la misma venta",
        });
      }
    });

    validarMediosNoRepetidos(data.pagos, ctx);

    // El motivo y el descuento van de la mano: con descuento el motivo es obligatorio y sin descuento no tiene sentido.
    // Si el motivo vino vacío ya lo rechazó su propio campo; aquí solo se cubre el caso de ausencia o contradicción.
    const hayDescuento = (data.descuentoManual ?? 0) > 0;
    if (hayDescuento && data.motivoDescuento === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["motivoDescuento"],
        message: "Un descuento manual requiere indicar el motivo",
      });
    }
    if (!hayDescuento && data.motivoDescuento !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["motivoDescuento"],
        message: "No se puede indicar un motivo sin descuento manual",
      });
    }
  });

// --- COBRO DE FIADO: ESQUEMAS ---

/**
 * Contrato de entrada del body de `POST /api/ventas/:idVenta/cobro`.
 * El front no envía total ni vuelto: los calcula el servidor. El cobro es total, así que `pagos` no puede venir vacío.
 */
export const liquidarFiadoSchema = z
  .object({
    pagos: z.array(pagoConMontoRecibidoSchema).min(1),
  })
  .superRefine((data, ctx) => {
    validarMediosNoRepetidos(data.pagos, ctx);
  });

// --- CONSULTA DE HISTORIAL: CONSTANTES ---

/** Estados que se pueden filtrar en el historial. Incluye ANULADA: sin filtro se devuelven todos. */
export const ESTADOS_VENTA_HISTORIAL = ["COMPLETADA", "PENDIENTE_PAGO", "ANULADA"] as const;

/** Tamaño de página cuando el cliente no lo indica. */
export const CANTIDAD_POR_PAGINA_PREDETERMINADA = 20;

/** Tamaño de página máximo: mantiene liviano el payload de cada respuesta. */
export const CANTIDAD_POR_PAGINA_MAXIMA = 100;

/** Tope de `pagina`: evita desbordar el desplazamiento (skip) de la consulta con valores absurdos. */
export const PAGINA_MAXIMA = 1_000_000;

/** Tope de `idProducto`: es el máximo de una columna integer de PostgreSQL (más allá, la BD falla con 500). */
export const ID_PRODUCTO_MAXIMO = 2_147_483_647;

/** Tope de `idVenta`: mismo máximo de la columna integer de PostgreSQL; un valor mayor haría fallar la BD con 500. */
export const ID_VENTA_MAXIMO = 2_147_483_647;

// --- CONSULTA DE HISTORIAL: AUXILIARES ---

/**
 * Descompone una fecha `AAAA-MM-DD` en ejercicio, mes y día.
 * @returns Las partes si el texto tiene el formato y la fecha existe en el calendario; `null` en otro caso.
 */
export function descomponerFechaCalendario(
  fecha: string,
): { ejercicio: number; mes: number; dia: number } | null {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (coincidencia === null) {
    return null;
  }
  const ejercicio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const dia = Number(coincidencia[3]);

  // Ida y vuelta por Date.UTC: una fecha inexistente (2026-02-31) se desborda al mes siguiente y no coincide
  const instante = new Date(Date.UTC(ejercicio, mes - 1, dia));
  const existe =
    instante.getUTCFullYear() === ejercicio && instante.getUTCMonth() === mes - 1 && instante.getUTCDate() === dia;
  return existe ? { ejercicio, mes, dia } : null;
}

/**
 * Entero recibido como texto dentro de un rango.
 * Se usa regex + transform y no `z.coerce`: coerce acepta en silencio "1e1", " 2 " o ["1"].
 */
function enteroDesdeTexto(minimo: number, maximo: number) {
  return z
    .string()
    .regex(/^\d+$/, "Debe ser un entero sin signo, sin espacios ni notación científica")
    .transform(Number)
    .pipe(z.number().int().min(minimo).max(maximo));
}

/** Fecha `AAAA-MM-DD` que además existe en el calendario. */
const fechaCalendarioSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Debe tener formato AAAA-MM-DD")
  .refine((fecha) => descomponerFechaCalendario(fecha) !== null, "La fecha no existe en el calendario");

// --- CONSULTA DE HISTORIAL: ESQUEMA ---

/**
 * Contrato de entrada de `GET /api/ventas` (query params, todos opcionales).
 * Los valores llegan como texto; la conversión a número es estricta (ver `enteroDesdeTexto`).
 * Las fechas son inclusivas en ambos extremos y se interpretan en hora de Argentina.
 */
export const consultarHistorialSchema = z
  .object({
    pagina: enteroDesdeTexto(1, PAGINA_MAXIMA).default(1),
    cantidadPorPagina: enteroDesdeTexto(1, CANTIDAD_POR_PAGINA_MAXIMA).default(CANTIDAD_POR_PAGINA_PREDETERMINADA),
    fechaDesde: fechaCalendarioSchema.optional(),
    fechaHasta: fechaCalendarioSchema.optional(),
    idProducto: enteroDesdeTexto(1, ID_PRODUCTO_MAXIMO).optional(),
    estado: z.enum(ESTADOS_VENTA_HISTORIAL).optional(),
  })
  // Con el formato AAAA-MM-DD la comparación de texto equivale a la cronológica
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

// --- CONSULTA DE UNA VENTA: ESQUEMA ---

/**
 * Contrato de entrada de `GET /api/ventas/:idVenta` (parámetro de ruta).
 * Llega como texto y se convierte de forma estricta, igual que la query del historial.
 */
export const consultarVentaSchema = z.object({
  idVenta: enteroDesdeTexto(1, ID_VENTA_MAXIMO),
});

// --- COBRO DE FIADO: PARÁMETRO DE RUTA ---

/**
 * Contrato de entrada del parámetro de ruta de `POST /api/ventas/:idVenta/cobro`.
 * Va después de `ID_VENTA_MAXIMO` y `enteroDesdeTexto` porque se evalúa al cargar el módulo.
 */
export const liquidarFiadoParametrosSchema = z.object({
  idVenta: enteroDesdeTexto(1, ID_VENTA_MAXIMO),
});
