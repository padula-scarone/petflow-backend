import type { z } from "zod";
import type { Decimal } from "../../shared/decimal.js";
import type { Deudor } from "../deudores/deudores.types.js";
import type { MedioPagoVigente, PagoCobroCalculado } from "../ventas/ventas.types.js";
import type {
  consultarCobroSchema,
  consultarCuentasCorrientesSchema,
  consultarEstadoCuentaSchema,
  registrarCobroCuerpoSchema,
  registrarCobroParametrosSchema,
} from "./cuentas-corrientes.schemas.js";

// --- ENTRADA ---

/** Query validada de `GET /api/cuentas-corrientes`, con los valores por defecto ya aplicados. */
export type ConsultarCuentasCorrientesInput = z.infer<typeof consultarCuentasCorrientesSchema>;

/** Parámetro de ruta validado de `GET /api/cuentas-corrientes/:idDeudor`. */
export type ConsultarEstadoCuentaInput = z.infer<typeof consultarEstadoCuentaSchema>;

// --- DATOS DE LA BASE ---

/** Columna por la que se ordena el listado: uno de los valores de `ordenarPor`. */
export type CampoOrdenCuentasCorrientes = NonNullable<ConsultarCuentasCorrientesInput["ordenarPor"]>;

/** Sentido del orden: ascendente o descendente. */
export type SentidoOrdenCuentasCorrientes = NonNullable<ConsultarCuentasCorrientesInput["sentido"]>;

/** Orden pedido por el cliente, ya con el sentido resuelto (el service aplica el predeterminado). */
export type OrdenCuentasCorrientes = {
  campo: CampoOrdenCuentasCorrientes;
  sentido: SentidoOrdenCuentasCorrientes;
};

/** Filtro del listado ya traducido a lo que consulta el repository. */
export type FiltroCuentasCorrientes = {
  /** Texto a buscar dentro del nombre o del DNI, sin distinguir mayúsculas. Nunca viene vacío; ausente = sin filtro de texto. */
  texto?: string;
  /** Con `false` solo se listan los deudores con saldo mayor a 0. */
  incluirSinDeuda: boolean;
  /**
   * Orden pedido. Ausente = el orden de siempre (saldo descendente, nombre y id ascendentes). No es un filtro, pero viaja junto
   * a ellos porque el repository arma una sola consulta con el filtro y el orden.
   */
  orden?: OrdenCuentasCorrientes;
};

