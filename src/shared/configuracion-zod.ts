import { z } from "zod";

// --- CONFIGURACION DE ZOD ---

/**
 * Configura Zod para que sus mensajes de validacion por defecto salgan en castellano.
 * Debe llamarse una sola vez al arrancar la aplicacion, antes de procesar cualquier peticion:
 * `z.config` modifica la configuracion global de Zod, por eso no se invoca desde ningun modulo.
 * Solo reemplaza los mensajes que Zod genera solo (tipo incorrecto, valor muy chico, etc.):
 * los mensajes propios de cada esquema (`.min(1, "...")`) no se tocan.
 */
export function configurarZodEnCastellano(): void {
  z.config(z.locales.es());
}
