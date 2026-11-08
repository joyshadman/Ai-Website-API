import { deleteProject, getProjectById, getProjectPreview, getPublishedProjects, makeRevision, rollbackToVersion, saveProjectCode, editProjectByPrompt, toggleSaveMessage, getSavedMessages, getGenerationProgress, stopGeneration } from "../controller/projectController.js";
import { togglePublish } from "../controller/userController.js";
import { deleteAsset, listAssets, mediaReady, ownProject, parseUpload, updateAssetAlt, uploadAsset, uploadRateLimit } from "../controller/assetController.js";
import { uploadSlot } from "../lib/media.js";
import express from "express";
import { protect } from "../middlewares/auth.js";

const projectRouter = express.Router();

projectRouter.post('/revision/:projectId', protect, makeRevision)
projectRouter.post('/edit/:projectId', protect, editProjectByPrompt)
projectRouter.get('/progress/:projectId', protect, getGenerationProgress)
projectRouter.post('/stop/:projectId', protect, stopGeneration)
projectRouter.post('/rollback/:projectId/:versionId', protect, rollbackToVersion)  
projectRouter.put('/save/:projectId', protect, saveProjectCode)
projectRouter.get('/preview/:projectId', protect, getProjectPreview)
projectRouter.get('/published', getPublishedProjects)
projectRouter.put('/published/:projectId', protect, togglePublish)
projectRouter.get('/project/:projectId', getProjectById)
projectRouter.delete('/:projectId', protect, deleteProject)                
projectRouter.put('/save-message/:conversationId', protect, toggleSaveMessage)
projectRouter.get('/saved-messages/:projectId', protect, getSavedMessages)

// Project media (spec 0006)
projectRouter.get('/:projectId/assets', protect, ownProject, listAssets)
projectRouter.post('/:projectId/assets', protect, uploadRateLimit, ownProject, mediaReady, uploadSlot, parseUpload, uploadAsset)
projectRouter.patch('/:projectId/assets/:assetId', protect, ownProject, updateAssetAlt)
projectRouter.delete('/:projectId/assets/:assetId', protect, ownProject, mediaReady, deleteAsset)

export default projectRouter;