import express from "express";
import { protect } from "../middlewares/auth.js";
import {
  getAvailableTools,
  getEditorPage,
  saveEditorPage,
  getEditorHistory,
  getEditorPagePublic
} from "../controller/editingController.js";
import { setPublished } from "../lib/publish.js";
import { checkIdParams, schemas, validate } from "../lib/http.js";
import { limits } from "../middlewares/rateLimit.js";

const editingRoutes = express.Router();
checkIdParams(editingRoutes); // spec 0033 AC-1

editingRoutes.get('/tools', protect, getAvailableTools);
editingRoutes.get('/page/:projectId', protect, getEditorPage);
editingRoutes.put('/page/:projectId', protect, limits.save, validate(schemas.save), saveEditorPage);
editingRoutes.post('/page/:projectId', protect, limits.save, validate(schemas.save), saveEditorPage);
editingRoutes.post('/page/:projectId/publish', protect, limits.publish, validate(schemas.publish), setPublished);
editingRoutes.get('/page/:projectId/history', protect, getEditorHistory);
editingRoutes.get('/public/:projectId', limits.publicRead, getEditorPagePublic);

export default editingRoutes;
