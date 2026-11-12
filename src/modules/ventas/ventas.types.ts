import type { z } from "zod";
import type {
  anularVentaCuerpoSchema,
  anularVentaParametrosSchema,
  consultarHistorialSchema,
  consultarVentaSchema,
  ESTADOS_VENTA_HISTORIAL,
  liquidarFiadoParametrosSchema,
  liquidarFiadoSchema,
  registrarVentaSchema,
} from "./ventas.schemas.js";

// --- TIPOS DE ENTRADA ---

/** Cuerpo validado de `POST /api/ventas`, inferido del esquema Zod. No incluye al vendedor: sale del token. */
export type RegistrarVentaCuerpo = z.infer<typeof registrarVentaSchema>;

/** Entrada completa del alta: el cuerpo del request más el vendedor, que viene del token ya verificado. */
export type RegistrarVentaInput = RegistrarVentaCuerpo & {
  /** Usuario de la sesión; nunca se toma del body. */
  idUsuario: number;
};

/** Canal por el que se originó la venta. */
export type OrigenVenta = RegistrarVentaCuerpo["origen"];

/** Forma de entrega de la mercadería. */
export type ModalidadEntrega = RegistrarVentaCuerpo["modalidadEntrega"];

/** Estados con los que puede nacer una venta: cobrada o fiado. */
export type EstadoVenta = "COMPLETADA" | "PENDIENTE_PAGO";

// --- DATOS LEÍDOS DE LA BASE ---
// Montos en centavos (enteros), cantidades en milésimas (enteros) y porcentajes en
// centésimas de punto (basis points). Así no hay errores de coma flotante.

/** Producto con sus valores vigentes al momento de vender. */
export type ProductoVigente = {
  idProducto: number;
  nombre: string;
  /** UNIDAD solo admite cantidades enteras; GRANEL admite decimales. */
  formatoVenta: "UNIDAD" | "GRANEL";
  activo: boolean;
  /** Precio de venta actual, en centavos. */
  precioCentavos: number;
  /** Costo actual, en centavos. Se congela en el detalle de la venta. */
  costoCentavos: number;
  /** Stock físico disponible, en milésimas. */
  stockMilesimas: number;
};

/** Tipo de un medio de pago; solo EFECTIVO admite monto recibido y vuelto. */
export type TipoMedioPago = "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "BILLETERA_VIRTUAL";

/** Medio de pago con su ajuste porcentual ya resuelto y su tipo (decide si admite monto recibido y vuelto). */
export type MedioPagoVigente = {
  idMedioPago: number;
  tipo: TipoMedioPago;
  activo: boolean;
  /** Neto del medio: recargo − descuento, en basis points (ej. 1000 = 10%). */
  ajusteBp: number;
};

// --- RESULTADO DEL CÁLCULO ---

/** Una línea de la venta con el precio y costo congelados. */
export type LineaVentaCalculada = {
  idProducto: number;
  cantidadMilesimas: number;
  precioUnitarioCentavos: number;
  costoUnitarioCentavos: number;
  /** precio unitario × cantidad, redondeado a centavos. */
  subtotalCentavos: number;
};

/** Un pago con el ajuste del medio ya aplicado. */
export type PagoVentaCalculado = {
  idMedioPago: number;
  /** Porción base aportada por este medio, antes del ajuste. */
  montoBaseCentavos: number;
  /** Ajuste aplicado (recargo − descuento) en basis points. */
  porcentajeAplicadoBp: number;
  /** Lo que efectivamente paga el cliente por este medio: base × (1 + ajuste). */
  montoFinalCentavos: number;
};

/** Resultado completo de `calcularVenta`, listo para persistir. */
export type TotalesVentaCalculados = {
  lineas: LineaVentaCalculada[];
  /** Vacío en un fiado. Cada pago trae monto recibido y vuelto (nulos si no aplican). */
  pagos: PagoCobroCalculado[];
  subtotalBrutoCentavos: number;
  descuentoManualCentavos: number;
  /** Fiado: subtotal − descuento. Cobrada: suma de los montos finales de los pagos. */
  montoTotalCentavos: number;
  estado: EstadoVenta;
};

// --- RESPUESTA HTTP ---

