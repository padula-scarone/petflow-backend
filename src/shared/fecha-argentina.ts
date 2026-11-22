// --- CONSTANTES ---

/** Horas que Argentina (UTC-3, sin horario de verano) está por detrás de UTC. */
export const HORAS_DESFASE_ARGENTINA_RESPECTO_UTC = 3;

/** Milisegundos que dura una hora, para correr un instante al huso horario de Argentina. */
const MILISEGUNDOS_POR_HORA = 3_600_000;

// --- FECHA DE HOY ---

/**
 * Devuelve la fecha de calendario (`AAAA-MM-DD`) que rige en Argentina en un instante dado.
 * Es pura a propósito: no lee el reloj, lo recibe. Quien orquesta toma `new Date()` y lo inyecta, así el cálculo se prueba
 * con cualquier instante y no depende de la zona horaria del servidor (solo usa partes UTC).
 * El día argentino empieza a las 03:00 UTC: antes de esa hora todavía rige el día anterior.
 * @param ahora Instante de referencia (reloj del servidor).
 * @example calcularHoyArgentina(new Date("2026-11-30T02:59:59.000Z")) // "2026-11-29"
 * @example calcularHoyArgentina(new Date("2026-11-30T03:00:00.000Z")) // "2026-11-30"
 */
export function calcularHoyArgentina(ahora: Date): string {
  const instanteArgentino = new Date(ahora.getTime() - HORAS_DESFASE_ARGENTINA_RESPECTO_UTC * MILISEGUNDOS_POR_HORA);
  // Los primeros 10 caracteres del texto ISO son siempre AAAA-MM-DD en UTC, es decir, la fecha argentina ya corrida
  return instanteArgentino.toISOString().slice(0, 10);
}
