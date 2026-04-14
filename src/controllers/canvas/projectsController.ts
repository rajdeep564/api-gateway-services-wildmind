import { Request, Response } from 'express';
import { projectService } from '../../services/canvas/projectService';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { ApiError } from '../../utils/errorHandler';

export async function createProject(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { name, description, settings } = req.body;
    const project = await projectService.createProject(userId, {
      name,
      description,
      settings,
    });

    res.json(formatApiResponse('success', 'Project created', { project }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to create project', null)
    );
  }
}

export async function getProject(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { id } = req.params;
    const project = await projectService.getProject(id, userId);

    res.json(formatApiResponse('success', 'Project retrieved', { project }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to get project', null)
    );
  }
}

export async function updateProject(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { id } = req.params;
    const updates = req.body;
    const project = await projectService.updateProject(id, userId, updates);

    res.json(formatApiResponse('success', 'Project updated', { project }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to update project', null)
    );
  }
}

export async function deleteProject(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { id } = req.params;
    await projectService.deleteProject(id, userId);

    res.json(formatApiResponse('success', 'Project deleted', null));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to delete project', null)
    );
  }
}

export async function addCollaborator(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { id } = req.params;
    const { collaboratorUid, role } = req.body;

    await projectService.addCollaboratorToProject(id, userId, collaboratorUid, role);

    res.json(formatApiResponse('success', 'Collaborator added', null));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to add collaborator', null)
    );
  }
}

export async function inviteCollaborator(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { id } = req.params;
    const invitation = await projectService.inviteCollaboratorToProject(id, userId, req.body);

    res.json(formatApiResponse('success', 'Invitation sent', { invitation }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to send invitation', null)
    );
  }
}

export async function listInvitations(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const invitations = await projectService.listInvitationsForUser(userId);
    res.json(formatApiResponse('success', 'Invitations retrieved', { invitations }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to list invitations', null)
    );
  }
}

export async function listSentInvitations(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const invitations = await projectService.listSentInvitationsForUser(userId);
    res.json(formatApiResponse('success', 'Sent invitations retrieved', { invitations }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to list sent invitations', null)
    );
  }
}

export async function acceptInvitation(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { invitationId } = req.params;
    const invitation = await projectService.acceptInvitation(invitationId, userId);
    res.json(formatApiResponse('success', 'Invitation accepted', { invitation }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to accept invitation', null)
    );
  }
}

export async function dismissInvitation(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { invitationId } = req.params;
    const invitation = await projectService.dismissInvitation(invitationId, userId);
    res.json(formatApiResponse('success', 'Invitation dismissed', { invitation }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to dismiss invitation', null)
    );
  }
}

export async function cancelSentInvitation(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { invitationId } = req.params;
    const invitation = await projectService.cancelSentInvitation(invitationId, userId);
    res.json(formatApiResponse('success', 'Invitation cancelled', { invitation }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to cancel invitation', null)
    );
  }
}

export async function updateSentInvitationRole(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { invitationId } = req.params;
    const { role } = req.body;
    const invitation = await projectService.updateSentInvitationRole(invitationId, userId, role);
    res.json(formatApiResponse('success', 'Invitation role updated', { invitation }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to update invitation role', null)
    );
  }
}

export async function listProjects(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const limit = parseInt(req.query.limit as string) || 20;
    const projects = await projectService.listUserProjects(userId, limit);

    res.json(formatApiResponse('success', 'Projects retrieved', { projects }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to list projects', null)
    );
  }
}
