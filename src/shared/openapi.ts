import { z } from "zod";
import { iniciarSesionSchema } from "../modules/auth/auth.schemas.js";
import { CODIGOS_ERROR_CAMBIO } from "../modules/cambios-mercaderia/cambios-mercaderia.errors.js";
import {
  CANTIDAD_MAXIMA,
  consultarCambioSchema,
  consultarHistorialCambiosSchema,
  ID_CAMBIO_MAXIMO,
  ID_MEDIO_PAGO_MAXIMO,
  MOTIVO_CAMBIO_LONGITUD_MAXIMA,
  registrarCambioSchema,
} from "../modules/cambios-mercaderia/cambios-mercaderia.schemas.js";
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
  NUMERO_COMPROBANTE_LONGITUD_MAXIMA,
  PAGINA_MAXIMA,
  registrarVentaSchema,
  TEXTO_CLIENTE_LONGITUD_MAXIMA,
  VALOR_MEDIO_PAGO_MIXTO,
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
    fechaHoraServidor: {
      type: "string",
      format: "date-time",
      description:
        "Hora del servidor al responder (ISO 8601), tomada después de leer. El front la compara con `fechaHoraLimiteModificacion` " +
        "para saber si la ventana de edición o anulación sigue abierta",
    },
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
          fechaHoraLimiteModificacion: {
            type: "string",
            format: "date-time",
            nullable: true,
            description:
              "Hasta cuándo se puede editar o anular: 15 minutos desde el pago (o desde la venta si no hay pago, como en un fiado pendiente). " +
              "Misma regla que la anulación. Nulo si la venta está ANULADA",
          },
          montoTotal: { type: "string", example: "1425.00" },
          clienteReferencia: { type: "string", nullable: true, example: "Maria Lopez" },
          origen: { type: "string", enum: ["MOSTRADOR", "DIGITAL"] },
          modalidadEntrega: { type: "string", enum: ["RETIRO", "ENVIO"] },
          cantidadCambiosActivos: {
            type: "integer",
            example: 1,
            description: "Cambios de mercadería con estado ACTIVO vinculados a la venta; 0 si no hay",
          },
        },
        required: [
          "idVenta",
          "numeroComprobante",
          "fechaHora",
          "estado",
          "fechaHoraLimiteModificacion",
          "montoTotal",
          "clienteReferencia",
          "origen",
          "modalidadEntrega",
          "cantidadCambiosActivos",
        ],
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
  required: ["exito", "fechaHoraServidor", "ventas", "paginacion"],
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
    fechaHoraServidor: {
      type: "string",
      format: "date-time",
      description:
        "Hora del servidor al responder (ISO 8601), tomada después de leer. El front la compara con `venta.fechaHoraLimiteModificacion`",
    },
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
        fechaHoraLimiteModificacion: {
          type: "string",
          format: "date-time",
          nullable: true,
          description:
            "Hasta cuándo se puede editar o anular: 15 minutos desde `fechaHoraPago` (o desde `fechaHora` si no hay pago). " +
            "Misma regla que la anulación y que el historial. Nulo si la venta está ANULADA",
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
              cantidadYaDevuelta: {
                type: "string",
                example: "1.000",
                description:
                  "Lo ya devuelto de este producto en cambios ACTIVOS vinculados a la venta, texto con 3 decimales (\"0.000\" si nada). " +
                  "Es el total del producto: si figura en más de una línea (datos antiguos), todas llevan el mismo valor. " +
                  "Mismo criterio que el tope de cantidad del alta de cambios",
              },
            },
            required: ["idProducto", "nombreProducto", "formatoVenta", "cantidad", "precioUnitario", "subtotal", "cantidadYaDevuelta"],
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
        "fechaHoraLimiteModificacion",
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
  required: ["exito", "fechaHoraServidor", "venta"],
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

// --- CAMBIO DE MERCADERÍA ---

/** Propiedad `codigo` de los errores de cambios: legible por máquina, alineada con `CodigoErrorCambio` del front. */
const propiedadCodigoErrorCambio = {
  type: "string",
  enum: [...CODIGOS_ERROR_CAMBIO],
  example: "SALDO_NEGATIVO",
  description:
    "Caso del rechazo, para que el front no lea el texto del mensaje. Los 404 de producto o medio de pago inexistente salen como " +
    "`DATOS_INVALIDOS` (el enum del front no tiene valores propios para esos dos casos). Los errores 401 y 403 de autenticación no lo traen",
};

/** Error de negocio (400/404/409) de cambios: el de siempre más `codigo`. */
const errorNegocioCambio = {
  type: "object",
  properties: {
    ...errorNegocio.properties,
    mensaje: { type: "string", example: "El saldo a cobrar es 2000.00: se requiere un medio de pago" },
    codigo: propiedadCodigoErrorCambio,
  },
  required: ["exito", "mensaje", "codigo"],
};