/** Respuesta exitosa de `POST /api/ventas`. Los montos viajan como texto con 2 decimales. */
export type RegistrarVentaResponse = {
  exito: true;
  mensaje: string;
  venta: {
    idVenta: number;
    /** Siempre presente: toda venta emite comprobante al instante (ticket de pago si queda COMPLETADA, ticket de deuda si queda PENDIENTE_PAGO). */
    numeroComprobante: string;
    montoTotal: string;
    estado: EstadoVenta;
    /** Fecha y hora en formato ISO 8601. */
    fechaHora: string;
    /** Vacío en un fiado. Permite al front mostrar el vuelto sin otra consulta. */
    pagos: PagoCobrado[];
  };
};

// --- HISTORIAL DE VENTAS: ENTRADA Y FILTRO ---

/** Query validada de `GET /api/ventas`, inferida del esquema Zod (ya con valores por defecto aplicados). */
export type ConsultarHistorialInput = z.infer<typeof consultarHistorialSchema>;

/** Estados consultables en el historial: incluye ANULADA, que no existe al registrar una venta. */
export type EstadoVentaHistorial = (typeof ESTADOS_VENTA_HISTORIAL)[number];

/** Filtros del historial ya traducidos a valores listos para consultar. Todos se combinan con AND. */
export type FiltroHistorialVentas = {
  /** Límite inferior inclusivo: 00:00 (hora de Argentina) del día `fechaDesde`. */
  fechaDesdeInclusiva?: Date;
  /** Límite superior exclusivo: 00:00 (hora de Argentina) del día siguiente a `fechaHasta`. */
  fechaHastaExclusiva?: Date;
  /** Solo ventas que contienen este producto en sus detalles. */
  idProducto?: number;
  estado?: EstadoVentaHistorial;
};

// --- HISTORIAL DE VENTAS: DATOS DE LA BASE ---

/** Fila del historial tal como la entrega el repositorio. */
export type FilaHistorialVenta = {
  idVenta: number;
  /**
   * Nulo solo en datos anteriores al backfill: la columna sigue siendo nullable en el esquema,
   * aunque toda venta nueva emite comprobante al instante.
   */
  numeroComprobante: string | null;
  fechaHora: Date;
  estado: EstadoVentaHistorial;
  montoTotalCentavos: number;
  clienteReferencia: string | null;
  origen: OrigenVenta;
  modalidadEntrega: ModalidadEntrega;
};

/** Una página de filas más el total de registros que cumplen el filtro (sin paginar). */
export type PaginaHistorialVentas = {
  filas: FilaHistorialVenta[];
  totalRegistros: number;
};

// --- HISTORIAL DE VENTAS: RESPUESTA HTTP ---

/** Fila de la grilla de historial en la respuesta. No incluye detalles ni pagos (eso es "Consultar Venta"). */
export type VentaHistorial = {
  idVenta: number;
  /** Nulo solo en datos anteriores al backfill. */
  numeroComprobante: string | null;
  /** Fecha y hora en formato ISO 8601. */
  fechaHora: string;
  estado: EstadoVentaHistorial;
  /** Monto total como texto con 2 decimales, igual que en el alta. */
  montoTotal: string;
  /** Nulo si la venta no tiene cliente asociado. */
  clienteReferencia: string | null;
  origen: OrigenVenta;
  modalidadEntrega: ModalidadEntrega;
};

/** Metadatos de paginación de la respuesta. */
export type PaginacionHistorial = {
  /** Página solicitada (empieza en 1). */
  pagina: number;
  cantidadPorPagina: number;
  /** Total de ventas que cumplen el filtro, sin paginar. */
  totalRegistros: number;
  /** Techo de totalRegistros / cantidadPorPagina; 0 si no hay filas. */
  totalPaginas: number;
};

/** Respuesta exitosa de `GET /api/ventas`. Una página fuera de rango devuelve `ventas` vacío. */
export type ConsultarHistorialResponse = {
  exito: true;
  ventas: VentaHistorial[];
  paginacion: PaginacionHistorial;
};

// --- CONSULTA DE UNA VENTA: ENTRADA ---

/** Parámetros de ruta validados de `GET /api/ventas/:idVenta`, inferidos del esquema Zod. */
export type ConsultarVentaInput = z.infer<typeof consultarVentaSchema>;

// --- CONSULTA DE UNA VENTA: DATOS DE LA BASE ---
// Solo incluye lo que el contrato permite devolver: el costo congelado no se pide a la base.

