import { z } from "zod";
import { iniciarSesionSchema } from "../modules/auth/auth.schemas.js";
import {
  CANTIDAD_POR_PAGINA_MAXIMA,
  CANTIDAD_POR_PAGINA_PREDETERMINADA,
  consultarHistorialSchema,
  ID_PRODUCTO_MAXIMO,
  PAGINA_MAXIMA,
  registrarVentaSchema,
} from "../modules/ventas/ventas.schemas.js";

// --- ESQUEMAS REUTILIZABLES ---

/** Error de negocio (400/404/409): lo devuelve el controller al capturar un `ErrorNegocio`. */
const errorNegocio = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: false },
    mensaje: { type: "string", example: "No hay una caja abierta" },
  },
};

/**
 * Error de autenticación o autorización (401/403): lo devuelve el login o el middleware `requerirRol`.
 * Cada respuesta lleva su propio mensaje de ejemplo, el mismo que produce `auth.errors.ts`.
 * @param mensajeEjemplo Mensaje real de esa respuesta.
 */
function crearEsquemaErrorAutenticacion(mensajeEjemplo: string) {
  return {
    type: "object",
    properties: {
      exito: { type: "boolean", example: false },
      mensaje: { type: "string", example: mensajeEjemplo },
    },
  };
}

/** Respuesta exitosa de `POST /api/auth/login` (ver `IniciarSesionResponse`). Nunca incluye el hash. */
const sesionIniciada = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: true },
    mensaje: { type: "string", example: "Sesión iniciada" },
    token: { type: "string", description: "JWT: se envía como `Authorization: Bearer <token>`" },
    tipoToken: { type: "string", enum: ["Bearer"] },
    vigenciaSegundos: { type: "integer", example: 28800, description: "Vigencia del token (8 h)" },
    usuario: {
      type: "object",
      properties: {
        idUsuario: { type: "integer", example: 1 },
        username: { type: "string", example: "demo.vendedor" },
        nombre: { type: "string", example: "Vendedor Demo" },
        rol: { type: "string", enum: ["VENDEDOR", "GESTOR_COMERCIAL", "GERENTE"], example: "VENDEDOR" },
      },
      required: ["idUsuario", "username", "nombre", "rol"],
    },
  },
  required: ["exito", "mensaje", "token", "tipoToken", "vigenciaSegundos", "usuario"],
};

/** Respuestas 401 y 403 que agrega `requerirRol` a todo endpoint protegido. */
const respuestasProteccion = {
  "401": {
    description: "Token ausente, inválido o vencido",
    content: { "application/json": { schema: crearEsquemaErrorAutenticacion("Token de sesión vencido") } },
  },
  "403": {
    description: "El rol del usuario no está permitido en esta ruta",
    content: {
      "application/json": { schema: crearEsquemaErrorAutenticacion("No tiene permiso para realizar esta acción") },
    },
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

/** Error de validación (400) del login: mismo formato, con el mensaje y los campos propios de `auth.controller.ts`. */
const errorValidacionInicioSesion = {
  ...errorValidacion,
  properties: {
    ...errorValidacion.properties,
    mensaje: { type: "string", example: "Datos de inicio de sesión inválidos" },
    errores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          campo: { type: "string", example: "username" },
          mensaje: { type: "string" },
        },
      },
    },
  },
};

/** Respuesta exitosa de `POST /api/ventas` (ver `RegistrarVentaResponse`). */
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
          example: "CMP-00000001",
          description:
            "Siempre presente. Toda venta emite comprobante al instante: ticket de pago si el estado es " +
            "COMPLETADA, ticket de deuda si es PENDIENTE_PAGO (el frontend lo deduce de `estado`)",
        },
        montoTotal: { type: "string", example: "1500.00" },
        estado: { type: "string", enum: ["COMPLETADA", "PENDIENTE_PAGO"] },
        fechaHora: { type: "string", format: "date-time" },
      },
      // numeroComprobante nunca es nulo: se emite siempre, incluso en un fiado
      required: ["idVenta", "numeroComprobante", "montoTotal", "estado", "fechaHora"],
    },
  },
};

/** Error de validación (400) de la consulta del historial: mismo formato, con el mensaje propio de la query. */
const errorValidacionConsulta = {
  ...errorValidacion,
  properties: {
    ...errorValidacion.properties,
    mensaje: { type: "string", example: "Parámetros de consulta inválidos" },
    errores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          campo: { type: "string", example: "pagina" },
          mensaje: { type: "string" },
        },
      },
    },
  },
};

/** Respuesta exitosa de `GET /api/ventas` (ver `ConsultarHistorialResponse`). */
const historialConsultado = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: true },
    ventas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          idVenta: { type: "integer", example: 10 },
          numeroComprobante: {
            type: "string",
            nullable: true,
            example: "CMP-00000010",
            description: "Nulo solo en datos anteriores al backfill",
          },
          fechaHora: { type: "string", format: "date-time" },
          estado: { type: "string", enum: ["COMPLETADA", "PENDIENTE_PAGO", "ANULADA"] },
          montoTotal: { type: "string", example: "1425.00" },
          clienteReferencia: { type: "string", nullable: true, example: "Maria Lopez" },
          origen: { type: "string", enum: ["MOSTRADOR", "DIGITAL"] },
          modalidadEntrega: { type: "string", enum: ["RETIRO", "ENVIO"] },
        },
        required: ["idVenta", "numeroComprobante", "fechaHora", "estado", "montoTotal", "clienteReferencia", "origen", "modalidadEntrega"],
      },
    },
    paginacion: {
      type: "object",
      properties: {
        pagina: { type: "integer", example: 1 },
        cantidadPorPagina: { type: "integer", example: 20 },
        totalRegistros: { type: "integer", example: 10 },
        totalPaginas: { type: "integer", example: 1 },
      },
      required: ["pagina", "cantidadPorPagina", "totalRegistros", "totalPaginas"],
    },
  },
  required: ["exito", "ventas", "paginacion"],
};

