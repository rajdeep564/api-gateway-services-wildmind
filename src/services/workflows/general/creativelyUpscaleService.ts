import { falService } from '../../falService';
import { ApiError } from '../../../utils/errorHandler';

export interface CreativelyUpscaleRequest {
    imageUrl: string;
    upscaleFactor?: number;
}

/**
 * Service to handle Creatively Upscale workflow using SeedVR
 */
export async function creativelyUpscale(uid: string, request: CreativelyUpscaleRequest) {
    if (!request.imageUrl) {
        throw new ApiError('Image URL is required', 400);
    }

    const upscaleFactor = request.upscaleFactor || 2;

    // Use SeedVR image upscale from falService
    return await falService.seedvrUpscaleImage(uid, {
        image: request.imageUrl,
        upscale_factor: upscaleFactor,
        upscale_mode: 'factor'
    });
}
