import type { z } from "zod";
import type { consultarProductosSchema } from "./inventario.schemas.js";

// --- TIPOS DE ENTRADA ---

/** Query validada de `GET /api/productos`, inferida del esquema Zod. */
export type ConsultarProductosInput = z.infer<typeof consultarProductosSchema>;

// --- DATOS LEÍDOS DE LA BASE ---

/**
 * Decimal exacto de la BD (el `Decimal` de Prisma lo cumple de forma estructural).
 * Se declara aquí para que el service formatee sin importar Prisma ni pasar por `number`.
 */
export type DecimalExacto = {
  /** Texto con exactamente `decimales` posiciones decimales. */
  toFixed(decimales: number): string;
};

/** Cómo se vende un producto: por unidad entera o a granel (admite decimales). */
export type FormatoVenta = "UNIDAD" | "GRANEL";

/** Producto GRANEL asociado a un producto por unidad, tal como lo lee el repository. */
export type ProductoGranelLeido = {
  formatoVenta: FormatoVenta;
  estado: "ACTIVO" | "INACTIVO";
};

/** Producto activo tal como lo lee el repository, con solo los campos del contrato y los de la regla de bolsa abierta. */
export type ProductoLeido = {
  idProducto: number;
  nombre: string;
  precioVenta: DecimalExacto;
  stockFisico: DecimalExacto;
  formatoVenta: FormatoVenta;
  /** Kilos por unidad; nulo si no aplica o no está cargado. No se expone: solo alimenta `permiteBolsaAbierta`. */
  pesoUnitario: DecimalExacto | null;
  /** Producto GRANEL al que se suma una bolsa abierta; nulo si no tiene. */
  productoGranel: ProductoGranelLeido | null;
};

// --- REGLA DE BOLSA ABIERTA ---

/** Producto GRANEL asociado, reducido a lo que decide la regla de bolsa abierta. */
export type ProductoGranelAsociado = {
  formatoVenta: FormatoVenta;
  activo: boolean;
};

/**
 * Datos de un producto que decide si admite bolsa abierta.
 * La regla es compartida: la usan el catálogo (`permiteBolsaAbierta`) y el alta de un cambio de mercadería.
 */
export type ProductoParaBolsaAbierta = {
  formatoVenta: FormatoVenta;
  /** Kilos por unidad, en milésimas; nulo si no está cargado. */
  pesoUnitarioMilesimas: number | null;
  /** Producto GRANEL asociado; nulo si el producto no tiene `idProductoGranel`. */
  productoGranel: ProductoGranelAsociado | null;
};

// --- TIPOS DE SALIDA ---

/** Producto del catálogo que se expone al carrito. Los montos van como texto exacto. */
export type ProductoCatalogo = {
  idProducto: number;
  nombre: string;
  /** Precio vigente, texto con 2 decimales. */
  precioVenta: string;
  /** Stock disponible, texto con 3 decimales. */
  stockFisico: string;
  formatoVenta: FormatoVenta;
  /** Si el producto admite devolverse como bolsa abierta en un cambio de mercadería (ver `evaluarBolsaAbierta`). */
  permiteBolsaAbierta: boolean;
};

/** Cuerpo de la respuesta 200 de `GET /api/productos`. */
export type ConsultarProductosResponse = {
  exito: true;
  productos: ProductoCatalogo[];
};
