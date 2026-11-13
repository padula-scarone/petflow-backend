import { evaluarBolsaAbierta } from "../inventario/inventario.service.js";
import { crearErrorNegocio } from "../ventas/ventas.errors.js";
import {
  crearErrorBolsaAbiertaNoPermitida,
  crearErrorCantidadExcedeVenta,
  crearErrorMedioPagoRequerido,
  crearErrorProductoNoFiguraEnVenta,
  crearErrorSaldoNegativo,
  crearErrorValorExcedeMaximo,
  crearErrorVentaOriginalAnulada,
  crearErrorVentaOriginalPendientePago,
} from "./cambios-mercaderia.errors.js";
import { registrarCambioAtomico } from "./cambios-mercaderia.repository.js";
import type {
  CambioCalculado,
  CambioPersistido,
  LecturaCambio,
  ProductoParaCambio,
  RegistrarCambioInput,
  RegistrarCambioResponse,
  VentaOriginalLeida,
} from "./cambios-mercaderia.types.js";

// --- CONSTANTES ---

/** Máximo de una columna decimal(10,3) expresado en milésimas: 9.999.999,999. */
const MAXIMO_MILESIMAS_COLUMNA = 9_999_999_999;

/** Máximo de una columna decimal(10,2) expresado en centavos: 99.999.999,99. */
const MAXIMO_CENTAVOS_COLUMNA = 9_999_999_999;

// --- ORQUESTACIÓN ---

/**
 * Registra un cambio de mercadería: calcula con reglas puras y persiste en una única transacción.
 * El cálculo se inyecta al repositorio como función para que corra dentro de la transacción,
 * con los datos leídos en ese mismo momento.
 * @param input Cuerpo ya validado por Zod más el usuario del token.
 * @returns Respuesta lista para enviar al frontend.
 * @throws {ErrorNegocio} Si alguna regla de negocio no se cumple (nada queda escrito).
 */
export async function registrarCambio(input: RegistrarCambioInput): Promise<RegistrarCambioResponse> {
  const cambio = await registrarCambioAtomico(input, (lectura) => calcularCambio(input, lectura));

  return {
    exito: true,
    mensaje:
      cambio.saldoCentavos > 0
        ? "Cambio registrado, stock actualizado y saldo asentado en caja"
        : "Cambio registrado y stock actualizado",
    cambio: convertirCambioPersistido(cambio),
  };
}

// --- CÁLCULO PURO ---

/**
 * Aplica todas las reglas de negocio de un cambio sin acceder a la base de datos.
 * Es pura a propósito: así se prueba con datos de ejemplo sin conectarse a Supabase.
 * El orden de las comprobaciones es parte del contrato: 404 (devuelto, entregado, venta), 400 (entregado inactivo,
 * cantidades, bolsa abierta), vínculo con la venta (409 estado, 400 producto ausente, 409 exceso) y por último
 * el saldo y el medio de pago. El vínculo va antes que el saldo porque el precio del devuelto sale del ticket.
 * La falta de caja y el stock insuficiente del entregado los resuelve el repositorio después de este cálculo.
 * @param input Cuerpo validado del cambio.
 * @param lectura Recursos leídos de la BD dentro de la transacción.
 * @returns Cantidades, precios, saldo y producto que recibe el ingreso, listos para persistir.
 * @throws {ErrorNegocio} Recurso inexistente (404), regla de bolsa, cantidad, saldo o medio inválido (400),
 * venta anulada, pendiente de pago o cantidad excedida (409). Se lanza como objeto puro, no como Error.
 */
