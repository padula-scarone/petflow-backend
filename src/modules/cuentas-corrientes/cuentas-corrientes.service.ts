import { Decimal, redondearAMoneda } from "../../shared/decimal.js";
import { calcularDomingoDeLaSemana, calcularHoyArgentina } from "../../shared/fecha-argentina.js";
import { calcularImporteAdeudado } from "../../shared/importe-adeudado.js";
import { crearErrorDeudorNoEncontrado } from "../deudores/deudores.errors.js";
import {
  adjuntarMontoRecibidoYVuelto,
  calcularDesplazamiento,
  calcularPagosVenta,
  calcularTotalPaginas,
  formatearBasisPoints,
  formatearCentavos,
} from "../ventas/ventas.service.js";
import {
  crearErrorCobroNoEncontrado,
  crearErrorFiadoNoEncontrado,
  crearErrorFiadoNoPendiente,
  crearErrorMontoExcedeFalta,
} from "./cuentas-corrientes.errors.js";
import {
  buscarCobroPorId,
  buscarEstadoCuentaDeudor,
  buscarPaginaCuentasCorrientes,
  registrarCobroAtomico,
} from "./cuentas-corrientes.repository.js";
import { SENTIDO_ORDEN_PREDETERMINADO } from "./cuentas-corrientes.schemas.js";
import type {
  CobroCalculado,
  CobroLeido,
  CobroRegistrado,
  ConsultarCobroInput,
  ConsultarCobroResponse,
  ConsultarCuentasCorrientesInput,
  ConsultarCuentasCorrientesResponse,
  ConsultarEstadoCuentaInput,
  CuentaCorrienteListada,
  EstadoCuentaLeido,
  EstadoCuentaResponse,
  FilaCuentaCorriente,
  FiadoCobrado,
  FiadoCobradoCalculado,
  FiadoDeEstadoCuenta,
  FiadoDeRecibo,
  FiadoLeido,
  FiltroCuentasCorrientes,
  FiltroProximoPago,
  LecturaCobro,
  OrdenCuentasCorrientes,
  PagoDeCobro,
  PagoDeFiado,
  RegistrarCobroInput,
  ValorProximoPago,
  RegistrarCobroResponse,
} from "./cuentas-corrientes.types.js";

// --- UTILIDADES ---

/** Convierte un importe exacto a texto con 2 decimales (la mitad hacia arriba). */
function formatearImporte(importe: Decimal): string {
  return redondearAMoneda(importe).toFixed(2);
}

// --- LISTADO DE DEUDORES CON SALDO ---

/**
 * Resuelve el orden pedido en la query. Sin `ordenarPor` no hay orden pedido (`undefined`): el repository aplica el de siempre.
 * Con `ordenarPor` y sin `sentido` se usa `SENTIDO_ORDEN_PREDETERMINADO`. Que `sentido` no llegue solo ya lo rechazó el esquema.
 * @param consulta Query ya validada por Zod.
 */
export function calcularOrdenCuentasCorrientes(consulta: ConsultarCuentasCorrientesInput): OrdenCuentasCorrientes | undefined {
  if (consulta.ordenarPor === undefined) {
    return undefined;
  }
  return { campo: consulta.ordenarPor, sentido: consulta.sentido ?? SENTIDO_ORDEN_PREDETERMINADO };
}

/**
 * Resuelve el filtro `proximoPago` a fechas de calendario concretas, para que el repository no tenga lógica de calendario.
 * "Hoy" sale de `calcularHoyArgentina`, el mismo helper con el que se marca un fiado como `vencido` en la ficha:
 * así "vencidos" del listado y `vencido` de la ficha coinciden siempre (y a medianoche argentina cambian a la vez).
 * - `hoy`: desde hoy hasta hoy.
 * - `estaSemana`: desde hoy hasta el domingo de esta semana (lunes a domingo), ambos inclusive. No incluye vencidas;
 *   si hoy es domingo, es solo hoy.
 * - `vencidos`: anteriores a hoy (hoy no cuenta).
 * - `sinFecha`: no necesita fechas.
 * @param proximoPago Valor ya validado por Zod.
 * @param ahora Instante actual del servidor (se inyecta para poder probar la función con fechas fijas).
 */
