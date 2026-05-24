import { deleteProject, getProjectById, getProjectPreview, getPublishedProjects, makeRevision, rollbackToVersion, saveProjectCode, editProjectByPrompt } from "../controller/projectController.js";
import { togglePublish } from "../controller/userController.js";
import express from "express";
import { protect } from "../middlewares/auth.js";

const projectRouter = express.Router();

projectRouter.post('/revision/:projectId', protect, makeRevision)
projectRouter.put('/save/:projectId', protect, saveProjectCode)
projectRouter.get('/rollback/:projectId/:versionId', protect, rollbackToVersion)
projectRouter.delete('/:projectId', protect, deleteProject)
projectRouter.get('/preview/:projectId', protect, getProjectPreview)
projectRouter.get('/published', getPublishedProjects)
projectRouter.put('/published/:projectId', protect, togglePublish)
projectRouter.post('/edit/:projectId', protect, editProjectByPrompt)

export default projectRouter;