export function calcularCambio(input: RegistrarCambioInput, lectura: LecturaCambio): CambioCalculado {
  // --- RECURSOS ---
  const { devuelto, entregado, ventaOriginal } = lectura;
  if (devuelto === null) {
    throw crearErrorNegocio(`El producto ${input.idProductoDevuelto} no existe`, 404);
  }
  if (entregado === null) {
    throw crearErrorNegocio(`El producto ${input.idProductoEntregado} no existe`, 404);
  }
  if (input.idVentaOriginal !== undefined && ventaOriginal === null) {
    throw crearErrorNegocio(`La venta ${input.idVentaOriginal} no existe`, 404);
  }

  // --- ENTREGADO Y CANTIDADES ---
  // El devuelto puede estar inactivo (se pudo desactivar después de venderlo); el entregado sale hoy del local
  if (!entregado.activo) {
    throw crearErrorNegocio(`El producto ${entregado.nombre} está inactivo`, 400);
  }
  const cantidadDevueltaMilesimas = aMilesimas(input.cantidadDevuelta);
  const cantidadEntregadaMilesimas = aMilesimas(input.cantidadEntregada);
  validarCantidadEntera(devuelto, cantidadDevueltaMilesimas);
  validarCantidadEntera(entregado, cantidadEntregadaMilesimas);

  // --- INGRESO AL STOCK ---
  const ingreso = calcularIngresoAlStock(input, devuelto, cantidadDevueltaMilesimas);

  // --- VÍNCULO CON LA VENTA ORIGINAL ---
  // Con ticket, el devuelto vale lo que se pagó por él; sin ticket, su precio actual
  const precioUnitarioDevueltoCentavos =
    ventaOriginal === null
      ? devuelto.precioCentavos
      : validarVentaOriginal(ventaOriginal, devuelto.idProducto, cantidadDevueltaMilesimas, lectura.cantidadYaDevueltaMilesimas);

  // --- SALDO Y MEDIO DE PAGO ---
  const saldoCentavos = calcularSaldo(
    precioUnitarioDevueltoCentavos,
    cantidadDevueltaMilesimas,
    entregado.precioCentavos,
    cantidadEntregadaMilesimas,
  );
  const idMedioPago = resolverMedioPago(input, lectura, saldoCentavos);

  return {
    cantidadDevueltaMilesimas,
    idProductoStockIngresado: ingreso.idProductoStockIngresado,
    cantidadStockIngresadoMilesimas: ingreso.cantidadStockIngresadoMilesimas,
    precioUnitarioDevueltoCentavos,
    cantidadEntregadaMilesimas,
    precioUnitarioEntregadoCentavos: entregado.precioCentavos,
    // El costo se congela del entregado; el del devuelto no se guarda (el modelo no tiene dónde)
    costoUnitarioEntregadoCentavos: entregado.costoCentavos,
    saldoCentavos,
    idMedioPago,
  };
}

// --- REGLAS AUXILIARES ---

/**
 * Exige cantidad entera a un producto por unidad (1.5 bolsas no tiene sentido).
 * @throws {ErrorNegocio} 400 si el producto es UNIDAD y la cantidad tiene decimales.
 */
function validarCantidadEntera(producto: ProductoParaCambio, cantidadMilesimas: number): void {
  if (producto.formatoVenta === "UNIDAD" && cantidadMilesimas % 1000 !== 0) {
    throw crearErrorNegocio(`El producto ${producto.nombre} se vende por unidad: la cantidad debe ser entera`, 400);
  }
}

/**
 * Decide qué producto recibe el ingreso y cuánto entra.
 * Bolsa cerrada (o devuelto a granel): ingresa el mismo producto y la misma cantidad.
 * Bolsa abierta: ingresan al granel los kilos que pesan las bolsas, con el peso del producto (no lo informa el vendedor).
 * @throws {ErrorNegocio} 400 si el producto no admite bolsa abierta o si los kilos no entran en la columna.
 */
