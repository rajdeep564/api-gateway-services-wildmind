import { Request, Response, NextFunction } from 'express';
import { templateService } from '../services/templateService';
import { ApiError } from '../utils/errorHandler';
import { formatApiResponse } from '../utils/formatApiResponse';
import { TemplateCategory, TemplateTheme } from '../types/template';

export class TemplateController {

    async getCategories(req: Request, res: Response, next: NextFunction) {
        try {
            const categories = await templateService.getCategories();
            res.json(formatApiResponse('success', 'Values fetched successfully', categories));
        } catch (error) {
            next(error);
        }
    }

    async getThemes(req: Request, res: Response, next: NextFunction) {
        try {
            const categoryId = req.query.category as string;
            const themes = await templateService.getThemes(categoryId);
            res.json(formatApiResponse('success', 'Values fetched successfully', themes));
        } catch (error) {
            next(error);
        }
    }

    async getTemplates(req: Request, res: Response, next: NextFunction) {
        try {
            const { category, theme, limit, startAfter, search } = req.query;
            const result = await templateService.getTemplates({
                category: category as string,
                theme: theme as string,
                limit: limit ? Number(limit) : 20,
                startAfter,
                search: search as string,
            });
            res.json(formatApiResponse('success', 'Templates fetched successfully', result.templates, {
                nextCursor: result.lastDoc ? result.lastDoc.id : null // Simple cursor for now
            } as any));
        } catch (error) {
            next(error);
        }
    }

    async getTemplateById(req: Request, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const template = await templateService.getTemplateById(id);
            if (!template) {
                throw new ApiError('Template not found', 404);
            }
            res.json(formatApiResponse('success', 'Template fetched successfully', template));
        } catch (error) {
            next(error);
        }
    }

    async createTemplate(req: Request, res: Response, next: NextFunction) {
        try {
            // In a real app, validate req.body against schema (e.g. Zod)
            const data = req.body;
            const newTemplate = await templateService.createTemplate({
                ...data,
                creatorId: (req as any).uid
            });
            res.status(201).json(formatApiResponse('success', 'Template created successfully', newTemplate));
        } catch (error) {
            next(error);
        }
    }

    async updateTemplate(req: Request, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const data = req.body;
            const updatedTemplate = await templateService.updateTemplate(id, data);
            res.json(formatApiResponse('success', 'Template updated successfully', updatedTemplate));
        } catch (error) {
            next(error);
        }
    }

    async deleteTemplate(req: Request, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            await templateService.deleteTemplate(id);
            res.json(formatApiResponse('success', 'Template deleted successfully', null));
        } catch (error) {
            next(error);
        }
    }

    // Admin util to seed params
    async createCategory(req: Request, res: Response, next: NextFunction) {
        try {
            await templateService.createCategory(req.body);
            res.json(formatApiResponse('success', 'Category created', null));
        } catch (err) { next(err); }
    }

    async createTheme(req: Request, res: Response, next: NextFunction) {
        try {
            await templateService.createTheme(req.body);
            res.json(formatApiResponse('success', 'Theme created', null));
        } catch (err) { next(err); }
    }
}

export const templateController = new TemplateController();
