import { z } from "zod";
import { Decimal } from "../../shared/decimal.js";
import { ID_DEUDOR_MAXIMO } from "../deudores/deudores.schemas.js";
import {
  CANTIDAD_POR_PAGINA_MAXIMA,
  CANTIDAD_POR_PAGINA_PREDETERMINADA,
  conDecimalesMaximos,
  enteroDesdeTexto,
  ID_VENTA_MAXIMO,
  MONTO_RECIBIDO_MAXIMO,
  PAGINA_MAXIMA,
  pagoConMontoRecibidoSchema,
  validarMediosNoRepetidos,
} from "../ventas/ventas.schemas.js";

// --- CONSTANTES ---

/** Largo máximo de `texto`: el mismo que `busqueda` de deudores y `textoCliente` del historial (columna VARCHAR(100)). */
export const TEXTO_BUSQUEDA_LONGITUD_MAXIMA = 100;

// --- AUXILIARES ---

/**
 * Booleano recibido como texto en una query: solo se admite `true` o `false`, en minúsculas.
 * Es estricto a propósito (igual que `MIXTO` en el historial): `TRUE`, `1` o `yes` dan 400 en lugar de interpretarse en silencio.
 */
const booleanoDesdeTexto = z
  .enum(["true", "false"], { error: "Debe ser true o false (en minúsculas)" })
  .transform((valor) => valor === "true");

// --- LISTADO DE DEUDORES CON SALDO ---

/**
 * Contrato de entrada de `GET /api/cuentas-corrientes` (query params, todos opcionales).
 * Los valores llegan como texto; la conversión a número es estricta (ver `enteroDesdeTexto` de ventas).
 * `texto` coincide de forma parcial, sin distinguir mayúsculas, con el nombre o el DNI; si queda vacío tras el recorte
 * equivale a no filtrar (lo resuelve el service). `incluirSinDeuda` vale `false` si se omite: solo salen los deudores con saldo.
 */
export const consultarCuentasCorrientesSchema = z.object({
  pagina: enteroDesdeTexto(1, PAGINA_MAXIMA).default(1),
  cantidadPorPagina: enteroDesdeTexto(1, CANTIDAD_POR_PAGINA_MAXIMA).default(CANTIDAD_POR_PAGINA_PREDETERMINADA),
  texto: z.string().trim().max(TEXTO_BUSQUEDA_LONGITUD_MAXIMA).optional(),
  incluirSinDeuda: booleanoDesdeTexto.default(false),
});

// --- ESTADO DE CUENTA DE UN DEUDOR ---

/**
 * Contrato de entrada del parámetro de ruta de `GET /api/cuentas-corrientes/:idDeudor`.
 * El id llega como texto y la conversión es estricta (entero positivo hasta `ID_DEUDOR_MAXIMO`).
 */
export const consultarEstadoCuentaSchema = z.object({
  idDeudor: enteroDesdeTexto(1, ID_DEUDOR_MAXIMO),
});

// ===== COBRO DE FIADOS DE UN DEUDOR =====

/**
 * Contrato de entrada del parametro de ruta de `POST /api/cuentas-corrientes/:idDeudor/cobros`.
 * Es el mismo del estado de cuenta (entero positivo hasta `ID_DEUDOR_MAXIMO`, conversion estricta):
 * se reutiliza para que el tope del id no pueda divergir entre las rutas del modulo.
 */
export const registrarCobroParametrosSchema = consultarEstadoCuentaSchema;

/**
 * Un fiado a abonar: cual es y cuanto se le abona de la deuda.
 * El monto es mayor a 0 y admite hasta 2 decimales (columna `detalles_cobro_deudor.monto` NUMERIC(12,2)).
 * Que no supere lo que falta del fiado lo verifica el service con lo leido de la base (409), no este esquema.
 */
const fiadoACobrarSchema = z.object({
  idVenta: z.number().int().positive().max(ID_VENTA_MAXIMO),
  monto: z
    .number()
    .positive()
    .max(MONTO_RECIBIDO_MAXIMO)
    .refine(conDecimalesMaximos(2), "El monto admite hasta 2 decimales"),
});

/**
 * Contrato de entrada del body de `POST /api/cuentas-corrientes/:idDeudor/cobros`.
 * - `fiados`: al menos uno, sin `idVenta` repetido (la base tiene unico `id_cobro_deudor` + `id_venta`).
 * - `pagos`: al menos uno, con la misma forma que en Liquidar Fiado; `monto` es la porcion base (sin recargo) y
 *   `montoRecibido` solo corresponde al efectivo (lo valida el service, que conoce el tipo del medio). Sin medio repetido.
 * - La suma de los `monto` de `pagos` debe ser igual a la de `fiados`: se compara con Decimal exacto, sin sumar numeros de JS.
 * El usuario no viaja en el body: sale del token. Las claves desconocidas se descartan sin error.
 */
export const registrarCobroCuerpoSchema = z
  .object({
    fiados: z.array(fiadoACobrarSchema).min(1),
    pagos: z.array(pagoConMontoRecibidoSchema).min(1),
  })
  .superRefine((datos, contexto) => {
    // Se reporta como error cada repeticion posterior a la primera aparicion del fiado
    datos.fiados.forEach((fiado, indice) => {
      const primeraAparicion = datos.fiados.findIndex((otro) => otro.idVenta === fiado.idVenta);
      if (primeraAparicion !== indice) {
        contexto.addIssue({
          code: "custom",
          path: ["fiados", indice, "idVenta"],
          message: "Un fiado no puede repetirse en el mismo cobro",
        });
      }
    });

    validarMediosNoRepetidos(datos.pagos, contexto);

    // Decimal exacto: `Decimal(numero.toString())` conserva lo que escribio quien llamo (por ejemplo 0.1) sin ruido binario
    const sumaFiados = datos.fiados.reduce((suma, fiado) => suma.plus(new Decimal(fiado.monto.toString())), new Decimal(0));
    const sumaPagos = datos.pagos.reduce((suma, pago) => suma.plus(new Decimal(pago.monto.toString())), new Decimal(0));
    if (!sumaFiados.equals(sumaPagos)) {
      contexto.addIssue({
        code: "custom",
        path: ["pagos"],
        message: `La suma de los pagos (${sumaPagos.toFixed(2)}) no coincide con la suma abonada a los fiados (${sumaFiados.toFixed(2)})`,
      });
    }
  });