function calcularIngresoAlStock(
  input: RegistrarCambioInput,
  devuelto: ProductoParaCambio,
  cantidadDevueltaMilesimas: number,
): Pick<CambioCalculado, "idProductoStockIngresado" | "cantidadStockIngresadoMilesimas"> {
  if (!input.esBolsaAbierta) {
    return { idProductoStockIngresado: devuelto.idProducto, cantidadStockIngresadoMilesimas: cantidadDevueltaMilesimas };
  }

  // La misma regla que decide `permiteBolsaAbierta` en el catálogo: así no pueden divergir
  const motivo = evaluarBolsaAbierta({
    formatoVenta: devuelto.formatoVenta,
    pesoUnitarioMilesimas: devuelto.pesoUnitarioMilesimas,
    productoGranel: devuelto.productoGranel,
  });
  const { productoGranel, pesoUnitarioMilesimas } = devuelto;
  // Las comprobaciones de nulo son inalcanzables si `motivo` es nulo; sirven para que TypeScript lo sepa
  if (motivo !== null || productoGranel === null || pesoUnitarioMilesimas === null) {
    throw crearErrorBolsaAbiertaNoPermitida(devuelto.nombre, motivo ?? "no tiene producto a granel o peso cargado");
  }

  // Producto UNIDAD ya validado como entero: la cantidad son bolsas completas.
  // Se compara antes de multiplicar para no operar con un producto fuera del rango de enteros seguros
  const cantidadBolsas = cantidadDevueltaMilesimas / 1000;
  if (cantidadBolsas > Math.floor(MAXIMO_MILESIMAS_COLUMNA / pesoUnitarioMilesimas)) {
    throw crearErrorValorExcedeMaximo("La cantidad que ingresa al granel");
  }
  return {
    idProductoStockIngresado: productoGranel.idProducto,
    cantidadStockIngresadoMilesimas: cantidadBolsas * pesoUnitarioMilesimas,
  };
}

/**
 * Valida el vínculo con la venta original y devuelve el precio al que se vendió el producto devuelto.
 * Si el producto figura en más de un detalle (datos antiguos), se suman las cantidades y se toma el precio del primero.
 * @param cantidadYaDevueltaMilesimas Lo devuelto antes en cambios activos de esta venta y este producto.
 * @returns Precio unitario del devuelto en centavos, sin prorratear el descuento manual de la venta.
 * @throws {ErrorNegocio} Venta anulada o pendiente de pago (409), producto ausente (400) o cantidad excedida (409).
 */
function validarVentaOriginal(
  ventaOriginal: VentaOriginalLeida,
  idProductoDevuelto: number,
  cantidadDevueltaMilesimas: number,
  cantidadYaDevueltaMilesimas: number,
): number {
  if (ventaOriginal.estado === "ANULADA") {
    throw crearErrorVentaOriginalAnulada(ventaOriginal.idVenta);
  }
  if (ventaOriginal.estado === "PENDIENTE_PAGO") {
    throw crearErrorVentaOriginalPendientePago();
  }

  const detallesDelProducto = ventaOriginal.detalles.filter((detalle) => detalle.idProducto === idProductoDevuelto);
  const primerDetalle = detallesDelProducto[0];
  if (primerDetalle === undefined) {
    throw crearErrorProductoNoFiguraEnVenta(idProductoDevuelto, ventaOriginal.idVenta);
  }

  const cantidadVendidaMilesimas = detallesDelProducto.reduce((suma, detalle) => suma + detalle.cantidadMilesimas, 0);
  const cantidadDisponibleMilesimas = Math.max(0, cantidadVendidaMilesimas - cantidadYaDevueltaMilesimas);
  if (cantidadDevueltaMilesimas > cantidadDisponibleMilesimas) {
    throw crearErrorCantidadExcedeVenta(
      idProductoDevuelto,
      ventaOriginal.idVenta,
      formatearMilesimas(cantidadDevueltaMilesimas),
      formatearMilesimas(cantidadDisponibleMilesimas),
    );
  }
  return primerDetalle.precioUnitarioCentavos;
}

/**
 * Calcula el saldo a favor del local: lo entregado menos lo devuelto, en centavos enteros.
 * Cada lado se redondea a centavos por separado, igual que el subtotal de una línea de venta.
 * @throws {ErrorNegocio} 400 si el saldo es negativo (no hay reembolsos) o no entra en su columna.
 */
function calcularSaldo(
  precioDevueltoCentavos: number,
  cantidadDevueltaMilesimas: number,
  precioEntregadoCentavos: number,
  cantidadEntregadaMilesimas: number,
): number {
  const saldoCentavos =
    calcularSubtotalCentavos(precioEntregadoCentavos, cantidadEntregadaMilesimas) -
    calcularSubtotalCentavos(precioDevueltoCentavos, cantidadDevueltaMilesimas);

  if (saldoCentavos < 0) {
    throw crearErrorSaldoNegativo(formatearCentavos(saldoCentavos));
  }
  if (saldoCentavos > MAXIMO_CENTAVOS_COLUMNA) {
    throw crearErrorValorExcedeMaximo("El saldo");
  }
  return saldoCentavos;
}

