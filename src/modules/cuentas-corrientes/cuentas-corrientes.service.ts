import { Decimal, redondearAMoneda } from "../../shared/decimal.js";
import { calcularHoyArgentina } from "../../shared/fecha-argentina.js";
import { calcularImporteAdeudado } from "../../shared/importe-adeudado.js";
import { crearErrorDeudorNoEncontrado } from "../deudores/deudores.errors.js";
import { calcularDesplazamiento, calcularTotalPaginas } from "../ventas/ventas.service.js";
import { buscarEstadoCuentaDeudor, buscarPaginaCuentasCorrientes } from "./cuentas-corrientes.repository.js";
import type {
  ConsultarCuentasCorrientesInput,
  ConsultarCuentasCorrientesResponse,
  ConsultarEstadoCuentaInput,
  CuentaCorrienteListada,
  EstadoCuentaLeido,
  EstadoCuentaResponse,
  FilaCuentaCorriente,
  FiadoDeEstadoCuenta,
  FiadoLeido,
  FiltroCuentasCorrientes,
} from "./cuentas-corrientes.types.js";

// --- UTILIDADES ---

/** Convierte un importe exacto a texto con 2 decimales (la mitad hacia arriba). */
function formatearImporte(importe: Decimal): string {
  return redondearAMoneda(importe).toFixed(2);
}

// --- LISTADO DE DEUDORES CON SALDO ---

/**
 * Traduce la query al filtro del repository. Un texto vacío tras el recorte equivale a no filtrar
 * (el front lo manda así cuando el campo está limpio), igual que `textoCliente` en el historial de ventas.
 */
export function calcularFiltroCuentasCorrientes(consulta: ConsultarCuentasCorrientesInput): FiltroCuentasCorrientes {
  return {
    incluirSinDeuda: consulta.incluirSinDeuda,
    ...(consulta.texto !== undefined && consulta.texto !== "" ? { texto: consulta.texto } : {}),
  };
}

/** Convierte un deudor con saldo al formato de la respuesta: el saldo como texto con 2 decimales. */
function convertirFilaCuentaCorriente(fila: FilaCuentaCorriente): CuentaCorrienteListada {
  return {
    idDeudor: fila.idDeudor,
    nombreCompleto: fila.nombreCompleto,
    dni: fila.dni,
    saldo: formatearImporte(fila.saldo),
    cantidadFiadosPendientes: fila.cantidadFiadosPendientes,
  };
}

/**
 * Consulta una página del listado de deudores con su saldo.
 * El saldo, el filtro de saldo, el orden y la paginación los resuelve el repository en la base; acá solo se arma la respuesta.
 * @param consulta Query ya validada por Zod (con los valores por defecto aplicados).
 * @returns Los deudores de la página y los metadatos de paginación. Una página fuera de rango devuelve lista vacía.
 */
export async function consultarCuentasCorrientes(
  consulta: ConsultarCuentasCorrientesInput,
): Promise<ConsultarCuentasCorrientesResponse> {
  const filtro = calcularFiltroCuentasCorrientes(consulta);
  const desplazamiento = calcularDesplazamiento(consulta.pagina, consulta.cantidadPorPagina);

  const paginaEncontrada = await buscarPaginaCuentasCorrientes(filtro, desplazamiento, consulta.cantidadPorPagina);

  return {
    exito: true,
    cuentasCorrientes: paginaEncontrada.filas.map(convertirFilaCuentaCorriente),
    paginacion: {
      pagina: consulta.pagina,
      cantidadPorPagina: consulta.cantidadPorPagina,
      totalRegistros: paginaEncontrada.totalRegistros,
      totalPaginas: calcularTotalPaginas(paginaEncontrada.totalRegistros, consulta.cantidadPorPagina),
    },
  };
}

// --- ESTADO DE CUENTA: CÁLCULO PURO ---

/**
 * Calcula lo que debe un fiado: importe adeudado, ya pagado y lo que falta, con decimal exacto.
 * @param fiado Fiado pendiente leído de la base.
 * @returns Los tres importes como `Decimal` (sin formatear); el llamador suma los `falta` para el saldo.
 */
