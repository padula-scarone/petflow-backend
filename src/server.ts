import cors from "cors";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { authRouter } from "./modules/auth/auth.routes.js";
import { cajaRouter } from "./modules/caja/caja.routes.js";
import { inventarioRouter } from "./modules/inventario/inventario.routes.js";
import { ventasRouter } from "./modules/ventas/ventas.routes.js";
import { configurarZodEnCastellano } from "./shared/configuracion-zod.js";
import { openapiDocument } from "./shared/openapi.js";

// Los mensajes de validación de Zod salen en castellano. Se configura una sola vez al arrancar,
// antes de recibir peticiones, porque la configuración de Zod es global a todo el proceso.
configurarZodEnCastellano();

const app = express();

// CORS: se habilita solo el origen del frontend. Va antes de las rutas para responder los preflight (OPTIONS).
// Sin la variable no se habilita ningún origen: `cors` sin `origin` caería a "*" (cualquier origen).
const origenPermitido = process.env.CORS_ORIGEN_PERMITIDO;
if (origenPermitido) {
  // No hay `credentials`: el token viaja en el encabezado Authorization, no en cookies
  app.use(cors({ origin: origenPermitido, allowedHeaders: ["Authorization", "Content-Type"] }));
} else {
  console.warn("CORS_ORIGEN_PERMITIDO no está definida: no se habilita ningún origen del frontend");
}

app.use(express.json());

// Documentación interactiva de la API
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));

app.use("/api/auth", authRouter);
app.use("/api/ventas", ventasRouter);
app.use("/api/productos", inventarioRouter);
app.use("/api/medios-pago", cajaRouter);

const puerto = Number(process.env.PORT ?? 3000);

app.listen(puerto, () => {
  console.log(`Servidor escuchando en el puerto ${puerto}`);
});
