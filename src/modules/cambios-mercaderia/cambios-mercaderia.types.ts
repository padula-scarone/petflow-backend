import type { z } from "zod";
import type { Decimal } from "../../shared/decimal.js";
import type { FormatoVenta, ProductoGranelAsociado } from "../inventario/inventario.types.js";
import type { PaginacionHistorial } from "../ventas/ventas.types.js";
import type {
  consultarCambioSchema,
  consultarHistorialCambiosSchema,
  ESTADOS_CAMBIO_HISTORIAL,
  registrarCambioSchema,
  VINCULOS_CAMBIO_HISTORIAL,
} from "./cambios-mercaderia.schemas.js";

// --- TIPOS DE ENTRADA ---

/** Cuerpo validado de `POST /api/cambios-mercaderia`, inferido del esquema Zod. No incluye al usuario: sale del token. */
export type RegistrarCambioCuerpo = z.infer<typeof registrarCambioSchema>;

/** Entrada completa del alta: el cuerpo del request más el usuario, que viene del token ya verificado. */
export type RegistrarCambioInput = RegistrarCambioCuerpo & {
  /** Usuario de la sesión; nunca se toma del body. */
  idUsuario: number;
};

// --- DATOS LEÍDOS DE LA BASE ---
// Montos y cantidades como Decimal exacto (nunca `number`): así no hay errores de coma flotante.

/** Producto granel asociado a un producto por unidad, con su id para saber a quién ingresa el stock. */
export type ProductoGranelParaCambio = ProductoGranelAsociado & {
  idProducto: number;
};

/** Producto leído para un cambio, con los valores vigentes al momento de registrarlo. */
export type ProductoParaCambio = {
  idProducto: number;
  nombre: string;
  /** UNIDAD solo admite cantidades enteras; GRANEL admite decimales. */
  formatoVenta: FormatoVenta;
  activo: boolean;
  /** Precio de venta actual, en pesos. */
  precioVenta: Decimal;
  /** Costo actual, en pesos. Se congela en el cambio solo si el producto es el entregado. */
  costoActual: Decimal;
  /** Kilos por unidad; nulo si no está cargado. */
  pesoUnitario: Decimal | null;
  /** Producto GRANEL asociado; nulo si el producto no lo tiene. */
  productoGranel: ProductoGranelParaCambio | null;
};

/** Estados que puede tener la venta a la que se vincula un cambio. */
export type EstadoVentaOriginal = "COMPLETADA" | "PENDIENTE_PAGO" | "ANULADA";

/** Un detalle de la venta original: lo necesario para validar la cantidad y tomar el precio vendido. */
export type DetalleVentaLeido = {
  idProducto: number;
  /** Cantidad vendida. */
  cantidad: Decimal;
  /** Precio unitario congelado en la venta, en pesos. */
  precioUnitario: Decimal;
};

/** Venta original leída para vincular un cambio, con sus detalles ordenados por `idDetalle`. */
export type VentaOriginalLeida = {
  idVenta: number;
  estado: EstadoVentaOriginal;
  detalles: DetalleVentaLeido[];
};

/** Medio de pago leído para el saldo: solo importa que exista y esté activo (el cambio no aplica recargo ni descuento). */
export type MedioPagoParaCambio = {
  idMedioPago: number;
  activo: boolean;
};

/**
 * Todo lo que el repository lee dentro de la transacción y entrega al cálculo puro.
 * Un recurso `null` significa que no existe (el cálculo decide el 404); `ventaOriginal` y `medioPago`
 * también son `null` si el body no los pidió.
 */
export type LecturaCambio = {
  devuelto: ProductoParaCambio | null;
  entregado: ProductoParaCambio | null;
  ventaOriginal: VentaOriginalLeida | null;
  /** Suma de lo devuelto en cambios ACTIVO de esa venta y ese producto; 0 si no hay ticket. */
  cantidadYaDevuelta: Decimal;
  medioPago: MedioPagoParaCambio | null;
};

// --- RESULTADO DEL CÁLCULO ---