/** Un deudor con su saldo, tal como lo devuelve el repository (el saldo ya sumado en la base, con decimal exacto). */
export type FilaCuentaCorriente = {
  idDeudor: number;
  nombreCompleto: string;
  dni: string;
  /** Suma de lo que falta pagar de sus fiados pendientes; 0 si no tiene ninguno. */
  saldo: Decimal;
  cantidadFiadosPendientes: number;
  /** `fechaHora` del fiado `PENDIENTE_PAGO` más antiguo; `null` si no tiene fiados pendientes. */
  fiadoDesde: Date | null;
  /** Fecha estimada de pago (`AAAA-MM-DD`) más temprana entre sus fiados pendientes; `null` si ninguno tiene. */
  proximaFechaEstimadaPago: string | null;
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

/** Un cobro aplicado a un fiado, tal como lo lee el estado de cuenta: cuándo, con qué recibo y cuánto se aplicó a ESE fiado. */
export type PagoDeFiadoLeido = {
  idCobroDeudor: number;
  /** Se asigna en la misma transacción que crea el cobro, pero la columna es nullable: se informa tal cual está guardada. */
  numeroRecibo: string | null;
  fechaHora: Date;
  /** Lo aplicado a este fiado (`detalles_cobro_deudor.monto`), no el total del cobro, que puede cubrir varios fiados. */
  monto: Decimal;
};

/** Un fiado pendiente con el detalle de sus cobros, para el estado de cuenta. Los cobros ya vienen ordenados por fecha ascendente. */
export type FiadoConPagosLeido = FiadoLeido & {
  pagos: PagoDeFiadoLeido[];
};

/** Lo que lee el repository para el estado de cuenta: el deudor (o `null` si no existe) y sus fiados pendientes ya ordenados. */
export type EstadoCuentaLeido = {
  deudor: Deudor | null;
  fiados: FiadoConPagosLeido[];
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
  /** `fechaHora` (ISO 8601) del fiado pendiente más antiguo; `null` si el deudor no tiene fiados pendientes. */
  fiadoDesde: string | null;
  /**
   * Fecha estimada de pago (`AAAA-MM-DD`, sin hora) más temprana entre sus fiados pendientes, incluidas las ya vencidas;
   * `null` si ninguno tiene fecha. Es solo informativa.
   */
  proximaFechaEstimadaPago: string | null;
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
 * Orden: el pedido con `ordenarPor` y `sentido` (los nulos siempre al final) o, sin ellos, saldo descendente;
 * en ambos casos el desempate es nombre ascendente y luego id ascendente.
 */
export type ConsultarCuentasCorrientesResponse = {
  exito: true;
  cuentasCorrientes: CuentaCorrienteListada[];
  paginacion: PaginacionCuentasCorrientes;
};

/** Un cobro aplicado a un fiado, en el estado de cuenta. El `monto` va como texto con 2 decimales. */
export type PagoDeFiado = {
  idCobroDeudor: number;
  /** Número del recibo del cobro (`REC-` y 8 dígitos). */
  numeroRecibo: string | null;
  /** Instante del cobro, en ISO 8601. */
  fechaHora: string;
  /** Lo aplicado a ESTE fiado (no el total del cobro, que puede cubrir varios fiados). */
  monto: string;
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
  /**
   * Cobros aplicados a este fiado, del más viejo al más nuevo (`fechaHora` ascendente, desempate por `idCobroDeudor`).
   * La suma de sus `monto` es `yaPagado`. Vacío si todavía no se cobró nada.
   */
  pagos: PagoDeFiado[];
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

// ===== COBRO DE FIADOS: ENTRADA =====

/** Parametro de ruta validado de `POST /api/cuentas-corrientes/:idDeudor/cobros`. */
export type RegistrarCobroParametros = z.infer<typeof registrarCobroParametrosSchema>;

/** Body validado del cobro, inferido del esquema Zod. No incluye al usuario: sale del token. */
export type RegistrarCobroCuerpo = z.infer<typeof registrarCobroCuerpoSchema>;

/** Entrada completa del cobro: el deudor de la ruta, el body y el usuario del token ya verificado. */
export type RegistrarCobroInput = RegistrarCobroCuerpo &
  RegistrarCobroParametros & {
    /** Usuario de la sesion; nunca se toma del body. Queda como `cobros_deudor.id_usuario`. */
    idUsuario: number;
  };

// ===== COBRO DE FIADOS: DATOS DE LA BASE =====

/** Estado de una venta tal como se lee para cobrarla: el service rechaza todo el que no sea `PENDIENTE_PAGO`. */
export type EstadoVentaLeida = "COMPLETADA" | "PENDIENTE_PAGO" | "ANULADA";

/** Un fiado del deudor leido para cobrarlo: lo del estado de cuenta mas su estado actual (puede haber cambiado). */
export type FiadoParaCobro = FiadoLeido & {
  estado: EstadoVentaLeida;
};

/** Medio de pago leido para el cobro: lo que necesita el calculo de ventas mas el nombre vigente para el recibo. */
export type MedioPagoCobro = MedioPagoVigente & {
  nombre: string;
};

/**
 * Lo que lee el repository dentro de la transaccion, ya con los fiados bloqueados, para que el service calcule el cobro.
 * `fiados` trae solo los pedidos que existen y son del deudor, ordenados por `idVenta`: un pedido que falta es un 404.
 */
export type LecturaCobro = {
  /** El deudor, o `null` si no existe (el service decide el 404). */
  deudor: Deudor | null;
  fiados: FiadoParaCobro[];
  medios: MedioPagoCobro[];
};

// ===== COBRO DE FIADOS: RESULTADO DEL CALCULO =====

/** Un fiado del cobro con lo abonado y lo que falta antes y despues. Todo con Decimal exacto. */
export type FiadoCobradoCalculado = {
  idVenta: number;
  numeroComprobante: string | null;
  montoAbonado: Decimal;
  faltaAntes: Decimal;
  /** `faltaAntes - montoAbonado`. Si es 0 el repository pasa el fiado a `COMPLETADA` en la misma transaccion. */
  faltaDespues: Decimal;
};

/** Un pago ya calculado (recargo o descuento, recibido y vuelto, en centavos como en ventas) con el nombre de su medio. */
export type PagoCobroConNombre = PagoCobroCalculado & {
  nombreMedioPago: string;
};

/** Resultado de `calcularCobro`, listo para persistir. */
export type CobroCalculado = {
  deudor: Deudor;
  /** En el orden en que se pidieron. */
  fiados: FiadoCobradoCalculado[];
  /** En el orden en que se pidieron. */
  pagos: PagoCobroConNombre[];
  /** Suma de lo abonado a los fiados (igual a la suma de las bases de los pagos). */
  totalAbonado: Decimal;
};

/** Lo que devuelve el repository tras guardar: el recibo y los fiados pendientes que le quedan al deudor, releidos. */
export type CobroPersistido = {
  idCobroDeudor: number;
  /** `REC-` mas el id con 8 digitos. */
  numeroRecibo: string;
  /** Instante del cobro; es tambien la `fecha_hora_pago` de los fiados que se completaron. */
  fechaHora: Date;
  /** Fiados `PENDIENTE_PAGO` del deudor despues de escribir: de ahi sale `saldoDeudorDespues` con la misma formula del estado de cuenta. */
  fiadosPendientesDespues: FiadoLeido[];
};

// ===== COBRO DE FIADOS: RESPUESTA HTTP =====

/** Un fiado en el recibo. Los importes van como texto con 2 decimales. */
export type FiadoCobrado = {
  idVenta: number;
  numeroComprobante: string | null;
  montoAbonado: string;
  faltaAntes: string;
  faltaDespues: string;
  /** `COMPLETADA` si `faltaDespues` es 0; si no, sigue `PENDIENTE_PAGO`. */
  estado: "PENDIENTE_PAGO" | "COMPLETADA";
};

/** Un pago en el recibo. Los importes van como texto con 2 decimales y el porcentaje con 2 (recargo positivo, descuento negativo). */
export type PagoDeCobro = {
  idMedioPago: number;
  nombreMedioPago: string;
  montoBase: string;
  porcentajeAplicado: string;
  montoFinal: string;
  /** Nulo si el medio no es efectivo o no se informo el monto recibido. */
  montoRecibido: string | null;
  /** Nulo siempre que `montoRecibido` sea nulo. */
  vuelto: string | null;
};

/** Respuesta exitosa (201) de `POST /api/cuentas-corrientes/:idDeudor/cobros`. */
export type RegistrarCobroResponse = {
  exito: true;
  cobro: {
    idCobroDeudor: number;
    numeroRecibo: string;
    /** Instante del cobro en ISO 8601. */
    fechaHora: string;
  };
  deudor: Deudor;
  fiados: FiadoCobrado[];
  pagos: PagoDeCobro[];
  /** Suma de lo abonado a los fiados (suma de las bases): lo que baja la deuda. */
  totalAbonado: string;
  /** Suma de los montos finales: lo que paga el cliente, con los recargos o descuentos de los medios. */
  totalCobrado: string;
  /** Lo que el deudor debe despues del cobro, con la misma formula que su estado de cuenta. */
  saldoDeudorDespues: string;
};

/** Lo que devuelve `registrarCobroAtomico` al service: el calculo que se guardo y lo que quedo persistido. */
export type CobroRegistrado = {
  calculo: CobroCalculado;
  persistido: CobroPersistido;
};

// ===== RECIBO DE UN COBRO: ENTRADA Y DATOS DE LA BASE =====

/** Parametro de ruta validado de `GET /api/cuentas-corrientes/cobros/:idCobroDeudor`. */
export type ConsultarCobroInput = z.infer<typeof consultarCobroSchema>;

/** Un fiado cubierto por un cobro, tal como lo lee el recibo: cuanto de ese cobro se aplico a el. */
export type FiadoCobroLeido = {
  idVenta: number;
  numeroComprobante: string | null;
  /** Lo aplicado a este fiado (`detalles_cobro_deudor.monto`). */
  monto: Decimal;
};

/** Un pago de un cobro, tal como se guardo (recargo o descuento congelado). Todo con Decimal exacto. */
export type PagoCobroLeido = {
  idMedioPago: number;
  /** Nombre vigente del medio de pago al consultar. */
  nombreMedioPago: string;
  montoBase: Decimal;
  /** Recargo (positivo) o descuento (negativo) que se aplico en ese cobro. */
  porcentajeAplicado: Decimal;
  montoFinal: Decimal;
  /** Nulo si el medio no es efectivo o no se informo el monto recibido. */
  montoRecibido: Decimal | null;
  /** Nulo siempre que `montoRecibido` sea nulo. */
  vuelto: Decimal | null;
};

/** Cobro completo con su deudor, usuario, fiados y pagos, tal como lo entrega el repository. Sin DNI ni telefono del deudor. */
export type CobroLeido = {
  idCobroDeudor: number;
  /** Se asigna en la misma transaccion que crea el cobro, pero la columna es nullable: se informa tal cual esta guardada. */
  numeroRecibo: string | null;
  fechaHora: Date;
  deudor: DeudorDeRecibo;
  /** Quien registro el cobro (el usuario de la sesion de ese momento). */
  usuario: UsuarioDeRecibo;
  /** En el orden en que se guardaron (el mismo en que se pidieron). */
  fiados: FiadoCobroLeido[];
  /** En el orden en que se guardaron (el mismo en que se pidieron). */
  pagos: PagoCobroLeido[];
};

// ===== RECIBO DE UN COBRO: RESPUESTA HTTP =====

/** Deudor reducido a lo que muestra el recibo: sin DNI ni telefono (RNF-VENTAS-03). */
export type DeudorDeRecibo = Pick<Deudor, "idDeudor" | "nombreCompleto">;

/** Usuario que registro el cobro. */
export type UsuarioDeRecibo = {
  idUsuario: number;
  nombre: string;
};

/** Un fiado cubierto por el cobro en el recibo. El importe va como texto con 2 decimales. */
export type FiadoDeRecibo = {
  idVenta: number;
  numeroComprobante: string | null;
  /** Lo aplicado a este fiado en este cobro. */
  montoAbonado: string;
};

/** Respuesta exitosa (200) de `GET /api/cuentas-corrientes/cobros/:idCobroDeudor`. Los pagos tienen la misma forma que en el 201 del cobro. */
export type ConsultarCobroResponse = {
  exito: true;
  cobro: {
    idCobroDeudor: number;
    numeroRecibo: string | null;
    /** Instante del cobro en ISO 8601. */
    fechaHora: string;
  };
  deudor: DeudorDeRecibo;
  usuario: UsuarioDeRecibo;
  fiados: FiadoDeRecibo[];
  pagos: PagoDeCobro[];
  /** Suma de los montos finales de los pagos: lo que pago el cliente, con los recargos o descuentos de los medios. */
  totalCobrado: string;
};
