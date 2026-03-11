/**
 * Email templates for the application
 * All templates share the same professional dark theme with the brand banner.
 */

import { getAppBaseUrl } from "../config/env";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const FONT_STACK = "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// Resolves to the correct domain per environment via PRODUCTION_WWW_DOMAIN env var:
//   staging:    https://onstaging.wildmindai.com/emailBanner/email-banner.jpg
//   production: https://www.wildmindai.com/emailBanner/email-banner.jpg
function getBannerUrl(): string {
  return `${getAppBaseUrl()}/emailBanner/email-banner.jpg`;
}

/** Shared outer wrapper: dark background, centred 600-px column, banner at top */
function wrapEmail(bodyContent: string, subject: string): string {
  const bannerUrl = getBannerUrl();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${subject}</title>
  <!--[if mso]>
  <style>body,table,td,a{font-family:Arial,sans-serif!important;}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#0b0b12;font-family:${FONT_STACK};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#0b0b12;">
    <tr><td align="center" style="padding:40px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
             style="max-width:600px;background-color:#12121e;border-radius:16px;overflow:hidden;border:1px solid #1e1e30;">

        <!-- BANNER -->
        <tr>
          <td style="padding:0;margin:0;line-height:0;font-size:0;">
            <img src="${bannerUrl}" width="600" height="auto" alt="Wild Mind AI" border="0"
                 style="display:block;width:100%;max-width:600px;border:0;outline:none;text-decoration:none;" />
          </td>
        </tr>

        ${bodyContent}

        <!-- FOOTER -->
        <tr>
          <td style="border-top:1px solid #1e1e30;padding:24px 40px;text-align:center;background-color:#0d0d18;">
            <p style="margin:0 0 6px;font-size:12px;color:#444466;font-family:${FONT_STACK};">
              Wild Mind AI &nbsp;&bull;&nbsp; 511, Satyamev Eminence, Ahmedabad
            </p>
            <p style="margin:0 0 10px;font-size:12px;font-family:${FONT_STACK};">
              <a href="${getAppBaseUrl()}/privacy" style="color:#5566aa;text-decoration:none;">Privacy</a>
              &nbsp;&bull;&nbsp;
              <a href="mailto:support@wildmindai.com" style="color:#5566aa;text-decoration:none;">Support</a>
            </p>
            <p style="margin:0;font-size:11px;color:#333355;font-family:${FONT_STACK};">
              &copy; ${new Date().getFullYear()} Wild Mind AI. All rights reserved.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

// ---------------------------------------------------------------------------
// OTP Email
// ---------------------------------------------------------------------------

export interface OTPEmailData {
  code: string;
  email: string;
  expiresInMinutes?: number;
  companyName?: string;
  supportEmail?: string;
}

export function generateOTPEmailHTML(data: OTPEmailData): string {
  const { code, expiresInMinutes = 10, companyName = "Wild Mind AI" } = data;

  const body = `
        <!-- HEADING -->
        <tr>
          <td style="padding:36px 40px 10px;text-align:center;">
            <h1 style="margin:0 0 10px;font-size:26px;font-weight:700;color:#e8e8f0;font-family:${FONT_STACK};line-height:1.3;">
              Verify Your Email Address
            </h1>
            <p style="margin:0;font-size:15px;color:#8888aa;font-family:${FONT_STACK};line-height:1.6;">
              Use the code below to complete your sign-up.
            </p>
          </td>
        </tr>

        <!-- OTP BOX -->
        <tr>
          <td align="center" style="padding:28px 40px;">
            <div style="display:inline-block;background-color:#1a1a2e;border:1px solid #2a2a50;border-radius:12px;padding:22px 48px;">
              <div style="font-size:40px;font-weight:700;color:#7b8cde;letter-spacing:12px;font-family:'Courier New',Courier,monospace;text-align:center;">
                ${code}
              </div>
            </div>
          </td>
        </tr>

        <!-- META -->
        <tr>
          <td style="padding:0 40px 28px;text-align:center;">
            <p style="margin:0 0 10px;font-size:13px;color:#666688;font-family:${FONT_STACK};">
              &#x23F1; This code expires in <strong style="color:#aaaacc;">${expiresInMinutes} minutes</strong>.
            </p>
            <p style="margin:0;font-size:13px;color:#444466;font-family:${FONT_STACK};">
              If you did not request this, you can safely ignore this email.
            </p>
          </td>
        </tr>

        <!-- SECURITY NOTICE -->
        <tr>
          <td style="padding:0 40px 32px;">
            <div style="background-color:#16162a;border-left:3px solid #3a3a6a;border-radius:6px;padding:14px 18px;">
              <p style="margin:0;font-size:13px;color:#6666aa;font-family:${FONT_STACK};line-height:1.6;">
                <strong style="color:#8888cc;">Security notice:</strong> ${companyName} will never ask for your code via phone or chat. Never share it with anyone.
              </p>
            </div>
          </td>
        </tr>`;

  return wrapEmail(body, `Verify Your Email — ${companyName}`);
}

export function generateOTPEmailText(data: OTPEmailData): string {
  const {
    code,
    expiresInMinutes = 10,
    companyName = "Wild Mind AI",
    supportEmail = "support@wildmindai.com",
  } = data;

  return `${companyName} — Email Verification

Your verification code: ${code}

This code expires in ${expiresInMinutes} minutes.

Security: ${companyName} will never ask for your code via phone or chat.

If you did not request this, please ignore this email.

Need help? ${supportEmail}

© ${new Date().getFullYear()} ${companyName}. All rights reserved.`.trim();
}

// ---------------------------------------------------------------------------
// Password Reset Email
// ---------------------------------------------------------------------------

export interface PasswordResetEmailData {
  resetLink: string;
  email: string;
  companyName?: string;
  supportEmail?: string;
}

export function generatePasswordResetEmailHTML(
  data: PasswordResetEmailData,
): string {
  const { resetLink, companyName = "Wild Mind AI" } = data;

  const body = `
        <!-- HEADING -->
        <tr>
          <td style="padding:36px 40px 10px;text-align:center;">
            <h1 style="margin:0 0 10px;font-size:26px;font-weight:700;color:#e8e8f0;font-family:${FONT_STACK};line-height:1.3;">
              Reset Your Password
            </h1>
            <p style="margin:0;font-size:15px;color:#8888aa;font-family:${FONT_STACK};line-height:1.6;">
              We received a request to reset the password on your ${companyName} account.
            </p>
          </td>
        </tr>

        <!-- CTA BUTTON -->
        <tr>
          <td align="center" style="padding:32px 40px;">
            <a href="${resetLink}"
               style="display:inline-block;background-color:#3b4fd4;color:#ffffff;text-decoration:none;
                      padding:15px 40px;border-radius:8px;font-size:15px;font-weight:600;
                      font-family:${FONT_STACK};letter-spacing:0.3px;">
              Reset Password
            </a>
          </td>
        </tr>

        <!-- FALLBACK LINK -->
        <tr>
          <td style="padding:0 40px 20px;text-align:center;">
            <p style="margin:0 0 6px;font-size:13px;color:#6666aa;font-family:${FONT_STACK};">
              Or paste this link directly into your browser:
            </p>
            <p style="margin:0;font-size:12px;color:#5566bb;word-break:break-all;font-family:${FONT_STACK};">
              <a href="${resetLink}" style="color:#5566bb;">${resetLink}</a>
            </p>
          </td>
        </tr>

        <!-- EXPIRY + SECURITY -->
        <tr>
          <td style="padding:8px 40px 32px;">
            <div style="background-color:#16162a;border-left:3px solid #3a3a6a;border-radius:6px;padding:14px 18px;">
              <p style="margin:0 0 6px;font-size:13px;color:#8888cc;font-family:${FONT_STACK};">
                &#x23F1; This link expires in <strong>1 hour</strong>.
              </p>
              <p style="margin:0;font-size:13px;color:#6666aa;font-family:${FONT_STACK};">
                If you did not request a password reset, you can safely ignore this email — your password will remain unchanged.
              </p>
            </div>
          </td>
        </tr>`;

  return wrapEmail(body, `Reset Your Password — ${companyName}`);
}

export function generatePasswordResetEmailText(
  data: PasswordResetEmailData,
): string {
  const {
    resetLink,
    companyName = "Wild Mind AI",
    supportEmail = "support@wildmindai.com",
  } = data;

  return `${companyName} — Password Reset

We received a request to reset your password.

Reset your password here:
${resetLink}

This link expires in 1 hour.

If you did not request a password reset, you can safely ignore this email.

Need help? ${supportEmail}

© ${new Date().getFullYear()} ${companyName}. All rights reserved.`.trim();
}

// ---------------------------------------------------------------------------
// Welcome Email
// ---------------------------------------------------------------------------

export interface WelcomeEmailData {
  email: string;
  username?: string;
  companyName?: string;
  supportEmail?: string;
  dashboardUrl?: string;
}

export function generateWelcomeEmailHTML(data: WelcomeEmailData): string {
  const {
    email,
    username,
    companyName = "Wild Mind AI",
    dashboardUrl = getAppBaseUrl(),
  } = data;

  const displayName = username || email.split("@")[0] || "there";

  const body = `
        <!-- HERO -->
        <tr>
          <td align="center" style="padding:36px 40px 20px;">
            <h1 style="margin:0 0 12px;font-size:28px;font-weight:700;color:#e8e8f0;font-family:${FONT_STACK};line-height:1.3;">
              Welcome aboard, ${displayName}!
            </h1>
            <p style="margin:0;font-size:15px;color:#8888aa;font-family:${FONT_STACK};line-height:1.6;">
              Your account has been created. You're now part of ${companyName}.
            </p>
          </td>
        </tr>

        <!-- MESSAGE -->
        <tr>
          <td style="padding:0 40px 28px;text-align:center;">
            <p style="margin:0 0 14px;font-size:15px;color:#aaaacc;font-family:${FONT_STACK};line-height:1.7;">
              Start exploring AI-powered image generation, video creation, and brand scaling tools — all in one place.
            </p>
            <p style="margin:0;font-size:14px;color:#6666aa;font-family:${FONT_STACK};">
              You have <strong style="color:#c8c8ee;">2,000 free images</strong> ready to use.
            </p>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td align="center" style="padding:0 40px 36px;">
            <a href="${dashboardUrl}"
               style="display:inline-block;background-color:#3b4fd4;color:#ffffff;text-decoration:none;
                      padding:15px 40px;border-radius:8px;font-size:15px;font-weight:600;
                      font-family:${FONT_STACK};letter-spacing:0.3px;">
              Start Creating &rarr;
            </a>
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr>
          <td style="padding:0 40px;">
            <div style="height:1px;background-color:#1e1e30;"></div>
          </td>
        </tr>

        <!-- FEATURES -->
        <tr>
          <td style="padding:28px 40px 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td align="center" width="33%" style="padding:0 10px 20px;vertical-align:top;">
                  <div style="font-size:26px;margin-bottom:8px;">&#x1F5BC;&#xFE0F;</div>
                  <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#c8c8ee;font-family:${FONT_STACK};">Image AI</p>
                  <p style="margin:0;font-size:12px;color:#666688;font-family:${FONT_STACK};line-height:1.5;">Studio-quality visuals in seconds.</p>
                </td>
                <td align="center" width="33%" style="padding:0 10px 20px;vertical-align:top;border-left:1px solid #1e1e30;border-right:1px solid #1e1e30;">
                  <div style="font-size:26px;margin-bottom:8px;">&#x1F3AC;</div>
                  <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#c8c8ee;font-family:${FONT_STACK};">Video AI</p>
                  <p style="margin:0;font-size:12px;color:#666688;font-family:${FONT_STACK};line-height:1.5;">Generate engaging video content.</p>
                </td>
                <td align="center" width="33%" style="padding:0 10px 20px;vertical-align:top;">
                  <div style="font-size:26px;margin-bottom:8px;">&#x1F680;</div>
                  <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#c8c8ee;font-family:${FONT_STACK};">Brand Scaling</p>
                  <p style="margin:0;font-size:12px;color:#666688;font-family:${FONT_STACK};line-height:1.5;">Scale your creative assets effortlessly.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;

  return wrapEmail(body, `Welcome to ${companyName}`);
}

export function generateWelcomeEmailText(data: WelcomeEmailData): string {
  const {
    email,
    username,
    companyName = "Wild Mind AI",
    supportEmail = "support@wildmindai.com",
    dashboardUrl = getAppBaseUrl(),
  } = data;

  const displayName = username || email.split("@")[0] || "there";

  return `Welcome to ${companyName}, ${displayName}!

Your account has been successfully created.

Start exploring AI-powered image generation, video creation, and brand-scaling tools — all in one place.
You have 2,000 free images ready to use.

Start creating: ${dashboardUrl}

--------------------------------------
Image AI      — Studio-quality visuals in seconds
Video AI      — Generate engaging video content
Brand Scaling — Scale your creative assets effortlessly
--------------------------------------

Need help? ${supportEmail}

${companyName} — 511, Satyamev Eminence, Ahmedabad
© ${new Date().getFullYear()} ${companyName}. All rights reserved.`.trim();
}