/** Resultado completo de `calcularCambio`, listo para persistir. */
export type CambioCalculado = {
  cantidadDevuelta: Decimal;
  /** Producto que recibe el ingreso: el mismo devuelto, o su granel si es bolsa abierta. */
  idProductoStockIngresado: number;
  /** Unidades del producto ingresado, o kilos si ingresa a granel. */
  cantidadStockIngresado: Decimal;
  precioUnitarioDevuelto: Decimal;
  cantidadEntregada: Decimal;
  precioUnitarioEntregado: Decimal;
  costoUnitarioEntregado: Decimal;
  /** Diferencia a favor del local: nunca negativa (no hay reembolsos). */
  saldo: Decimal;
  /** Nulo si el saldo es 0. */
  idMedioPago: number | null;
};

// --- DATOS PERSISTIDOS Y RESPUESTA HTTP ---

/** Datos del cambio ya guardado que necesita el service para armar la respuesta. */
export type CambioPersistido = CambioCalculado & {
  idCambio: number;
  fechaHora: Date;
  idVentaOriginal: number | null;
  idProductoDevuelto: number;
  esBolsaAbierta: boolean;
  idProductoEntregado: number;
};

/** Respuesta exitosa de `POST /api/cambios-mercaderia`. Montos como texto con 2 decimales, cantidades con 3. */
export type RegistrarCambioResponse = {
  exito: true;
  mensaje: string;
  cambio: {
    idCambio: number;
    /** Fecha y hora en formato ISO 8601. */
    fechaHora: string;
    estado: "ACTIVO";
    idVentaOriginal: number | null;
    idProductoDevuelto: number;
    cantidadDevuelta: string;
    esBolsaAbierta: boolean;
    precioUnitarioDevuelto: string;
    idProductoStockIngresado: number;
    /** Unidades del producto ingresado, o kilos si `esBolsaAbierta`. */
    cantidadStockIngresado: string;
    idProductoEntregado: number;
    cantidadEntregada: string;
    precioUnitarioEntregado: string;
    saldoResultante: string;
    idMedioPago: number | null;
  };
};

// --- HISTORIAL DE CAMBIOS: ENTRADA Y FILTRO ---

/** Query validada de `GET /api/cambios-mercaderia`, inferida del esquema Zod (ya con valores por defecto aplicados). */
export type ConsultarHistorialCambiosInput = z.infer<typeof consultarHistorialCambiosSchema>;

/** Estados consultables en el historial de cambios. */
export type EstadoCambioHistorial = (typeof ESTADOS_CAMBIO_HISTORIAL)[number];

/** Vínculos filtrables: con venta original (`VINCULADO`) o sin ella (`DESVINCULADO`). */
export type VinculoCambioHistorial = (typeof VINCULOS_CAMBIO_HISTORIAL)[number];

/** Filtros del historial ya traducidos a valores listos para consultar. Todos se combinan con AND. */
export type FiltroHistorialCambios = {
  /** Límite inferior inclusivo: 00:00 (hora de Argentina) del día `fechaDesde`. */
  fechaDesdeInclusiva?: Date;
  /** Límite superior exclusivo: 00:00 (hora de Argentina) del día siguiente a `fechaHasta`. */
  fechaHastaExclusiva?: Date;
  /** Solo cambios cuyo producto devuelto o entregado es este. */
  idProducto?: number;
  estado?: EstadoCambioHistorial;
  vinculo?: VinculoCambioHistorial;
  /** Solo cambios cuyo saldo se cobró con este medio; los de saldo 0 (sin medio) nunca coinciden. */
  idMedioPago?: number;
};

// --- HISTORIAL DE CAMBIOS: DATOS DE LA BASE ---
// Cantidades y saldo como Decimal exacto, como el resto del módulo.

/** Fila del historial tal como la entrega el repositorio: solo las columnas de la grilla. */
export type FilaHistorialCambio = {
  idCambio: number;
  fechaHora: Date;
  estado: EstadoCambioHistorial;
  idVentaOriginal: number | null;
  /** Nulo sin venta original, o si la venta es anterior al backfill del comprobante. */
  numeroComprobanteVentaOriginal: string | null;
  idProductoDevuelto: number;
  /** Nombre vigente del producto (no se congela en el cambio). */
  nombreProductoDevuelto: string;
  formatoVentaProductoDevuelto: FormatoVenta;
  cantidadDevuelta: Decimal;
  esBolsaAbierta: boolean;
  /**
   * Lo que entró al stock: unidades si no es bolsa abierta (el alta guarda la cantidad devuelta) o kilos si lo es.
   * Se tipa con nulo por defensa: la columna es NOT NULL, así que hoy el repositorio siempre entrega un número.
   */
  cantidadStockIngresado: Decimal | null;
  idProductoEntregado: number;
  nombreProductoEntregado: string;
  formatoVentaProductoEntregado: FormatoVenta;
  cantidadEntregada: Decimal;
  saldoResultante: Decimal;
  idMedioPago: number | null;
  /** Nombre vigente del medio de pago; nulo si el cambio no tuvo saldo. */
  nombreMedioPago: string | null;
};

