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

