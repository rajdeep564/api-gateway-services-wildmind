import nodemailer from 'nodemailer';
import { env } from '../config/env';

let transporter: any | null = null;
let lastCredentials: { user?: string; pass?: string } | null = null;

/**
 * Reset the transporter to force recreation with new credentials
 * Call this after updating EMAIL_USER or EMAIL_APP_PASSWORD in .env
 */
export function resetTransporter(): void {
  console.log('[MAIL] Resetting transporter to use new credentials');
  if (transporter) {
    try {
      transporter.close();
    } catch (e) {
      // Ignore errors when closing
    }
  }
  transporter = null;
  lastCredentials = null;
}

function getTransporter() {
  // Check if credentials have changed - if so, reset transporter
  const currentUser = env.emailUser || env.smtpUser;
  const currentPass = env.emailAppPassword || env.smtpPass;
  
  if (transporter && lastCredentials) {
    if (lastCredentials.user !== currentUser || lastCredentials.pass !== currentPass) {
      console.log('[MAIL] Credentials changed, resetting transporter');
      resetTransporter();
    }
  }

  if (transporter) return transporter;

  // Preferred: Gmail App Password flow
  const gmailUser = env.emailUser;
  const gmailPass = env.emailAppPassword;
  if (gmailUser && gmailPass) {
    console.log('[MAIL] Creating Gmail transporter', {
      user: gmailUser,
      hasPassword: !!gmailPass,
      passwordLength: gmailPass?.length || 0
    });
    
    transporter = nodemailer.createTransport({
      host: env.gmailSmtpHost,
      port: env.gmailSmtpPort,
      secure: true,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      auth: { 
        user: gmailUser, 
        pass: gmailPass 
      }
    });
    
    // Store credentials to detect changes
    lastCredentials = { user: gmailUser, pass: gmailPass };
    
    // Verify connection on creation
    transporter.verify((error: any, success: any) => {
      if (error) {
        console.error('[MAIL] Gmail transporter verification failed:', {
          code: error.code,
          command: error.command,
          message: error.message,
          user: gmailUser
        });
      } else {
        console.log('[MAIL] Gmail transporter verified successfully');
      }
    });
    
    return transporter;
  }

  // Generic SMTP fallback
  const host = env.smtpHost;
  const port = env.smtpPort;
  const user = env.smtpUser;
  const pass = env.smtpPass;
  if (host && port && user && pass) {
    console.log('[MAIL] Creating generic SMTP transporter', {
      host,
      port,
      user,
      hasPassword: !!pass
    });
    
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      auth: { user, pass }
    });
    
    // Store credentials to detect changes
    lastCredentials = { user, pass };
    
    return transporter;
  }
  
  return transporter;
}

/**
 * Send email using Resend API as primary, Gmail SMTP as fallback
 */
async function sendEmailViaResend(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  // Check if Resend is configured
  if (!env.resendApiKey) {
    console.log('[MAIL] Resend API key not configured, skipping Resend');
    return false;
  }
  
  if (!env.smtpFrom) {
    console.log('[MAIL] SMTP_FROM not configured, skipping Resend');
    return false;
  }

  try {
    const resendApiBase = env.resendApiBase || 'https://api.resend.com';
    const payload: any = {
      from: env.smtpFrom,
      to,
      subject,
      text
    };
    
    // Add HTML if provided
    if (html) {
      payload.html = html;
    }
    
    console.log(`[MAIL] Attempting to send email via Resend to ${to} from ${env.smtpFrom}`);
    
    const resp = await fetch(`${resendApiBase}/emails`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (resp.ok) {
      const result = await resp.json().catch(() => ({}));
      console.log(`[MAIL] Resend email sent successfully to ${to}`, result);
      return true;
    } else {
      const errTxt = await resp.text().catch(() => '');
      console.error(`[MAIL] Resend send failed: ${resp.status} ${resp.statusText}`, {
        error: errTxt,
        from: env.smtpFrom,
        to,
        hasApiKey: !!env.resendApiKey,
        apiKeyLength: env.resendApiKey?.length || 0
      });
      return false;
    }
  } catch (e: any) {
    console.error(`[MAIL] Resend error: ${e?.message}`, {
      stack: e?.stack,
      from: env.smtpFrom,
      to,
      hasApiKey: !!env.resendApiKey
    });
    return false;
  }
}

/**
 * Send email using Gmail SMTP as fallback
 */
async function sendEmailViaSMTP(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  const from = env.smtpFrom || env.emailUser;
  const t = getTransporter();
  
  if (!t || !from) {
    return false;
  }

  try {
    const mailOptions: any = { from, to, subject, text };
    
    // Add HTML if provided
    if (html) {
      mailOptions.html = html;
    }
    
    await t.sendMail(mailOptions);
    console.log(`[MAIL] SMTP email sent successfully to ${to}`);
    return true;
  } catch (error: any) {
    const errorCode = error?.code || error?.responseCode;
    const errorMessage = error?.message || 'Unknown error';
    
    console.log(`[MAIL] SMTP send failed: ${errorMessage}`, {
      code: errorCode,
      command: error?.command,
      response: error?.response
    });
    
    // If it's an authentication error, reset transporter to force credential refresh
    if (errorCode === 'EAUTH' || errorCode === 535 || errorMessage.includes('BadCredentials') || errorMessage.includes('Username and Password not accepted')) {
      console.log('[MAIL] Authentication error detected - resetting transporter. Please check EMAIL_USER and EMAIL_APP_PASSWORD in .env file');
      resetTransporter();
    }
    
    return false;
  }
}

/**
 * Send email with optional HTML content
 * @param to - Recipient email address
 * @param subject - Email subject
 * @param text - Plain text email body (required)
 * @param html - HTML email body (optional)
 */
export async function sendEmail(to: string, subject: string, text: string, html?: string) {
  // Primary: Try Resend API first
  console.log('[MAIL] Starting email send process', {
    to,
    hasResendKey: !!env.resendApiKey,
    hasSmtpFrom: !!env.smtpFrom,
    hasEmailUser: !!env.emailUser,
    hasEmailAppPassword: !!env.emailAppPassword
  });
  
  const resendSuccess = await sendEmailViaResend(to, subject, text, html);
  if (resendSuccess) {
    return;
  }

  // Fallback: Try Gmail SMTP (only if Resend failed)
  console.log('[MAIL] Resend failed, attempting SMTP fallback');
  const smtpSuccess = await sendEmailViaSMTP(to, subject, text, html);
  if (smtpSuccess) {
    return;
  }

  // Final fallback: Log to console
  console.error(`[MAIL] All email providers failed, falling back to console log`, {
    to,
    subject,
    resendConfigured: !!(env.resendApiKey && env.smtpFrom),
    smtpConfigured: !!(env.emailUser && env.emailAppPassword),
    environment: env.nodeEnv
  });
  console.log(`[MAIL FALLBACK] To: ${to} | Subject: ${subject} | Body: ${text}`);
}

export function isEmailConfigured(): boolean {
  // Primary: Check Resend API (preferred method)
  if (env.resendApiKey && env.smtpFrom) return true;
  // Fallback: Check Gmail App Password
  if (env.emailUser && env.emailAppPassword) return true;
  // Fallback: Check generic SMTP creds
  if (env.smtpHost && env.smtpPort && env.smtpUser && env.smtpPass) return true;
  return false;
}