/** Una página de filas más el total de registros que cumplen el filtro (sin paginar). */
export type PaginaHistorialCambios = {
  filas: FilaHistorialCambio[];
  totalRegistros: number;
};

// --- HISTORIAL DE CAMBIOS: RESPUESTA HTTP ---

/** Fila de la grilla de historial en la respuesta. Cantidades como texto con 3 decimales y saldo con 2. */
export type CambioHistorial = {
  idCambio: number;
  /** Fecha y hora en formato ISO 8601. */
  fechaHora: string;
  estado: EstadoCambioHistorial;
  /**
   * Hasta cuándo se puede anular o editar (ISO 8601): `fechaHora` más `LIMITE_MINUTOS_ANULACION`.
   * Nulo si el cambio está anulado: ya no tiene ventana.
   */
  fechaHoraLimiteModificacion: string | null;
  idVentaOriginal: number | null;
  numeroComprobanteVentaOriginal: string | null;
  idProductoDevuelto: number;
  nombreProductoDevuelto: string;
  formatoVentaProductoDevuelto: FormatoVenta;
  cantidadDevuelta: string;
  esBolsaAbierta: boolean;
  /** Kilos que ingresaron al granel si es bolsa abierta; nulo en caso contrario. */
  cantidadStockIngresado: string | null;
  idProductoEntregado: number;
  nombreProductoEntregado: string;
  formatoVentaProductoEntregado: FormatoVenta;
  cantidadEntregada: string;
  saldoResultante: string;
  idMedioPago: number | null;
  nombreMedioPago: string | null;
};

/** Respuesta exitosa de `GET /api/cambios-mercaderia`. Una página fuera de rango devuelve `cambios` vacío. */
export type ConsultarHistorialCambiosResponse = {
  exito: true;
  /** Hora del servidor al responder (ISO 8601): el front la compara con `fechaHoraLimiteModificacion`. */
  fechaHoraServidor: string;
  cambios: CambioHistorial[];
  paginacion: PaginacionHistorial;
};

// --- DETALLE DE UN CAMBIO: ENTRADA ---

/** Parámetro de ruta validado de `GET /api/cambios-mercaderia/:idCambio`, inferido del esquema Zod. */
export type ConsultarCambioInput = z.infer<typeof consultarCambioSchema>;

// --- DETALLE DE UN CAMBIO: DATOS DE LA BASE ---
// Cantidades e importes como Decimal exacto; las fechas, como `Date`.

/** Persona de una auditoría o del registro del cambio: quien lo cargó o quien lo anuló. */
export type UsuarioCambio = {
  idUsuario: number;
  nombre: string;
};

/** Cambio completo tal como lo entrega el repositorio: sin cálculos, solo lo que está guardado y los nombres vigentes. */
export type CambioDetalleLeido = {
  idCambio: number;
  fechaHora: Date;
  estado: EstadoCambioHistorial;
  /** Nulo en los cambios anteriores a que se registrara el motivo. */
  motivoCambio: string | null;
  /** Venta a la que se vinculó el cambio; nulo si es un cambio aislado. */
  ventaOriginal: {
    idVenta: number;
    /** Nulo solo en datos anteriores al backfill del comprobante. */
    numeroComprobante: string | null;
  } | null;
  productoDevuelto: {
    idProducto: number;
    nombre: string;
    formatoVenta: FormatoVenta;
    cantidadDevuelta: Decimal;
    esBolsaAbierta: boolean;
    /** Precio unitario congelado al registrar el cambio; con bolsa abierta es el precio de la bolsa. */
    precioUnitario: Decimal;
  };
  /** Producto que recibió el stock: el devuelto, o su granel si fue bolsa abierta. La columna es NOT NULL. */
  productoStockIngresado: {
    idProducto: number;
    nombre: string;
    /** Unidades del producto ingresado, o kilos si ingresó a granel. */
    cantidadStockIngresado: Decimal;
  };
  productoEntregado: {
    idProducto: number;
    nombre: string;
    formatoVenta: FormatoVenta;
    cantidadEntregada: Decimal;
    /** Precio unitario congelado al registrar el cambio. */
    precioUnitario: Decimal;
  };
  saldoResultante: Decimal;
  /** Nulo si el cambio no tuvo saldo que cobrar. */
  medioPago: { idMedioPago: number; nombre: string } | null;
  /** Solo efectivo con monto recibido informado; nulo en otro caso y en cambios anteriores. */
  montoRecibido: Decimal | null;
  vuelto: Decimal | null;
  vendedor: UsuarioCambio;
  /** Nulo mientras el cambio no esté anulado o si se anuló antes de que se registrara la auditoría. */
  anulacion: { fechaHora: Date; usuario: UsuarioCambio; motivo: string } | null;
};

