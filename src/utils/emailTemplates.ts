/**
 * Email templates for the application
 */

export interface OTPEmailData {
  code: string;
  email: string;
  expiresInMinutes?: number;
  companyName?: string;
  supportEmail?: string;
}

/**
 * Generate HTML email template for OTP verification
 */
export function generateOTPEmailHTML(data: OTPEmailData): string {
  const {
    code,
    email,
    expiresInMinutes = 10,
    companyName = 'WildMind AI',
    supportEmail = 'support@wildmindai.com'
  } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Verify Your Email - ${companyName}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f4f4f4;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px 12px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">
                ${companyName}
              </h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 40px 30px;">
              <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 24px; font-weight: 600; line-height: 1.3;">
                Verify Your Email Address
              </h2>
              
              <p style="margin: 0 0 20px; color: #4a4a4a; font-size: 16px; line-height: 1.6;">
                Hello,
              </p>
              
              <p style="margin: 0 0 30px; color: #4a4a4a; font-size: 16px; line-height: 1.6;">
                Thank you for signing up! To complete your registration and secure your account, please use the verification code below:
              </p>
              
              <!-- OTP Code Box -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding: 0 0 30px;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; padding: 2px; display: inline-block;">
                      <div style="background-color: #ffffff; border-radius: 6px; padding: 20px 40px;">
                        <div style="font-size: 36px; font-weight: 700; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace; text-align: center;">
                          ${code}
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 0 0 20px; color: #666666; font-size: 14px; line-height: 1.6;">
                <strong style="color: #1a1a1a;">⏱️ This code will expire in ${expiresInMinutes} minutes.</strong>
              </p>
              
              <p style="margin: 0 0 30px; color: #666666; font-size: 14px; line-height: 1.6;">
                <strong style="color: #d32f2f;">🔒 Security Notice:</strong> Never share this code with anyone. ${companyName} will never ask for your verification code via phone or email.
              </p>
              
              <div style="background-color: #f8f9fa; border-left: 4px solid #667eea; padding: 15px; margin: 30px 0; border-radius: 4px;">
                <p style="margin: 0; color: #4a4a4a; font-size: 14px; line-height: 1.6;">
                  <strong>Didn't request this code?</strong><br>
                  If you didn't sign up for ${companyName}, you can safely ignore this email. No account will be created without verification.
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 12px 12px; border-top: 1px solid #e0e0e0;">
              <p style="margin: 0 0 10px; color: #666666; font-size: 13px; line-height: 1.6; text-align: center;">
                Need help? Contact us at <a href="mailto:${supportEmail}" style="color: #667eea; text-decoration: none; font-weight: 500;">${supportEmail}</a>
              </p>
              <p style="margin: 0; color: #999999; font-size: 12px; line-height: 1.6; text-align: center;">
                © ${new Date().getFullYear()} ${companyName}. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generate plain text version of OTP email (fallback for email clients that don't support HTML)
 */
export function generateOTPEmailText(data: OTPEmailData): string {
  const {
    code,
    expiresInMinutes = 10,
    companyName = 'WildMind AI',
    supportEmail = 'support@wildmindai.com'
  } = data;

  return `
${companyName} - Email Verification

Hello,

Thank you for signing up! To complete your registration, please use the verification code below:

VERIFICATION CODE: ${code}

This code will expire in ${expiresInMinutes} minutes.

SECURITY NOTICE: Never share this code with anyone. ${companyName} will never ask for your verification code via phone or email.

Didn't request this code?
If you didn't sign up for ${companyName}, you can safely ignore this email. No account will be created without verification.

Need help? Contact us at ${supportEmail}

© ${new Date().getFullYear()} ${companyName}. All rights reserved.
  `.trim();
}

export interface PasswordResetEmailData {
  resetLink: string;
  email: string;
  companyName?: string;
  supportEmail?: string;
}

/**
 * Generate HTML email template for password reset (matching OTP email style)
 */
export function generatePasswordResetEmailHTML(data: PasswordResetEmailData): string {
  const {
    resetLink,
    email,
    companyName = 'WildMind AI',
    supportEmail = 'support@wildmindai.com'
  } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Reset Your Password - ${companyName}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f4f4f4;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px 12px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">
                ${companyName}
              </h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 40px 30px;">
              <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 24px; font-weight: 600; line-height: 1.3;">
                Reset Your Password
              </h2>
              
              <p style="margin: 0 0 20px; color: #4a4a4a; font-size: 16px; line-height: 1.6;">
                Hello,
              </p>
              
              <p style="margin: 0 0 30px; color: #4a4a4a; font-size: 16px; line-height: 1.6;">
                We received a request to reset your password for your ${companyName} account. Click the button below to create a new password:
              </p>
              
              <!-- Reset Button (Styled like OTP code box) -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding: 0 0 30px;">
                    <a href="${resetLink}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-size: 16px; font-weight: 600; letter-spacing: 0.5px; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 0 0 20px; color: #666666; font-size: 14px; line-height: 1.6;">
                Or copy and paste this link into your browser:
              </p>
              
              <p style="margin: 0 0 30px; color: #667eea; font-size: 14px; line-height: 1.6; word-break: break-all;">
                <a href="${resetLink}" style="color: #667eea; text-decoration: underline;">${resetLink}</a>
              </p>
              
              <p style="margin: 0 0 20px; color: #666666; font-size: 14px; line-height: 1.6;">
                <strong style="color: #1a1a1a;">⏱️ This link will expire in 1 hour.</strong>
              </p>
              
              <p style="margin: 0 0 30px; color: #666666; font-size: 14px; line-height: 1.6;">
                <strong style="color: #d32f2f;">🔒 Security Notice:</strong> If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
              </p>
              
              <div style="background-color: #f8f9fa; border-left: 4px solid #667eea; padding: 15px; margin: 30px 0; border-radius: 4px;">
                <p style="margin: 0; color: #4a4a4a; font-size: 14px; line-height: 1.6;">
                  <strong>Having trouble?</strong><br>
                  If the button doesn't work, copy and paste the link above into your browser. If you continue to have issues, contact us at <a href="mailto:${supportEmail}" style="color: #667eea; text-decoration: none;">${supportEmail}</a>
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 12px 12px; border-top: 1px solid #e0e0e0;">
              <p style="margin: 0 0 10px; color: #666666; font-size: 13px; line-height: 1.6; text-align: center;">
                Need help? Contact us at <a href="mailto:${supportEmail}" style="color: #667eea; text-decoration: none; font-weight: 500;">${supportEmail}</a>
              </p>
              <p style="margin: 0; color: #999999; font-size: 12px; line-height: 1.6; text-align: center;">
                © ${new Date().getFullYear()} ${companyName}. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generate plain text version of password reset email (fallback for email clients that don't support HTML)
 */
export function generatePasswordResetEmailText(data: PasswordResetEmailData): string {
  const {
    resetLink,
    companyName = 'WildMind AI',
    supportEmail = 'support@wildmindai.com'
  } = data;

  return `
${companyName} - Password Reset

Hello,

We received a request to reset your password for your ${companyName} account. Click the link below to create a new password:

${resetLink}

This link will expire in 1 hour.

SECURITY NOTICE: If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.

Having trouble?
If the link doesn't work, copy and paste it into your browser. If you continue to have issues, contact us at ${supportEmail}

© ${new Date().getFullYear()} ${companyName}. All rights reserved.
  `.trim();
}

export interface WelcomeEmailData {
  email: string;
  username?: string;
  companyName?: string;
  supportEmail?: string;
  dashboardUrl?: string;
}

/**
 * Generate HTML welcome email for new user signups
 */
export function generateWelcomeEmailHTML(data: WelcomeEmailData): string {
  const {
    email,
    username,
    companyName = 'Wild Mind AI',
    supportEmail = 'support@wildmindai.com',
    dashboardUrl = 'https://www.wildmindai.com'
  } = data;

  const displayName = username || email.split('@')[0] || 'there';
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to ${companyName}</title>
</head>
<body style="margin:0;padding:0;background-color:#07070c;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#07070c;">
    <tr><td align="center" style="padding:40px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#07070c;color:#ffffff;border-radius:16px;border:1px solid #1c303d;">
        <!-- LOGO -->
        <tr>
          <td align="center" style="padding:36px 40px 20px;">
            <img src="https://www.wildmindai.com/core/logosquare.png" width="56" height="56" alt="Logo" style="display:block;border:0;border-radius:12px;" />
            <p style="margin:10px 0 0;font-size:13px;color:#4a7a8a;letter-spacing:2px;text-transform:uppercase;font-weight:600;">${companyName}</p>
          </td>
        </tr>
        <!-- HERO -->
        <tr>
          <td align="center" style="padding:10px 40px 30px;">
            <h1 style="margin:0 0 12px;font-size:30px;font-weight:700;color:#ffffff;">Congratulations, ${displayName}!</h1>
            <p style="margin:0;font-size:16px;color:#bbbbbb;line-height:1.6;">Your account has been successfully created.<br>Welcome to <strong style="color:#ffffff;">${companyName}</strong> — where creativity meets automation.</p>
          </td>
        </tr>
        <!-- DIVIDER -->
        <tr><td style="padding:0 40px;"><div style="height:1px;background-color:#1c303d;"></div></td></tr>
        <!-- MESSAGE -->
        <tr>
          <td style="padding:30px 40px;text-align:center;">
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#cccccc;">You are now ready to generate stunning visuals, create videos, and scale your brand content with powerful AI tools — all in one place.</p>
            <p style="margin:0;font-size:15px;color:#888888;">You have <strong style="color:#ffffff;">4,120 free credits</strong> waiting for you to get started.</p>
          </td>
        </tr>
        <!-- CTA -->
        <tr>
          <td align="center" style="padding:10px 40px 36px;">
            <a href="${dashboardUrl}" style="display:inline-block;background:linear-gradient(135deg,#1c6fa8 0%,#1c303d 100%);color:#ffffff;padding:15px 36px;border-radius:30px;text-decoration:none;font-weight:700;font-size:16px;border:1px solid #2a5070;">Start Creating &rarr;</a>
          </td>
        </tr>
        <!-- DIVIDER -->
        <tr><td style="padding:0 40px;"><div style="height:1px;background-color:#1c303d;"></div></td></tr>
        <!-- FEATURES -->
        <tr>
          <td style="padding:30px 40px 10px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td align="center" width="33%" style="padding:0 8px 20px;">
                  <div style="font-size:24px;margin-bottom:6px;">&#x1F5BC;&#xFE0F;</div>
                  <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#ffffff;">Image AI</p>
                  <p style="margin:0;font-size:13px;color:#888888;">Create studio-quality visuals instantly.</p>
                </td>
                <td align="center" width="33%" style="padding:0 8px 20px;border-left:1px solid #1c303d;border-right:1px solid #1c303d;">
                  <div style="font-size:24px;margin-bottom:6px;">&#x1F3AC;</div>
                  <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#ffffff;">Video AI</p>
                  <p style="margin:0;font-size:13px;color:#888888;">Generate engaging video content.</p>
                </td>
                <td align="center" width="33%" style="padding:0 8px 20px;">
                  <div style="font-size:24px;margin-bottom:6px;">&#x1F680;</div>
                  <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#ffffff;">Brand Scaling</p>
                  <p style="margin:0;font-size:13px;color:#888888;">Design &amp; scale assets effortlessly.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- FOOTER -->
        <tr>
          <td style="border-top:1px solid #1c303d;padding:28px 40px;text-align:center;">
            <p style="margin:0 0 6px;font-size:12px;color:#555555;">${companyName} &nbsp;&bull;&nbsp; 511, Satyamev Eminence, Ahmedabad</p>
            <p style="margin:0 0 10px;font-size:12px;color:#555555;"><a href="https://www.wildmindai.com/privacy" style="color:#4a7a8a;text-decoration:none;">Privacy</a>&nbsp;&bull;&nbsp;<a href="mailto:${supportEmail}" style="color:#4a7a8a;text-decoration:none;">Support</a></p>
            <p style="margin:0;font-size:11px;color:#333333;">&copy; ${year} ${companyName}. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

/**
 * Generate plain text version of welcome email
 */
export function generateWelcomeEmailText(data: WelcomeEmailData): string {
  const {
    email,
    username,
    companyName = 'Wild Mind AI',
    supportEmail = 'support@wildmindai.com',
    dashboardUrl = 'https://www.wildmindai.com'
  } = data;

  const displayName = username || email.split('@')[0] || 'there';

  return `Welcome to ${companyName}, ${displayName}!

Congratulations! Your account has been successfully created.

You are now ready to generate stunning visuals, create videos, and scale your brand content with powerful AI tools.

You have 4,120 free credits waiting for you to get started.

Start creating: ${dashboardUrl}

--------------------------------------
WHAT YOU CAN DO

Image AI      - Create studio-quality visuals instantly
Video AI      - Generate engaging video content
Brand Scaling - Design and scale assets effortlessly

--------------------------------------

Need help? Contact us at ${supportEmail}

${companyName} - 511, Satyamev Eminence, Ahmedabad
(c) ${new Date().getFullYear()} ${companyName}. All rights reserved.`.trim();
}