/** Error de validación (400) del alta de un cambio: mismo formato, con el mensaje, los campos propios del body y `codigo`. */
const errorValidacionCambio = {
  ...errorValidacion,
  properties: {
    ...errorValidacion.properties,
    mensaje: { type: "string", example: "Datos de cambio inválidos" },
    errores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          campo: { type: "string", example: "motivoCambio" },
          mensaje: { type: "string" },
        },
      },
    },
    codigo: { type: "string", enum: ["DATOS_INVALIDOS"], example: "DATOS_INVALIDOS" },
  },
};

/** Persona del cambio: quien lo cargó (vendedor) o quien lo anuló. */
const usuarioCambio = {
  type: "object",
  properties: {
    idUsuario: { type: "integer", example: 2 },
    nombre: { type: "string", example: "María López", description: "Nombre vigente" },
  },
  required: ["idUsuario", "nombre"],
};

/**
 * Cambio completo (ver `CambioDetalle`): el contenido de `GET /api/cambios-mercaderia/{idCambio}` y la base de `cambio` en el `POST`.
 * Cantidades como texto con 3 decimales e importes como texto con 2.
 */
const propiedadesCambioDetalle = {
  idCambio: { type: "integer", example: 7 },
  fechaHora: { type: "string", format: "date-time", example: "2026-11-13T15:20:00.000Z" },
  estado: { type: "string", enum: ["ACTIVO", "ANULADO"] },
  fechaHoraLimiteModificacion: {
    type: "string",
    format: "date-time",
    nullable: true,
    description: "`fechaHora` más los minutos de la ventana de anulación (15). Nulo si el cambio está ANULADO",
  },
  motivoCambio: {
    type: "string",
    nullable: true,
    example: "El cliente cambia de marca por una alergia de la mascota",
    description: "Texto del motivo, de hasta 200 caracteres. Nulo en los cambios anteriores a que se registrara",
  },
  ventaVinculada: {
    type: "object",
    nullable: true,
    description: "Venta original. Nulo si el cambio es desvinculado",
    properties: {
      idVenta: { type: "integer", example: 42 },
      numeroComprobante: {
        type: "string",
        nullable: true,
        example: "CMP-00000042",
        description: "Nulo solo en datos anteriores al backfill del comprobante",
      },
    },
    required: ["idVenta", "numeroComprobante"],
  },
  articuloDevuelto: {
    type: "object",
    description: "Lo que entra: el artículo que devuelve el cliente",
    properties: {
      idProducto: { type: "integer", example: 1 },
      nombreProducto: { type: "string", example: "Alimento balanceado perro adulto 15 kg", description: "Nombre vigente" },
      formatoVenta: { type: "string", enum: ["UNIDAD", "GRANEL"] },
      cantidadDevuelta: { type: "string", example: "1.000", description: "Unidades devueltas (bolsas enteras con bolsa abierta). Texto con 3 decimales" },
      esBolsaAbierta: { type: "boolean", example: true },
      precioUnitario: {
        type: "string",
        example: "60000.00",
        description:
          "Precio unitario congelado al registrar el cambio (con ticket, el pagado; sin ticket, el vigente). Con bolsa abierta es el precio de la BOLSA. Texto con 2 decimales",
      },
      subtotal: {
        type: "string",
        example: "58000.00",
        description: "Crédito del devuelto. Con bolsa abierta, el de la fracción de bolsa devuelta. Texto con 2 decimales",
      },
    },
    required: ["idProducto", "nombreProducto", "formatoVenta", "cantidadDevuelta", "esBolsaAbierta", "precioUnitario", "subtotal"],
  },
  productoStockIngresado: {
    type: "object",
    description: "Producto que recibió el stock: el devuelto, o su granel si fue bolsa abierta. Siempre viene",
    properties: {
      idProducto: { type: "integer", example: 3 },
      nombreProducto: { type: "string", example: "Alimento balanceado perro adulto a granel", description: "Nombre vigente" },
      cantidadStockIngresado: {
        type: "string",
        nullable: true,
        example: "14.500",
        description: "Kilos que ingresaron al granel. Solo con `esBolsaAbierta`; nulo en caso contrario. Texto con 3 decimales",
      },
    },
    required: ["idProducto", "nombreProducto", "cantidadStockIngresado"],
  },
  articuloEntregado: {
    type: "object",
    description: "Lo que sale: el artículo que se lleva el cliente",
    properties: {
      idProducto: { type: "integer", example: 2 },
      nombreProducto: { type: "string", example: "Alimento balanceado perro adulto 20 kg", description: "Nombre vigente" },
      formatoVenta: { type: "string", enum: ["UNIDAD", "GRANEL"] },
      cantidadEntregada: { type: "string", example: "1.000", description: "Texto con 3 decimales" },
      precioUnitario: { type: "string", example: "60000.00", description: "Precio unitario congelado al registrar el cambio. Texto con 2 decimales" },
      subtotal: { type: "string", example: "60000.00", description: "Precio unitario × cantidad, redondeado a centavos. Texto con 2 decimales" },
    },
    required: ["idProducto", "nombreProducto", "formatoVenta", "cantidadEntregada", "precioUnitario", "subtotal"],
  },
  valorDevuelto: { type: "string", example: "58000.00", description: "Crédito del producto devuelto (igual al subtotal del devuelto). Texto con 2 decimales" },
  valorEntregado: { type: "string", example: "60000.00", description: "Valor de lo entregado (igual al subtotal del entregado). Texto con 2 decimales" },
  saldoResultante: { type: "string", example: "2000.00", description: "Valor entregado menos valor devuelto: nunca negativo. Texto con 2 decimales" },
  pagoSaldo: {
    type: "object",
    nullable: true,
    description: "Cómo se cobró el saldo. Nulo si el cambio no tuvo saldo",
    properties: {
      idMedioPago: { type: "integer", example: 1 },
      nombreMedioPago: { type: "string", example: "Efectivo", description: "Nombre vigente" },
      montoRecibido: {
        type: "string",
        nullable: true,
        example: "5000.00",
        description: "Solo efectivo con monto informado; nulo en otro caso y en cambios anteriores. Texto con 2 decimales",
      },
      vuelto: { type: "string", nullable: true, example: "3000.00", description: "Monto recibido menos saldo, calculado por el servidor. Texto con 2 decimales" },
    },
    required: ["idMedioPago", "nombreMedioPago", "montoRecibido", "vuelto"],
  },
  vendedor: { ...usuarioCambio, description: "Usuario que cargó el cambio (el del token)" },
  anulacion: {
    type: "object",
    nullable: true,
    description: "Auditoría de la anulación. Nulo mientras el cambio no está ANULADO o si se anuló antes de que se registrara la auditoría",
    properties: {
      fechaHora: { type: "string", format: "date-time" },
      usuario: usuarioCambio,
      motivo: { type: "string", example: "Cambio cargado dos veces" },
    },
    required: ["fechaHora", "usuario", "motivo"],
  },
};

