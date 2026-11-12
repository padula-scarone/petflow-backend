import { z } from "zod";
import { iniciarSesionSchema } from "../modules/auth/auth.schemas.js";
import { consultarProductosSchema, BUSQUEDA_LONGITUD_MAXIMA } from "../modules/inventario/inventario.schemas.js";
import {
  CANTIDAD_POR_PAGINA_MAXIMA,
  anularVentaCuerpoSchema,
  CANTIDAD_POR_PAGINA_PREDETERMINADA,
  consultarHistorialSchema,
  consultarVentaSchema,
  ID_PRODUCTO_MAXIMO,
  ID_VENTA_MAXIMO,
  liquidarFiadoSchema,
  MONTO_RECIBIDO_MAXIMO,
  PAGINA_MAXIMA,
  registrarVentaSchema,
} from "../modules/ventas/ventas.schemas.js";

// --- ESQUEMAS REUTILIZABLES ---

/** Error de negocio (400/403/404/409): lo devuelve el controller al capturar un `ErrorNegocio`. */
const errorNegocio = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: false },
    mensaje: { type: "string", example: "No hay una caja abierta" },
  },
};

/** Respuesta de `GET /api/salud` (ver `getSalud` en `salud.ts`). */
const estadoSalud = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: true },
    estado: { type: "string", example: "ok" },
  },
  required: ["exito", "estado"],
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
        pagos: {
          type: "array",
          description: "Arreglo vacío en un fiado. Permite mostrar el vuelto sin consultar de nuevo la venta",
          items: {
            type: "object",
            properties: {
              idMedioPago: { type: "integer", example: 1 },
              montoFinal: { type: "string", example: "1650.00" },
              montoRecibido: {
                type: "string",
                nullable: true,
                example: "2000.00",
                description: "Nulo si el medio no es efectivo o no se informó el monto recibido",
              },
              vuelto: {
                type: "string",
                nullable: true,
                example: "350.00",
                description: "Monto recibido menos monto final; nulo siempre que montoRecibido sea nulo",
              },
            },
            required: ["idMedioPago", "montoFinal", "montoRecibido", "vuelto"],
          },
        },
      },
      // numeroComprobante nunca es nulo: se emite siempre, incluso en un fiado
      required: ["idVenta", "numeroComprobante", "montoTotal", "estado", "fechaHora", "pagos"],
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

/** Error de validación (400) del parámetro de ruta de la consulta de una venta: mismo formato, con su mensaje propio. */
const errorValidacionConsultaVenta = {
  ...errorValidacion,
  properties: {
    ...errorValidacion.properties,
    mensaje: { type: "string", example: "Parámetros de ruta inválidos" },
    errores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          campo: { type: "string", example: "idVenta" },
          mensaje: { type: "string" },
        },
      },
    },
  },
};

/** Respuesta 404 de `GET /api/ventas/:idVenta`: la venta no existe. */
const ventaInexistente = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: false },
    mensaje: { type: "string", example: "La venta 999 no existe" },
  },
};

