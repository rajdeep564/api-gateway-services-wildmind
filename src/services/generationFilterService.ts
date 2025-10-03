import { GenerationType } from '../types/generate';
import { generationHistoryRepository } from '../repository/generationHistoryRepository';
import { publicGenerationsRepository } from '../repository/publicGenerationsRepository';

export interface FilterParams {
  limit?: number;
  page?: number;
  cursor?: string;
  generationType?: GenerationType | string;
  status?: 'generating' | 'completed' | 'failed';
  sortBy?: 'createdAt' | 'updatedAt' | 'prompt';
  sortOrder?: 'asc' | 'desc';
  createdBy?: string;
}

export interface PaginationMeta {
  limit: number;
  nextCursor?: string;
  totalCount?: number;
  hasMore?: boolean;
}

async function getUserGenerations(uid: string, params: FilterParams) {
  const limit = params.limit || 20;
  
  // Support both cursor and page-based pagination
  let cursor = params.cursor;
  if (params.page && !cursor) {
    // For page-based pagination, we need to simulate with cursor
    // This is a simplified approach - for production, consider using offset-based pagination
    cursor = undefined; // Start from beginning for now
  }
  
  const result = await generationHistoryRepository.list(uid, {
    limit,
    cursor,
    generationType: params.generationType,
    status: params.status,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  
  const meta: PaginationMeta = {
    limit,
    nextCursor: result.nextCursor,
    totalCount: result.totalCount,
    hasMore: !!result.nextCursor,
  };
  
  return {
    items: result.items,
    meta,
  };
}

async function getPublicGenerations(params: FilterParams) {
  const isAll = (params as any).limit === undefined || typeof (params as any).limit === 'string';
  let cursor = params.cursor;
  if (params.page && !cursor) {
    cursor = undefined;
  }

  if (isAll) {
    const pageSize = 1000; // safety page size for Firestore
    const aggregated: any[] = [];
    let guard = 0;
    let next = cursor;
    // Page through all public generations
    while (guard < 200) {
      const page = await publicGenerationsRepository.listPublic({
        limit: pageSize,
        cursor: next,
        generationType: params.generationType,
        status: params.status,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
        createdBy: params.createdBy,
      });
      aggregated.push(...page.items);
      if (!page.nextCursor) break;
      next = page.nextCursor;
      guard += 1;
    }
    const meta: PaginationMeta = {
      limit: aggregated.length,
      nextCursor: undefined,
      totalCount: aggregated.length,
      hasMore: false,
    };
    return { items: aggregated, meta };
  }

  const limit = params.limit || 20;
  const result = await publicGenerationsRepository.listPublic({
    limit,
    cursor,
    generationType: params.generationType,
    status: params.status,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
    createdBy: params.createdBy,
  });
  const meta: PaginationMeta = {
    limit,
    nextCursor: result.nextCursor,
    totalCount: result.totalCount,
    hasMore: !!result.nextCursor,
  };
  return { items: result.items, meta };
}

async function validateAndTransformParams(queryParams: any): Promise<FilterParams> {
  const params: FilterParams = {};
  
  // Handle limit
  if (queryParams.limit) {
    const limit = parseInt(queryParams.limit, 10);
    if (isNaN(limit) || limit < 1 || limit > 100) {
      throw new Error('Limit must be between 1 and 100');
    }
    params.limit = limit;
  }
  
  // Handle page
  if (queryParams.page) {
    const page = parseInt(queryParams.page, 10);
    if (isNaN(page) || page < 1) {
      throw new Error('Page must be a positive integer');
    }
    params.page = page;
  }
  
  // Handle cursor
  if (queryParams.cursor) {
    params.cursor = queryParams.cursor;
  }
  
  // Handle generationType
  const validGenerationTypes = [
    'text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music',
    'mockup-generation', 'product-generation', 'ad-generation', 'live-chat'
  ];
  
  if (queryParams.generationType) {
    if (validGenerationTypes.includes(queryParams.generationType)) {
      params.generationType = queryParams.generationType;
    } else {
      throw new Error(`Invalid generationType. Must be one of: ${validGenerationTypes.join(', ')}`);
    }
  }
  
  // Handle status
  const validStatuses = ['generating', 'completed', 'failed'];
  if (queryParams.status) {
    if (validStatuses.includes(queryParams.status)) {
      params.status = queryParams.status as any;
    } else {
      throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }
  }
  
  // Handle sortBy
  const validSortFields = ['createdAt', 'updatedAt', 'prompt'];
  if (queryParams.sortBy) {
    if (validSortFields.includes(queryParams.sortBy)) {
      params.sortBy = queryParams.sortBy as any;
    } else {
      throw new Error(`Invalid sortBy. Must be one of: ${validSortFields.join(', ')}`);
    }
  }
  
  // Handle sortOrder
  const validSortOrders = ['asc', 'desc'];
  if (queryParams.sortOrder) {
    if (validSortOrders.includes(queryParams.sortOrder)) {
      params.sortOrder = queryParams.sortOrder as any;
    } else {
      throw new Error(`Invalid sortOrder. Must be one of: ${validSortOrders.join(', ')}`);
    }
  }
  
  // Handle createdBy
  if (queryParams.createdBy) {
    params.createdBy = queryParams.createdBy;
  }
  
  return params;
}

export const generationFilterService = {
  getUserGenerations,
  getPublicGenerations,
  validateAndTransformParams,
};