/**
 * Precio unitario × cantidad, redondeado a centavos.
 * @throws {ErrorNegocio} 400 si el importe es tan grande que precio × cantidad deja de ser un entero seguro de JS.
 */
function calcularSubtotalCentavos(precioUnitarioCentavos: number, cantidadMilesimas: number): number {
  const producto = precioUnitarioCentavos * cantidadMilesimas;
  if (!Number.isSafeInteger(producto)) {
    throw crearErrorValorExcedeMaximo("El importe del cambio");
  }
  return Math.round(producto / 1000);
}

/**
 * Resuelve el medio de pago del saldo. Con saldo 0 no hay cobro: el medio es nulo y, si el body trae uno, se ignora.
 * Con saldo mayor a 0 el medio es obligatorio, debe existir y estar activo. No hay recargo, descuento ni vuelto.
 * @throws {ErrorNegocio} 400 si falta o está inactivo; 404 si no existe.
 */
function resolverMedioPago(input: RegistrarCambioInput, lectura: LecturaCambio, saldoCentavos: number): number | null {
  if (saldoCentavos === 0) {
    return null;
  }
  if (input.idMedioPago === undefined) {
    throw crearErrorMedioPagoRequerido(formatearCentavos(saldoCentavos));
  }
  if (lectura.medioPago === null) {
    throw crearErrorNegocio(`El medio de pago ${input.idMedioPago} no existe`, 404);
  }
  if (!lectura.medioPago.activo) {
    throw crearErrorNegocio(`El medio de pago ${input.idMedioPago} está inactivo`, 400);
  }
  return lectura.medioPago.idMedioPago;
}

// --- RESPUESTA ---

/** Convierte el cambio persistido al formato de la respuesta: fecha ISO, montos con 2 decimales y cantidades con 3. */
function convertirCambioPersistido(cambio: CambioPersistido): RegistrarCambioResponse["cambio"] {
  return {
    idCambio: cambio.idCambio,
    fechaHora: cambio.fechaHora.toISOString(),
    estado: "ACTIVO",
    idVentaOriginal: cambio.idVentaOriginal,
    idProductoDevuelto: cambio.idProductoDevuelto,
    cantidadDevuelta: formatearMilesimas(cambio.cantidadDevueltaMilesimas),
    esBolsaAbierta: cambio.esBolsaAbierta,
    precioUnitarioDevuelto: formatearCentavos(cambio.precioUnitarioDevueltoCentavos),
    idProductoStockIngresado: cambio.idProductoStockIngresado,
    cantidadStockIngresado: formatearMilesimas(cambio.cantidadStockIngresadoMilesimas),
    idProductoEntregado: cambio.idProductoEntregado,
    cantidadEntregada: formatearMilesimas(cambio.cantidadEntregadaMilesimas),
    precioUnitarioEntregado: formatearCentavos(cambio.precioUnitarioEntregadoCentavos),
    saldoResultante: formatearCentavos(cambio.saldoCentavos),
    idMedioPago: cambio.idMedioPago,
  };
}

// --- UTILIDADES DE MONEDA Y CANTIDAD ---
// Copias locales de las de ventas, que no se exportan: se evita tocar ese módulo. Su extracción a `shared` es deuda registrada.

/**
 * Convierte centavos enteros a texto con 2 decimales.
 * @example formatearCentavos(150000) // "1500.00"
 */
function formatearCentavos(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

/**
 * Convierte milésimas enteras a texto con 3 decimales.
 * @example formatearMilesimas(1875) // "1.875"
 */
function formatearMilesimas(milesimas: number): string {
  return (milesimas / 1000).toFixed(3);
}

/** Convierte una cantidad decimal a milésimas enteras (la BD guarda 3 decimales). */
function aMilesimas(cantidad: number): number {
  return Math.round(cantidad * 1000);
}
