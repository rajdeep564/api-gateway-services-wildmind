import { Router } from "express";
import { requireAuth } from "../middlewares/authMiddleware";
import {
  createCreditOrder,
  listCreditPacks,
  verifyCreditOrder,
} from "../controllers/paymentsController";

const router = Router();

router.get("/packs", requireAuth, listCreditPacks);
router.post("/create-order", requireAuth, createCreditOrder);
router.post("/verify", requireAuth, verifyCreditOrder);

export default router;
