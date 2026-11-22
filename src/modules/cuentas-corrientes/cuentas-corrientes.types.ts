import type { z } from "zod";
import type { Decimal } from "../../shared/decimal.js";
import type { Deudor } from "../deudores/deudores.types.js";
import type { consultarCuentasCorrientesSchema, consultarEstadoCuentaSchema } from "./cuentas-corrientes.schemas.js";

// --- ENTRADA ---

/** Query validada de `GET /api/cuentas-corrientes`, con los valores por defecto ya aplicados. */
export type ConsultarCuentasCorrientesInput = z.infer<typeof consultarCuentasCorrientesSchema>;

/** Parámetro de ruta validado de `GET /api/cuentas-corrientes/:idDeudor`. */
export type ConsultarEstadoCuentaInput = z.infer<typeof consultarEstadoCuentaSchema>;

// --- DATOS DE LA BASE ---

/** Filtro del listado ya traducido a lo que consulta el repository. */
export type FiltroCuentasCorrientes = {
  /** Texto a buscar dentro del nombre o del DNI, sin distinguir mayúsculas. Nunca viene vacío; ausente = sin filtro de texto. */
  texto?: string;
  /** Con `false` solo se listan los deudores con saldo mayor a 0. */
  incluirSinDeuda: boolean;
};

/** Un deudor con su saldo, tal como lo devuelve el repository (el saldo ya sumado en la base, con decimal exacto). */
export type FilaCuentaCorriente = {
  idDeudor: number;
  nombreCompleto: string;
  dni: string;
  /** Suma de lo que falta pagar de sus fiados pendientes; 0 si no tiene ninguno. */
  saldo: Decimal;
  cantidadFiadosPendientes: number;
};

/** Página del listado tal como la devuelve el repository. */
export type PaginaCuentasCorrientes = {
  filas: FilaCuentaCorriente[];
  /** Total de deudores que cumplen el filtro, sin paginar. */
  totalRegistros: number;
};

/** Un fiado pendiente de un deudor con lo necesario para calcular lo que falta pagar. */
export type FiadoLeido = {
  idVenta: number;
  /** Toda venta nueva lo tiene; es nulo solo en ventas muy anteriores. */
  numeroComprobante: string | null;
  fechaHora: Date;
  /** Fecha estimada de pago (`AAAA-MM-DD`, sin hora); nula si el fiado no la tiene. */
  fechaEstimadaPago: string | null;
  subtotalBruto: Decimal;
  descuentoManual: Decimal;
  /** Monto de cada cobro aplicado a este fiado (`detalles_cobro_deudor.monto`); vacío si todavía no se cobró nada. */
  montosCobrados: Decimal[];
};

/** Lo que lee el repository para el estado de cuenta: el deudor (o `null` si no existe) y sus fiados pendientes ya ordenados. */
export type EstadoCuentaLeido = {
  deudor: Deudor | null;
  fiados: FiadoLeido[];
};

// --- RESPUESTA HTTP ---

/** Un deudor en el listado de cuentas corrientes. Los importes van como texto con 2 decimales. */
export type CuentaCorrienteListada = {
  idDeudor: number;
  nombreCompleto: string;
  dni: string;
  /** Lo que el deudor debe hoy: suma de lo que falta de sus fiados pendientes. */
  saldo: string;
  cantidadFiadosPendientes: number;
};

/** Metadatos de paginación de `GET /api/cuentas-corrientes` (la misma forma que el historial de ventas). */
export type PaginacionCuentasCorrientes = {
  /** Página solicitada (empieza en 1). */
  pagina: number;
  cantidadPorPagina: number;
  /** Total de deudores que cumplen el filtro, sin paginar. */
  totalRegistros: number;
  /** Techo de totalRegistros / cantidadPorPagina; 0 si no hay filas. */
  totalPaginas: number;
};

/**
 * Respuesta exitosa de `GET /api/cuentas-corrientes`. Una página fuera de rango devuelve `cuentasCorrientes` vacío.
 * Orden: saldo descendente, desempate por nombre ascendente y luego por id ascendente.
 */
export type ConsultarCuentasCorrientesResponse = {
  exito: true;
  cuentasCorrientes: CuentaCorrienteListada[];
  paginacion: PaginacionCuentasCorrientes;
};

/** Un fiado pendiente en el estado de cuenta. Los importes van como texto con 2 decimales. */
export type FiadoDeEstadoCuenta = {
  idVenta: number;
  numeroComprobante: string | null;
  /** Instante de la venta, en ISO 8601. */
  fechaHora: string;
  /** Fecha estimada de pago (`AAAA-MM-DD`, sin hora) o `null` si no tiene. Es solo informativa. */
  fechaEstimadaPago: string | null;
  /**
   * `true` si tiene fecha estimada, esa fecha es anterior a hoy (hora de Argentina) y todavía falta pagar algo.
   * Se calcula al consultar; no se guarda.
   */
  vencido: boolean;
  /** Subtotal bruto menos descuento manual de la venta. */
  importeAdeudado: string;
  /** Suma de lo cobrado hasta ahora de este fiado. */
  yaPagado: string;
  /** `importeAdeudado - yaPagado`. */
  falta: string;
};

/**
 * Respuesta exitosa de `GET /api/cuentas-corrientes/:idDeudor`. El `saldo` es la suma de los `falta` de `fiados`,
 * calculada a partir de esas mismas filas. Los fiados van del más viejo al más nuevo.
 */
export type EstadoCuentaResponse = {
  exito: true;
  deudor: Deudor;
  saldo: string;
  fiados: FiadoDeEstadoCuenta[];
};
