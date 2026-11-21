import { calcularDesplazamiento, calcularTotalPaginas } from "../ventas/ventas.service.js";
import { crearErrorDeudorNoEncontrado, crearErrorDniDuplicado } from "./deudores.errors.js";
import {
  actualizarDeudorPorId,
  buscarDeudorPorDni,
  buscarDeudorPorId,
  buscarPaginaDeudores,
  crearDeudor,
} from "./deudores.repository.js";
import type {
  ActualizarDeudorInput,
  ActualizarDeudorResponse,
  ConsultarDeudoresInput,
  ConsultarDeudoresResponse,
  DatosDeudor,
  FiltroDeudores,
  RegistrarDeudorResponse,
} from "./deudores.types.js";

// --- CONSTANTES ---

/** Mensaje de éxito del alta. Fijo: nunca incluye el DNI ni el teléfono (RNF-VENTAS-03). */
const MENSAJE_DEUDOR_REGISTRADO = "Deudor registrado";

/** Mensaje de éxito de la edición. Fijo, por la misma razón. */
const MENSAJE_DEUDOR_ACTUALIZADO = "Deudor actualizado";

// --- ALTA ---

/**
 * Registra un deudor nuevo.
 * El DNI es único: se busca primero al deudor que ya lo tiene para responder 409 con sus datos; si dos altas con el
 * mismo DNI llegan a la vez, el índice único de la base rechaza la segunda y el repository lo informa igual.
 * @param datos Datos ya validados y normalizados por Zod.
 * @throws {ErrorNegocioDeudor} 409 `DNI_DUPLICADO` si el DNI ya pertenece a un deudor.
 */
export async function registrarDeudor(datos: DatosDeudor): Promise<RegistrarDeudorResponse> {
  const deudorConEseDni = await buscarDeudorPorDni(datos.dni);
  if (deudorConEseDni !== null) {
    throw crearErrorDniDuplicado(deudorConEseDni);
  }

  const resultado = await crearDeudor(datos);
  if (resultado.tipo === "DNI_DUPLICADO") {
    throw crearErrorDniDuplicado(resultado.deudorExistente);
  }

  return { exito: true, mensaje: MENSAJE_DEUDOR_REGISTRADO, deudor: resultado.deudor };
}

// --- EDICIÓN ---

/**
 * Reemplaza los tres datos de un deudor.
 * Orden de evaluación: primero que el deudor exista (404) y después que el DNI no sea de otro (409).
 * Conservar el propio DNI no es un conflicto, así que una edición idéntica también responde 200.
 * @param entrada Id de la ruta más los datos ya validados.
 * @throws {ErrorNegocioDeudor} 404 `DEUDOR_NO_ENCONTRADO` o 409 `DNI_DUPLICADO`.
 */
export async function actualizarDeudor(entrada: ActualizarDeudorInput): Promise<ActualizarDeudorResponse> {
  const { idDeudor, ...datos } = entrada;

  const deudorActual = await buscarDeudorPorId(idDeudor);
  if (deudorActual === null) {
    throw crearErrorDeudorNoEncontrado(idDeudor);
  }

  const deudorConEseDni = await buscarDeudorPorDni(datos.dni);
  if (deudorConEseDni !== null && deudorConEseDni.idDeudor !== idDeudor) {
    throw crearErrorDniDuplicado(deudorConEseDni);
  }

  const resultado = await actualizarDeudorPorId(idDeudor, datos);
  if (resultado.tipo === "DNI_DUPLICADO") {
    throw crearErrorDniDuplicado(resultado.deudorExistente);
  }

  return { exito: true, mensaje: MENSAJE_DEUDOR_ACTUALIZADO, deudor: resultado.deudor };
}

// --- BÚSQUEDA ---

/**
 * Traduce la query al filtro del repository. Una búsqueda vacía tras el recorte equivale a no filtrar
 * (el front la manda así cuando el campo está limpio), igual que `textoCliente` en el historial de ventas.
 */
export function calcularFiltroDeudores(consulta: ConsultarDeudoresInput): FiltroDeudores {
  return consulta.busqueda !== undefined && consulta.busqueda !== "" ? { busqueda: consulta.busqueda } : {};
}

/**
 * Consulta una página de deudores por nombre o DNI.
 * @param consulta Query ya validada por Zod (con los valores por defecto aplicados).
 * @returns Los deudores de la página y los metadatos de paginación. Una página fuera de rango devuelve lista vacía.
 */
export async function consultarDeudores(consulta: ConsultarDeudoresInput): Promise<ConsultarDeudoresResponse> {
  const filtro = calcularFiltroDeudores(consulta);
  const desplazamiento = calcularDesplazamiento(consulta.pagina, consulta.cantidadPorPagina);

  const paginaEncontrada = await buscarPaginaDeudores(filtro, desplazamiento, consulta.cantidadPorPagina);

  return {
    exito: true,
    deudores: paginaEncontrada.filas,
    paginacion: {
      pagina: consulta.pagina,
      cantidadPorPagina: consulta.cantidadPorPagina,
      totalRegistros: paginaEncontrada.totalRegistros,
      totalPaginas: calcularTotalPaginas(paginaEncontrada.totalRegistros, consulta.cantidadPorPagina),
    },
  };
}
