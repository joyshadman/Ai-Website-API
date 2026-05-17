import { createUserProject, getUserCredit, getUserProjects, togglePublish, purchaseCredit } from "../controller/userController.js";
import express from "express";
import { protect } from "../middlewares/auth.js";

const userRoutes = express.Router();

userRoutes.get('/credit', protect, getUserCredit);
userRoutes.post('/project', protect, createUserProject);
userRoutes.post('/project/:projectId', protect, createUserProject);
userRoutes.get('/projects', protect, getUserProjects)
userRoutes.get('/publish-toggle/:projectId', protect, togglePublish)
userRoutes.post('/purchase-credits', protect, purchaseCredit)
export default userRoutes