import axios from 'axios';

/**
 * Verify Cloudflare Turnstile captcha token
 * Call this on your backend before processing form submissions
 * 
 * @param token - The captcha token from frontend
 * @param ipAddress - User's IP address
 * @returns Promise<boolean> - true if verification successful
 */
export async function verifyTurnstileToken(
  token: string,
  ipAddress: string
): Promise<boolean> {
  try {
    const secretKey = process.env.TURNSTILE_SECRET_KEY;
    
    if (!secretKey) {
      console.error('❌ TURNSTILE_SECRET_KEY not configured in environment');
      return false;
    }

    console.log('🔐 Verifying Turnstile token for IP:', ipAddress);

    const response = await axios.post(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        secret: secretKey,
        response: token,
        remoteip: ipAddress,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Turnstile verification response:', response.data);

    return response.data.success === true;
  } catch (error: any) {
    console.error('❌ Turnstile verification error:', error.message);
    return false;
  }
}

/**
 * Express middleware to verify Turnstile captcha
 * Add this before your route handlers
 * 
 * Example usage:
 * router.post('/api/contact', verifyCaptchaMiddleware, contactController);
 */
export async function verifyCaptchaMiddleware(req: any, res: any, next: any) {
  const captchaToken = req.body.captchaToken;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  if (!captchaToken) {
    return res.status(400).json({
      responseStatus: 'error',
      message: 'Captcha token is required',
    });
  }

  const isValid = await verifyTurnstileToken(captchaToken, ip);

  if (!isValid) {
    return res.status(400).json({
      responseStatus: 'error',
      message: 'Invalid captcha verification. Please try again.',
    });
  }

  // Captcha valid, continue to next middleware/handler
  next();
}
