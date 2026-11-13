import { buscarProductosActivos } from "./inventario.repository.js";
import type {
  ConsultarProductosInput,
  ConsultarProductosResponse,
  DecimalExacto,
  ProductoCatalogo,
  ProductoLeido,
  ProductoParaBolsaAbierta,
} from "./inventario.types.js";

// --- REGLA DE BOLSA ABIERTA ---

/**
 * Evalúa si un producto admite devolverse como bolsa abierta (su contenido se suma al granel).
 * Es la única implementación de la regla: el catálogo y el alta de cambios la comparten para no divergir.
 * Es pura a propósito: no accede a la base de datos.
 * @param producto Producto con su formato, su peso unitario y su granel asociado.
 * @returns `null` si la admite; si no, el motivo, redactado para completar "no admite bolsa abierta: ...".
 */
export function evaluarBolsaAbierta(producto: ProductoParaBolsaAbierta): string | null {
  if (producto.formatoVenta !== "UNIDAD") {
    return "se vende a granel";
  }
  if (producto.productoGranel === null) {
    return "no tiene un producto a granel asociado";
  }
  if (producto.productoGranel.formatoVenta !== "GRANEL") {
    return "su producto a granel asociado no se vende a granel";
  }
  if (!producto.productoGranel.activo) {
    return "su producto a granel asociado está inactivo";
  }
  // Sin peso no se sabe cuántos kilos sumar al granel
  if (producto.pesoUnitarioMilesimas === null || producto.pesoUnitarioMilesimas <= 0) {
    return "no tiene peso unitario cargado";
  }
  return null;
}

/** Indica si un producto admite bolsa abierta; es `evaluarBolsaAbierta` sin el motivo. */
export function permiteBolsaAbierta(producto: ProductoParaBolsaAbierta): boolean {
  return evaluarBolsaAbierta(producto) === null;
}

// --- FUNCIONES AUXILIARES ---

/**
 * Convierte un decimal exacto de 3 decimales a milésimas enteras sin pasar por `number` decimal.
 * @example convertirAMilesimas(decimal("3.000")) // 3000
 */
function convertirAMilesimas(valor: DecimalExacto): number {
  return Number(valor.toFixed(3).replace(".", ""));
}

/** Convierte un producto leído de la BD al formato de respuesta, con los montos como texto exacto. */
function convertirProducto(producto: ProductoLeido): ProductoCatalogo {
  return {
    idProducto: producto.idProducto,
    nombre: producto.nombre,
    // toFixed del decimal evita pasar por number y perder exactitud
    precioVenta: producto.precioVenta.toFixed(2),
    stockFisico: producto.stockFisico.toFixed(3),
    formatoVenta: producto.formatoVenta,
    permiteBolsaAbierta: permiteBolsaAbierta({
      formatoVenta: producto.formatoVenta,
      pesoUnitarioMilesimas: producto.pesoUnitario === null ? null : convertirAMilesimas(producto.pesoUnitario),
      productoGranel:
        producto.productoGranel === null
          ? null
          : { formatoVenta: producto.productoGranel.formatoVenta, activo: producto.productoGranel.estado === "ACTIVO" },
    }),
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