// --- DETALLE DE UN CAMBIO: RESPUESTA HTTP ---

/** Artículo devuelto en la respuesta del detalle. Cantidad con 3 decimales e importes con 2, como texto. */
export type ArticuloDevueltoDetalle = {
  idProducto: number;
  nombreProducto: string;
  formatoVenta: FormatoVenta;
  cantidadDevuelta: string;
  esBolsaAbierta: boolean;
  /** Precio unitario congelado al registrar el cambio; con bolsa abierta es el precio de la bolsa. */
  precioUnitario: string;
  /** Crédito del devuelto; con bolsa abierta, el de la fracción de bolsa que se devolvió. */
  subtotal: string;
};

/** Artículo entregado en la respuesta del detalle. Cantidad con 3 decimales e importes con 2, como texto. */
export type ArticuloEntregadoDetalle = {
  idProducto: number;
  nombreProducto: string;
  formatoVenta: FormatoVenta;
  cantidadEntregada: string;
  /** Precio unitario congelado al registrar el cambio. */
  precioUnitario: string;
  /** Valor de lo entregado: precio unitario × cantidad, redondeado a centavos. */
  subtotal: string;
};

/**
 * Cambio completo de `GET /api/cambios-mercaderia/:idCambio` y del `POST`.
 * Cantidades como texto con 3 decimales e importes como texto con 2.
 */
export type CambioDetalle = {
  idCambio: number;
  /** Fecha y hora en formato ISO 8601. */
  fechaHora: string;
  estado: EstadoCambioHistorial;
  /** Hasta cuándo se puede anular o editar (ISO 8601); nulo si el cambio está anulado. */
  fechaHoraLimiteModificacion: string | null;
  /** Nulo en los cambios anteriores a que se registrara el motivo. */
  motivoCambio: string | null;
  /** Nulo si el cambio es aislado. */
  ventaVinculada: { idVenta: number; numeroComprobante: string | null } | null;
  articuloDevuelto: ArticuloDevueltoDetalle;
  /** Producto que recibió el stock: el devuelto, o su granel si fue bolsa abierta. */
  productoStockIngresado: {
    idProducto: number;
    nombreProducto: string;
    /** Kilos que ingresaron al granel si fue bolsa abierta; nulo en otro caso. */
    cantidadStockIngresado: string | null;
  };
  articuloEntregado: ArticuloEntregadoDetalle;
  /** Crédito del producto devuelto: igual al subtotal del devuelto. */
  valorDevuelto: string;
  /** Valor de lo entregado: igual al subtotal del entregado. */
  valorEntregado: string;
  saldoResultante: string;
  /** Nulo si el cambio no tuvo saldo que cobrar. */
  pagoSaldo: {
    idMedioPago: number;
    nombreMedioPago: string;
    /** Solo efectivo con monto recibido informado. */
    montoRecibido: string | null;
    vuelto: string | null;
  } | null;
  vendedor: UsuarioCambio;
  /** Nulo mientras el cambio no esté anulado o si se anuló antes de que se registrara la auditoría. */
  anulacion: { fechaHora: string; usuario: UsuarioCambio; motivo: string } | null;
};

/** Respuesta exitosa de `GET /api/cambios-mercaderia/:idCambio`. */
export type ConsultarCambioResponse = {
  exito: true;
  /** Hora del servidor al responder (ISO 8601): el front la compara con `fechaHoraLimiteModificacion`. */
  fechaHoraServidor: string;
  cambio: CambioDetalle;
};
