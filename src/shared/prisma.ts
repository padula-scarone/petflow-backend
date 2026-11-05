import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

// --- CLIENTE DE BASE DE DATOS ---

// Runtime: usa DATABASE_URL (conexión del pooler de Supabase) a través del adaptador.
// Prisma 7 exige un adaptador de driver; el CLI usa DIRECT_URL desde prisma.config.ts.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

/** Instancia única de Prisma compartida por toda la aplicación (un solo pool de conexiones). */
export const prisma = new PrismaClient({ adapter });