/** Una línea de la venta tal como se guardó (precio congelado al registrar). */
export type ItemVentaDetallado = {
  idProducto: number;
  /** Nombre actual del producto: el esquema no lo congela en el detalle. */
  nombreProducto: string;
  formatoVenta: "UNIDAD" | "GRANEL";
  cantidadMilesimas: number;
  precioUnitarioCentavos: number;
  subtotalCentavos: number;
};

/** Un pago de la venta tal como se guardó (porcentaje congelado al registrar). */
export type PagoVentaDetallado = {
  idMedioPago: number;
  /** Nombre actual del medio de pago: el esquema no lo congela en el pago. */
  nombreMedioPago: string;
  montoBaseCentavos: number;
  /** Ajuste neto (recargo − descuento) aplicado, en basis points. */
  porcentajeAplicadoBp: number;
  montoFinalCentavos: number;
  /** Lo que entregó el cliente en efectivo. Nulo en ventas anteriores o si no se informó. */
  montoRecibidoCentavos: number | null;
  /** Recibido − monto final. Nulo siempre que el recibido sea nulo. */
  vueltoCentavos: number | null;
};

/** Vendedor que registró la venta. */
export type VendedorVenta = {
  idUsuario: number;
  nombre: string;
};

/** Venta completa con sus ítems y pagos, tal como la entrega el repositorio. */
export type VentaDetallada = {
  idVenta: number;
  /** Nulo solo en datos anteriores al backfill. */
  numeroComprobante: string | null;
  fechaHora: Date;
  /** Nulo si es fiado y todavía no se cobró. */
  fechaHoraPago: Date | null;
  estado: EstadoVentaHistorial;
  origen: OrigenVenta;
  modalidadEntrega: ModalidadEntrega;
  clienteReferencia: string | null;
  vendedor: VendedorVenta;
  subtotalBrutoCentavos: number;
  descuentoManualCentavos: number;
  /** Nulo si la venta no tuvo descuento o es anterior a que se registrara el motivo. */
  motivoDescuento: string | null;
  montoTotalCentavos: number;
  items: ItemVentaDetallado[];
  /** Vacío en un fiado no cobrado. */
  pagos: PagoVentaDetallado[];
  /** Nulo si la venta no está ANULADA o si se anuló antes de que se registrara la auditoría. */
  anulacion: AnulacionVenta | null;
};

// --- CONSULTA DE UNA VENTA: RESPUESTA HTTP ---

/** Línea de la venta en la respuesta: precio como texto con 2 decimales, cantidad con 3. */
export type ItemVentaConsultado = {
  idProducto: number;
  nombreProducto: string;
  formatoVenta: "UNIDAD" | "GRANEL";
  /** Texto con 3 decimales. */
  cantidad: string;
  /** Texto con 2 decimales. */
  precioUnitario: string;
  /** Texto con 2 decimales. */
  subtotal: string;
};

/** Pago de la venta en la respuesta: montos como texto con 2 decimales. */
export type PagoVentaConsultado = {
  idMedioPago: number;
  nombreMedioPago: string;
  montoBase: string;
  /** Ajuste neto como texto con 2 decimales; negativo si el medio da descuento (ej. "-5.00"). */
  porcentajeAplicado: string;
  montoFinal: string;
} & Pick<PagoCobrado, "montoRecibido" | "vuelto">;

/** Venta en la respuesta. El tipo de comprobante se deduce de `estado`; no hay un campo aparte. */
export type VentaConsultada = {
  idVenta: number;
  /** Nulo solo en datos anteriores al backfill. */
  numeroComprobante: string | null;
  /** Fecha y hora en formato ISO 8601. */
  fechaHora: string;
  /** Fecha y hora de pago en formato ISO 8601; nulo si es fiado. */
  fechaHoraPago: string | null;
  estado: EstadoVentaHistorial;
  origen: OrigenVenta;
  modalidadEntrega: ModalidadEntrega;
  /** Nulo si la venta no tiene cliente asociado. */
  clienteReferencia: string | null;
  vendedor: VendedorVenta;
  /** Montos como texto con 2 decimales. */
  subtotalBruto: string;
  descuentoManual: string;
  /** Nulo si la venta no tuvo descuento o es anterior a que se registrara el motivo. */
  motivoDescuento: string | null;
  montoTotal: string;
  items: ItemVentaConsultado[];
  /** Arreglo vacío si es un ticket de deuda (PENDIENTE_PAGO). */
  pagos: PagoVentaConsultado[];
  /** Nulo si la venta no está ANULADA o si se anuló antes de que se registrara la auditoría. */
  anulacion: AnulacionConsultada | null;
};

