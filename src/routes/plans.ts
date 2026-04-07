import { Router } from "express";
import * as plansController from "../controllers/plansController";

const router = Router();

router.get("/subscription-catalog", plansController.getSubscriptionCatalog);

export default router;