export function calcularFiltroProximoPago(proximoPago: ValorProximoPago, ahora: Date): FiltroProximoPago {
  const hoy = calcularHoyArgentina(ahora);
  switch (proximoPago) {
    case "hoy":
      return { tipo: "hoy", fechaDesde: hoy, fechaHasta: hoy };
    case "estaSemana":
      return { tipo: "estaSemana", fechaDesde: hoy, fechaHasta: calcularDomingoDeLaSemana(hoy) };
    case "vencidos":
      return { tipo: "vencidos", fechaAntesDe: hoy };
    case "sinFecha":
      return { tipo: "sinFecha" };
  }
}

/**
 * Traduce la query al filtro del repository. Un texto vacío tras el recorte equivale a no filtrar
 * (el front lo manda así cuando el campo está limpio), igual que `textoCliente` en el historial de ventas.
 * @param consulta Query ya validada por Zod.
 * @param ahora Instante actual del servidor: define "hoy" en Argentina para el filtro `proximoPago`.
 */
export function calcularFiltroCuentasCorrientes(consulta: ConsultarCuentasCorrientesInput, ahora: Date): FiltroCuentasCorrientes {
  const orden = calcularOrdenCuentasCorrientes(consulta);
  return {
    incluirSinDeuda: consulta.incluirSinDeuda,
    ...(consulta.texto !== undefined && consulta.texto !== "" ? { texto: consulta.texto } : {}),
    ...(consulta.proximoPago !== undefined ? { proximoPago: calcularFiltroProximoPago(consulta.proximoPago, ahora) } : {}),
    ...(orden !== undefined ? { orden } : {}),
  };
}

/**
 * Convierte un deudor con saldo al formato de la respuesta: el saldo como texto con 2 decimales,
 * `fiadoDesde` en ISO 8601 y la próxima fecha estimada tal como la entrega el repository (`AAAA-MM-DD`).
 */
function convertirFilaCuentaCorriente(fila: FilaCuentaCorriente): CuentaCorrienteListada {
  return {
    idDeudor: fila.idDeudor,
    nombreCompleto: fila.nombreCompleto,
    dni: fila.dni,
    saldo: formatearImporte(fila.saldo),
    cantidadFiadosPendientes: fila.cantidadFiadosPendientes,
    fiadoDesde: fila.fiadoDesde === null ? null : fila.fiadoDesde.toISOString(),
    proximaFechaEstimadaPago: fila.proximaFechaEstimadaPago,
  };
}

/**
 * Consulta una página del listado de deudores con su saldo.
 * El saldo, el filtro de saldo, el orden y la paginación los resuelve el repository en la base; acá solo se arma la respuesta.
 * @param consulta Query ya validada por Zod (con los valores por defecto aplicados).
 * @param ahora Instante actual (por defecto el reloj del servidor): define "hoy" en Argentina para el filtro `proximoPago`.
 * @returns Los deudores de la página y los metadatos de paginación. Una página fuera de rango devuelve lista vacía.
 */