/** Campos requeridos del cambio completo. */
const requeridosCambioDetalle = [
  "idCambio",
  "fechaHora",
  "estado",
  "fechaHoraLimiteModificacion",
  "motivoCambio",
  "ventaVinculada",
  "articuloDevuelto",
  "productoStockIngresado",
  "articuloEntregado",
  "valorDevuelto",
  "valorEntregado",
  "saldoResultante",
  "pagoSaldo",
  "vendedor",
  "anulacion",
];

/** Respuesta exitosa de `POST /api/cambios-mercaderia` (ver `RegistrarCambioResponse`). */
const cambioRegistrado = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: true },
    mensaje: { type: "string", example: "Cambio registrado, stock actualizado y saldo asentado en caja" },
    fechaHoraServidor: {
      type: "string",
      format: "date-time",
      description: "Hora del servidor al responder (ISO 8601). El front la compara con `cambio.fechaHoraLimiteModificacion`",
    },
    cambio: {
      type: "object",
      description:
        "El mismo contenido que `GET /api/cambios-mercaderia/{idCambio}` (releído dentro de la misma transacción del alta) " +
        "más los campos planos que el alta ya devolvía, que se conservan",
      properties: {
        ...propiedadesCambioDetalle,
        idVentaOriginal: { type: "integer", nullable: true, example: 42, description: "Nulo si el cambio no está vinculado a un ticket" },
        idProductoDevuelto: { type: "integer", example: 1 },
        cantidadDevuelta: { type: "string", example: "1.000", description: "Texto con 3 decimales" },
        esBolsaAbierta: { type: "boolean", example: true },
        precioUnitarioDevuelto: {
          type: "string",
          example: "60000.00",
          description: "Con ticket, el precio al que se vendió; sin ticket, el vigente. Con bolsa abierta, el de la bolsa. Texto con 2 decimales",
        },
        idProductoStockIngresado: {
          type: "integer",
          example: 3,
          description: "Producto cuyo stock recibe el ingreso: el devuelto, o su granel si es bolsa abierta",
        },
        cantidadStockIngresado: {
          type: "string",
          example: "14.500",
          description: "Unidades del producto ingresado, o kilos (el peso devuelto) si `esBolsaAbierta`. Texto con 3 decimales",
        },
        idProductoEntregado: { type: "integer", example: 2 },
        cantidadEntregada: { type: "string", example: "1.000", description: "Texto con 3 decimales" },
        precioUnitarioEntregado: { type: "string", example: "60000.00", description: "Texto con 2 decimales" },
        idMedioPago: { type: "integer", nullable: true, example: 1, description: "Nulo si el saldo es 0" },
      },
      required: [
        ...requeridosCambioDetalle,
        "idVentaOriginal",
        "idProductoDevuelto",
        "cantidadDevuelta",
        "esBolsaAbierta",
        "precioUnitarioDevuelto",
        "idProductoStockIngresado",
        "cantidadStockIngresado",
        "idProductoEntregado",
        "cantidadEntregada",
        "precioUnitarioEntregado",
        "idMedioPago",
      ],
    },
  },
  required: ["exito", "mensaje", "fechaHoraServidor", "cambio"],
};

