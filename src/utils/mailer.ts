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
      port: 465,
      secure: true,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
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
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      auth: { user, pass }
    });
  }
  return transporter;
}

export async function sendEmail(to: string, subject: string, text: string) {
  const from = env.smtpFrom || env.emailUser;
  const t = getTransporter();
  
  if (!t || !from) {
    // Fallback to console if email not configured
    console.log(`[MAIL FALLBACK] To: ${to} | Subject: ${subject} | Body: ${text}`);
    return;
  }
  
  try {
    await t.sendMail({ from, to, subject, text });
    console.log(`[MAIL] Email sent successfully to ${to}`);
  } catch (error: any) {
    console.log(`[MAIL] Email failed, falling back to console log`);
    console.log(`[MAIL FALLBACK] To: ${to} | Subject: ${subject} | Body: ${text}`);
    console.log(`[MAIL ERROR] ${error.message}`);
    // Don't throw error - just log OTP to console as fallback
  }
}