/** Respuesta exitosa de `GET /api/ventas/:idVenta` (ver `ConsultarVentaResponse`). Sin costo congelado. */
const ventaConsultada = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: true },
    venta: {
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
        fechaHoraPago: {
          type: "string",
          format: "date-time",
          nullable: true,
          description: "Nulo si es fiado (PENDIENTE_PAGO)",
        },
        estado: {
          type: "string",
          enum: ["COMPLETADA", "PENDIENTE_PAGO", "ANULADA"],
          description:
            "COMPLETADA = ticket de pago (pagos y fechaHoraPago con valor). PENDIENTE_PAGO = ticket de deuda " +
            "(pagos vacío y fechaHoraPago nulo). ANULADA se devuelve tal como quedó guardada",
        },
        origen: { type: "string", enum: ["MOSTRADOR", "DIGITAL"] },
        modalidadEntrega: { type: "string", enum: ["RETIRO", "ENVIO"] },
        clienteReferencia: { type: "string", nullable: true, example: "Maria Lopez" },
        vendedor: {
          type: "object",
          properties: {
            idUsuario: { type: "integer", example: 1 },
            nombre: { type: "string", example: "Vendedor Demo" },
          },
          required: ["idUsuario", "nombre"],
        },
        subtotalBruto: { type: "string", example: "1500.00" },
        descuentoManual: { type: "string", example: "0.00" },
        motivoDescuento: {
          type: "string",
          nullable: true,
          example: "Cliente frecuente",
          description: "Nulo si la venta no tuvo descuento o es anterior a que se registrara el motivo",
        },
        montoTotal: { type: "string", example: "1425.00" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              idProducto: { type: "integer", example: 3 },
              nombreProducto: { type: "string", example: "Alimento balanceado 15 kg" },
              formatoVenta: { type: "string", enum: ["UNIDAD", "GRANEL"] },
              cantidad: { type: "string", example: "2.500", description: "Texto con 3 decimales" },
              precioUnitario: { type: "string", example: "600.00", description: "Precio congelado al registrar la venta" },
              subtotal: { type: "string", example: "1500.00" },
            },
            required: ["idProducto", "nombreProducto", "formatoVenta", "cantidad", "precioUnitario", "subtotal"],
          },
        },
        pagos: {
          type: "array",
          description: "Arreglo vacío en un fiado (PENDIENTE_PAGO)",
          items: {
            type: "object",
            properties: {
              idMedioPago: { type: "integer", example: 2 },
              nombreMedioPago: { type: "string", example: "Transferencia" },
              montoBase: { type: "string", example: "1500.00" },
              porcentajeAplicado: {
                type: "string",
                example: "-5.00",
                description: "Ajuste neto (recargo − descuento) congelado al registrar; negativo si el medio da descuento",
              },
              montoFinal: { type: "string", example: "1425.00" },
              montoRecibido: {
                type: "string",
                nullable: true,
                example: "2000.00",
                description: "Nulo en ventas anteriores, si el medio no es efectivo o si no se informó el monto recibido",
              },
              vuelto: {
                type: "string",
                nullable: true,
                example: "575.00",
                description: "Monto recibido menos monto final; nulo siempre que montoRecibido sea nulo",
              },
            },
            required: ["idMedioPago", "nombreMedioPago", "montoBase", "porcentajeAplicado", "montoFinal", "montoRecibido", "vuelto"],
          },
        },
        anulacion: {
          type: "object",
          nullable: true,
          description:
            "Auditoría de la anulación: quién, cuándo y por qué. Nulo si la venta no está ANULADA o si se anuló " +
            "antes de que se registrara la auditoría",
          properties: {
            fechaHora: { type: "string", format: "date-time", example: "2026-11-12T20:35:10.000Z" },
            motivo: { type: "string", example: "El cliente cambió de producto" },
            usuario: {
              type: "object",
              description: "Quien anuló: puede ser distinto del vendedor original",
              properties: {
                idUsuario: { type: "integer", example: 2 },
                nombre: { type: "string", example: "Gestor Comercial Demo" },
              },
              required: ["idUsuario", "nombre"],
            },
          },
          required: ["fechaHora", "motivo", "usuario"],
        },
      },
      required: [
        "idVenta",
        "numeroComprobante",
        "fechaHora",
        "fechaHoraPago",
        "estado",
        "origen",
        "modalidadEntrega",
        "clienteReferencia",
        "vendedor",
        "subtotalBruto",
        "descuentoManual",
        "motivoDescuento",
        "montoTotal",
        "items",
        "pagos",
        "anulacion",
      ],
    },
  },
  required: ["exito", "venta"],
};

// --- COBRO DE FIADO ---

