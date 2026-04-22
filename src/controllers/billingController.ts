import axios from 'axios';
import { Request, Response } from 'express';
import '../types/http';
import { creditsRepository } from '../repository/creditsRepository';
import { logger } from '../utils/logger';
import { formatApiResponse } from '../utils/formatApiResponse';
import { normalizeApiError } from '../utils/errorHandler';

const CREDIT_SERVICE_URL =
  process.env.CREDIT_SERVICE_URL || 'http://credit-service:3000';

function creditServiceAuthHeaders(
  req: Request,
): Record<string, string> | undefined {
  if (req.verifiedAuthToken) {
    return { Authorization: `Bearer ${req.verifiedAuthToken}` };
  }
  const auth = req.headers.authorization;
  if (!auth) return undefined;
  return { Authorization: auth };
}

export const billingController = {
  getBillingSummary: async (req: Request, res: Response) => {
    try {
      const uid = (req as any).uid as string;
      const headers = creditServiceAuthHeaders(req);

      const info = await creditsRepository.readUserInfo(uid);
      const subscriptionRes = await axios
        .get(`${CREDIT_SERVICE_URL}/subscriptions/me/${uid}`, { headers })
        .catch(() => null);

      return res.json(
        formatApiResponse('success', 'Billing summary fetched', {
          planCode: info?.planCode || 'FREE',
          creditBalance: Number(info?.creditBalance || 0),
          storageUsedBytes: info?.storageUsedBytes?.toString() || '0',
          storageQuotaBytes: info?.storageQuotaBytes?.toString() || '0',
          subscription: subscriptionRes?.data?.data ?? null,
          billingSource: info ? 'credit-service' : 'firestore',
          billingSyncedAt: new Date().toISOString(),
        }),
      );
    } catch (error: any) {
      logger.error(
        { uid: (req as any).uid, err: error?.message },
        'getBillingSummary failed',
      );
      const { status, payload } = normalizeApiError(
        error,
        'Failed to fetch billing summary',
      );
      return res.status(status).json(payload);
    }
  },

  getUserInvoices: async (req: Request, res: Response) => {
    try {
      const uid = (req as any).uid;
      const invoices = await creditsRepository.listInvoices(
        uid,
        creditServiceAuthHeaders(req),
      );
      return res.json(formatApiResponse('success', 'Invoices fetched successfully', invoices));
    } catch (error: any) {
      logger.error({ uid: (req as any).uid, err: error.message }, 'Failed to fetch invoices');
      const { status, payload } = normalizeApiError(error, 'Failed to fetch invoices');
      return res.status(status).json(payload);
    }
  },

  getPaymentHistory: async (req: Request, res: Response) => {
    try {
      const uid = (req as any).uid;
      const payments = await creditsRepository.listPayments(
        uid,
        creditServiceAuthHeaders(req),
      );
      return res.json(formatApiResponse('success', 'Payment history fetched successfully', payments));
    } catch (error: any) {
      logger.error({ uid: (req as any).uid, err: error.message }, 'Failed to fetch payment history');
      const { status, payload } = normalizeApiError(
        error,
        'Failed to fetch payment history',
      );
      return res.status(status).json(payload);
    }
  },

  getInvoiceDetail: async (req: Request, res: Response) => {
    try {
      const uid = (req as any).uid;
      const invoiceId = req.params.invoiceId;
      const response = await axios.get(
        `${CREDIT_SERVICE_URL}/billing/invoice/${invoiceId}`,
        {
          headers: creditServiceAuthHeaders(req),
          params: { userId: uid },
        },
      );
      return res.status(response.status).json(response.data);
    } catch (error: any) {
      logger.error(
        { uid: (req as any).uid, err: error?.message },
        'getInvoiceDetail failed',
      );
      const { status, payload } = normalizeApiError(
        error,
        'Failed to fetch invoice detail',
      );
      return res.status(status).json(payload);
    }
  },

  downloadInvoicePdf: async (req: Request, res: Response) => {
    try {
      const uid = (req as any).uid;
      const invoiceId = req.params.invoiceId;
      const response = await axios.get(
        `${CREDIT_SERVICE_URL}/billing/invoice/${invoiceId}/download`,
        {
          headers: creditServiceAuthHeaders(req),
          params: { userId: uid },
          responseType: 'arraybuffer',
        },
      );

      res.setHeader(
        'Content-Type',
        response.headers['content-type'] || 'application/pdf',
      );
      const disposition = response.headers['content-disposition'];
      if (disposition) {
        res.setHeader('Content-Disposition', disposition);
      }
      return res.status(response.status).send(Buffer.from(response.data));
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.data) {
        const { status, payload } = normalizeApiError(
          error,
          'Failed to download invoice PDF',
        );
        return res.status(status).json(payload);
      }
      logger.error(
        { uid: (req as any).uid, err: error?.message },
        'downloadInvoicePdf failed',
      );
      const { status, payload } = normalizeApiError(
        error,
        'Failed to download invoice PDF',
      );
      return res.status(status).json(payload);
    }
  },

  validateGSTIN: async (req: Request, res: Response) => {
    try {
      const response = await axios.post(
        `${CREDIT_SERVICE_URL}/billing/validate-gstin`,
        {
          gstin: req.body?.gstin,
          force: req.body?.force === true || req.body?.force === 'true',
        },
        { headers: creditServiceAuthHeaders(req) },
      );
      return res.status(response.status).json(response.data);
    } catch (error: any) {
      logger.error(
        { uid: (req as any).uid, err: error?.message },
        'validateGSTIN failed',
      );
      const { status, payload } = normalizeApiError(error, 'GST verification failed');
      return res.status(status).json(payload);
    }
  },
};