export async function consultarCuentasCorrientes(
  consulta: ConsultarCuentasCorrientesInput,
  ahora: Date = new Date(),
): Promise<ConsultarCuentasCorrientesResponse> {
  const filtro = calcularFiltroCuentasCorrientes(consulta, ahora);
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
      // Mantienen el orden del repository (fecha del cobro ascendente); el monto es lo aplicado a ESTE fiado
      pagos: fiado.pagos.map(
        (pago): PagoDeFiado => ({
          idCobroDeudor: pago.idCobroDeudor,
          numeroRecibo: pago.numeroRecibo,
          fechaHora: pago.fechaHora.toISOString(),
          monto: formatearImporte(pago.monto),
        }),
      ),
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

// ===== COBRO DE FIADOS: ORQUESTACION =====

/**
 * Registra el cobro de uno o varios fiados de un deudor: calcula con reglas puras y persiste en una unica transaccion.
 * El calculo se inyecta al repository como funcion para que corra dentro de la transaccion, con los fiados ya bloqueados
 * y leidos en ese mismo momento (asi la falta de cada fiado es la vigente, no la de una lectura vieja).
 * @param entrada Parametro de ruta, body validado y usuario del token.
 * @returns Respuesta lista para enviar al frontend (recibo consolidado).
 * @throws {ErrorNegocio} Si alguna regla de negocio no se cumple (nada queda escrito). Se lanza como objeto puro, no como Error.
 */
export async function registrarCobro(entrada: RegistrarCobroInput): Promise<RegistrarCobroResponse> {
  const registrado = await registrarCobroAtomico(entrada, (lectura) => calcularCobro(entrada, lectura));
  return armarRespuestaCobro(registrado);
}

// ===== COBRO DE FIADOS: CALCULO PURO =====

/**
 * Aplica las reglas de negocio del cobro sin acceder a la base ni al reloj (es pura a proposito: se prueba con datos de ejemplo).
 * La falta de cada fiado sale de `calcularImportesFiado`, la misma funcion del estado de cuenta: una sola definicion.
 * Orden de comprobaciones (parte del contrato): deudor 404; todos los fiados existen y son del deudor, 404; luego,
 * fiado por fiado en el orden pedido, no pendiente 409 y monto mayor a la falta 409; por ultimo los pagos
 * (medio inexistente 404, inactivo 400, recibido 400). La caja (409) la comprueba el repository despues.
 * El recargo o descuento de cada medio se aplica sobre la porcion base de cada pago, una sola vez para todo el cobro
 * (no por fiado), con `calcularPagosVenta`, igual que en el alta de venta y en Liquidar Fiado.
 * Dinero: sumas y comparaciones con Decimal exacto. Los centavos enteros solo se usan para llamar a las funciones de pagos
 * de ventas (que trabajan en centavos); un entero es exacto, no hay coma flotante.
 * @param entrada Parametro de ruta y body validados.
 * @param lectura Deudor, fiados bloqueados y medios de pago, leidos dentro de la transaccion.
 * @throws {ErrorNegocio} 404 deudor o fiado, 409 fiado no pendiente o monto mayor a la falta, y los de los pagos (404/400).
 */
export function calcularCobro(entrada: RegistrarCobroInput, lectura: LecturaCobro): CobroCalculado {
  if (lectura.deudor === null) {
    throw crearErrorDeudorNoEncontrado(entrada.idDeudor);
  }

  const fiadosPorId = new Map(lectura.fiados.map((fiado) => [fiado.idVenta, fiado]));

  // Primero que todos existan: un 404 no debe quedar tapado por un 409 de otro fiado del mismo pedido.
  // La lectura solo trae fiados de este deudor, asi que "no esta" cubre "no existe" y "es de otro deudor"
  for (const fiadoPedido of entrada.fiados) {
    if (!fiadosPorId.has(fiadoPedido.idVenta)) {
      throw crearErrorFiadoNoEncontrado(fiadoPedido.idVenta, entrada.idDeudor);
    }
  }

  const fiados = entrada.fiados.map((fiadoPedido): FiadoCobradoCalculado => {
    const fiado = fiadosPorId.get(fiadoPedido.idVenta);
    if (fiado === undefined) {
      // Inalcanzable: el bucle anterior ya lo verifico; es una defensa que ademas estrecha el tipo
      throw crearErrorFiadoNoEncontrado(fiadoPedido.idVenta, entrada.idDeudor);
    }
    if (fiado.estado !== "PENDIENTE_PAGO") {
      throw crearErrorFiadoNoPendiente(fiado.idVenta);
    }

    const { falta } = calcularImportesFiado(fiado);
    // `toString` del numero del body conserva lo que escribio quien llamo (0.1), sin ruido binario
    const montoAbonado = new Decimal(fiadoPedido.monto.toString());
    if (montoAbonado.gt(falta)) {
      throw crearErrorMontoExcedeFalta(fiado.idVenta, formatearImporte(montoAbonado), formatearImporte(falta));
    }

    return {
      idVenta: fiado.idVenta,
      numeroComprobante: fiado.numeroComprobante,
      montoAbonado,
      faltaAntes: falta,
      faltaDespues: falta.minus(montoAbonado),
    };
  });

  const totalAbonado = fiados.reduce((suma, fiado) => suma.plus(fiado.montoAbonado), new Decimal(0));

  // Los pagos deben cubrir exactamente lo abonado (el esquema ya lo exigio; `calcularPagosVenta` lo vuelve a verificar).
  // Un importe con 2 decimales por 100 es un entero exacto: no hay redondeo ni coma flotante
  const importeCentavos = totalAbonado.times(100).toNumber();
  const pagosCalculados = adjuntarMontoRecibidoYVuelto(
    entrada.pagos,
    calcularPagosVenta(entrada.pagos, lectura.medios, importeCentavos),
    lectura.medios,
  );

  const nombresPorMedio = new Map(lectura.medios.map((medio) => [medio.idMedioPago, medio.nombre]));
  const pagos = pagosCalculados.map((pago) => ({
    ...pago,
    // El valor vacio es inalcanzable: `calcularPagosVenta` ya exigio que cada medio exista
    nombreMedioPago: nombresPorMedio.get(pago.idMedioPago) ?? "",
  }));

  return { deudor: lectura.deudor, fiados, pagos, totalAbonado };
}

// ===== COBRO DE FIADOS: RESPUESTA =====

/** Igual que `formatearCentavos`, pero conserva `null` (recibido y vuelto no aplican fuera del efectivo). */
function formatearCentavosOpcional(centavos: number | null): string | null {
  return centavos === null ? null : formatearCentavos(centavos);
}

/** Convierte un fiado del cobro al formato de la respuesta; queda `COMPLETADA` solo si ya no falta nada. */
function convertirFiadoCobrado(fiado: FiadoCobradoCalculado): FiadoCobrado {
  return {
    idVenta: fiado.idVenta,
    numeroComprobante: fiado.numeroComprobante,
    montoAbonado: formatearImporte(fiado.montoAbonado),
    faltaAntes: formatearImporte(fiado.faltaAntes),
    faltaDespues: formatearImporte(fiado.faltaDespues),
    estado: fiado.faltaDespues.isZero() ? "COMPLETADA" : "PENDIENTE_PAGO",
  };
}

/**
 * Arma el recibo del cobro a partir de lo calculado y lo persistido. Pura: no accede a la base ni al reloj.
 * `saldoDeudorDespues` suma los `falta` de los fiados pendientes releidos tras escribir, con `calcularImportesFiado`
 * (la misma formula del estado de cuenta). `totalCobrado` es la suma de los montos finales (centavos enteros, exacta).
 * @param registrado Calculo guardado y datos persistidos (recibo, fecha y fiados pendientes que quedan).
 */
export function armarRespuestaCobro(registrado: CobroRegistrado): RegistrarCobroResponse {
  const { calculo, persistido } = registrado;

  const saldoDeudorDespues = persistido.fiadosPendientesDespues.reduce(
    (suma, fiado) => suma.plus(calcularImportesFiado(fiado).falta),
    new Decimal(0),
  );
  const totalCobradoCentavos = calculo.pagos.reduce((suma, pago) => suma + pago.montoFinalCentavos, 0);

  return {
    exito: true,
    cobro: {
      idCobroDeudor: persistido.idCobroDeudor,
      numeroRecibo: persistido.numeroRecibo,
      fechaHora: persistido.fechaHora.toISOString(),
    },
    deudor: calculo.deudor,
    fiados: calculo.fiados.map(convertirFiadoCobrado),
    pagos: calculo.pagos.map(
      (pago): PagoDeCobro => ({
        idMedioPago: pago.idMedioPago,
        nombreMedioPago: pago.nombreMedioPago,
        montoBase: formatearCentavos(pago.montoBaseCentavos),
        porcentajeAplicado: formatearBasisPoints(pago.porcentajeAplicadoBp),
        montoFinal: formatearCentavos(pago.montoFinalCentavos),
        montoRecibido: formatearCentavosOpcional(pago.montoRecibidoCentavos),
        vuelto: formatearCentavosOpcional(pago.vueltoCentavos),
      }),
    ),
    totalAbonado: formatearImporte(calculo.totalAbonado),
    totalCobrado: formatearCentavos(totalCobradoCentavos),
    saldoDeudorDespues: formatearImporte(saldoDeudorDespues),
  };
}

// ===== RECIBO DE UN COBRO =====

/**
 * Consulta el recibo de un cobro ya registrado. Solo lectura: no escribe nada ni toma el reloj, porque el recibo muestra
 * lo que quedo guardado (la fecha del cobro es la guardada, no la de la consulta).
 * @param entrada Parametro de ruta ya validado por Zod.
 * @returns El recibo, con los mismos formatos de importes que el 201 del cobro.
 * @throws {ErrorNegocioCobro} 404 `COBRO_NO_ENCONTRADO` si el cobro no existe. Se lanza como objeto puro, no como Error.
 */
export async function consultarCobro(entrada: ConsultarCobroInput): Promise<ConsultarCobroResponse> {
  const cobro = await buscarCobroPorId(entrada.idCobroDeudor);
  return armarReciboCobro(entrada.idCobroDeudor, cobro);
}

/**
 * Arma el recibo de un cobro a partir de lo leido. Pura: no accede a la base ni al reloj.
 * `totalCobrado` es la suma de los montos finales de los pagos (lo que pago el cliente, con recargos o descuentos), con Decimal
 * exacto y sin pasar por `number`: es la misma definicion del 201 del cobro, asi que el recibo y el alta coinciden.
 * Los importes salen en texto con 2 decimales; el porcentaje aplicado tambien (recargo positivo, descuento negativo).
 * @param idCobroDeudor Id pedido (para el mensaje del 404).
 * @param cobro Cobro leido, o `null` si no existe.
 * @throws {ErrorNegocioCobro} 404 `COBRO_NO_ENCONTRADO` si el cobro no existe.
 */
export function armarReciboCobro(idCobroDeudor: number, cobro: CobroLeido | null): ConsultarCobroResponse {
  if (cobro === null) {
    throw crearErrorCobroNoEncontrado(idCobroDeudor);
  }

  const totalCobrado = cobro.pagos.reduce((suma, pago) => suma.plus(pago.montoFinal), new Decimal(0));

  return {
    exito: true,
    cobro: {
      idCobroDeudor: cobro.idCobroDeudor,
      numeroRecibo: cobro.numeroRecibo,
      fechaHora: cobro.fechaHora.toISOString(),
    },
    deudor: cobro.deudor,
    usuario: cobro.usuario,
    fiados: cobro.fiados.map(
      (fiado): FiadoDeRecibo => ({
        idVenta: fiado.idVenta,
        numeroComprobante: fiado.numeroComprobante,
        montoAbonado: formatearImporte(fiado.monto),
      }),
    ),
    pagos: cobro.pagos.map(
      (pago): PagoDeCobro => ({
        idMedioPago: pago.idMedioPago,
        nombreMedioPago: pago.nombreMedioPago,
        montoBase: formatearImporte(pago.montoBase),
        porcentajeAplicado: formatearImporte(pago.porcentajeAplicado),
        montoFinal: formatearImporte(pago.montoFinal),
        montoRecibido: pago.montoRecibido === null ? null : formatearImporte(pago.montoRecibido),
        vuelto: pago.vuelto === null ? null : formatearImporte(pago.vuelto),
      }),
    ),
    totalCobrado: formatearImporte(totalCobrado),
  };
}
