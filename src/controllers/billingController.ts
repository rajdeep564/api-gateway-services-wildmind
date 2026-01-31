
import { Request, Response } from 'express';
import { creditsRepository } from '../repository/creditsRepository';
import { logger } from '../utils/logger';
import { formatApiResponse } from '../utils/formatApiResponse';

export const billingController = {
  getUserInvoices: async (req: Request, res: Response) => {
    try {
      const uid = (req as any).uid;
      const invoices = await creditsRepository.listInvoices(uid);
      return res.json(formatApiResponse('success', 'Invoices fetched successfully', invoices));
    } catch (error: any) {
      logger.error({ uid: (req as any).uid, err: error.message }, 'Failed to fetch invoices');
      return res.status(500).json(formatApiResponse('error', 'Failed to fetch invoices', null));
    }
  },

  getPaymentHistory: async (req: Request, res: Response) => {
    try {
      const uid = (req as any).uid;
      const payments = await creditsRepository.listPayments(uid);
      return res.json(formatApiResponse('success', 'Payment history fetched successfully', payments));
    } catch (error: any) {
      logger.error({ uid: (req as any).uid, err: error.message }, 'Failed to fetch payment history');
      return res.status(500).json(formatApiResponse('error', 'Failed to fetch payment history', null));
    }
  }
};
