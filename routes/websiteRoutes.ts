import express from "express";
import { protect } from "../middlewares/auth.js";
import {
  getWebsite,
  updateWebsite,
  deleteWebsite,
  getEditorWebsite
} from "../controller/websiteController.js";

const websiteRoutes = express.Router();

websiteRoutes.get('/api/websites/:id', protect, getWebsite);
websiteRoutes.put('/api/websites/:id', protect, updateWebsite);
websiteRoutes.delete('/api/websites/:id', protect, deleteWebsite);
websiteRoutes.get('/api/editor/:websiteId', protect, getEditorWebsite);

export default websiteRoutes;
