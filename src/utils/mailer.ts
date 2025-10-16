import nodemailer from 'nodemailer';
import { env } from '../config/env';

let transporter: any | null = null;

function getTransporter() {
  if (transporter) return transporter;

  // Check if we have Resend API key - prefer this over SMTP for cloud deployments
  if (env.resendApiKey && env.smtpFrom) {
    console.log('[MAIL] Using Resend API as primary email service');
    return null; // Will use API instead of SMTP
  }

  // Preferred: Gmail App Password flow (fallback for local development)
  const gmailUser = env.emailUser;
  const gmailPass = env.emailAppPassword;
  if (gmailUser && gmailPass) {
    console.log('[MAIL] Using Gmail SMTP as fallback');
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587, // Use port 587 instead of 465
      secure: false, // false for port 587
      requireTLS: true, // Require TLS for port 587
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
      auth: { user: gmailUser, pass: gmailPass }
    });
    return transporter;
  }

  // Generic SMTP fallback
  const host = env.smtpHost;
  const port = env.smtpPort;
  const user = env.smtpUser;
  const pass = env.smtpPass;
  if (host && port && user && pass) {
    console.log('[MAIL] Using generic SMTP as fallback');
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
      auth: { user, pass }
    });
  }
  return transporter;
}

export async function sendEmail(to: string, subject: string, text: string) {
  const from = env.smtpFrom || env.emailUser;
  
  // Try Resend API first (preferred for cloud deployments)
  if (env.resendApiKey && env.smtpFrom) {
    try {
      console.log(`[MAIL] Attempting Resend API delivery to ${to}`);
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          from: env.smtpFrom, 
          to, 
          subject, 
          text,
          html: `<p>${text.replace(/\n/g, '<br>')}</p>`
        })
      });
      
      if (resp.ok) {
        const result = await resp.json();
        console.log(`[MAIL] Resend email sent successfully to ${to} (ID: ${result.id})`);
        return { success: true, channel: 'resend' };
      } else {
        const errTxt = await resp.text().catch(() => '');
        console.log(`[MAIL] Resend API failed: ${resp.status} ${errTxt}`);
        throw new Error(`Resend API failed: ${resp.status} ${errTxt}`);
      }
    } catch (e: any) {
      console.log(`[MAIL] Resend API error: ${e?.message}`);
      // Continue to SMTP fallback
    }
  }
  
  // Try SMTP as fallback
  const t = getTransporter();
  if (t && from) {
    try {
      console.log(`[MAIL] Attempting SMTP delivery to ${to}`);
      console.log(`[MAIL] Testing SMTP connection to ${t.options.host}:${t.options.port}`);
      await t.verify();
      console.log(`[MAIL] SMTP connection verified successfully`);
      
      await t.sendMail({ from, to, subject, text });
      console.log(`[MAIL] Email sent successfully to ${to} via SMTP`);
      return { success: true, channel: 'smtp' };
    } catch (error: any) {
      console.log(`[MAIL] SMTP send failed: ${error?.message}`);
      console.log(`[MAIL] SMTP config: host=${t.options.host}, port=${t.options.port}, secure=${t.options.secure}`);
    }
  }
  
  // Final fallback - log to console
  console.log(`[MAIL] All email transports failed, logging to console`);
  console.log(`[MAIL FALLBACK] To: ${to} | Subject: ${subject} | Body: ${text}`);
  throw new Error('Email delivery failed: No working email service available');
}

export function isEmailConfigured(): boolean {
  console.log('[MAIL] Checking email configuration:');
  console.log('[MAIL] - Resend API:', !!env.resendApiKey, 'From:', !!env.smtpFrom);
  console.log('[MAIL] - Gmail User:', !!env.emailUser, 'App Password:', !!env.emailAppPassword);
  console.log('[MAIL] - SMTP Host:', !!env.smtpHost, 'Port:', !!env.smtpPort, 'User:', !!env.smtpUser, 'Pass:', !!env.smtpPass);
  
  // Check Resend API first (preferred for cloud deployments)
  if (env.resendApiKey && env.smtpFrom) {
    console.log('[MAIL] Email configured: Resend API');
    return true;
  }
  // Fallback to SMTP
  if (env.emailUser && env.emailAppPassword) {
    console.log('[MAIL] Email configured: Gmail SMTP');
    return true;
  }
  if (env.smtpHost && env.smtpPort && env.smtpUser && env.smtpPass) {
    console.log('[MAIL] Email configured: Generic SMTP');
    return true;
  }
  
  console.log('[MAIL] No email configuration found');
  return false;
}


