function getLoginUrl() {
  // Must be set in .env — no hardcoded production URL in code
  const explicit = (process.env.APP_LOGIN_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const base = (process.env.APP_URL || process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
  if (base) return `${base}/login`;

  console.warn(
    '[email] APP_LOGIN_URL is not set. Add APP_LOGIN_URL=https://your-app.example/login to .env'
  );
  return '';
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

  // Render / many cloud hosts: Gmail IPv6 is often unreachable (ENETUNREACH ::587).
  // Force IPv4 sockets so DNS AAAA records are not used.
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
    // Node net.Socket option — prefer IPv4 (fixes ENETUNREACH on Render)
    family: 4,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 25_000,
    tls: {
      // Gmail STARTTLS on 587
      minVersion: 'TLSv1.2',
      servername: cfg.host,
    },
  });

  try {
    await transporter.sendMail({ from, to, subject, text, html });
    console.log(`[email] sent → ${to} | ${subject} (via ${cfg.host}:${cfg.port} ipv4)`);
    return { sent: true };
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`[email] send failed: ${msg}`);
    if (/ENETUNREACH|ETIMEDOUT|ECONNREFUSED|ESOCKET/i.test(msg)) {
      console.error(
        '[email] Tip (Render): outbound SMTP to Gmail may fail on free/IPv6 networks. ' +
          '1) Ensure family IPv4 is set (already applied). ' +
          '2) Try SMTP_PORT=465 and SMTP_SECURE=true. ' +
          '3) Or use a transactional provider (Resend / SendGrid / Brevo) with their SMTP host.'
      );
    }
    return { sent: false, reason: msg };
  }
}


// ── Admin welcome email (called by adminController.createAdmin) ───────────────
export async function sendAdminWelcomeEmail({ name, email, tempPassword, companyName }) {
  const loginUrl = getLoginUrl();
  const subject = 'Welcome to JustEdge — your admin account';
  const company = companyName || 'your company';

  const text = [
    `Welcome to JustEdge, ${name}!`,
    '',
    `Your admin account for ${company} is ready.`,
    '',
    `Email    : ${email}`,
    `Password : ${tempPassword}`,
    '',
    'Open the email and tap Log in to get started.',
    '',
    '— Just Embedded',
  ].join('\n');

  const html = buildWelcomeHtml({
    loginUrl,
    headline: 'Welcome to JustEdge',
    greeting: `Hello <strong style="color:#ffffff;">${escapeHtml(name)}</strong>,`,
    body: `We're glad you're here. Your <strong style="color:#ffffff;">admin</strong> account for <strong style="color:#ffffff;">${escapeHtml(company)}</strong> is ready — monitor devices, manage users, and run your workspace from one place.`,
    email,
    tempPassword,
  });

  return sendMail({ to: email, subject, text, html });
}

// ── User welcome email (called by userController.createUser) ──────────────────
export async function sendUserWelcomeEmail({ name, email, tempPassword, adminName, companyName }) {
  const loginUrl = getLoginUrl();
  const subject = 'Welcome to JustEdge — your account';

  const text = [
    `Welcome to JustEdge, ${name}!`,
    '',
    `${adminName || 'Your admin'} created your account${companyName ? ` at ${companyName}` : ''}.`,
    '',
    `Email    : ${email}`,
    `Password : ${tempPassword}`,
    '',
    'Open the email and tap Log in to get started.',
    '',
    '— Just Embedded',
  ].join('\n');

  const byline = companyName
    ? `<strong style="color:#ffffff;">${escapeHtml(adminName || 'Your admin')}</strong> invited you to <strong style="color:#ffffff;">${escapeHtml(companyName)}</strong>.`
    : `<strong style="color:#ffffff;">${escapeHtml(adminName || 'Your admin')}</strong> invited you to JustEdge.`;

  const html = buildWelcomeHtml({
    loginUrl,
    headline: 'Welcome to JustEdge',
    greeting: `Hello <strong style="color:#ffffff;">${escapeHtml(name)}</strong>,`,
    body: `${byline} Your account is ready — sign in to view the sensors assigned to you.`,
    email,
    tempPassword,
  });

  return sendMail({ to: email, subject, text, html });
}


/** Dark blue / white brand palette (Just Embedded) + amber Log in button */
function buildWelcomeHtml({ loginUrl, headline, greeting, body, email, tempPassword }) {
  const href = loginUrl || '#';
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(headline)}</title>
</head>
<body style="margin:0;padding:0;background:#060d18;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#060d18;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0b1728;border-radius:18px;overflow:hidden;border:1px solid #1a3050;box-shadow:0 20px 50px rgba(0,0,0,.45);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0a1f3d 0%,#0d2b52 55%,#123a6b 100%);padding:32px 36px;border-bottom:1px solid #1e3a5f;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;letter-spacing:0.04em;">
                <span style="color:#3b82f6;">JUST</span><span style="color:#ef4444;"> EDGE</span>
              </div>
              <div style="font-family:system-ui,-apple-system,sans-serif;font-size:12px;color:#94a3b8;margin-top:6px;letter-spacing:0.12em;text-transform:uppercase;">
                Just Embedded · Connected Systems
              </div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 36px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e2e8f0;">
              <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#ffffff;line-height:1.25;">
                ${escapeHtml(headline)}
              </h1>
              <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#cbd5e1;">
                ${greeting}
              </p>
              <p style="margin:0 0 22px;font-size:14.5px;line-height:1.65;color:#94a3b8;">
                ${body}
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 28px;background:#071322;border:1px solid #1e3a5f;border-radius:12px;">
                <tr>
                  <td style="padding:14px 16px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;width:100px;border-bottom:1px solid #1e3a5f;">Email</td>
                  <td style="padding:14px 16px;font-size:14px;color:#f8fafc;border-bottom:1px solid #1e3a5f;">${escapeHtml(email)}</td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Password</td>
                  <td style="padding:14px 16px;font-size:14px;color:#f8fafc;font-family:ui-monospace,Consolas,monospace;letter-spacing:0.04em;">${escapeHtml(tempPassword)}</td>
                </tr>
              </table>

              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 8px;">
                <tr>
                  <td align="center" bgcolor="#2563eb" style="border-radius:10px;box-shadow:0 8px 24px rgba(37,99,235,.35);">
                    <a href="${href}" target="_blank"
                       style="display:inline-block;padding:14px 36px;font-family:system-ui,-apple-system,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;background:#2563eb;">
                      Log in
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 36px 28px;font-family:system-ui,-apple-system,sans-serif;font-size:12px;color:#64748b;line-height:1.5;border-top:1px solid #1a3050;">
              Connected systems. Built right.<br/>
              <span style="color:#475569;">— Just Embedded</span>
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}