// --- DETALLE DE UN CAMBIO ---

/** Error de validación (400) del parámetro de ruta del detalle de un cambio: mismo formato, con su mensaje y `codigo`. */
const errorValidacionConsultaCambio = {
  ...errorValidacion,
  properties: {
    ...errorValidacion.properties,
    mensaje: { type: "string", example: "Parámetros de consulta inválidos" },
    errores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          campo: { type: "string", example: "idCambio" },
          mensaje: { type: "string" },
        },
      },
    },
    codigo: { type: "string", enum: ["DATOS_INVALIDOS"], example: "DATOS_INVALIDOS" },
  },
};

/** Respuesta 404 de `GET /api/cambios-mercaderia/{idCambio}`: el cambio no existe. */
const cambioInexistente = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: false },
    mensaje: { type: "string", example: "El cambio 999 no existe" },
    codigo: { type: "string", enum: ["CAMBIO_NO_ENCONTRADO"], example: "CAMBIO_NO_ENCONTRADO" },
  },
  required: ["exito", "mensaje", "codigo"],
};

/** Respuesta exitosa de `GET /api/cambios-mercaderia/{idCambio}` (ver `ConsultarCambioResponse`). */
const cambioConsultado = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: true },
    fechaHoraServidor: {
      type: "string",
      format: "date-time",
      description:
        "Hora del servidor al responder (ISO 8601), tomada después de leer. El front la compara con `cambio.fechaHoraLimiteModificacion`",
    },
    cambio: { type: "object", properties: propiedadesCambioDetalle, required: requeridosCambioDetalle },
  },
  required: ["exito", "fechaHoraServidor", "cambio"],
};

// --- HISTORIAL DE CAMBIOS ---

