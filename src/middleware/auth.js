import jwt from 'jsonwebtoken';
import { AdminAccount } from '../models/AdminAccount.js';
import { UserAccount } from '../models/UserAccount.js';

// Verifies the bearer token, loads the account, and rejects suspended
// accounts on every request (not just at login) so a suspension takes
// effect immediately.
//
// Tokens are tagged with `kind: 'admin' | 'user'` at sign time (see
// authController.js) so this middleware knows which table to load from.
// Tokens signed before the two-table split didn't carry `kind` — those
// fall through to the admin branch, same as before.
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.kind === 'user') {
      const user = await UserAccount.findById(payload.sub);
      if (!user) return res.status(401).json({ error: 'Account no longer exists' });
      if (user.status === 'suspended') return res.status(403).json({ error: 'Account is suspended' });
      req.user = user;
      return next();
    }

    const admin = await AdminAccount.findById(payload.sub);
    if (!admin) return res.status(401).json({ error: 'Account no longer exists' });
    if (admin.status === 'suspended') return res.status(403).json({ error: 'Account is suspended' });
    req.admin = admin;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
