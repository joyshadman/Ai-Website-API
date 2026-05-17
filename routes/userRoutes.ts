import { createUserProject, getUserCredit, getUserProject, getUserProjects, purchaseCredit } from "../controller/userController.js";
import express from "express";
import { protect } from "../middlewares/auth.js";

const userRoutes = express.Router();

userRoutes.get('/credit', protect, getUserCredit);
userRoutes.post('/project', protect, createUserProject);
userRoutes.get('/project/:projectId', protect, getUserProject);
userRoutes.get('/projects', protect, getUserProjects);
userRoutes.post('/purchase-credits', protect, purchaseCredit);

export default userRoutes;