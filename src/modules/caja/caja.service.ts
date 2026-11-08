import { listarMediosPagoActivos } from "./caja.repository.js";
import type { ListarMediosPagoResponse, MedioPagoDisponible, MedioPagoLeido } from "./caja.types.js";

// --- FUNCIONES AUXILIARES ---

/** Convierte un medio de pago leído de la BD al formato de respuesta, con los porcentajes como texto exacto. */
function convertirMedioPago(medioPago: MedioPagoLeido): MedioPagoDisponible {
  return {
    idMedioPago: medioPago.idMedioPago,
    nombre: medioPago.nombre,
    tipo: medioPago.tipo,
    // toFixed del decimal evita pasar por number y perder exactitud
    porcentajeRecargo: medioPago.porcentajeRecargo.toFixed(2),
    porcentajeDescuento: medioPago.porcentajeDescuento.toFixed(2),
  };
}

// --- CONSULTA DE MEDIOS DE PAGO ---

/**
 * Lista los medios de pago activos para el alta de venta y la liquidación de fiados.
 * No agrega ni filtra por nombre: "Fiado" no es un medio de pago.
 * @returns Los medios activos ordenados por id.
 */
export async function listarMediosPago(): Promise<ListarMediosPagoResponse> {
  const mediosPago = await listarMediosPagoActivos();

  return { exito: true, mediosPago: mediosPago.map(convertirMedioPago) };
}
