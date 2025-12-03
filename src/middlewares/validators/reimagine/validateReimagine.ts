import { body, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

export const validateReimagine = [
  body('image_url').isString().notEmpty().withMessage('image_url is required'),
  body('selection_bounds').isObject().withMessage('selection_bounds must be an object'),
  body('selection_bounds.x').isNumeric().withMessage('selection_bounds.x must be a number'),
  body('selection_bounds.y').isNumeric().withMessage('selection_bounds.y must be a number'),
  body('selection_bounds.width').isNumeric().withMessage('selection_bounds.width must be a number'),
  body('selection_bounds.height').isNumeric().withMessage('selection_bounds.height must be a number'),
  body('prompt').isString().notEmpty().withMessage('prompt is required'),
  body('model')
    .optional()
    .isIn(['nano-banana', 'seedream-4k'])
    .withMessage('model must be either "nano-banana" or "seedream-4k"'),
  body('referenceImage')
    .optional()
    .isString()
    .withMessage('referenceImage must be a string (URL or Base64)'),
  body('isPublic').optional().isBoolean(),

  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    next();
  },
];
