import { buscarProductosActivos } from "./inventario.repository.js";
import type {
  ConsultarProductosInput,
  ConsultarProductosResponse,
  ProductoCatalogo,
  ProductoLeido,
} from "./inventario.types.js";

// --- FUNCIONES AUXILIARES ---

/** Convierte un producto leído de la BD al formato de respuesta, con los montos como texto exacto. */
function convertirProducto(producto: ProductoLeido): ProductoCatalogo {
  return {
    idProducto: producto.idProducto,
    nombre: producto.nombre,
    // toFixed del decimal evita pasar por number y perder exactitud
    precioVenta: producto.precioVenta.toFixed(2),
    stockFisico: producto.stockFisico.toFixed(3),
    formatoVenta: producto.formatoVenta,
  };
}

// --- CONSULTA DE PRODUCTOS ---

/**
 * Busca productos activos para el carrito de Alta Venta.
 * No filtra por stock: esa validación la hace el alta de venta.
 * @param consulta Query ya validada por Zod.
 * @returns La lista de coincidencias; vacía si no hay ninguna.
 */
export async function buscarProductos(consulta: ConsultarProductosInput): Promise<ConsultarProductosResponse> {
  // Una búsqueda vacía tras el trim equivale a no buscar: se devuelve el catálogo completo
  const busqueda = consulta.busqueda === "" ? undefined : consulta.busqueda;

  const productos = await buscarProductosActivos(busqueda);

  return { exito: true, productos: productos.map(convertirProducto) };
}
