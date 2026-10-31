import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    // `npx prisma db seed`: tsx ejecuta el TypeScript ESM sin compilar
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // El CLI (db push, migrate) usa la conexión directa de Supabase
    url: env("DIRECT_URL"),
  },
});
