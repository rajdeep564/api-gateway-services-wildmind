import nodemailer from 'nodemailer';
import { env } from '../config/env';

let transporter: any | null = null;

function getTransporter() {
  if (transporter) return transporter;

  // Preferred: Gmail App Password flow
  const gmailUser = env.emailUser;
  const gmailPass = env.emailAppPassword;
  if (gmailUser && gmailPass) {
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
  const t = getTransporter();
  
  if (!t || !from) {
    console.log(`[MAIL] No SMTP transporter available, trying API fallback`);
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
          throw new Error(`Resend API failed: ${resp.status}`);
        } else {
          console.log(`[MAIL] Resend email sent successfully to ${to}`);
          return { success: true, channel: 'resend' };
        }
      } catch (e: any) {
        console.log(`[MAIL] Resend error: ${e?.message}`);
        throw new Error(`All email transports failed: ${e?.message}`);
      }
    }
    // Fallback to console if no provider works
    console.log(`[MAIL FALLBACK] To: ${to} | Subject: ${subject} | Body: ${text}`);
    throw new Error('No email configuration available');
  }
  
  try {
    // Test connection first
    console.log(`[MAIL] Testing SMTP connection to ${t.options.host}:${t.options.port}`);
    await t.verify();
    console.log(`[MAIL] SMTP connection verified successfully`);
    
    // Send email
    await t.sendMail({ from, to, subject, text });
    console.log(`[MAIL] Email sent successfully to ${to} via SMTP`);
    return { success: true, channel: 'smtp' };
  } catch (error: any) {
    console.log(`[MAIL] SMTP send failed: ${error?.message}`);
    console.log(`[MAIL] SMTP config: host=${t.options.host}, port=${t.options.port}, secure=${t.options.secure}`);
    
    // Try Resend fallback if configured
    if (env.resendApiKey && env.smtpFrom) {
      try {
        console.log(`[MAIL] Attempting Resend API fallback`);
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
          return { success: true, channel: 'resend' };
        } else {
          const errTxt = await resp.text().catch(() => '');
          console.log(`[MAIL] Resend fallback failed: ${resp.status} ${errTxt}`);
        }
      } catch (e: any) {
        console.log(`[MAIL] Resend fallback error: ${e?.message}`);
      }
    }
    
    // Final fallback - log to console but don't pretend success
    console.log(`[MAIL] All email transports failed, logging to console`);
    console.log(`[MAIL FALLBACK] To: ${to} | Subject: ${subject} | Body: ${text}`);
    console.log(`[MAIL ERROR] ${error.message}`);
    throw new Error(`Email delivery failed: ${error.message}`);
  }
}

export function isEmailConfigured(): boolean {
  // True if Gmail App Password or generic SMTP creds are present
  if (env.emailUser && env.emailAppPassword) return true;
  if (env.smtpHost && env.smtpPort && env.smtpUser && env.smtpPass) return true;
  return false;
}


