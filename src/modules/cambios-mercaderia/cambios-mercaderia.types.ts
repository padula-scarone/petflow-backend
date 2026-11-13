import type { z } from "zod";
import type { FormatoVenta, ProductoGranelAsociado } from "../inventario/inventario.types.js";
import type { registrarCambioSchema } from "./cambios-mercaderia.schemas.js";

// --- TIPOS DE ENTRADA ---

/** Cuerpo validado de `POST /api/cambios-mercaderia`, inferido del esquema Zod. No incluye al usuario: sale del token. */
export type RegistrarCambioCuerpo = z.infer<typeof registrarCambioSchema>;

/** Entrada completa del alta: el cuerpo del request más el usuario, que viene del token ya verificado. */
export type RegistrarCambioInput = RegistrarCambioCuerpo & {
  /** Usuario de la sesión; nunca se toma del body. */
  idUsuario: number;
};

// --- DATOS LEÍDOS DE LA BASE ---
// Montos en centavos (enteros) y cantidades en milésimas (enteras): así no hay errores de coma flotante.

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
  /** Precio de venta actual, en centavos. */
  precioCentavos: number;
  /** Costo actual, en centavos. Se congela en el cambio solo si el producto es el entregado. */
  costoCentavos: number;
  /** Kilos por unidad, en milésimas; nulo si no está cargado. */
  pesoUnitarioMilesimas: number | null;
  /** Producto GRANEL asociado; nulo si el producto no lo tiene. */
  productoGranel: ProductoGranelParaCambio | null;
};

/** Estados que puede tener la venta a la que se vincula un cambio. */
export type EstadoVentaOriginal = "COMPLETADA" | "PENDIENTE_PAGO" | "ANULADA";

/** Un detalle de la venta original: lo necesario para validar la cantidad y tomar el precio vendido. */
export type DetalleVentaLeido = {
  idProducto: number;
  /** Cantidad vendida, en milésimas. */
  cantidadMilesimas: number;
  /** Precio unitario congelado en la venta, en centavos. */
  precioUnitarioCentavos: number;
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
  /** Suma de lo devuelto en cambios ACTIVO de esa venta y ese producto, en milésimas; 0 si no hay ticket. */
  cantidadYaDevueltaMilesimas: number;
  medioPago: MedioPagoParaCambio | null;
};

// --- RESULTADO DEL CÁLCULO ---

/** Resultado completo de `calcularCambio`, listo para persistir. */
export type CambioCalculado = {
  cantidadDevueltaMilesimas: number;
  /** Producto que recibe el ingreso: el mismo devuelto, o su granel si es bolsa abierta. */
  idProductoStockIngresado: number;
  /** Unidades del producto ingresado, o kilos si ingresa a granel. */
  cantidadStockIngresadoMilesimas: number;
  precioUnitarioDevueltoCentavos: number;
  cantidadEntregadaMilesimas: number;
  precioUnitarioEntregadoCentavos: number;
  costoUnitarioEntregadoCentavos: number;
  /** Diferencia a favor del local: nunca negativa (no hay reembolsos). */
  saldoCentavos: number;
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
