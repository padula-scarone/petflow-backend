import express from "express";
import { ventasRouter } from "./modules/ventas/ventas.routes.js";

const app = express();

app.use(express.json());
app.use("/ventas", ventasRouter);

const puerto = Number(process.env.PORT ?? 3000);

app.listen(puerto, () => {
  console.log(`Servidor escuchando en el puerto ${puerto}`);
});