// --- PARÁMETROS DEL HISTORIAL ---

/**
 * Descripción de cada parámetro de la consulta. El esquema derivado de Zod solo aporta el patrón del texto:
 * los rangos y valores por defecto se escriben aquí, tomándolos de las mismas constantes del esquema.
 */
const descripcionesParametrosHistorial: Record<string, string> = {
  pagina: `Número de página, entero entre 1 y ${PAGINA_MAXIMA}. Por defecto 1.`,
  cantidadPorPagina: `Filas por página, entero entre 1 y ${CANTIDAD_POR_PAGINA_MAXIMA}. Por defecto ${CANTIDAD_POR_PAGINA_PREDETERMINADA}.`,
  fechaDesde:
    "Día inicial inclusivo (AAAA-MM-DD), interpretado en hora de Argentina (UTC-3): desde las 00:00 de ese día.",
  fechaHasta:
    "Día final inclusivo (AAAA-MM-DD), interpretado en hora de Argentina (UTC-3): hasta las 23:59:59 de ese día. No puede ser anterior a fechaDesde.",
  idProducto: `Entero positivo (máximo ${ID_PRODUCTO_MAXIMO}). Solo ventas que contienen este producto en sus detalles.`,
  estado: "Solo ventas en este estado. Sin este filtro se devuelven todas, incluidas las anuladas.",
};

// Los parámetros se derivan del esquema Zod real (io "input" = lo que envía el cliente), así no se desactualizan
const esquemaConsultaHistorial = z.toJSONSchema(consultarHistorialSchema, { io: "input", target: "draft-7" });
const parametrosHistorial = Object.entries(esquemaConsultaHistorial.properties ?? {}).map(([nombre, esquema]) => ({
  name: nombre,
  in: "query",
  required: false,
  description: descripcionesParametrosHistorial[nombre],
  schema: esquema,
}));

// --- DOCUMENTO OPENAPI ---

/**
 * Especificación OpenAPI 3.0 de la API, servida por Swagger UI en `/docs`.
 * El body de `POST /api/ventas` y los parámetros de `GET /api/ventas` se derivan de los esquemas Zod reales,
 * así el contrato no se desactualiza.
 * Al agregar un endpoint nuevo hay que sumar su entrada en `paths`.
 */
export const openapiDocument = {
  openapi: "3.0.3",
  info: {
    title: "PetFlow API",
    version: "1.0.0",
    description: "API del Sistema de Gestión ERP de Mundo Mascotas.",
  },
  tags: [
    { name: "Seguridad", description: "Inicio de sesión y control de acceso" },
    { name: "Ventas", description: "Alta y gestión de ventas" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Token obtenido en `POST /api/auth/login` (vigencia de 8 horas)",
      },
    },
  },
  paths: {
    "/api/auth/login": {
      post: {
        tags: ["Seguridad"],
        summary: "Iniciar sesión",
        description:
          "Valida `username` y `clave` y devuelve un JWT con vigencia de 8 horas, sin refresh token. " +
          "Usuario inexistente, clave errónea y usuario inactivo responden igual (401 genérico). " +
          "Cerrar sesión no tiene endpoint: el frontend descarta el token.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              // `io: "input"` describe lo que el cliente envía, no el resultado ya transformado
              schema: z.toJSONSchema(iniciarSesionSchema, { io: "input", target: "draft-7" }),
            },
          },
        },
        responses: {
          "200": {
            description: "Sesión iniciada",
            content: { "application/json": { schema: sesionIniciada } },
          },
          "400": {
            description: "Body inválido (campo faltante, vacío o `username` de más de 50 caracteres)",
            content: { "application/json": { schema: errorValidacionInicioSesion } },
          },
          "401": {
            description: "Credenciales inválidas",
            content: { "application/json": { schema: crearEsquemaErrorAutenticacion("Credenciales inválidas") } },
          },
        },
      },
    },
    "/api/ventas": {
      get: {
        tags: ["Ventas"],
        security: [{ bearerAuth: [] }],
        summary: "Consultar el historial de ventas (paginado, con filtros)",
        description:
          "Alimenta la grilla del historial. Orden fijo: fecha descendente con desempate por id descendente. " +
          "Los filtros son opcionales y se combinan con AND. Una página fuera de rango devuelve 200 con lista vacía. " +
          "No incluye detalles ni pagos de cada venta. Requiere sesión (roles VENDEDOR, GESTOR_COMERCIAL o GERENTE); no exige caja abierta.",
        parameters: parametrosHistorial,
        responses: {
          "200": {
            description: "Página del historial con sus metadatos de paginación",
            content: { "application/json": { schema: historialConsultado } },
          },
          "400": {
            description: "Parámetros de consulta inválidos (formato, rango, fecha inexistente o rango de fechas invertido)",
            content: { "application/json": { schema: errorValidacionConsulta } },
          },
          ...respuestasProteccion,
        },
      },
      post: {
        tags: ["Ventas"],
        security: [{ bearerAuth: [] }],
        summary: "Registrar una venta (cobrada o fiado)",
        description:
          "Con `pagos` vacío la venta queda `PENDIENTE_PAGO` (fiado) y exige `clienteReferencia`. " +
          "Descuenta stock y congela precio y costo de cada ítem. Los cobros se asocian a la última caja abierta. " +
          "Toda venta, cobrada o fiado, devuelve su `numeroComprobante` (ticket de pago o ticket de deuda).",
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
          ...respuestasProteccion,
        },
      },
    },
  },
};
