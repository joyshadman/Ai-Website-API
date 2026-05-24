import { deleteProject, getProjectById, getProjectPreview, getPublishedProjects, makeRevision, rollbackToVersion, saveProjectCode, editProjectByPrompt } from "../controller/projectController.js";
import { togglePublish } from "../controller/userController.js";
import express from "express";
import { protect } from "../middlewares/auth.js";

const projectRouter = express.Router();

projectRouter.post('/revision/:projectId', protect, makeRevision)
projectRouter.post('/edit/:projectId', protect, editProjectByPrompt)       
projectRouter.post('/rollback/:projectId/:versionId', protect, rollbackToVersion)  
projectRouter.put('/save/:projectId', protect, saveProjectCode)
projectRouter.get('/preview/:projectId', protect, getProjectPreview)
projectRouter.get('/published', getPublishedProjects)
projectRouter.put('/published/:projectId', protect, togglePublish)
projectRouter.get('/project/:projectId', getProjectById)
projectRouter.delete('/:projectId', protect, deleteProject)                

export default projectRouter;