/** Error de validación (400) del cobro de un fiado: mismo formato, con el mensaje y los campos propios del body. */
const errorValidacionCobroFiado = {
  ...errorValidacion,
  properties: {
    ...errorValidacion.properties,
    mensaje: { type: "string", example: "Datos de cobro inválidos" },
    errores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          campo: { type: "string", example: "pagos.0.montoRecibido" },
          mensaje: { type: "string" },
        },
      },
    },
  },
};

/** Respuesta exitosa de `POST /api/ventas/:idVenta/cobro` (ver `LiquidarFiadoResponse`). */
const fiadoCobrado = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: true },
    mensaje: { type: "string", example: "Fiado cobrado, venta completada y recibo de pago emitido" },
    venta: {
      type: "object",
      properties: {
        idVenta: { type: "integer", example: 10 },
        numeroComprobante: {
          type: "string",
          nullable: true,
          example: "CMP-00000010",
          description: "El mismo del ticket de deuda: el comprobante pasa a ser un recibo de pago. Nulo solo en datos anteriores al backfill",
        },
        estado: { type: "string", enum: ["COMPLETADA"] },
        montoTotal: {
          type: "string",
          example: "1650.00",
          description: "Suma de los montos finales, con los recargos o descuentos de hoy; puede diferir del importe del fiado",
        },
        fechaHoraPago: { type: "string", format: "date-time" },
        pagos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              idMedioPago: { type: "integer", example: 1 },
              montoFinal: { type: "string", example: "1650.00" },
              montoRecibido: {
                type: "string",
                nullable: true,
                example: "2000.00",
                description: "Nulo si el medio no es efectivo o no se informó el monto recibido",
              },
              vuelto: {
                type: "string",
                nullable: true,
                example: "350.00",
                description: "Monto recibido menos monto final; nulo siempre que montoRecibido sea nulo",
              },
            },
            required: ["idMedioPago", "montoFinal", "montoRecibido", "vuelto"],
          },
        },
      },
      required: ["idVenta", "numeroComprobante", "estado", "montoTotal", "fechaHoraPago", "pagos"],
    },
  },
  required: ["exito", "mensaje", "venta"],
};

// --- ANULACIÓN DE VENTA ---

/** Error de validación (400) de la anulación: mismo formato, con el mensaje y los campos propios del body (`motivo`). */
const errorValidacionAnulacionVenta = {
  ...errorValidacion,
  properties: {
    ...errorValidacion.properties,
    mensaje: { type: "string", example: "Datos de anulación inválidos" },
    errores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          campo: { type: "string", example: "motivo" },
          mensaje: { type: "string", example: "El motivo de la anulación es obligatorio y debe ser texto" },
        },
      },
    },
  },
};

/** Respuesta exitosa de `POST /api/ventas/:idVenta/anulacion` (ver `AnularVentaResponse`). */
const ventaAnulada = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: true },
    mensaje: { type: "string", example: "Venta anulada, cobro revertido y stock repuesto" },
    venta: {
      type: "object",
      properties: {
        idVenta: { type: "integer", example: 42 },
        numeroComprobante: { type: "string", nullable: true, example: "CMP-00000042" },
        estado: { type: "string", enum: ["ANULADA"], example: "ANULADA" },
        estadoAnterior: {
          type: "string",
          enum: ["COMPLETADA", "PENDIENTE_PAGO"],
          example: "COMPLETADA",
          description: "Estado que tenía antes de anularse: COMPLETADA (cobro revertido) o PENDIENTE_PAGO (solo stock)",
        },
        anulacion: {
          type: "object",
          description: "Auditoría de la anulación recién hecha. El usuario que anuló lo trae `GET /api/ventas/{idVenta}`",
          properties: {
            fechaHora: { type: "string", format: "date-time", example: "2026-11-12T20:35:10.000Z" },
            motivo: { type: "string", example: "El cliente cambió de producto" },
          },
          required: ["fechaHora", "motivo"],
        },
      },
      required: ["idVenta", "numeroComprobante", "estado", "estadoAnterior", "anulacion"],
    },
  },
  required: ["exito", "mensaje", "venta"],
};

