import { prisma } from "../../shared/prisma.js";
import type { UsuarioConCredenciales } from "./auth.types.js";

// --- CONSULTA DE USUARIO ---

/**
 * Busca un usuario por su `username` (coincidencia exacta). Es la única capa del módulo que toca Prisma.
 * @param username Nombre de usuario ya validado.
 * @returns El usuario con su hash, o `null` si no existe.
 */
export async function buscarUsuarioPorUsername(username: string): Promise<UsuarioConCredenciales | null> {
  return prisma.usuario.findUnique({
    where: { username },
    // Solo lo necesario para validar la clave y armar la respuesta
    select: {
      idUsuario: true,
      username: true,
      nombre: true,
      rol: true,
      passwordHash: true,
      estado: true,
    },
  });
}
