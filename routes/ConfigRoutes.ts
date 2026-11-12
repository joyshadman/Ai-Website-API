import express from "express";
import { DAILY_START_LIMIT, GENERATION_COST, REFILL_TO } from "../lib/credits.js";
import { limits } from "../middlewares/rateLimit.js";

// Public product numbers for signed out pages (spec 0021 AC-14). No auth, no input, cacheable.
const configRouter = express.Router();

configRouter.get("/public", limits.publicRead, (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.json({ generationCost: GENERATION_COST, dailyCredits: REFILL_TO, dailyStartLimit: DAILY_START_LIMIT });
});

export default configRouter;