// --- PARÁMETRO DE RUTA DE LA CONSULTA DE UNA VENTA ---

// El parámetro se deriva del esquema Zod real, igual que los del historial, para que no se desactualice
const esquemaConsultaVenta = z.toJSONSchema(consultarVentaSchema, { io: "input", target: "draft-7" });
const parametroIdVenta = {
  name: "idVenta",
  in: "path",
  required: true,
  description: `Id de la venta: entero positivo (máximo ${ID_VENTA_MAXIMO}), por ejemplo el que devuelve el historial.`,
  schema: (esquemaConsultaVenta.properties ?? {}).idVenta,
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

// --- CATÁLOGO DE PRODUCTOS Y MEDIOS DE PAGO ---

// El parámetro se deriva del esquema Zod real, igual que los del historial, para que no se desactualice
const esquemaConsultaProductos = z.toJSONSchema(consultarProductosSchema, { io: "input", target: "draft-7" });
const parametroBusqueda = {
  name: "busqueda",
  in: "query",
  required: false,
  description:
    `Texto a buscar dentro del nombre, sin distinguir mayúsculas ni normalizar acentos; máximo ${BUSQUEDA_LONGITUD_MAXIMA} caracteres. ` +
    "Los caracteres `%` y `_` actúan como comodines. Vacío o ausente devuelve todos los productos activos.",
  schema: (esquemaConsultaProductos.properties ?? {}).busqueda,
};

/** Error de validación (400) de la búsqueda de productos: mismo formato, con el mensaje propio de la query. */
const errorValidacionBusquedaProductos = {
  ...errorValidacionConsulta,
  properties: {
    ...errorValidacionConsulta.properties,
    errores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          campo: { type: "string", example: "busqueda" },
          mensaje: { type: "string" },
        },
      },
    },
  },
};

/** Respuesta exitosa de `GET /api/productos` (ver `ConsultarProductosResponse`). */
const productosConsultados = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: true },
    productos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          idProducto: { type: "integer", example: 1 },
          nombre: { type: "string", example: "Alimento balanceado perro adulto 15 kg" },
          precioVenta: { type: "string", example: "45000.00", description: "Texto con 2 decimales" },
          stockFisico: { type: "string", example: "12.000", description: "Texto con 3 decimales" },
          formatoVenta: { type: "string", enum: ["UNIDAD", "GRANEL"], example: "UNIDAD" },
        },
        required: ["idProducto", "nombre", "precioVenta", "stockFisico", "formatoVenta"],
      },
    },
  },
  required: ["exito", "productos"],
};

