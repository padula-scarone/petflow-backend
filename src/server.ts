import cors from "cors";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { authRouter } from "./modules/auth/auth.routes.js";
import { cajaRouter } from "./modules/caja/caja.routes.js";
import { inventarioRouter } from "./modules/inventario/inventario.routes.js";
import { ventasRouter } from "./modules/ventas/ventas.routes.js";
import { configurarZodEnCastellano } from "./shared/configuracion-zod.js";
import { manejarErrorInesperado, manejarErrorLecturaCuerpo, manejarRutaInexistente } from "./shared/manejo-errores.js";
import { openapiDocument } from "./shared/openapi.js";
import { getSalud } from "./shared/salud.js";

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

// Salud del servicio: pública (sin token) y sin base de datos, para el chequeo de la plataforma de deploy
app.get("/api/salud", getSalud);

// Documentación interactiva de la API
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));

app.use("/api/auth", authRouter);
app.use("/api/ventas", ventasRouter);
app.use("/api/productos", inventarioRouter);
app.use("/api/medios-pago", cajaRouter);

// --- MANEJO DE ERRORES ---
// El orden importa: Express ejecuta estos middlewares en el orden en que se registran,
// y solo llegan hasta acá las peticiones que ninguna ruta atendió o que fallaron.

// 404 en JSON: va después de todas las rutas y de /docs
app.use(manejarRutaInexistente);
// Errores de lectura del cuerpo (JSON inválido, cuerpo muy grande, codificación no soportada)
app.use(manejarErrorLecturaCuerpo);
// Último recurso: cualquier otro error responde 500 genérico, con el detalle solo en la consola
app.use(manejarErrorInesperado);

const puerto = Number(process.env.PORT ?? 3000);

app.listen(puerto, () => {
  console.log(`Servidor escuchando en el puerto ${puerto}`);
});
