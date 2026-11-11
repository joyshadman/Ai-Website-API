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

const editingRoutes = express.Router();

editingRoutes.get('/tools', protect, getAvailableTools);
editingRoutes.get('/page/:projectId', protect, getEditorPage);
editingRoutes.put('/page/:projectId', protect, saveEditorPage);
editingRoutes.post('/page/:projectId', protect, saveEditorPage);
editingRoutes.post('/page/:projectId/publish', protect, setPublished);
editingRoutes.get('/page/:projectId/history', protect, getEditorHistory);
editingRoutes.get('/public/:projectId', getEditorPagePublic);

export default editingRoutes;
