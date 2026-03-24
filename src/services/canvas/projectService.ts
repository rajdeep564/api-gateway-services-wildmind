import { projectRepository } from '../../repository/canvas/projectRepository';
import { CanvasInvitation, CanvasProject } from '../../types/canvas';
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

export async function inviteCollaboratorToProject(
  projectId: string,
  ownerUid: string,
  input: {
    recipientUid: string;
    recipientEmail: string;
    recipientUsername?: string;
    senderEmail?: string;
    senderUsername?: string;
    role: 'owner' | 'editor' | 'viewer';
  }
): Promise<CanvasInvitation> {
  const project = await getProject(projectId, ownerUid);

  if (project.ownerUid !== ownerUid) {
    throw new ApiError('Only project owner can invite collaborators', 403);
  }

  if (!input.recipientUid) {
    throw new ApiError('Recipient uid is required', 400);
  }

  if (input.recipientUid === ownerUid) {
    throw new ApiError('You already own this project', 400);
  }

  if (project.collaborators.some((collaborator) => collaborator.uid === input.recipientUid)) {
    throw new ApiError('This user already has access to the project', 400);
  }

  const existingInvitation = await projectRepository.findPendingInvitation(projectId, input.recipientUid);
  if (existingInvitation) {
    return existingInvitation;
  }

  return projectRepository.createInvitation({
    projectId,
    projectName: project.name,
    ownerUid,
    senderUid: ownerUid,
    senderEmail: input.senderEmail,
    senderUsername: input.senderUsername,
    recipientUid: input.recipientUid,
    recipientEmail: input.recipientEmail,
    recipientUsername: input.recipientUsername,
    role: input.role,
  });
}

export async function listInvitationsForUser(userId: string): Promise<CanvasInvitation[]> {
  return projectRepository.listInvitationsForRecipient(userId);
}

export async function listSentInvitationsForUser(userId: string): Promise<CanvasInvitation[]> {
  return projectRepository.listInvitationsForSender(userId);
}

export async function acceptInvitation(invitationId: string, userId: string): Promise<CanvasInvitation> {
  const invitation = await projectRepository.getInvitation(invitationId);
  if (!invitation) {
    throw new ApiError('Invitation not found', 404);
  }

  if (invitation.recipientUid !== userId) {
    throw new ApiError('Unauthorized', 403);
  }

  if (invitation.status === 'accepted') {
    return invitation;
  }

  await projectRepository.addCollaborator(invitation.projectId, userId, invitation.role);
  return projectRepository.updateInvitation(invitationId, { status: 'accepted' });
}

export async function dismissInvitation(invitationId: string, userId: string): Promise<CanvasInvitation> {
  const invitation = await projectRepository.getInvitation(invitationId);
  if (!invitation) {
    throw new ApiError('Invitation not found', 404);
  }

  if (invitation.recipientUid !== userId) {
    throw new ApiError('Unauthorized', 403);
  }

  return projectRepository.updateInvitation(invitationId, { status: 'dismissed' });
}

export async function cancelSentInvitation(invitationId: string, userId: string): Promise<CanvasInvitation> {
  const invitation = await projectRepository.getInvitation(invitationId);
  if (!invitation) {
    throw new ApiError('Invitation not found', 404);
  }

  if (invitation.senderUid !== userId && invitation.ownerUid !== userId) {
    throw new ApiError('Unauthorized', 403);
  }

  if (invitation.status === 'accepted') {
    await projectRepository.removeCollaborator(invitation.projectId, invitation.recipientUid);
  }

  return projectRepository.updateInvitation(invitationId, { status: 'dismissed' });
}

export async function updateSentInvitationRole(
  invitationId: string,
  userId: string,
  role: 'editor' | 'viewer'
): Promise<CanvasInvitation> {
  const invitation = await projectRepository.getInvitation(invitationId);
  if (!invitation) {
    throw new ApiError('Invitation not found', 404);
  }

  if (invitation.senderUid !== userId && invitation.ownerUid !== userId) {
    throw new ApiError('Unauthorized', 403);
  }

  if (role !== 'editor' && role !== 'viewer') {
    throw new ApiError('Invalid role', 400);
  }

  if (invitation.status === 'accepted') {
    await projectRepository.addCollaborator(invitation.projectId, invitation.recipientUid, role);
  }

  return projectRepository.updateInvitation(invitationId, { role });
}

export const projectService = {
  createProject,
  getProject,
  updateProject,
  addCollaboratorToProject,
  inviteCollaboratorToProject,
  listInvitationsForUser,
  listSentInvitationsForUser,
  acceptInvitation,
  dismissInvitation,
  cancelSentInvitation,
  updateSentInvitationRole,
  listUserProjects,
  deleteProject,
};
