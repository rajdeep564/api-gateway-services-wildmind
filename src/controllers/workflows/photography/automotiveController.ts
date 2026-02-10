import { Request, Response } from 'express';
import { generateAutomotiveShot } from '../../../services/workflows/photography/automotiveService';

export const automotiveController = async (req: Request, res: Response) => {
  try {
    const { carImage, background, lighting, motionBlur, isPublic } = req.body;
    const userId = (req as any).user?.uid || 'guest';

    if (!carImage) {
      return res.status(400).json({
        responseStatus: 'error',
        message: 'Car image is required'
      });
    }

    const result = await generateAutomotiveShot(userId, {
      carImage,
      background,
      lighting,
      motionBlur,
      isPublic
    });

    return res.status(200).json({
      responseStatus: 'success',
      data: result
    });

  } catch (error: any) {
    console.error('Automotive Controller Error:', error);
    return res.status(error.statusCode || 500).json({
      responseStatus: 'error',
      message: error.message || 'Internal server error'
    });
  }
};
