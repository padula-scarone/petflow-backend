import bcrypt from "bcryptjs";
import { prisma } from "../src/shared/prisma.js";

// Usuarios semilla para probar el inicio de sesión (SSOT, sección 2). Se ejecuta con `npx prisma db seed`.
// Nunca imprime claves ni hashes.

// --- CONSTANTES ---

/** Cost factor de bcrypt: el mismo con el que se generan los hashes del sistema. */
const COST_FACTOR_BCRYPT = 10;

/** Un usuario semilla y la variable de entorno de la que se lee su clave. */
type UsuarioSemilla = {
  username: string;
  nombre: string;
  rol: "VENDEDOR" | "GESTOR_COMERCIAL" | "GERENTE";
  variableClave: string;
};

/** Uno por rol. `demo.vendedor` ya existe en la BD: se conserva su vínculo con las ventas cargadas. */
const USUARIOS_SEMILLA: UsuarioSemilla[] = [
  { username: "demo.vendedor", nombre: "Vendedor Demo", rol: "VENDEDOR", variableClave: "SEED_CLAVE_VENDEDOR" },
  {
    username: "demo.gestor.comercial",
    nombre: "Gestor Comercial Demo",
    rol: "GESTOR_COMERCIAL",
    variableClave: "SEED_CLAVE_GESTOR_COMERCIAL",
  },
  { username: "demo.gerente", nombre: "Gerente Demo", rol: "GERENTE", variableClave: "SEED_CLAVE_GERENTE" },
];

// --- EJECUCIÓN ---

async function ejecutarSeed(): Promise<void> {
  // Se validan las tres claves antes de escribir: si falta alguna, no se toca la base
  const variablesFaltantes = USUARIOS_SEMILLA.filter((usuario) => !process.env[usuario.variableClave]).map(
    (usuario) => usuario.variableClave,
  );
  if (variablesFaltantes.length > 0) {
    console.error(`Faltan variables de entorno: ${variablesFaltantes.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  for (const usuario of USUARIOS_SEMILLA) {
    const passwordHash = await bcrypt.hash(process.env[usuario.variableClave] as string, COST_FACTOR_BCRYPT);

    // Idempotente: si el usuario existe solo se actualiza el hash (no se pisan nombre, rol ni estado)
    await prisma.usuario.upsert({
      where: { username: usuario.username },
      update: { passwordHash },
      create: {
        username: usuario.username,
        nombre: usuario.nombre,
        rol: usuario.rol,
        passwordHash,
        estado: "ACTIVO",
      },
    });
    console.log(`Usuario semilla listo: ${usuario.username}`);
  }
}

ejecutarSeed()
  .catch((errorCapturado) => {
    // No se imprime el mensaje: los errores de Prisma pueden incluir los argumentos de la llamada (el hash)
    console.error(`No se pudieron cargar los usuarios semilla (${errorCapturado instanceof Error ? errorCapturado.name : "error desconocido"})`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
