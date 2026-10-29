import { z } from "zod";

// Hasta `decimales` posiciones decimales (cantidades con 3, montos con 2)
function conDecimalesMaximos(decimales: number) {
  const factor = 10 ** decimales;
  return (valor: number) => Math.abs(Math.round(valor * factor) - valor * factor) < 1e-6;
}

const decimalesCantidad = conDecimalesMaximos(3);
const decimalesMonto = conDecimalesMaximos(2);

const itemVentaSchema = z.object({
  idProducto: z.number().int().positive(),
  cantidad: z
    .number()
    .positive()
    .refine(decimalesCantidad, "La cantidad admite hasta 3 decimales"),
});

const pagoVentaSchema = z.object({
  idMedioPago: z.number().int().positive(),
  monto: z
    .number()
    .positive()
    .refine(decimalesMonto, "El monto admite hasta 2 decimales"),
});

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
  .superRefine((data, ctx) => {
    if (data.pagos.length === 0 && !data.clienteReferencia) {
      ctx.addIssue({
        code: "custom",
        path: ["clienteReferencia"],
        message: "Una venta al fiado requiere el nombre o referencia del cliente",
      });
    }

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
