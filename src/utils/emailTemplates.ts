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

