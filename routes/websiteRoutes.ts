import express from "express";
import { protect } from "../middlewares/auth.js";
import { checkIdParams, schemas, validate } from "../lib/http.js";
import { limits } from "../middlewares/rateLimit.js";
import {
  getWebsite,
  updateWebsite,
  deleteWebsite,
  getEditorWebsite
} from "../controller/websiteController.js";

const websiteRoutes = express.Router();
checkIdParams(websiteRoutes); // spec 0033 AC-1

websiteRoutes.get('/api/websites/:id', protect, getWebsite);
websiteRoutes.put('/api/websites/:id', protect, limits.save, validate(schemas.save), updateWebsite);
websiteRoutes.delete('/api/websites/:id', protect, deleteWebsite);
websiteRoutes.get('/api/editor/:websiteId', protect, getEditorWebsite);

export default websiteRoutes;