/** Respuesta exitosa de `GET /api/cambios-mercaderia` (ver `ConsultarHistorialCambiosResponse`). */
const historialCambiosConsultado = {
  type: "object",
  properties: {
    exito: { type: "boolean", example: true },
    fechaHoraServidor: {
      type: "string",
      format: "date-time",
      description:
        "Hora del servidor al responder. Se compara con `fechaHoraLimiteModificacion` de cada fila para saber si la ventana de 15 minutos sigue abierta",
    },
    cambios: {
      type: "array",
      items: {
        type: "object",
        properties: {
          idCambio: { type: "integer", example: 7 },
          fechaHora: { type: "string", format: "date-time" },
          estado: { type: "string", enum: ["ACTIVO", "ANULADO"] },
          fechaHoraLimiteModificacion: {
            type: "string",
            format: "date-time",
            nullable: true,
            description: "`fechaHora` más los minutos de la ventana de anulación. Nulo si el cambio está ANULADO",
          },
          idVentaOriginal: { type: "integer", nullable: true, example: 42, description: "Nulo si el cambio no está vinculado a un ticket" },
          numeroComprobanteVentaOriginal: {
            type: "string",
            nullable: true,
            example: "CMP-00000042",
            description: "Nulo sin venta original o si la venta es anterior al backfill del comprobante",
          },
          idProductoDevuelto: { type: "integer", example: 1 },
          nombreProductoDevuelto: { type: "string", example: "Alimento balanceado perro adulto 15 kg", description: "Nombre vigente" },
          formatoVentaProductoDevuelto: { type: "string", enum: ["UNIDAD", "GRANEL"] },
          cantidadDevuelta: { type: "string", example: "1.000", description: "Texto con 3 decimales" },
          esBolsaAbierta: { type: "boolean", example: false },
          cantidadStockIngresado: {
            type: "string",
            nullable: true,
            example: "15.000",
            description: "Kilos que ingresaron al granel. Solo con `esBolsaAbierta`; nulo en caso contrario. Texto con 3 decimales",
          },
          idProductoEntregado: { type: "integer", example: 2 },
          nombreProductoEntregado: { type: "string", example: "Alimento balanceado perro adulto 20 kg", description: "Nombre vigente" },
          formatoVentaProductoEntregado: { type: "string", enum: ["UNIDAD", "GRANEL"] },
          cantidadEntregada: { type: "string", example: "1.000", description: "Texto con 3 decimales" },
          saldoResultante: { type: "string", example: "500.00", description: "Texto con 2 decimales" },
          idMedioPago: { type: "integer", nullable: true, example: 1, description: "Nulo si el saldo es 0" },
          nombreMedioPago: { type: "string", nullable: true, example: "Efectivo", description: "Nombre vigente; nulo si el saldo es 0" },
        },
        required: [
          "idCambio",
          "fechaHora",
          "estado",
          "fechaHoraLimiteModificacion",
          "idVentaOriginal",
          "numeroComprobanteVentaOriginal",
          "idProductoDevuelto",
          "nombreProductoDevuelto",
          "formatoVentaProductoDevuelto",
          "cantidadDevuelta",
          "esBolsaAbierta",
          "cantidadStockIngresado",
          "idProductoEntregado",
          "nombreProductoEntregado",
          "formatoVentaProductoEntregado",
          "cantidadEntregada",
          "saldoResultante",
          "idMedioPago",
          "nombreMedioPago",
        ],
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
  required: ["exito", "fechaHoraServidor", "cambios", "paginacion"],
};

/** Descripción de cada parámetro de la consulta del historial de cambios (los rangos salen de las mismas constantes del esquema). */
const descripcionesParametrosHistorialCambios: Record<string, string> = {
  pagina: `Número de página, entero entre 1 y ${PAGINA_MAXIMA}. Por defecto 1.`,
  cantidadPorPagina: `Filas por página, entero entre 1 y ${CANTIDAD_POR_PAGINA_MAXIMA}. Por defecto ${CANTIDAD_POR_PAGINA_PREDETERMINADA}.`,
  fechaDesde:
    "Día inicial inclusivo (AAAA-MM-DD), interpretado en hora de Argentina (UTC-3): desde las 00:00 de ese día.",
  fechaHasta:
    "Día final inclusivo (AAAA-MM-DD), interpretado en hora de Argentina (UTC-3): hasta las 23:59:59 de ese día. No puede ser anterior a fechaDesde.",
  idProducto: `Entero positivo (máximo ${ID_PRODUCTO_MAXIMO}). Cambios cuyo producto devuelto o entregado es este.`,
  estado: "Solo cambios en este estado. Sin este filtro se devuelven todos, incluidos los anulados.",
  vinculo:
    "`VINCULADO`: solo cambios con venta original. `DESVINCULADO`: solo cambios sin ella. Sin este filtro se devuelven ambos.",
  idMedioPago: `Entero positivo (máximo ${ID_MEDIO_PAGO_MAXIMO}). Cambios cuyo saldo se cobró con este medio; los de saldo 0 no tienen medio y no coinciden.`,
};

// Los parámetros se derivan del esquema Zod real (io "input" = lo que envía el cliente), así no se desactualizan
const esquemaConsultaHistorialCambios = z.toJSONSchema(consultarHistorialCambiosSchema, { io: "input", target: "draft-7" });
const parametrosHistorialCambios = Object.entries(esquemaConsultaHistorialCambios.properties ?? {}).map(([nombre, esquema]) => ({
  name: nombre,
  in: "query",
  required: false,
  description: descripcionesParametrosHistorialCambios[nombre],
  schema: esquema,
}));

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

// El parámetro se deriva del esquema Zod real, igual que el de la venta, para que no se desactualice
const esquemaConsultaCambio = z.toJSONSchema(consultarCambioSchema, { io: "input", target: "draft-7" });
const parametroIdCambio = {
  name: "idCambio",
  in: "path",
  required: true,
  description: `Id del cambio: entero positivo (máximo ${ID_CAMBIO_MAXIMO}), por ejemplo el que devuelve el historial de cambios.`,
  schema: (esquemaConsultaCambio.properties ?? {}).idCambio,
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
  origen: "Solo ventas con este origen (MOSTRADOR o DIGITAL).",
  medioPago:
    `Id de un medio de pago (entero positivo, máximo ${ID_MEDIO_PAGO_MAXIMO}) o el literal \`${VALOR_MEDIO_PAGO_MIXTO}\` en mayúsculas. ` +
    "Con un id: solo las ventas con exactamente un pago, y que ese pago sea de ese medio. " +
    `Con \`${VALOR_MEDIO_PAGO_MIXTO}\`: ventas con más de un pago. Las ventas mixtas salen únicamente con \`${VALOR_MEDIO_PAGO_MIXTO}\` ` +
    "(nunca con un id): ambos filtros son conjuntos disjuntos. Un fiado pendiente no tiene pagos, así que no coincide con ninguno.",
  textoCliente:
    `Texto contenido en la referencia del cliente (máximo ${TEXTO_CLIENTE_LONGITUD_MAXIMA} caracteres), sin distinguir mayúsculas. ` +
    "Las ventas sin cliente no coinciden. Vacío equivale a no filtrar. Los caracteres `%` y `_` actúan como comodines.",
  numeroComprobante:
    `Texto contenido en el número de comprobante (máximo ${NUMERO_COMPROBANTE_LONGITUD_MAXIMA} caracteres), sin distinguir mayúsculas. ` +
    "Coincidencia parcial, no exacta. Vacío equivale a no filtrar. Los caracteres `%` y `_` actúan como comodines.",
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
          categoria: {
            type: "string",
            example: "Alimento balanceado",
            description: "Nombre vigente de la categoría del producto; siempre tiene valor",
          },
          precioVenta: { type: "string", example: "45000.00", description: "Texto con 2 decimales" },
          stockFisico: { type: "string", example: "12.000", description: "Texto con 3 decimales" },
          formatoVenta: { type: "string", enum: ["UNIDAD", "GRANEL"], example: "UNIDAD" },
          permiteBolsaAbierta: {
            type: "boolean",
            example: true,
            description:
              "Si el producto admite devolverse como bolsa abierta en un cambio: es UNIDAD, tiene un producto a granel activo asociado y un peso unitario cargado",
          },
          idProductoGranel: {
            type: "integer",
            nullable: true,
            example: 4,
            description: "Id del producto a granel vinculado; nulo si no tiene. Se informa aunque ese granel esté inactivo",
          },
          nombreProductoGranel: {
            type: "string",
            nullable: true,
            example: "Alimento balanceado perro adulto a granel",
            description: "Nombre vigente del producto a granel vinculado; nulo si no tiene",
          },
          pesoUnitario: {
            type: "string",
            nullable: true,
            example: "3.000",
            description: "Kilos por unidad, texto con 3 decimales; nulo si no está cargado",
          },
        },
        required: [
          "idProducto",
          "nombre",
          "categoria",
          "precioVenta",
          "stockFisico",
          "formatoVenta",
          "permiteBolsaAbierta",
          "idProductoGranel",
          "nombreProductoGranel",
          "pesoUnitario",
        ],
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
          "No expone costo ni código de barras. Cada producto trae `categoria` (el nombre vigente de su categoría), `permiteBolsaAbierta`, la misma regla que valida el alta de un cambio, " +
          "y los datos de su granel vinculado (`idProductoGranel`, `nombreProductoGranel`) y `pesoUnitario`, nulos si no aplican. " +
          "Requiere sesión (roles VENDEDOR, GESTOR_COMERCIAL o GERENTE); no exige caja abierta.",
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
          "Los filtros son opcionales y se combinan con AND (fechas, producto, estado, origen, medio de pago, cliente y comprobante). " +
          "Una página fuera de rango devuelve 200 con lista vacía. " +
          "Cada venta trae `fechaHoraLimiteModificacion` y `cantidadCambiosActivos`, y la raíz `fechaHoraServidor`. " +
          "No incluye detalles ni pagos de cada venta. Requiere sesión (roles VENDEDOR, GESTOR_COMERCIAL o GERENTE); no exige caja abierta.",
        parameters: parametrosHistorial,
        responses: {
          "200": {
            description: "Página del historial con sus metadatos de paginación",
            content: { "application/json": { schema: historialConsultado } },
          },
          "400": {
            description:
              "Parámetros de consulta inválidos (formato, rango, fecha inexistente, rango de fechas invertido, `origen` fuera de MOSTRADOR/DIGITAL, " +
              "`medioPago` que no es un id positivo ni `MIXTO` en mayúsculas, o `textoCliente` / `numeroComprobante` más largos que su máximo)",
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
          "Devuelve `fechaHoraServidor` en la raíz, `venta.fechaHoraLimiteModificacion` (nula si está ANULADA) y, por ítem, `cantidadYaDevuelta`. " +
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
    "/api/cambios-mercaderia": {
      get: {
        tags: ["Ventas"],
        security: [{ bearerAuth: [] }],
        summary: "Consultar el historial de cambios de mercadería (paginado, con filtros)",
        description:
          "Alimenta la grilla del historial de cambios. Orden fijo: fecha descendente con desempate por id descendente. " +
          "Los filtros son opcionales y se combinan con AND. Una página fuera de rango devuelve 200 con lista vacía. " +
          "Los nombres de producto y de medio de pago son los vigentes. No incluye precios unitarios ni costos. " +
          "`fechaHoraLimiteModificacion` es la fecha del cambio más la ventana de anulación (15 minutos) y es nulo en los anulados; " +
          "la raíz trae `fechaHoraServidor` para evaluar esa ventana con la hora del servidor. " +
          "`cantidadStockIngresado` solo se informa en una bolsa abierta (kilos que ingresaron al granel). " +
          "Requiere sesión (roles VENDEDOR, GESTOR_COMERCIAL o GERENTE); no exige caja abierta.",
        parameters: parametrosHistorialCambios,
        responses: {
          "200": {
            description: "Página del historial de cambios con sus metadatos de paginación",
            content: { "application/json": { schema: historialCambiosConsultado } },
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
        summary: "Registrar un cambio de mercadería posventa",
        description:
          "Un artículo entra (`idProductoDevuelto`) y otro sale (`idProductoEntregado`). Con `idVentaOriginal` el cambio queda vinculado a un ticket; sin él es un cambio aislado. " +
          "Ingresa el stock del devuelto, descuenta el del entregado y registra el cambio en una única transacción. " +
          "El usuario es el del token: un `idUsuario` en el body se ignora sin error. " +
          `Las cantidades admiten hasta 3 decimales y no pueden superar ${CANTIDAD_MAXIMA}; un producto por unidad exige cantidad entera. ` +
          `**Motivo:** \`motivoCambio\` es obligatorio: texto de 1 a ${MOTIVO_CAMBIO_LONGITUD_MAXIMA} caracteres tras recortar los espacios de los extremos (el front arma el texto a partir del motivo elegido). ` +
          "**Bolsa abierta (`esBolsaAbierta`):** solo si el devuelto es por unidad y tiene un producto a granel activo asociado y un peso unitario cargado " +
          "(`permiteBolsaAbierta` en `GET /api/productos`). `cantidadDevuelta` son bolsas enteras y `pesoDevuelto` (opcional, solo con bolsa abierta; con `esBolsaAbierta` falso es 400) son los kilos que se devuelven en total: " +
          "debe ser mayor que 0 y no superar el peso nominal (peso unitario × `cantidadDevuelta`); sin él se usa el peso nominal. " +
          "El granel recibe esos kilos y `cantidadStockIngresado` los guarda. Con bolsa cerrada ingresa el mismo producto y `cantidadStockIngresado` = `cantidadDevuelta`. " +
          "**Precios y crédito:** el devuelto con ticket vale lo que se pagó por él (el precio del detalle, sin prorratear el descuento manual de la venta); " +
          "sin ticket y el entregado, el precio vigente. El crédito de una bolsa abierta es el precio de la BOLSA (nunca el del granel) por la fracción devuelta: " +
          "`precio de la bolsa × (pesoDevuelto ÷ peso unitario)`, con Decimal exacto y un solo redondeo a 2 decimales (la mitad hacia arriba). " +
          "Ejemplo: bolsa de 15 kg a 60000 que vuelve con 14,5 kg → crédito 58000; si el cliente se lleva otra de 60000, el saldo es 2000. " +
          "**Saldo:** entregado menos devuelto, calculado por el servidor. " +
          "Negativo es 400 (no hay reembolsos); 0 deja `idMedioPago`, `montoRecibido` y vuelto nulos e ignora los del body; mayor a 0 exige `idMedioPago` de un medio activo, " +
          "sin recargo ni descuento. **Efectivo:** `montoRecibido` solo se admite con un medio en efectivo y saldo mayor que 0 (con otro medio es 400) y debe ser mayor o igual al saldo; " +
          "el servidor calcula el `vuelto` (recibido − saldo). Mismas reglas y mensajes que el cobro de una venta. El `vuelto` no viaja en el body. " +
          "El ingreso queda en la última caja abierta (`idCaja` + `saldoResultante`); no se modifica el saldo de la caja. " +
          "**Ticket vinculado:** la venta debe estar `COMPLETADA` (409 si está `ANULADA` o `PENDIENTE_PAGO`), el producto devuelto debe figurar en sus detalles (400) " +
          "y la cantidad no puede superar lo vendido menos lo ya devuelto en cambios activos de ese ticket (409). No hay límite de tiempo para dar de alta un cambio sobre un ticket viejo. " +
          "No emite comprobante. " +
          "**Respuesta:** `cambio` trae el mismo contenido que `GET /api/cambios-mercaderia/{idCambio}` (releído dentro de la misma transacción) más los campos planos que el alta ya devolvía, y `fechaHoraServidor` en la raíz. " +
          "**Errores:** todos traen `codigo`, legible por máquina (`DATOS_INVALIDOS`, `SALDO_NEGATIVO`, `VENTA_NO_ENCONTRADA`, `VENTA_NO_VINCULABLE`, `CANTIDAD_EXCEDE_VENTA`, `SIN_CAJA_ABIERTA`, `STOCK_INSUFICIENTE`); " +
          "producto o medio de pago inexistente es 404 con `DATOS_INVALIDOS`. " +
          "Orden de evaluación: 400 (formato), 404 (producto devuelto, entregado, venta), 400 (entregado inactivo, cantidades, bolsa abierta y peso), " +
          "ticket (409 estado, 400 producto ausente, 409 cantidad), saldo, medio de pago y efectivo (400, 404), 409 (sin caja abierta), 409 (stock insuficiente del entregado). " +
          "Ante cualquier fallo no queda nada escrito.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              // `io: "input"` describe lo que el cliente envía, no el resultado ya transformado
              schema: z.toJSONSchema(registrarCambioSchema, { io: "input", target: "draft-7" }),
            },
          },
        },
        responses: {
          "201": {
            description: "Cambio registrado",
            content: { "application/json": { schema: cambioRegistrado } },
          },
          "400": {
            description:
              "Body inválido (incluidos `motivoCambio` ausente o vacío y `pesoDevuelto` sin bolsa abierta), o regla de negocio incumplida: entregado inactivo, cantidad con decimales en un producto por unidad, " +
              "bolsa abierta no admitida, peso devuelto mayor al nominal, producto devuelto ausente en el ticket, saldo negativo (`SALDO_NEGATIVO`), saldo mayor a 0 sin medio de pago o con medio inactivo, " +
              "monto recibido con un medio que no es efectivo o menor al saldo",
            content: { "application/json": { schema: { oneOf: [errorValidacionCambio, errorNegocioCambio] } } },
          },
          "404": {
            description: "Producto devuelto, producto entregado o medio de pago inexistente (`DATOS_INVALIDOS`), o venta vinculada inexistente (`VENTA_NO_ENCONTRADA`)",
            content: { "application/json": { schema: errorNegocioCambio } },
          },
          "409": {
            description:
              "Venta vinculada anulada o pendiente de pago (`VENTA_NO_VINCULABLE`), cantidad a devolver mayor a la disponible del ticket (`CANTIDAD_EXCEDE_VENTA`), " +
              "no hay una caja abierta (`SIN_CAJA_ABIERTA`) o stock insuficiente del producto entregado (`STOCK_INSUFICIENTE`)",
            content: { "application/json": { schema: errorNegocioCambio } },
          },
          ...respuestasProteccion,
        },
      },
    },
    "/api/cambios-mercaderia/{idCambio}": {
      get: {
        tags: ["Ventas"],
        security: [{ bearerAuth: [] }],
        summary: "Consultar un cambio de mercadería (detalle)",
        description:
          "Detalle de un cambio, en cualquier estado. Trae la venta vinculada (nula si es desvinculado), el artículo devuelto y el entregado con su precio unitario y subtotal, " +
          "el producto que recibió el stock (el devuelto, o el granel si fue bolsa abierta; con la cantidad solo si fue bolsa abierta), " +
          "los valores (`valorDevuelto`, `valorEntregado` y `saldoResultante`), el pago del saldo (`pagoSaldo`: medio, `montoRecibido` y `vuelto`; nulo si no hubo saldo), el vendedor y `anulacion` " +
          "(fecha, usuario y motivo; nula mientras el cambio no esté anulado). `motivoCambio` es nulo en los cambios anteriores a que se registrara, y también lo son `montoRecibido` y `vuelto`. " +
          "El crédito del devuelto sale de restar el saldo al valor de lo entregado, así que es exacto aunque el peso del producto cambie después. " +
          "Los nombres son los vigentes. `fechaHoraLimiteModificacion` es la fecha del cambio más 15 minutos (nula si está ANULADO) y la raíz trae `fechaHoraServidor` para evaluarla con la hora del servidor. " +
          "Las lecturas salen de la misma foto de la base. Solo lectura: no modifica stock, caja ni estado. " +
          "Requiere sesión (roles VENDEDOR, GESTOR_COMERCIAL o GERENTE); no exige caja abierta.",
        parameters: [parametroIdCambio],
        responses: {
          "200": {
            description: "Detalle del cambio",
            content: { "application/json": { schema: cambioConsultado } },
          },
          "400": {
            description: "`idCambio` inválido (no es un entero positivo): `codigo` `DATOS_INVALIDOS`",
            content: { "application/json": { schema: errorValidacionConsultaCambio } },
          },
          "404": {
            description: "El cambio no existe (`CAMBIO_NO_ENCONTRADO`)",
            content: { "application/json": { schema: cambioInexistente } },
          },
          ...respuestasProteccion,
        },
      },
    },
  },
};
