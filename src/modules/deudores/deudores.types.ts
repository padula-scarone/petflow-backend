import type { z } from "zod";
import type {
  actualizarDeudorParametrosSchema,
  consultarDeudoresSchema,
  datosDeudorSchema,
} from "./deudores.schemas.js";

// --- ENTRADA ---

/** Datos de un deudor ya validados y normalizados (el teléfono queda solo con dígitos). Los usan el alta y la edición. */
export type DatosDeudor = z.infer<typeof datosDeudorSchema>;

/** Parámetros de ruta validados de `PUT /api/deudores/:idDeudor`. */
export type ActualizarDeudorParametros = z.infer<typeof actualizarDeudorParametrosSchema>;

/** Entrada del service para editar un deudor: el id de la ruta más los tres datos que lo reemplazan. */
export type ActualizarDeudorInput = ActualizarDeudorParametros & DatosDeudor;

/** Query validada de `GET /api/deudores`, con los valores por defecto ya aplicados. */
export type ConsultarDeudoresInput = z.infer<typeof consultarDeudoresSchema>;

// --- DATOS DE LA BASE ---

/** Filtro de la búsqueda ya traducido a lo que consulta el repository. Solo se incluye lo presente. */
export type FiltroDeudores = {
  /** Texto a buscar dentro del nombre o del DNI, sin distinguir mayúsculas. Nunca viene vacío. */
  busqueda?: string;
};

/** Página de deudores tal como la devuelve el repository. */
export type PaginaDeudores = {
  filas: Deudor[];
  /** Total de deudores que cumplen el filtro, sin paginar. */
  totalRegistros: number;
};

/**
 * Resultado de guardar (crear o editar) un deudor en el repository.
 * El conflicto de DNI es un resultado esperado y no una excepción: el repository atrapa el error de unicidad
 * de Prisma (dos operaciones simultáneas con el mismo DNI) y devuelve a quién pertenece.
 */
export type ResultadoGuardarDeudor =
  | { tipo: "GUARDADO"; deudor: Deudor }
  | { tipo: "DNI_DUPLICADO"; deudorExistente: Deudor };

// --- RESPUESTA HTTP ---

/** Deudor en las respuestas. El DNI y el teléfono solo viajan en el cuerpo estructurado (RNF-VENTAS-03). */
export type Deudor = {
  idDeudor: number;
  nombreCompleto: string;
  /** Solo dígitos, de 11 a 15, con código de país. */
  telefono: string;
  /** Solo dígitos, 7 u 8, sin puntos. Es único. */
  dni: string;
};

/** Respuesta exitosa de `POST /api/deudores` (201). */
export type RegistrarDeudorResponse = {
  exito: true;
  mensaje: string;
  deudor: Deudor;
};

/** Respuesta exitosa de `PUT /api/deudores/:idDeudor` (200). */
export type ActualizarDeudorResponse = {
  exito: true;
  mensaje: string;
  deudor: Deudor;
};

/** Metadatos de paginación de `GET /api/deudores` (la misma forma que el historial de ventas). */
export type PaginacionDeudores = {
  /** Página solicitada (empieza en 1). */
  pagina: number;
  cantidadPorPagina: number;
  /** Total de deudores que cumplen el filtro, sin paginar. */
  totalRegistros: number;
  /** Techo de totalRegistros / cantidadPorPagina; 0 si no hay filas. */
  totalPaginas: number;
};

/** Respuesta exitosa de `GET /api/deudores`. Una página fuera de rango devuelve `deudores` vacío. */
export type ConsultarDeudoresResponse = {
  exito: true;
  deudores: Deudor[];
  paginacion: PaginacionDeudores;
};
