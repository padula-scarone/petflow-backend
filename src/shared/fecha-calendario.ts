// --- FECHAS DE CALENDARIO (COLUMNAS `date`) ---
// Una columna `date` no tiene hora ni huso horario: Prisma la maneja como un instante a medianoche UTC.
// Por eso se escribe y se lee SIEMPRE con partes UTC. Con la hora local (`getDate`, `toLocaleDateString`,
// `new Date(anio, mes, dia)`) la fecha correría un día según la zona horaria del servidor.
// Solo los repositories las usan: son quienes hablan con Prisma; el resto del código ve texto `AAAA-MM-DD`.

/**
 * Convierte un texto `AAAA-MM-DD` a la fecha que escribe Prisma en una columna `date` (medianoche UTC).
 * @param fecha Fecha de calendario ya validada, o `null`/`undefined` si no hay.
 * @returns La fecha, o `null` si no hay (`undefined` también se guarda como nulo).
 */
export function textoAFechaCalendario(fecha: string | null | undefined): Date | null {
  return fecha === undefined || fecha === null ? null : new Date(`${fecha}T00:00:00.000Z`);
}

/**
 * Convierte una fecha leída de una columna `date` a texto `AAAA-MM-DD` (partes UTC).
 * @param fecha Fecha leída de Prisma, o `null` si la columna es nula.
 * @returns El texto, o `null` si no hay fecha.
 */
export function fechaCalendarioATexto(fecha: Date | null): string | null {
  return fecha === null ? null : fecha.toISOString().slice(0, 10);
}
