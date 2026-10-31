import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // El CLI (db push, migrate) usa la conexión directa de Supabase
    url: env("DIRECT_URL"),
  },
});
