import express from "express";
import swaggerUi from "swagger-ui-express";
import { ventasRouter } from "./modules/ventas/ventas.routes.js";
import { openapiDocument } from "./shared/openapi.js";

const app = express();

app.use(express.json());

// Documentación interactiva de la API
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));

app.use("/ventas", ventasRouter);

const puerto = Number(process.env.PORT ?? 3000);

app.listen(puerto, () => {
  console.log(`Servidor escuchando en el puerto ${puerto}`);
});