/** Respuesta exitosa de `GET /api/ventas/:idVenta`. */
export type ConsultarVentaResponse = {
  exito: true;
  venta: VentaConsultada;
};

// --- COBRO DE FIADO: ENTRADA ---

/** Parámetro de ruta validado de `POST /api/ventas/:idVenta/cobro`, inferido del esquema Zod. */
export type LiquidarFiadoParametros = z.infer<typeof liquidarFiadoParametrosSchema>;

/** Body validado de `POST /api/ventas/:idVenta/cobro`, inferido del esquema Zod. */
export type LiquidarFiadoCuerpo = z.infer<typeof liquidarFiadoSchema>;

/** Entrada completa del cobro: la venta que viene de la ruta y los pagos que vienen del body. */
export type LiquidarFiadoInput = LiquidarFiadoParametros & LiquidarFiadoCuerpo;

// --- COBRO DE FIADO: DATOS DE LA BASE ---

/** Venta leída para cobrarla: solo lo necesario para validar su estado y calcular el importe adeudado. */
export type VentaAdeudada = {
  idVenta: number;
  /** Se conserva tal cual en el cobro. Nulo solo en datos anteriores al backfill. */
  numeroComprobante: string | null;
  /** Cualquier estado: el service rechaza el que no sea PENDIENTE_PAGO. */
  estado: EstadoVentaHistorial;
  subtotalBrutoCentavos: number;
  descuentoManualCentavos: number;
};

// --- COBRO DE FIADO: RESULTADO DEL CÁLCULO ---

/**
 * Un pago con el ajuste del medio aplicado y, si corresponde, el monto recibido y el vuelto.
 * Lo comparten el alta de venta y el cobro de un fiado.
 */
export type PagoCobroCalculado = PagoVentaCalculado & {
  /** Lo que entregó el cliente en efectivo. Nulo si el medio no es efectivo o no se informó. */
  montoRecibidoCentavos: number | null;
  /** Recibido − monto final. Nulo siempre que el recibido sea nulo. */
  vueltoCentavos: number | null;
};

/** Resultado completo de `calcularCobroFiado`, listo para persistir. */
export type CobroFiadoCalculado = {
  pagos: PagoCobroCalculado[];
  /** Subtotal bruto − descuento manual: lo que los pagos (porciones base) deben cubrir. */
  importeAdeudadoCentavos: number;
  /** Suma de los montos finales: lo que paga el cliente con recargos o descuentos del día. */
  montoTotalCentavos: number;
  /** Se conserva el del ticket de deuda; nunca se emite uno nuevo. */
  numeroComprobante: string | null;
};

// --- COBRO DE FIADO: DATOS PERSISTIDOS Y RESPUESTA HTTP ---

/** Datos del cobro ya guardado que necesita el service para armar la respuesta. */
export type CobroFiadoPersistido = {
  idVenta: number;
  numeroComprobante: string | null;
  montoTotalCentavos: number;
  fechaHoraPago: Date;
  pagos: PagoCobroCalculado[];
};

/** Pago en la respuesta del alta y del cobro: montos como texto con 2 decimales. */
export type PagoCobrado = {
  idMedioPago: number;
  montoFinal: string;
  /** Nulo si el medio no es efectivo o no se informó el monto recibido. */
  montoRecibido: string | null;
  /** Nulo siempre que `montoRecibido` sea nulo. */
  vuelto: string | null;
};

/** Respuesta exitosa de `POST /api/ventas/:idVenta/cobro`. */
export type LiquidarFiadoResponse = {
  exito: true;
  mensaje: string;
  venta: {
    idVenta: number;
    /** El mismo del ticket de deuda: el comprobante pasa a ser un recibo de pago. */
    numeroComprobante: string | null;
    estado: "COMPLETADA";
    /** Total pagado con los recargos o descuentos del día; cambia respecto del importe del fiado. */
    montoTotal: string;
    /** Fecha y hora del cobro en formato ISO 8601. */
    fechaHoraPago: string;
    pagos: PagoCobrado[];
  };
};

// --- ANULACIÓN DE VENTA: ENTRADA ---

/** Parámetro de ruta validado de `POST /api/ventas/:idVenta/anulacion`, inferido del esquema Zod. */
export type AnularVentaParametros = z.infer<typeof anularVentaParametrosSchema>;

