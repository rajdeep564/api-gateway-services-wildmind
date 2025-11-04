"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
exports.isEmailConfigured = isEmailConfigured;
const nodemailer_1 = __importDefault(require("nodemailer"));
const env_1 = require("../config/env");
let transporter = null;
function getTransporter() {
    if (transporter)
        return transporter;
    // Preferred: Gmail App Password flow
    const gmailUser = env_1.env.emailUser;
    const gmailPass = env_1.env.emailAppPassword;
    if (gmailUser && gmailPass) {
        transporter = nodemailer_1.default.createTransport({
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
    const host = env_1.env.smtpHost;
    const port = env_1.env.smtpPort;
    const user = env_1.env.smtpUser;
    const pass = env_1.env.smtpPass;
    if (host && port && user && pass) {
        transporter = nodemailer_1.default.createTransport({
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
async function sendEmail(to, subject, text) {
    const from = env_1.env.smtpFrom || env_1.env.emailUser;
    const t = getTransporter();
    if (!t || !from) {
        // Try Resend API if configured
        if (env_1.env.resendApiKey && env_1.env.smtpFrom) {
            try {
                const resp = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${env_1.env.resendApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ from: env_1.env.smtpFrom, to, subject, text })
                });
                if (!resp.ok) {
                    const errTxt = await resp.text().catch(() => '');
                    console.log(`[MAIL] Resend send failed: ${resp.status} ${errTxt}`);
                }
                else {
                    console.log(`[MAIL] Resend email sent successfully to ${to}`);
                    return;
                }
            }
            catch (e) {
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
    }
    catch (error) {
        console.log(`[MAIL] SMTP send failed: ${error?.message}`);
        // Try Resend fallback if configured
        if (env_1.env.resendApiKey && env_1.env.smtpFrom) {
            try {
                const resp = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${env_1.env.resendApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ from: env_1.env.smtpFrom, to, subject, text })
                });
                if (resp.ok) {
                    console.log(`[MAIL] Resend fallback delivered email to ${to}`);
                    return;
                }
                else {
                    const errTxt = await resp.text().catch(() => '');
                    console.log(`[MAIL] Resend fallback failed: ${resp.status} ${errTxt}`);
                }
            }
            catch (e) {
                console.log(`[MAIL] Resend fallback error: ${e?.message}`);
            }
        }
        console.log(`[MAIL] Email failed, falling back to console log`);
        console.log(`[MAIL FALLBACK] To: ${to} | Subject: ${subject} | Body: ${text}`);
        console.log(`[MAIL ERROR] ${error.message}`);
        // Don't throw error - just log OTP to console as fallback
    }
}
function isEmailConfigured() {
    // True if Gmail App Password or generic SMTP creds are present
    if (env_1.env.emailUser && env_1.env.emailAppPassword)
        return true;
    if (env_1.env.smtpHost && env_1.env.smtpPort && env_1.env.smtpUser && env_1.env.smtpPass)
        return true;
    return false;
}
