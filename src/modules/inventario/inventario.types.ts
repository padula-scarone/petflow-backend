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

/** Producto activo tal como lo lee el repository, con solo los campos del contrato. */
export type ProductoLeido = {
  idProducto: number;
  nombre: string;
  precioVenta: DecimalExacto;
  stockFisico: DecimalExacto;
  formatoVenta: FormatoVenta;
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
};

/** Cuerpo de la respuesta 200 de `GET /api/productos`. */
export type ConsultarProductosResponse = {
  exito: true;
  productos: ProductoCatalogo[];
};
