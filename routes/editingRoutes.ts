import express from "express";
import { protect } from "../middlewares/auth.js";
import { 
    applyEditingTool, 
    getAvailableTools, 
    uploadProjectImage, 
    deleteCanvasElement 
} from "../controller/editingController.js";

const editingRoutes = express.Router();

editingRoutes.get('/tools', protect, getAvailableTools);
editingRoutes.post('/apply/:projectId', protect, applyEditingTool);
editingRoutes.post('/upload-image/:projectId', protect, uploadProjectImage);
editingRoutes.post('/delete-element/:projectId', protect, deleteCanvasElement);

export default editingRoutes;