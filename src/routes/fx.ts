import { Router } from "express";
import { fxController } from "../controllers/fxController";

const router = Router();

router.get("/rates", fxController.getRates);

export default router;
