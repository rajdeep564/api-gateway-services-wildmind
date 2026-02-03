import { adminDb } from '../config/firebaseAdmin';
import { Template, TemplateCategory, TemplateTheme } from '../types/template';
import { v4 as uuidv4 } from 'uuid';
import { previewService } from './previewService';

const COLLECTION_TEMPLATES = 'templates';
const COLLECTION_CATEGORIES = 'template_categories';
const COLLECTION_THEMES = 'template_themes';

export class TemplateService {
    /**
     * Get all template categories
     */
    async getCategories(): Promise<TemplateCategory[]> {
        const snapshot = await adminDb.collection(COLLECTION_CATEGORIES).orderBy('order', 'asc').get();
        return snapshot.docs.map(doc => doc.data() as TemplateCategory);
    }

    /**
     * Get all template themes, optionally filtered by category
     */
    async getThemes(categoryId?: string): Promise<TemplateTheme[]> {
        let query = adminDb.collection(COLLECTION_THEMES).orderBy('order', 'asc');

        if (categoryId) {
            query = query.where('categoryId', '==', categoryId);
        }

        const snapshot = await query.get();
        return snapshot.docs.map(doc => doc.data() as TemplateTheme);
    }

    /**
     * Get templates with filtering and pagination
     */
    async getTemplates(params: {
        category?: string;
        theme?: string;
        limit?: number;
        startAfter?: any;
        search?: string;
    }): Promise<{ templates: Template[]; lastDoc: any }> {
        let query = adminDb.collection(COLLECTION_TEMPLATES).orderBy('createdAt', 'desc');

        if (params.category) {
            query = query.where('categoryId', '==', params.category);
        }

        if (params.theme) {
            query = query.where('themeId', '==', params.theme);
        }

        if (params.limit) {
            query = query.limit(params.limit);
        }

        if (params.startAfter) {
            query = query.startAfter(params.startAfter);
        }

        const snapshot = await query.get();
        const templates = snapshot.docs.map(doc => doc.data() as Template);

        return {
            templates,
            lastDoc: snapshot.docs[snapshot.docs.length - 1]
        };
    }

    /**
     * Get a single template by ID
     */
    async getTemplateById(id: string): Promise<Template | null> {
        const doc = await adminDb.collection(COLLECTION_TEMPLATES).doc(id).get();
        if (!doc.exists) return null;
        return doc.data() as Template;
    }

    /**
     * Create a new template. Supports optional ID for migration.
     */
    async createTemplate(data: Omit<Template, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<Template> {
        const id = data.id || uuidv4();
        const now = new Date();

        // Remove id from data to avoid duplication if it was passed in
        const { id: inputId, ...rest } = data;

        const template: Template = {
            ...rest,
            id,
            createdAt: now,
            updatedAt: now,
        };

        await adminDb.collection(COLLECTION_TEMPLATES).doc(id).set(template);

        // Trigger preview generation asynchronously
        this.triggerPreviewGeneration(template);

        return template;
    }

    /**
     * Update an existing template
     */
    async updateTemplate(id: string, data: Partial<Template>): Promise<Template> {
        const ref = adminDb.collection(COLLECTION_TEMPLATES).doc(id);
        const updates = {
            ...data,
            updatedAt: new Date(),
        };

        await ref.update(updates);

        // Fetch updated template to return
        const updatedDoc = await ref.get();
        const updatedTemplate = updatedDoc.data() as Template;

        // Trigger preview generation if visual data changed
        if (data.data || data.metadata) {
            this.triggerPreviewGeneration(updatedTemplate);
        }

        return updatedTemplate;
    }

    /**
     * Delete a template
     */
    async deleteTemplate(id: string): Promise<void> {
        await adminDb.collection(COLLECTION_TEMPLATES).doc(id).delete();
    }

    private triggerPreviewGeneration(template: Template) {
        previewService.generatePreview(template).catch((err: any) => {
            console.error(`[TemplateService] Failed to generate preview for ${template.id}:`, err);
        });
    }

    // --- Admin Helpers ---

    async createCategory(category: TemplateCategory): Promise<void> {
        await adminDb.collection(COLLECTION_CATEGORIES).doc(category.id).set(category);
    }

    async createTheme(theme: TemplateTheme): Promise<void> {
        await adminDb.collection(COLLECTION_THEMES).doc(theme.id).set(theme);
    }
}

export const templateService = new TemplateService();
