import { projectRepository } from '../../repository/canvas/projectRepository';
import { CanvasProject } from '../../types/canvas';
import { ApiError } from '../../utils/errorHandler';

export async function createProject(
  ownerUid: string,
  data: { name: string; description?: string; settings?: CanvasProject['settings'] }
): Promise<CanvasProject> {
  if (!data.name || data.name.trim().length === 0) {
    throw new ApiError('Project name is required', 400);
  }

  return projectRepository.createProject(ownerUid, data);
}

export async function getProject(projectId: string, userId: string): Promise<CanvasProject> {
  const project = await projectRepository.getProject(projectId);

  if (!project) {
    throw new ApiError('Project not found', 404);
  }

  // Check if user has access
  const hasAccess =
    project.ownerUid === userId ||
    project.collaborators.some(c => c.uid === userId);

  if (!hasAccess) {
    throw new ApiError('Access denied', 403);
  }

  return project;
}

export async function updateProject(
  projectId: string,
  userId: string,
  updates: Partial<CanvasProject>
): Promise<CanvasProject> {
  const project = await getProject(projectId, userId);

  // Check permissions
  const userRole = project.ownerUid === userId
    ? 'owner'
    : project.collaborators.find(c => c.uid === userId)?.role;

  if (userRole !== 'owner' && userRole !== 'editor') {
    throw new ApiError('Only owners and editors can update projects', 403);
  }

  return projectRepository.updateProject(projectId, updates);
}

export async function deleteProject(projectId: string, userId: string): Promise<void> {
  const project = await projectRepository.getProject(projectId);
  if (!project) {
    throw new Error('Project not found');
  }
  if (project.ownerUid !== userId) {
    throw new Error('Unauthorized');
  }
  return projectRepository.deleteProject(projectId);
}

export async function addCollaboratorToProject(
  projectId: string,
  ownerUid: string,
  collaboratorUid: string,
  role: 'owner' | 'editor' | 'viewer'
): Promise<void> {
  const project = await getProject(projectId, ownerUid);

  if (project.ownerUid !== ownerUid) {
    throw new ApiError('Only project owner can add collaborators', 403);
  }

  await projectRepository.addCollaborator(projectId, collaboratorUid, role);
}

export async function listUserProjects(userId: string, limit: number = 20): Promise<CanvasProject[]> {
  return projectRepository.listUserProjects(userId, limit);
}

export const projectService = {
  createProject,
  getProject,
  updateProject,
  addCollaboratorToProject,
  listUserProjects,
  deleteProject,
};

