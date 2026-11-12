import { createUserProject, getUserCredit, getUserProject, getUserProjects, purchaseCredit } from "../controller/userController.js";
import express from "express";
import { protect } from "../middlewares/auth.js";
import { checkIdParams, schemas, validate } from "../lib/http.js";
import { limits } from "../middlewares/rateLimit.js";

const userRoutes = express.Router();
checkIdParams(userRoutes); // spec 0033 AC-1

userRoutes.get('/credit', protect, getUserCredit);
userRoutes.post('/project', protect, limits.generate, validate(schemas.createProject), createUserProject);
userRoutes.get('/project/:projectId', protect, getUserProject);
userRoutes.get('/projects', protect, getUserProjects);
userRoutes.post('/purchase-credits', protect, purchaseCredit);

export default userRoutes;