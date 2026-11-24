import type { Prisma } from "../generated/prisma/client.js";

// --- SELECCIÓN DE LOS DATOS DE ENVÍO ---

/**
 * Columnas de una venta que describen su entrega: la modalidad (retiro o envío), la dirección y el destinatario del envío.
 * Es el único lugar donde se listan: las lecturas de solo lectura que muestran la venta de otro recurso (los fiados del estado de
 * cuenta, los fiados de un recibo de cobro y la venta vinculada a un cambio) la suman a su `select`, así los tres
 * devuelven exactamente las mismas columnas. Vive en `shared` para que ningún módulo dependa del otro
 * (`ventas.repository` ya importa de `cambios-mercaderia.repository`: el cruce inverso formaría un ciclo).
 * Es un dato personal: no se imprime en logs ni se repite en mensajes de error (RNF-VENTAS-03).
 */
export const SELECCION_DATOS_ENVIO_VENTA = {
  modalidadEntrega: true,
  direccionEnvio: true,
  destinatarioEnvio: true,
} satisfies Prisma.VentaSelect;

// --- TIPO DE LOS DATOS DE ENVÍO ---

/**
 * Datos de envío de una venta, con los mismos nombres y formato que `GET /api/ventas/:idVenta`.
 * `direccionEnvio` y `destinatarioEnvio` son `null` cuando la venta es RETIRO, cuando el dato no se cargó y en las ventas
 * anteriores a que se registraran. Se deriva del `select` de arriba para que el tipo y la consulta no puedan divergir.
 */
export type DatosEnvioVenta = Prisma.VentaGetPayload<{ select: typeof SELECCION_DATOS_ENVIO_VENTA }>;
