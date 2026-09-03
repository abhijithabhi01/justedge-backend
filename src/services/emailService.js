/**
 * emailService.js
 *
 * Nodemailer-based mailer for JustEdge.
 * Falls back gracefully (logs to console) when SMTP is not configured.
 *
 * Env vars required in .env:
 *   SMTP_HOST     — e.g. smtp.gmail.com
 *   SMTP_PORT     — 587 (TLS) or 465 (SSL). Defaults to 587.
 *   SMTP_SECURE   — "true" only for port 465. Leave blank for 587.
 *   SMTP_USER     — your Gmail / SMTP username (full email)
 *   SMTP_PASS     — Gmail App Password (NOT your account password)
 *   SMTP_FROM     — display sender, e.g. "JustEdge <noreply@justedge.io>"
 *   APP_LOGIN_URL — e.g. https://justedgetesting.vercel.app/login
 */

// ── Core mailer ──────────────────────────────────────────────────────────────
export async function sendMail({ to, subject, text, html }) {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@justedge.io';

  if (!host || !process.env.SMTP_USER) {
    console.log('[email] SMTP not configured — message not sent');
    console.log('[email] to:', to, '| subject:', subject);
    console.log('[email] body:\n', text || html);
    return { sent: false, reason: 'smtp_not_configured' };
  }

  let nodemailer;
  try {
    nodemailer = await import('nodemailer');
  } catch {
    console.warn('[email] nodemailer not installed — run: npm i nodemailer');
    return { sent: false, reason: 'nodemailer_missing' };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({ from, to, subject, text, html });
  console.log(`[email] sent → ${to} | ${subject}`);
  return { sent: true };
}

// ── Admin welcome email (called by adminController.createAdmin) ───────────────
export async function sendAdminWelcomeEmail({ name, email, tempPassword, companyName }) {
  const loginUrl = process.env.APP_LOGIN_URL || 'https://justedgetesting.vercel.app/login';
  const subject = 'Your JustEdge Admin Account';

  const text = [
    `Hello ${name},`,
    '',
    `A JustEdge admin account has been created for ${companyName || 'your company'}.`,
    '',
    `Login URL : ${loginUrl}`,
    `Email     : ${email}`,
    `Password  : ${tempPassword}`,
    '',
    'Please sign in and change your password after first login.',
    '',
    '— JustEdge / Just Embedded',
  ].join('\n');

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:8px">
      <h2 style="color:#1e293b;margin-bottom:4px">Welcome to JustEdge</h2>
      <p style="color:#64748b;margin-top:0">Your admin account is ready</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
      <p>Hello <strong>${name}</strong>,</p>
      <p>An admin account has been created for <strong>${companyName || 'your company'}</strong> on the JustEdge platform.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr>
          <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:140px">Login URL</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0"><a href="${loginUrl}" style="color:#3b82f6">${loginUrl}</a></td>
        </tr>
        <tr>
          <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600">Email</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0">${email}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600">Password</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0"><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${tempPassword}</code></td>
        </tr>
      </table>
      <p style="color:#dc2626;font-size:13px">⚠ Please change your password immediately after first login.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
      <p style="color:#94a3b8;font-size:12px">— JustEdge / Just Embedded</p>
    </div>
  `;

  return sendMail({ to: email, subject, text, html });
}

// ── User welcome email (called by userController.createUser) ──────────────────
export async function sendUserWelcomeEmail({ name, email, tempPassword, adminName, companyName }) {
  const loginUrl = process.env.APP_LOGIN_URL || 'https://justedgetesting.vercel.app/login';
  const subject = 'Your JustEdge Account';

  const text = [
    `Hello ${name},`,
    '',
    `${adminName || 'Your admin'} has created a JustEdge account for you${companyName ? ` at ${companyName}` : ''}.`,
    '',
    `Login URL : ${loginUrl}`,
    `Email     : ${email}`,
    `Password  : ${tempPassword}`,
    '',
    'Please sign in and change your password after first login.',
    '',
    '— JustEdge / Just Embedded',
  ].join('\n');

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:8px">
      <h2 style="color:#1e293b;margin-bottom:4px">Welcome to JustEdge</h2>
      <p style="color:#64748b;margin-top:0">Your account is ready</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
      <p>Hello <strong>${name}</strong>,</p>
      <p>
        <strong>${adminName || 'Your admin'}</strong> has set up a JustEdge account for you
        ${companyName ? `at <strong>${companyName}</strong>` : ''}.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr>
          <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:140px">Login URL</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0"><a href="${loginUrl}" style="color:#3b82f6">${loginUrl}</a></td>
        </tr>
        <tr>
          <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600">Email</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0">${email}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600">Password</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0"><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${tempPassword}</code></td>
        </tr>
      </table>
      <p style="color:#dc2626;font-size:13px">⚠ Please change your password immediately after first login.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
      <p style="color:#94a3b8;font-size:12px">— JustEdge / Just Embedded</p>
    </div>
  `;

  return sendMail({ to: email, subject, text, html });
}