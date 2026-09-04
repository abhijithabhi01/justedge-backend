function getLoginUrl() {
  const explicit = process.env.APP_LOGIN_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const base = (process.env.FRONTEND_URL || process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (base) return `${base}/login`;

  // Fallback: build from the Vercel-provided URL if present (works for
  // production + preview deployments without hardcoding anything).
  // Vercel exposes VERCEL_URL (no protocol) automatically at build/runtime.
  const vercelUrl = (process.env.VERCEL_URL || '').trim().replace(/\/$/, '');
  if (vercelUrl) {
    const withProtocol = vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`;
    return `${withProtocol}/login`;
  }

  // Last-resort fallback, also configurable via env so nothing is hardcoded
  // per-project. Set DEFAULT_FRONTEND_URL if you want a fixed fallback.
  const defaultUrl = (process.env.DEFAULT_FRONTEND_URL || '').trim().replace(/\/$/, '');
  if (defaultUrl) return `${defaultUrl}/login`;

  console.warn(
    '[email] No APP_LOGIN_URL, FRONTEND_URL, APP_URL, VERCEL_URL, or DEFAULT_FRONTEND_URL set — ' +
      'login links in emails will be relative "/login" only.'
  );
  return '/login';
}

/**
 * Resolve SMTP host/port. Common misconfig: putting the Gmail address in
 * SMTP_HOST → getaddrinfo EAI_FAIL justedgesuperadmin@gmail.com
 */
function resolveSmtpConfig() {
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  let host = (process.env.SMTP_HOST || '').trim();
  let port = Number(process.env.SMTP_PORT || 587);
  let secure = String(process.env.SMTP_SECURE || '') === 'true';

  // If host is missing or looks like an email, fix for Gmail / Google Workspace
  const hostLooksLikeEmail = host.includes('@');
  if (!host || hostLooksLikeEmail) {
    if (hostLooksLikeEmail) {
      console.warn(
        `[email] SMTP_HOST looks like an email ("${host}"). ` +
          'Use the mail server hostname, e.g. smtp.gmail.com — not the account address.'
      );
    }
    const domain = (user.split('@')[1] || '').toLowerCase();
    if (domain === 'gmail.com' || domain === 'googlemail.com' || domain.endsWith('.google.com')) {
      host = 'smtp.gmail.com';
      if (!process.env.SMTP_PORT) port = 587;
      if (!process.env.SMTP_SECURE) secure = false;
    } else if (!host || hostLooksLikeEmail) {
      // Unknown provider and invalid host — cannot guess
      return { error: 'smtp_host_invalid', host, user, pass };
    }
  }

  return { host, port, secure, user, pass };
}

// ── Core mailer ──────────────────────────────────────────────────────────────
export async function sendMail({ to, subject, text, html }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@justedge.io';
  const cfg = resolveSmtpConfig();

  if (cfg.error || !cfg.user || !cfg.pass || !cfg.host) {
    const reason = cfg.error || 'smtp_not_configured';
    console.log(`[email] ${reason} — message not sent`);
    console.log('[email] to:', to, '| subject:', subject);
    console.log('[email] body:\n', text || html);
    if (reason === 'smtp_host_invalid') {
      console.log(
        '[email] Set SMTP_HOST=smtp.gmail.com (or your provider host). ' +
          'SMTP_USER should be the full email; SMTP_PASS a Gmail App Password.'
      );
    }
    return { sent: false, reason };
  }

  let nodemailer;
  try {
    nodemailer = await import('nodemailer');
  } catch {
    console.warn('[email] nodemailer not installed — run: npm i nodemailer');
    return { sent: false, reason: 'nodemailer_missing' };
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });

  await transporter.sendMail({ from, to, subject, text, html });
  console.log(`[email] sent → ${to} | ${subject} (via ${cfg.host})`);
  return { sent: true };
}

// ── Shared HTML template ───────────────────────────────────────────────────
function renderWelcomeEmail({ heading, introLine, greetingName, bodyLine, loginUrl, email, tempPassword }) {
  return `
  <div style="background:#f1f5f9;padding:32px 16px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,0.06);">

      <!-- Header banner -->
      <div style="background:linear-gradient(135deg,#0a1a3f,#132a5e);padding:32px;text-align:center;border-bottom:3px solid #c8102e;">
        <div style="font-size:28px;line-height:1;margin-bottom:8px;">👋</div>
        <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;letter-spacing:0.3px;">${escapeHtml(heading)}</h1>
        <p style="color:#d4af37;margin:6px 0 0;font-size:14px;font-weight:600;">${escapeHtml(introLine)}</p>
      </div>

      <!-- Body -->
      <div style="padding:32px;">
        <p style="color:#0a1a3f;font-size:16px;margin:0 0 16px;">Hi <strong>${escapeHtml(greetingName)}</strong>, welcome aboard! 🎉</p>
        <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px;">${bodyLine}</p>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid #d4af37;border-radius:10px;padding:4px;margin-bottom:24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:12px 16px;color:#64748b;font-size:13px;font-weight:600;width:110px;">Email</td>
              <td style="padding:12px 16px;font-size:13px;color:#0a1a3f;">${escapeHtml(email)}</td>
            </tr>
            <tr>
              <td style="padding:12px 16px;color:#64748b;font-size:13px;font-weight:600;border-top:1px solid #e2e8f0;">Password</td>
              <td style="padding:12px 16px;border-top:1px solid #e2e8f0;">
                <code style="background:#e2e8f0;color:#0a1a3f;padding:3px 8px;border-radius:6px;font-size:13px;">${escapeHtml(tempPassword)}</code>
              </td>
            </tr>
          </table>
        </div>

        <div style="text-align:center;margin:28px 0 8px;">
          <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#c8102e,#8f0c22);color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:600;font-size:14px;">
            Open JustEdge login →
          </a>
        </div>

        <p style="text-align:center;color:#c8102e;font-size:12.5px;margin:20px 0 0;">
          ⚠ For your security, please change this password right after your first login.
        </p>
      </div>

      <!-- Footer -->
      <div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="color:#94a3b8;font-size:12px;margin:0;">Sent by JustEdge / Just Embedded — glad to have you here.</p>
      </div>
    </div>
  </div>
  `;
}

// ── Admin welcome email (called by adminController.createAdmin) ───────────────
export async function sendAdminWelcomeEmail({ name, email, tempPassword, companyName }) {
  const loginUrl = getLoginUrl();
  const subject = 'Welcome to JustEdge — your admin account is ready 🎉';

  const text = [
    `Hello ${name},`,
    '',
    `Welcome to JustEdge! A new admin account has been created for ${companyName || 'your company'}.`,
    '',
    `Login URL : ${loginUrl}`,
    `Email     : ${email}`,
    `Password  : ${tempPassword}`,
    '',
    'Please sign in and change your password after first login.',
    '',
    "We're glad to have you on board.",
    '— JustEdge / Just Embedded',
  ].join('\n');

  const html = renderWelcomeEmail({
    heading: 'Welcome to JustEdge',
    introLine: 'Your admin account is ready',
    greetingName: name,
    bodyLine: `An admin account has been created for <strong>${escapeHtml(
      companyName || 'your company'
    )}</strong> on the JustEdge platform. You now have full access to manage your organization — use the credentials below to get started.`,
    loginUrl,
    email,
    tempPassword,
  });

  return sendMail({ to: email, subject, text, html });
}

// ── User welcome email (called by userController.createUser) ──────────────────
export async function sendUserWelcomeEmail({ name, email, tempPassword, adminName, companyName }) {
  const loginUrl = getLoginUrl();
  const subject = 'Welcome to JustEdge — your account is ready 🎉';

  const text = [
    `Hello ${name},`,
    '',
    `Welcome to JustEdge! ${adminName || 'Your admin'} has created an account for you${
      companyName ? ` at ${companyName}` : ''
    }.`,
    '',
    `Login URL : ${loginUrl}`,
    `Email     : ${email}`,
    `Password  : ${tempPassword}`,
    '',
    'Please sign in and change your password after first login.',
    '',
    "We're glad to have you on board.",
    '— JustEdge / Just Embedded',
  ].join('\n');

  const html = renderWelcomeEmail({
    heading: 'Welcome to JustEdge',
    introLine: 'Your account is ready',
    greetingName: name,
    bodyLine: `<strong>${escapeHtml(adminName || 'Your admin')}</strong> has set up a JustEdge account for you${
      companyName ? ` at <strong>${escapeHtml(companyName)}</strong>` : ''
    }. Sign in below to explore your dashboard and get started.`,
    loginUrl,
    email,
    tempPassword,
  });

  return sendMail({ to: email, subject, text, html });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}