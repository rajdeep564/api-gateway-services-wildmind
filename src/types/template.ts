export interface TemplateCategory {
    id: string;
    name: string;
    description: string;
    order: number;
}

export interface TemplateTheme {
    id: string;
    categoryId: string;
    name: string;
    description: string;
    order: number;
}

export interface Template {
    id: string;
    themeId: string;
    categoryId: string;
    name: string;
    data: any; // Fabric JSON
    thumbnailUrl?: string;
    metadata?: {
        width: number;
        height: number;
        tags: string[];
    };
    createdAt: FirebaseFirestore.Timestamp | Date;
    updatedAt: FirebaseFirestore.Timestamp | Date;
    isPublic: boolean;
    creatorId?: string;
}