/** Respuesta exitosa de `GET /api/medios-pago` (ver `ListarMediosPagoResponse`). */
const mediosPagoListados = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: true },
    mediosPago: {
      type: "array",
      items: {
        type: "object",
        properties: {
          idMedioPago: { type: "integer", example: 1 },
          nombre: { type: "string", example: "Efectivo" },
          tipo: { type: "string", enum: ["EFECTIVO", "TRANSFERENCIA", "TARJETA", "BILLETERA_VIRTUAL"], example: "EFECTIVO" },
          porcentajeRecargo: { type: "string", example: "0.00", description: "Texto con 2 decimales" },
          porcentajeDescuento: { type: "string", example: "5.00", description: "Texto con 2 decimales" },
        },
        required: ["idMedioPago", "nombre", "tipo", "porcentajeRecargo", "porcentajeDescuento"],
      },
    },
  },
  required: ["exito", "mediosPago"],
};

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
    { name: "Inventario", description: "Catálogo de productos" },
    { name: "Caja", description: "Medios de pago" },
    { name: "Sistema", description: "Estado del servicio" },
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
    "/api/salud": {
      get: {
        tags: ["Sistema"],
        summary: "Comprobar que el servicio está activo",
        description:
          "Chequeo de salud para la plataforma de deploy. Público: no requiere token. " +
          "No consulta la base de datos, así que responde 200 aunque la base no esté disponible.",
        responses: {
          "200": {
            description: "El servicio está activo",
            content: { "application/json": { schema: estadoSalud } },
          },
        },
      },
    },
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
    "/api/productos": {
      get: {
        tags: ["Inventario"],
        security: [{ bearerAuth: [] }],
        summary: "Buscar productos activos para el carrito",
        description:
          "Devuelve solo productos con estado ACTIVO, sin filtrar por stock (el alta de venta valida el stock). " +
          "Sin paginación. Orden: nombre ascendente y id ascendente como desempate. Sin coincidencias devuelve 200 con lista vacía. " +
          "No expone costo, categoría ni código de barras. Requiere sesión (roles VENDEDOR, GESTOR_COMERCIAL o GERENTE); no exige caja abierta.",
        parameters: [parametroBusqueda],
        responses: {
          "200": {
            description: "Productos activos que coinciden con la búsqueda",
            content: { "application/json": { schema: productosConsultados } },
          },
          "400": {
            description: "`busqueda` de más de 100 caracteres o repetida",
            content: { "application/json": { schema: errorValidacionBusquedaProductos } },
          },
          ...respuestasProteccion,
        },
      },
    },
    "/api/medios-pago": {
      get: {
        tags: ["Caja"],
        security: [{ bearerAuth: [] }],
        summary: "Listar los medios de pago activos",
        description:
          "Devuelve solo medios con estado ACTIVO, ordenados por id ascendente, con su recargo y descuento porcentuales. " +
          "\"Fiado\" no es un medio de pago: es una venta sin pagos. Sin parámetros. " +
          "Requiere sesión (roles VENDEDOR, GESTOR_COMERCIAL o GERENTE); no exige caja abierta.",
        responses: {
          "200": {
            description: "Medios de pago activos",
            content: { "application/json": { schema: mediosPagoListados } },
          },
          ...respuestasProteccion,
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
          "Toda venta, cobrada o fiado, devuelve su `numeroComprobante` (ticket de pago o ticket de deuda). " +
          "El vendedor es el usuario del token: un `idUsuario` en el body se ignora sin error. " +
          "`motivoDescuento` (1 a 200 caracteres) es obligatorio si `descuentoManual` es mayor que 0 y no se admite sin descuento; aplica a venta inmediata y a fiado. " +
          "`pagos[].montoRecibido` es opcional y solo se admite en un medio EFECTIVO, mayor o igual al monto final de esa línea; " +
          "el servidor calcula el vuelto (solo registro: la caja suma siempre el monto final). Sin `montoRecibido`, recibido y vuelto quedan nulos. " +
          `El monto recibido admite hasta ${MONTO_RECIBIDO_MAXIMO} y 2 decimales. La respuesta incluye \`pagos\` con recibido y vuelto (vacío en un fiado).`,
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
            description:
              "Body inválido o regla de negocio incumplida (stock, montos, producto inactivo, descuento sin motivo o motivo sin descuento, " +
              "`montoRecibido` menor al monto final o en un medio que no es efectivo)",
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
    "/api/ventas/{idVenta}": {
      get: {
        tags: ["Ventas"],
        security: [{ bearerAuth: [] }],
        summary: "Consultar una venta (detalle del comprobante)",
        description:
          "Detalle de una venta con sus ítems y pagos, en cualquier estado (incluida ANULADA). " +
          "Los importes salen tal como se guardaron: precio unitario y porcentaje aplicado de ese momento. " +
          "El tipo de comprobante se deduce de `estado`. No devuelve el costo congelado. " +
          "Devuelve `motivoDescuento` (nivel venta) y, en cada pago, `montoRecibido` y `vuelto`; son nulos en ventas anteriores o cuando no aplican. " +
          "Devuelve `anulacion` (fecha, motivo y usuario que anuló), nula si la venta no está ANULADA o se anuló antes de que se registrara la auditoría. " +
          "Solo lectura: no modifica stock, caja ni estado. Cualquier rol autorizado ve cualquier venta " +
          "(VENDEDOR, GESTOR_COMERCIAL o GERENTE); no exige caja abierta.",
        parameters: [parametroIdVenta],
        responses: {
          "200": {
            description: "Detalle de la venta",
            content: { "application/json": { schema: ventaConsultada } },
          },
          "400": {
            description: "`idVenta` inválido (no es un entero positivo)",
            content: { "application/json": { schema: errorValidacionConsultaVenta } },
          },
          "404": {
            description: "La venta no existe",
            content: { "application/json": { schema: ventaInexistente } },
          },
          ...respuestasProteccion,
        },
      },
    },
    "/api/ventas/{idVenta}/cobro": {
      post: {
        tags: ["Ventas"],
        security: [{ bearerAuth: [] }],
        summary: "Liquidar un fiado (cobro)",
        description:
          "Cobra por completo una venta en estado `PENDIENTE_PAGO`, sin límite de tiempo. El front no envía el total ni el vuelto: " +
          "el servidor calcula el importe adeudado (subtotal bruto menos descuento manual) y aplica a cada porción base " +
          "el recargo o descuento VIGENTE HOY de su medio. Las porciones base de `pagos` deben sumar exactamente ese importe. " +
          "`montoRecibido` es opcional y solo se admite en un medio EFECTIVO: debe ser mayor o igual al monto final de esa línea " +
          "y el servidor calcula el vuelto. El ingreso a caja es siempre el monto final, nunca el recibido, y se asienta en la " +
          "última caja abierta (la del día en curso, no la del día del fiado). La venta pasa a `COMPLETADA`, registra la fecha de " +
          "pago, su `montoTotal` pasa a ser la suma de los montos finales y conserva el mismo `numeroComprobante`. " +
          "Un fiado no puede cobrarse dos veces: ante cobros simultáneos, uno responde 409. " +
          `El monto recibido admite hasta ${MONTO_RECIBIDO_MAXIMO} y 2 decimales.`,
        parameters: [parametroIdVenta],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              // `io: "input"` describe lo que el cliente envía, no el resultado ya transformado
              schema: z.toJSONSchema(liquidarFiadoSchema, { io: "input", target: "draft-7" }),
            },
          },
        },
        responses: {
          "200": {
            description: "Fiado cobrado: la venta queda COMPLETADA",
            content: { "application/json": { schema: fiadoCobrado } },
          },
          "400": {
            description:
              "`idVenta` o body inválido, o regla de negocio incumplida (suma de pagos que no cuadra, " +
              "`montoRecibido` menor al monto final o en un medio que no es efectivo, medio de pago inactivo)",
            content: {
              "application/json": {
                schema: { oneOf: [errorValidacionConsultaVenta, errorValidacionCobroFiado, errorNegocio] },
              },
            },
          },
          "404": {
            description: "La venta o un medio de pago no existe",
            content: { "application/json": { schema: ventaInexistente } },
          },
          "409": {
            description: "La venta no está PENDIENTE_PAGO, no hay una caja abierta, o se detectó un doble cobro",
            content: { "application/json": { schema: errorNegocio } },
          },
          ...respuestasProteccion,
        },
      },
    },
    "/api/ventas/{idVenta}/anulacion": {
      post: {
        tags: ["Ventas"],
        security: [{ bearerAuth: [] }],
        summary: "Anular una venta (baja y modificación)",
        description:
          "Anula una venta `COMPLETADA` o `PENDIENTE_PAGO` dentro de una ventana de 15 minutos, contada desde `fechaHoraPago` " +
          "si existe (un fiado cobrado vuelve a tener 15 minutos desde el cobro) y si no desde `fechaHora`; el reloj es el del servidor. " +
          "Es una baja lógica: la venta pasa a `ANULADA` y no se borra ni se edita ningún pago. Repone el stock de cada ítem " +
          "(la misma cantidad vendida al mismo producto) en la misma transacción. Una venta con cobro (`COMPLETADA`) exige alguna caja " +
          "abierta (409 si no hay); un fiado pendiente solo repone stock. La caja se revierte por el solo cambio de estado: " +
          "las ventas `ANULADA` no cuentan como ingreso. " +
          "El body exige `motivo` (texto de 1 a 200 caracteres, recortado): vale tanto para la baja como para la edición. " +
          "La anulación deja auditoría en la misma operación que cambia el estado: quién (el usuario del token, no el vendedor original), " +
          "cuándo (reloj del servidor) y por qué; un `idUsuario` en el body se ignora. La respuesta trae `anulacion` con la fecha y el motivo, " +
          "y `GET /api/ventas/{idVenta}` la devuelve completa, con el usuario (nula en una venta no anulada o anulada antes de que se registrara). " +
          "Una venta `ANULADA` no se puede anular de nuevo (la auditoría original no se modifica) ni cobrar (409). " +
          "Ante pedidos simultáneos sobre la misma venta (dos anulaciones, o un cobro y una anulación) solo uno gana y el otro responde 409. " +
          "Orden de evaluación: 400, 404, 409 (ya anulada), 403 (ventana vencida), 409 (sin caja abierta). " +
          "**Edición ágil (modificar una venta):** no hay un endpoint aparte. El front anula con este endpoint, consulta el detalle " +
          "con `GET /api/ventas/{idVenta}` (que sigue funcionando sobre una venta `ANULADA` y trae ítems, descuento, motivo, origen, " +
          "modalidad, cliente y pagos) y vuelve a registrar la venta con `POST /api/ventas`. Son tres llamadas independientes: " +
          "si la última falla, la venta original queda anulada. Al volver a vender se aplican los precios y recargos vigentes ese día, " +
          "así que el total puede diferir del original.",
        parameters: [parametroIdVenta],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              // `io: "input"` describe lo que el cliente envía, no el resultado ya transformado
              schema: z.toJSONSchema(anularVentaCuerpoSchema, { io: "input", target: "draft-7" }),
            },
          },
        },
        responses: {
          "200": {
            description: "Venta anulada, stock repuesto y auditoría registrada",
            content: { "application/json": { schema: ventaAnulada } },
          },
          "400": {
            description:
              "`idVenta` inválido, o `motivo` ausente, vacío, solo espacios, que no es texto o de más de 200 caracteres " +
              "(se valida antes de consultar la venta)",
            content: {
              "application/json": { schema: { oneOf: [errorValidacionConsultaVenta, errorValidacionAnulacionVenta] } },
            },
          },
          "401": respuestasProteccion["401"],
          "403": {
            description:
              "Pasaron más de 15 minutos desde el pago (o desde la venta si no hay pago): " +
              "mensaje propio de negocio con el formato `{ exito: false, mensaje }`. " +
              "También responde 403, con otro mensaje, si el rol del usuario no está permitido",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    exito: { type: "boolean", example: false },
                    mensaje: {
                      type: "string",
                      example: "No se puede anular: pasaron más de 15 minutos desde la venta",
                    },
                  },
                },
              },
            },
          },
          "404": {
            description: "La venta no existe",
            content: { "application/json": { schema: ventaInexistente } },
          },
          "409": {
            description:
              "La venta ya está ANULADA, cambió de estado mientras se procesaba (otra anulación o un cobro simultáneo), " +
              "o tuvo cobro y no hay ninguna caja abierta",
            content: { "application/json": { schema: errorNegocio } },
          },
        },
      },
    },
  },
};