export function calcularImportesFiado(fiado: FiadoLeido): { importeAdeudado: Decimal; yaPagado: Decimal; falta: Decimal } {
  // Misma regla que usa el cobro de un fiado (función compartida): subtotal bruto menos descuento manual
  const importeAdeudado = calcularImporteAdeudado(fiado.subtotalBruto, fiado.descuentoManual);
  // Sin cobros la suma es 0 (todavía no hay pagos parciales registrados)
  const yaPagado = fiado.montosCobrados.reduce((suma, monto) => suma.plus(monto), new Decimal(0));
  return { importeAdeudado, yaPagado, falta: importeAdeudado.minus(yaPagado) };
}

/**
 * Indica si un fiado está vencido: tiene fecha estimada de pago, esa fecha es anterior a hoy y todavía falta pagar algo.
 * Hoy no cuenta como vencido. La comparación de texto equivale a la cronológica porque el formato es `AAAA-MM-DD`.
 * Es solo informativo: no cambia cobros, saldo ni estados.
 * @param fechaEstimadaPago Fecha estimada (`AAAA-MM-DD`) o `null` si el fiado no la tiene.
 * @param hoy Fecha de hoy en Argentina (`AAAA-MM-DD`).
 * @param falta Lo que falta pagar del fiado.
 */
export function calcularVencido(fechaEstimadaPago: string | null, hoy: string, falta: Decimal): boolean {
  return fechaEstimadaPago !== null && fechaEstimadaPago < hoy && falta.gt(0);
}

/**
 * Arma el estado de cuenta de un deudor a partir de lo leído, sin acceder a la base ni al reloj (es pura a propósito).
 * El saldo es la suma de los `falta` de las mismas filas que se devuelven: coincide por construcción, sin segunda consulta.
 * Orden de reglas: primero que el deudor exista (404) y después el cálculo. Los fiados mantienen el orden del repository
 * (del más viejo al más nuevo).
 * @param idDeudor Id pedido (para el mensaje del 404).
 * @param leido Deudor (o `null` si no existe) y sus fiados pendientes.
 * @param ahora Instante actual del servidor: define qué día es "hoy" en Argentina para marcar los fiados vencidos.
 * @throws {ErrorNegocioDeudor} 404 `DEUDOR_NO_ENCONTRADO` si el deudor no existe. Se lanza como objeto puro, no como Error.
 */
export function calcularEstadoCuenta(idDeudor: number, leido: EstadoCuentaLeido, ahora: Date): EstadoCuentaResponse {
  if (leido.deudor === null) {
    throw crearErrorDeudorNoEncontrado(idDeudor);
  }

  const hoy = calcularHoyArgentina(ahora);
  let saldo = new Decimal(0);

  const fiados = leido.fiados.map((fiado): FiadoDeEstadoCuenta => {
    const { importeAdeudado, yaPagado, falta } = calcularImportesFiado(fiado);
    saldo = saldo.plus(falta);
    return {
      idVenta: fiado.idVenta,
      numeroComprobante: fiado.numeroComprobante,
      fechaHora: fiado.fechaHora.toISOString(),
      fechaEstimadaPago: fiado.fechaEstimadaPago,
      vencido: calcularVencido(fiado.fechaEstimadaPago, hoy, falta),
      importeAdeudado: formatearImporte(importeAdeudado),
      yaPagado: formatearImporte(yaPagado),
      falta: formatearImporte(falta),
    };
  });

  return { exito: true, deudor: leido.deudor, saldo: formatearImporte(saldo), fiados };
}

// --- ESTADO DE CUENTA: ORQUESTACIÓN ---

/**
 * Consulta el estado de cuenta de un deudor: sus fiados pendientes con lo que falta pagar de cada uno y el saldo.
 * Solo lectura. El reloj se toma después de leer (lo más cercano al momento en que el front recibe la respuesta).
 * @param entrada Parámetro de ruta ya validado por Zod.
 * @throws {ErrorNegocioDeudor} 404 `DEUDOR_NO_ENCONTRADO` si el deudor no existe.
 */
export async function consultarEstadoCuenta(entrada: ConsultarEstadoCuentaInput): Promise<EstadoCuentaResponse> {
  const leido = await buscarEstadoCuentaDeudor(entrada.idDeudor);
  return calcularEstadoCuenta(entrada.idDeudor, leido, new Date());
}
