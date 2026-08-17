// Gate a route behind a specific admin-console permission (see AdminAccount.permissions).
// Superadmins always pass, since manageAdmins/manageAccessControl are their reserved powers.
// Returns 403 (not 401) when the caller is authenticated but as a User —
// requireAuth already establishes authentication, so this is a "wrong
// account type / missing permission" case, not a missing-credentials one.
export function requirePermission(key) {
  return (req, res, next) => {
    const admin = req.admin;
    if (!admin) return res.status(403).json({ error: 'Forbidden' });
    if (admin.role === 'Superadmin') return next();
    if (admin.permissions?.[key]) return next();
    return res.status(403).json({ error: `Missing permission: ${key}` });
  };
}

// Gate a route behind an exact role (used for the superadmin-only surface:
// admin-account creation/removal, role changes, board-catalog writes).
export function requireRole(...roles) {
  return (req, res, next) => {
    const admin = req.admin;
    if (!admin) return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    if (!roles.includes(admin.role)) return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    next();
  };
}

// Gate a route behind a User-table permission (see UserAccount.permissions).
export function requireUserPermission(key) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) return res.status(403).json({ error: 'Forbidden' });
    if (user.permissions?.[key]) return next();
    return res.status(403).json({ error: `Missing permission: ${key}` });
  };
}

// Several new routes are reachable by either side of the platform with a
// different permission key each — e.g. alerts/automations require
// `manageSensors` on the admin table OR `alerts`/`automations` on the user
// table. Superadmins always pass. Pass `null` for a side that should never
// be allowed through this route.
export function requireEitherPermission({ admin: adminKey = null, user: userKey = null } = {}) {
  return (req, res, next) => {
    if (req.admin) {
      if (req.admin.role === 'Superadmin') return next();
      if (adminKey && req.admin.permissions?.[adminKey]) return next();
    }
    if (req.user && userKey && req.user.permissions?.[userKey]) return next();

    const parts = [adminKey, userKey].filter(Boolean).join(' or ');
    return res.status(403).json({ error: `Missing permission: ${parts}` });
  };
}

// Gate a route behind "any signed-in admin/superadmin" with no specific
// permission key required — used where the admin console can read
// something any staff member should see, but Users never should.
export function requireAnyAdmin() {
  return (req, res, next) => {
    if (!req.admin) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