/** Body validado de `POST /api/ventas/:idVenta/anulacion` (el motivo ya viene recortado), inferido del esquema Zod. */
export type AnularVentaCuerpo = z.infer<typeof anularVentaCuerpoSchema>;

/** Entrada completa de la anulación: la venta de la ruta, el motivo del body y quien anula, que viene del token ya verificado. */
export type AnularVentaInput = AnularVentaParametros &
  AnularVentaCuerpo & {
    /** Usuario de la sesión que anula (no necesariamente el vendedor original); nunca se toma del body. */
    idUsuario: number;
  };

/**
 * Estados desde los que se puede anular una venta: cobrada (inmediata o fiado ya cobrado) o fiado pendiente.
 * Tipo aparte de `EstadoVenta` (que describe cómo nace una venta) aunque hoy coincidan los valores.
 */
export type EstadoVentaAnulable = "COMPLETADA" | "PENDIENTE_PAGO";

// --- ANULACIÓN DE VENTA: DATOS DE LA BASE ---

/** Venta leída para anularla: solo lo necesario para validar su estado y la ventana de tiempo. */
export type VentaAnulable = {
  idVenta: number;
  /** Se devuelve tal cual en la respuesta. Nulo solo en datos anteriores al backfill. */
  numeroComprobante: string | null;
  /** Cualquier estado: el service rechaza ANULADA. */
  estado: EstadoVentaHistorial;
  /** Origen de la ventana si la venta no tiene fecha de pago. */
  fechaHora: Date;
  /** Origen de la ventana si existe: nulo mientras el fiado no se cobra. */
  fechaHoraPago: Date | null;
};

/** Resultado de `evaluarAnulacion`: la venta se puede anular y estos son los datos para transicionarla. */
export type DecisionAnulacion = {
  /** Comprobante de la venta, para devolverlo en la respuesta sin volver a leerla. */
  numeroComprobante: string | null;
  /** Estado leído: la transición exige que siga siendo este al momento de escribir. */
  estadoAnterior: EstadoVentaAnulable;
  /** Instante mínimo vigente: la fecha de referencia de la venta debe ser mayor o igual a este valor. */
  limiteVentana: Date;
  /** Instante de la anulación: el mismo `ahora` de la evaluación, para que ventana y auditoría usen un único reloj. */
  fechaHoraAnulacion: Date;
};

// --- ANULACIÓN DE VENTA: DATOS PERSISTIDOS Y RESPUESTA HTTP ---

/** Datos de la anulación ya guardada que necesita el service para armar la respuesta. */
export type AnulacionPersistida = {
  idVenta: number;
  numeroComprobante: string | null;
  estadoAnterior: EstadoVentaAnulable;
  /** Instante en que se anuló, tal como quedó guardado. */
  fechaHoraAnulacion: Date;
  /** Motivo recortado, tal como quedó guardado. */
  motivo: string;
};

/** Respuesta exitosa de `POST /api/ventas/:idVenta/anulacion`. */
export type AnularVentaResponse = {
  exito: true;
  mensaje: string;
  venta: {
    idVenta: number;
    numeroComprobante: string | null;
    estado: "ANULADA";
    /** Estado que tenía antes: permite al front saber si hubo cobro revertido o solo stock repuesto. */
    estadoAnterior: EstadoVentaAnulable;
    /** Auditoría de la anulación recién hecha. El usuario no viaja aquí: lo trae `GET /api/ventas/:idVenta`. */
    anulacion: {
      /** Fecha y hora de la anulación en formato ISO 8601. */
      fechaHora: string;
      motivo: string;
    };
  };
};

// --- ANULACIÓN DE VENTA: AUDITORÍA EN LA CONSULTA ---

/** Auditoría de una venta anulada, tal como la entrega el repositorio. */
export type AnulacionVenta = {
  fechaHora: Date;
  motivo: string;
  /** Quien anuló: puede ser distinto del vendedor original. */
  usuario: { idUsuario: number; nombre: string };
};

/** Auditoría de una venta anulada en la respuesta de `GET /api/ventas/:idVenta`. */
export type AnulacionConsultada = {
  /** Fecha y hora de la anulación en formato ISO 8601. */
  fechaHora: string;
  motivo: string;
  usuario: { idUsuario: number; nombre: string };
};
