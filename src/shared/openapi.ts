import { z } from "zod";
import { registrarVentaSchema } from "../modules/ventas/ventas.schemas.js";

// --- ESQUEMAS REUTILIZABLES ---

/** Error de negocio (400/404/409): lo devuelve el controller al capturar un `VentaError`. */
const errorNegocio = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: false },
    mensaje: { type: "string", example: "No hay una caja abierta" },
  },
};

/** Error de validación (400): un elemento por cada campo inválido del body. */
const errorValidacion = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: false },
    mensaje: { type: "string", example: "Datos de venta inválidos" },
    errores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          campo: { type: "string", example: "items.0.cantidad" },
          mensaje: { type: "string" },
        },
      },
    },
  },
};

/** Respuesta exitosa de `POST /ventas` (ver `RegistrarVentaResponse`). */
const ventaRegistrada = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: true },
    mensaje: { type: "string" },
    venta: {
      type: "object",
      properties: {
        idVenta: { type: "integer", example: 1 },
        numeroComprobante: {
          type: "string",
          nullable: true,
          example: "CMP-00000001",
          description: "Nulo en un fiado: el comprobante se emite recién al cobrar",
        },
        montoTotal: { type: "string", example: "1500.00" },
        estado: { type: "string", enum: ["COMPLETADA", "PENDIENTE_PAGO"] },
        fechaHora: { type: "string", format: "date-time" },
      },
    },
  },
};

// --- DOCUMENTO OPENAPI ---

/**
 * Especificación OpenAPI 3.0 de la API, servida por Swagger UI en `/docs`.
 * El body de `POST /ventas` se deriva del esquema Zod real, así el contrato no se desactualiza.
 * Al agregar un endpoint nuevo hay que sumar su entrada en `paths`.
 */
export const openapiDocument = {
  openapi: "3.0.3",
  info: {
    title: "PetFlow API",
    version: "1.0.0",
    description: "API del Sistema de Gestión ERP de Mundo Mascotas.",
  },
  tags: [{ name: "Ventas", description: "Alta y gestión de ventas" }],
  paths: {
    "/ventas": {
      post: {
        tags: ["Ventas"],
        summary: "Registrar una venta (cobrada o fiado)",
        description:
          "Con `pagos` vacío la venta queda `PENDIENTE_PAGO` (fiado) y exige `clienteReferencia`. " +
          "Descuenta stock y congela precio y costo de cada ítem. Los cobros se asocian a la última caja abierta.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              // `io: "input"` describe lo que el cliente envía, no el resultado ya transformado
              schema: z.toJSONSchema(registrarVentaSchema, { io: "input", target: "draft-7" }),
            },
          },
        },
        responses: {
          "201": {
            description: "Venta registrada",
            content: { "application/json": { schema: ventaRegistrada } },
          },
          "400": {
            description: "Body inválido o regla de negocio incumplida (stock, montos, producto inactivo)",
            content: {
              "application/json": { schema: { oneOf: [errorValidacion, errorNegocio] } },
            },
          },
          "404": {
            description: "Usuario, producto o medio de pago inexistente",
            content: { "application/json": { schema: errorNegocio } },
          },
          "409": {
            description: "No hay una caja abierta",
            content: { "application/json": { schema: errorNegocio } },
          },
        },
      },
    },
  },
};
