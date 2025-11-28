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
      host: 'smtp.gmail.com',
      port: 465,
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

export async function sendEmail(to: string, subject: string, text: string) {
  const from = env.smtpFrom || env.emailUser;
  const t = getTransporter();
  
  if (!t || !from) {
    // Try Resend API if configured
    if (env.resendApiKey && env.smtpFrom) {
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ from: env.smtpFrom, to, subject, text })
        });
        if (!resp.ok) {
          const errTxt = await resp.text().catch(() => '');
          console.log(`[MAIL] Resend send failed: ${resp.status} ${errTxt}`);
        } else {
          console.log(`[MAIL] Resend email sent successfully to ${to}`);
          return;
        }
      } catch (e: any) {
        console.log(`[MAIL] Resend error: ${e?.message}`);
      }
    }
    // Fallback to console if no provider works
    console.log(`[MAIL FALLBACK] To: ${to} | Subject: ${subject} | Body: ${text}`);
    return;
  }
  
  try {
    await t.sendMail({ from, to, subject, text });
    console.log(`[MAIL] Email sent successfully to ${to}`);
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
    
    // Try Resend fallback if configured
    if (env.resendApiKey && env.smtpFrom) {
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ from: env.smtpFrom, to, subject, text })
        });
        if (resp.ok) {
          console.log(`[MAIL] Resend fallback delivered email to ${to}`);
          return;
        } else {
          const errTxt = await resp.text().catch(() => '');
          console.log(`[MAIL] Resend fallback failed: ${resp.status} ${errTxt}`);
        }
      } catch (e: any) {
        console.log(`[MAIL] Resend fallback error: ${e?.message}`);
      }
    }
    console.log(`[MAIL] Email failed, falling back to console log`);
    console.log(`[MAIL FALLBACK] To: ${to} | Subject: ${subject} | Body: ${text}`);
    console.log(`[MAIL ERROR] ${error.message}`);
    // Don't throw error - just log OTP to console as fallback
  }
}

export function isEmailConfigured(): boolean {
  // True if Gmail App Password or generic SMTP creds are present
  if (env.emailUser && env.emailAppPassword) return true;
  if (env.smtpHost && env.smtpPort && env.smtpUser && env.smtpPass) return true;
  return false;
}


