import { Router } from 'express';
import axios from 'axios';
import { env } from '../config/env';
import { normalizeApiError } from '../utils/errorHandler';

const router = Router();
const CREDIT_SERVICE_URL = env.creditServiceUrl;

/**
 * Razorpay Webhook Proxy
 * Forwards webhook requests from Razorpay directly to credit-service
 */
router.post('/razorpay', async (req, res) => {
  try {
    console.log('🔔 Webhook received at API Gateway, forwarding to credit-service...');
    
    // Forward the entire request to credit-service
    const response = await axios.post(
      `${CREDIT_SERVICE_URL}/webhooks/razorpay`,
      req.body,
      {
        headers: {
          'x-razorpay-signature': req.headers['x-razorpay-signature'] || '',
          'content-type': 'application/json',
        },
      }
    );

    console.log('✅ Webhook forwarded successfully');
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      '❌ Webhook forwarding error:',
      axios.isAxiosError(error) ? error.response?.data || error.message : error,
    );
    const { status, payload } = normalizeApiError(error, 'Webhook forwarding failed');
    res.status(status).json(payload);
  }
});

export default router;
