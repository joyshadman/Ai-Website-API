import { deleteProject, getProjectById, getProjectPreview, getPublishedProjects, makeRevision, rollbackToVersion, saveProjectCode, editProjectByPrompt, toggleSaveMessage, getSavedMessages, getGenerationProgress, stopGeneration } from "../controller/projectController.js";
import { setPublished } from "../lib/publish.js";
import { deleteAsset, listAssets, mediaReady, ownProject, parseUpload, updateAssetAlt, uploadAsset, uploadRateLimit } from "../controller/assetController.js";
import { uploadSlot } from "../lib/media.js";
import express from "express";
import { identify, protect } from "../middlewares/auth.js";
import { checkIdParams, schemas, validate } from "../lib/http.js";
import { limits } from "../middlewares/rateLimit.js";

const projectRouter = express.Router();
checkIdParams(projectRouter); // spec 0033 AC-1

projectRouter.post('/revision/:projectId', protect, limits.generate, validate(schemas.message), makeRevision)
projectRouter.post('/edit/:projectId', protect, limits.generate, validate(schemas.message), editProjectByPrompt)
projectRouter.get('/progress/:projectId', protect, getGenerationProgress)
projectRouter.post('/stop/:projectId', protect, stopGeneration)
projectRouter.post('/rollback/:projectId/:versionId', protect, rollbackToVersion)  
projectRouter.put('/save/:projectId', protect, limits.save, validate(schemas.code), saveProjectCode)
projectRouter.get('/preview/:projectId', protect, getProjectPreview)
projectRouter.get('/published', limits.publicRead, getPublishedProjects)
projectRouter.put('/published/:projectId', protect, limits.publish, validate(schemas.publish), setPublished)
projectRouter.get('/project/:projectId', limits.publicRead, identify, getProjectById)
projectRouter.delete('/:projectId', protect, deleteProject)                
projectRouter.put('/save-message/:conversationId', protect, toggleSaveMessage)
projectRouter.get('/saved-messages/:projectId', protect, getSavedMessages)

// Project media (spec 0006)
projectRouter.get('/:projectId/assets', protect, ownProject, listAssets)
projectRouter.post('/:projectId/assets', protect, uploadRateLimit, ownProject, mediaReady, uploadSlot, parseUpload, uploadAsset)
projectRouter.patch('/:projectId/assets/:assetId', protect, ownProject, validate(schemas.alt), updateAssetAlt)
projectRouter.delete('/:projectId/assets/:assetId', protect, ownProject, mediaReady, deleteAsset)

export default projectRouter;