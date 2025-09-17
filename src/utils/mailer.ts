import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;

  // Preferred: Gmail App Password flow
  const gmailUser = process.env.EMAIL_USER;
  const gmailPass = process.env.EMAIL_APP_PASSWORD;
  if (gmailUser && gmailPass) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: gmailUser, pass: gmailPass }
    });
    return transporter;
  }

  // Generic SMTP fallback
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (host && port && user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
  }
  return transporter;
}

export async function sendEmail(to: string, subject: string, text: string) {
  const from = process.env.SMTP_FROM || process.env.EMAIL_USER;
  const t = getTransporter();
  if (!t || !from) {
    throw new Error('Email not configured. Set EMAIL_USER and EMAIL_APP_PASSWORD in server .env');
  }
  await t.sendMail({ from, to, subject, text });
}


