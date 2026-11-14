import { prisma } from "../../shared/prisma.js";
import type { ProductoLeido } from "./inventario.types.js";

// --- CONSULTA DE PRODUCTOS ---

/**
 * Lee los productos activos, con filtro opcional por nombre.
 * Es la única capa del módulo que toca Prisma. Solo lectura: no usa transacción.
 *
 * Sobre `%` y `_` en `busqueda`: verificado contra la BD, `contains` NO los escapa. Actúan como
 * comodines de LIKE y no como texto literal (buscar "%" devuelve todos los productos activos).
 * Se deja así a propósito, sin escapar; la búsqueda tampoco normaliza acentos.
 *
 * @param busqueda Texto a buscar dentro de `nombre`, sin distinguir mayúsculas; `undefined` devuelve todos los activos.
 * @returns Los productos ordenados por nombre y, ante empate, por id (ambos ascendentes).
 */
export async function buscarProductosActivos(busqueda: string | undefined): Promise<ProductoLeido[]> {
  return prisma.producto.findMany({
    where: {
      estado: "ACTIVO",
      // Sin condición de nombre cuando no hay búsqueda: se devuelve todo el catálogo activo
      ...(busqueda !== undefined && { nombre: { contains: busqueda, mode: "insensitive" } }),
    },
    // Select explícito: payload liviano y sin exponer costo ni código de barras.
    // La categoría trae solo su nombre vigente, en la misma consulta (sin N+1).
    // El peso y el granel asociado (id y nombre vigente) salen en la respuesta y además deciden `permiteBolsaAbierta`
    select: {
      idProducto: true,
      nombre: true,
      categoria: { select: { nombre: true } },
      precioVenta: true,
      stockFisico: true,
      formatoVenta: true,
      pesoUnitario: true,
      idProductoGranel: true,
      productoGranel: { select: { nombre: true, formatoVenta: true, estado: true } },
    },
    // El id desempata para que el orden sea estable entre consultas
    orderBy: [{ nombre: "asc" }, { idProducto: "asc" }],
  });
}
