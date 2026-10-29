import { z } from "zod";

// --- HELPERS DE VALIDACIÓN ---

/**
 * Crea un validador que acepta hasta `decimales` posiciones decimales.
 * Se compara contra un margen mínimo porque los números de JS no representan decimales exactos.
 */
function conDecimalesMaximos(decimales: number) {
  const factor = 10 ** decimales;
  return (valor: number) => Math.abs(Math.round(valor * factor) - valor * factor) < 1e-6;
}

// Cantidades: decimal(10,3) en BD. Montos: decimal(12,2) en BD.
const decimalesCantidad = conDecimalesMaximos(3);
const decimalesMonto = conDecimalesMaximos(2);

// --- ESQUEMAS DE ÍTEMS Y PAGOS ---

/** Un producto solicitado y su cantidad (admite decimales para productos a granel). */
const itemVentaSchema = z.object({
  idProducto: z.number().int().positive(),
  cantidad: z
    .number()
    .positive()
    .refine(decimalesCantidad, "La cantidad admite hasta 3 decimales"),
});

/** Un pago parcial: el medio utilizado y la porción base que aporta (sin recargo). */
const pagoVentaSchema = z.object({
  idMedioPago: z.number().int().positive(),
  monto: z
    .number()
    .positive()
    .refine(decimalesMonto, "El monto admite hasta 2 decimales"),
});

// --- ESQUEMA PRINCIPAL ---

/**
 * Contrato de entrada de `POST /ventas`.
 * Si `pagos` viene vacío la venta es un fiado y `clienteReferencia` pasa a ser obligatorio.
 */
export const registrarVentaSchema = z
  .object({
    origen: z.enum(["MOSTRADOR", "DIGITAL"]),
    modalidadEntrega: z.enum(["RETIRO", "ENVIO"]),
    // TEMPORAL: hasta que exista Login (6.1) el vendedor llega en el body
    idUsuario: z.number().int().positive(),
    clienteReferencia: z.string().trim().min(1).max(100).optional(),
    items: z.array(itemVentaSchema).min(1),
    pagos: z.array(pagoVentaSchema),
    descuentoManual: z
      .number()
      .nonnegative()
      .refine(decimalesMonto, "El descuento admite hasta 2 decimales")
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

    // La BD tiene unique (id_venta, id_medio_pago): un medio solo puede aparecer una vez
    data.pagos.forEach((pago, index) => {
      const repetido = data.pagos.findIndex((otro) => otro.idMedioPago === pago.idMedioPago);
      if (repetido !== index) {
        ctx.addIssue({
          code: "custom",
          path: ["pagos", index, "idMedioPago"],
          message: "Un medio de pago no puede repetirse en la misma venta",
        });
      }
    });
  });
