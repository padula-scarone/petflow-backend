import type { z } from "zod";
import type {
  consultarHistorialSchema,
  consultarVentaSchema,
  ESTADOS_VENTA_HISTORIAL,
  liquidarFiadoParametrosSchema,
  liquidarFiadoSchema,
  registrarVentaSchema,
} from "./ventas.schemas.js";

// --- TIPOS DE ENTRADA ---

/** Cuerpo validado de `POST /api/ventas`, inferido del esquema Zod. */
export type RegistrarVentaInput = z.infer<typeof registrarVentaSchema>;

/** Canal por el que se originó la venta. */
export type OrigenVenta = RegistrarVentaInput["origen"];

/** Forma de entrega de la mercadería. */
export type ModalidadEntrega = RegistrarVentaInput["modalidadEntrega"];

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

/** Medio de pago con su ajuste porcentual ya resuelto. */
export type MedioPagoVigente = {
  idMedioPago: number;
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
  /** Vacío en un fiado. */
  pagos: PagoVentaCalculado[];
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
// Solo incluye lo que el contrato permite devolver: el costo congelado, montoRecibido y vuelto
// no se piden a la base.

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
  montoTotalCentavos: number;
  items: ItemVentaDetallado[];
  /** Vacío en un fiado no cobrado. */
  pagos: PagoVentaDetallado[];
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
};

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
  montoTotal: string;
  items: ItemVentaConsultado[];
  /** Arreglo vacío si es un ticket de deuda (PENDIENTE_PAGO). */
  pagos: PagoVentaConsultado[];
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

/** Tipo de un medio de pago; solo EFECTIVO admite monto recibido y vuelto. */
export type TipoMedioPago = "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "BILLETERA_VIRTUAL";

/** Medio de pago con su tipo, necesario para decidir si admite monto recibido y vuelto. */
export type MedioPagoCobrable = MedioPagoVigente & {
  tipo: TipoMedioPago;
};

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

/** Un pago del cobro con el ajuste del medio aplicado y, si corresponde, el monto recibido y el vuelto. */
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

/** Pago del cobro en la respuesta: montos como texto con 2 decimales. */
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
