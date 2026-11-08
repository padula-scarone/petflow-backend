import { prisma } from "../../shared/prisma.js";
import type { MedioPagoLeido } from "./caja.types.js";

// --- CONSULTA DE MEDIOS DE PAGO ---

/**
 * Lee los medios de pago activos.
 * Es la única capa del módulo que toca Prisma. Solo lectura: no usa transacción.
 * @returns Los medios ordenados por id ascendente.
 */
export async function listarMediosPagoActivos(): Promise<MedioPagoLeido[]> {
  return prisma.medioPago.findMany({
    where: { estado: "ACTIVO" },
    // Select explícito: solo lo que necesita el front para ofrecer y calcular el medio
    select: {
      idMedioPago: true,
      nombre: true,
      tipo: true,
      porcentajeRecargo: true,
      porcentajeDescuento: true,
    },
    orderBy: { idMedioPago: "asc" },
  });
}
