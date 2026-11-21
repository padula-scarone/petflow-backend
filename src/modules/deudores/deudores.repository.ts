import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/prisma.js";
import type { DatosDeudor, Deudor, FiltroDeudores, PaginaDeudores, ResultadoGuardarDeudor } from "./deudores.types.js";

// --- CONSTANTES ---

/** Columnas que se leen de un deudor: las cuatro que devuelve la API, para que una columna futura no se filtre sola. */
const SELECCION_DEUDOR = {
  idDeudor: true,
  nombreCompleto: true,
  telefono: true,
  dni: true,
} satisfies Prisma.DeudorSelect;

// --- FUNCIONES AUXILIARES ---

/**
 * Indica si un error capturado es la violación de una restricción única de Prisma (P2002).
 * Se verifica la forma del error y no su clase: en `catch` el valor llega como `unknown` y no se importan clases de Prisma.
 * En esta tabla la única restricción única además de la clave primaria es el DNI, así que P2002 significa DNI repetido.
 */
function esErrorUnicidadPrisma(valor: unknown): boolean {
  return typeof valor === "object" && valor !== null && "code" in valor && valor.code === "P2002";
}

/**
 * Resuelve el fallo de un guardado: si fue por DNI repetido, relee al deudor que lo tiene y lo informa como resultado.
 * La relectura es una consulta nueva y va fuera de cualquier transacción: en PostgreSQL un error de unicidad
 * deja abortada la transacción en curso y toda consulta posterior dentro de ella fallaría.
 * @param errorCapturado Error del `create` o `update`.
 * @param dni DNI que se intentaba guardar.
 * @throws El error original si no es de unicidad o si el deudor que causó el conflicto ya no se encuentra.
 */
async function resolverConflictoDni(errorCapturado: unknown, dni: string): Promise<ResultadoGuardarDeudor> {
  if (!esErrorUnicidadPrisma(errorCapturado)) {
    throw errorCapturado;
  }
  const deudorExistente = await buscarDeudorPorDni(dni);
  if (deudorExistente === null) {
    throw errorCapturado;
  }
  return { tipo: "DNI_DUPLICADO", deudorExistente };
}

// --- LECTURA DE UN DEUDOR ---

/**
 * Busca un deudor por su DNI (único).
 * @returns El deudor, o `null` si ningún deudor tiene ese DNI.
 */
export async function buscarDeudorPorDni(dni: string): Promise<Deudor | null> {
  return prisma.deudor.findUnique({ where: { dni }, select: SELECCION_DEUDOR });
}

/**
 * Busca un deudor por su id.
 * @returns El deudor, o `null` si no existe.
 */
export async function buscarDeudorPorId(idDeudor: number): Promise<Deudor | null> {
  return prisma.deudor.findUnique({ where: { idDeudor }, select: SELECCION_DEUDOR });
}

// --- ESCRITURA ---

/**
 * Crea un deudor.
 * Si otra alta con el mismo DNI se coló entre la verificación del service y este insert (índice único de la base),
 * devuelve `DNI_DUPLICADO` con el deudor que ganó la carrera.
 */
export async function crearDeudor(datos: DatosDeudor): Promise<ResultadoGuardarDeudor> {
  try {
    const deudor = await prisma.deudor.create({
      data: { nombreCompleto: datos.nombreCompleto, telefono: datos.telefono, dni: datos.dni },
      select: SELECCION_DEUDOR,
    });
    return { tipo: "GUARDADO", deudor };
  } catch (errorCapturado) {
    return resolverConflictoDni(errorCapturado, datos.dni);
  }
}

/**
 * Reemplaza los tres datos de un deudor existente.
 * Igual que en el alta, un DNI que otro deudor tomó mientras tanto se informa como `DNI_DUPLICADO`.
 * El service verifica antes que el deudor exista: acá no se maneja su ausencia (no hay bajas, así que no desaparece).
 */
export async function actualizarDeudorPorId(idDeudor: number, datos: DatosDeudor): Promise<ResultadoGuardarDeudor> {
  try {
    const deudor = await prisma.deudor.update({
      where: { idDeudor },
      data: { nombreCompleto: datos.nombreCompleto, telefono: datos.telefono, dni: datos.dni },
      select: SELECCION_DEUDOR,
    });
    return { tipo: "GUARDADO", deudor };
  } catch (errorCapturado) {
    return resolverConflictoDni(errorCapturado, datos.dni);
  }
}

// --- BÚSQUEDA PAGINADA ---

/**
 * Traduce el filtro a la condición de Prisma: el texto debe aparecer en el nombre o en el DNI.
 * Es el mismo criterio que `textoCliente` del historial: `contains` sin distinguir mayúsculas, donde `%` y `_`
 * actúan como comodines de LIKE. Sin texto no se filtra.
 */
function construirCondicionDeudores(filtro: FiltroDeudores): Prisma.DeudorWhereInput {
  if (filtro.busqueda === undefined) {
    return {};
  }
  return {
    OR: [
      { nombreCompleto: { contains: filtro.busqueda, mode: "insensitive" } },
      { dni: { contains: filtro.busqueda, mode: "insensitive" } },
    ],
  };
}

/**
 * Busca una página de deudores y el total que cumple el filtro.
 * Orden fijo: nombre ascendente con desempate por id ascendente; sin desempate la paginación podría repetir
 * o saltarse filas que comparten nombre. El orden alfabético depende de la intercalación de la base.
 * La lista y el total se leen en una transacción `RepeatableRead` con el mismo `where`: salen de la misma foto
 * de la base, como en el historial. No hay lecturas dependientes, así que alcanza la forma de arreglo.
 * @param filtro Filtro ya traducido.
 * @param desplazamiento Cantidad de filas a saltar.
 * @param cantidadPorPagina Cantidad máxima de filas a devolver.
 */
export async function buscarPaginaDeudores(
  filtro: FiltroDeudores,
  desplazamiento: number,
  cantidadPorPagina: number,
): Promise<PaginaDeudores> {
  const condicion = construirCondicionDeudores(filtro);

  const [filas, totalRegistros] = await prisma.$transaction(
    [
      prisma.deudor.findMany({
        where: condicion,
        orderBy: [{ nombreCompleto: "asc" }, { idDeudor: "asc" }],
        skip: desplazamiento,
        take: cantidadPorPagina,
        select: SELECCION_DEUDOR,
      }),
      prisma.deudor.count({ where: condicion }),
    ],
    { isolationLevel: "RepeatableRead" },
  );

  return { filas, totalRegistros };
}
