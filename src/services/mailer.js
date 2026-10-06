const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST || 'localhost',
      port: config.SMTP_PORT || 587,
      secure: config.SMTP_PORT === 465,
      auth:
        config.SMTP_USER && config.SMTP_PASS
          ? {
              user: config.SMTP_USER,
              pass: config.SMTP_PASS,
            }
          : undefined,
    });
  }
  return transporter;
}

/**
 * Send an email using configured mail mode (console or smtp).
 *
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text content
 * @param {string} [options.html] - HTML content
 * @returns {Promise<{ success: boolean, messageId?: string, info?: any }>}
 */
async function sendMail({ to, subject, text, html }) {
  const mailMode = process.env.MAIL_MODE || config.MAIL_MODE || 'console';

  if (mailMode === 'console') {
    // Only place where OTP is permitted to be logged per Rule 01
    console.log(`\n========================================`);
    console.log(`[MoVo Mailer - Console Mode]`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${text}`);
    console.log(`========================================\n`);
    return { success: true, messageId: 'console-' + Date.now() };
  }

  const transport = getTransporter();
  const from = config.SMTP_USER || 'noreply@movo.local';

  const info = await transport.sendMail({
    from,
    to,
    subject,
    text,
    html: html || text,
  });

  return { success: true, messageId: info.messageId, info };
}

/**
 * Send an OTP verification code to a recipient email.
 *
 * @param {Object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.code - 6-digit OTP code
 * @param {number} [params.shareId] - Optional share ID
 * @returns {Promise<{ success: boolean }>}
 */
async function sendOtpMail({ to, code, shareId }) {
  const subject = 'Your MoVo verification code';
  const text = `Your MoVo verification code is: ${code}\n\nThis code will expire in 5 minutes and can only be used once. If you did not request this code, you can safely ignore this email.`;
  const html = `<p>Your MoVo verification code is: <strong>${code}</strong></p><p>This code will expire in 5 minutes and can only be used once.</p><p>If you did not request this code, you can safely ignore this email.</p>`;

  return sendMail({
    to,
    subject,
    text,
    html,
  });
}

module.exports = {
  sendMail,
  sendOtpMail,
};
