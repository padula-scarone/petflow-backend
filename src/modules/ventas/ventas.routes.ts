import { Router } from "express";
import { postRegistrarVenta } from "./ventas.controller.js";

export const ventasRouter = Router();

ventasRouter.post("/", postRegistrarVenta);
