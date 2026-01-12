import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { generateLogo, CreateLogoRequest } from '../../../services/workflows/branding/createLogoService';

export async function createLogoController(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const {
            image,
            companyName,
            industry,
            styles,
            personalities,
            color,
            format,
            fileType,
            isPublic
        } = req.body;

        if (!image && !companyName) {
            throw new ApiError('Either an image sketch or a company name is required', 400);
        }

        const requestPayload: CreateLogoRequest = {
            image,
            companyName: companyName || "",
            industry: industry || "",
            styles: styles || [],
            personalities: personalities || [],
            color: color || null,
            format: format || "Icon",
            fileType: fileType || "PNG",
            isPublic
        };

        // Service call
        const result = await generateLogo(uid, requestPayload);

        // Credit deduction logic (90 credits)
        const CREDIT_COST = 90;
        const ctx: any = { creditCost: CREDIT_COST };

        console.log(`[createLogoController] Calling postSuccessDebit for uid=${uid} historyId=${result.historyId} cost=${CREDIT_COST}`);
        const debitOutcome = await postSuccessDebit(uid, result, ctx, 'replicate', 'create-logo');
        console.log(`[createLogoController] postSuccessDebit outcome: ${debitOutcome}`);

        const responseData = {
            images: result.images,
            historyId: result.historyId,
            model: result.model,
            status: 'completed',
            debug: {
                debitOutcome,
                creditCost: CREDIT_COST,
                historyId: result.historyId,
                uid
            }
        };

        res.json({
            responseStatus: 'success',
            message: 'OK',
            data: responseData
        });
    } catch (error) {
        next(error);
    }
}
