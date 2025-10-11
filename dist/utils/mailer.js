"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
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
            auth: { user, pass }
        });
    }
    return transporter;
}
async function sendEmail(to, subject, text) {
    const from = env_1.env.smtpFrom || env_1.env.emailUser;
    const t = getTransporter();
    if (!t || !from) {
        // Fallback to console if email not configured
        console.log(`[MAIL FALLBACK] To: ${to} | Subject: ${subject} | Body: ${text}`);
        return;
    }
    try {
        await t.sendMail({ from, to, subject, text });
        console.log(`[MAIL] Email sent successfully to ${to}`);
    }
    catch (error) {
        console.log(`[MAIL] Email failed, falling back to console log`);
        console.log(`[MAIL FALLBACK] To: ${to} | Subject: ${subject} | Body: ${text}`);
        console.log(`[MAIL ERROR] ${error.message}`);
        // Don't throw error - just log OTP to console as fallback
    }
}
