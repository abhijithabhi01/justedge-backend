# Hearth Admin — Server

Node.js + Express + MongoDB API backing the superadmin dashboard: admin
accounts, activity logs, access control, and oversight. Built to run locally
or on MongoDB Atlas now, and move behind AWS (EC2/ECS + DocumentDB or
Atlas-on-AWS) later without code changes — all infra is env-configured
(`server/src/config/db.js` is the only file that talks to Mongo directly).

## Setup

```bash
cd server
npm install
cp .env.example .env   # fill in MONGO_URI, JWT_SECRET, etc.
npm run seed            # creates the first Superadmin account
npm run dev              # http://localhost:4000
```

The seed script only runs if no admin accounts exist yet — safe to leave in
your normal deploy flow.

## Auth

- `POST /api/auth/login` — `{ email, password }` → `{ token, admin }`. Token is
  a JWT (`Authorization: Bearer <token>`), expires per `JWT_EXPIRES_IN`.
- `GET /api/auth/me` — current admin.
- `POST /api/auth/logout` — logs a "Signed out" activity entry (JWTs are
  stateless — the client just discards the token; add a denylist/refresh-token
  store later if you need server-side revocation).
- 3+ failed logins for one account auto-creates a critical Oversight flag.

## Endpoints

| Area | Route | Notes |
|---|---|---|
| Admin accounts | `GET/POST /api/admins`, `PATCH /api/admins/:id`, `PATCH /api/admins/:id/status`, `PATCH /api/admins/:id/permissions`, `DELETE /api/admins/:id` | Mutations require `Superadmin` role. Guards: can't remove/suspend yourself, can't remove/demote/suspend the last active Superadmin. |
| Activity logs | `GET /api/activity-logs?q=&category=&severity=&from=&to=&page=&pageSize=`, `GET /api/activity-logs/summary` | Append-only — no update/delete route exists on purpose. |
| Access control | `GET /api/access-control/roles`, `GET /api/access-control/accounts/:id` | Role defaults + one account's live permissions. |
| Oversight | `GET /api/oversight/summary`, `GET /api/oversight/flags?resolved=`, `PATCH /api/oversight/flags/:id/resolve` | Missing-2FA / inactive-30d+ / suspended accounts, failed-login counts, resolvable flags. |

Every write endpoint logs an `ActivityLog` entry via
`middleware/activityLogger.js` with a human-readable action + target, so the
audit trail reads as a timeline, not raw HTTP verbs.

## Permission model

Roles: `Superadmin`, `Admin`, `Support`. Defaults live in
`models/AdminAccount.js::defaultPermissionsForRole` — the same shape the
React app uses in `src/lib/helpers.js`, so keep the two in sync if you add a
permission key. `manageAdmins` is Superadmin-only and can't be granted to
other roles (enforced in `adminController.setAdminPermission`).

## Moving to AWS later

Nothing in `models/`, `controllers/`, or `routes/` references infrastructure.
When you're ready:
1. Point `MONGO_URI` at DocumentDB or Atlas-on-AWS.
2. Deploy the same `server/` app to ECS/EC2/Elastic Beanstalk behind an ALB.
3. Move `JWT_SECRET` and Mongo credentials into Secrets Manager / SSM
   Parameter Store and inject them as env vars — the app already reads
   everything from `process.env`.

## Wiring up the existing React app

The frontend (`hearth-admin/`) currently runs entirely on localStorage-backed
demo data (`src/context/DataContext.jsx`). To point it at this server:
1. Replace the `localStorage` load/save in `DataContext.jsx` with `fetch`
   calls to these routes (start with `adminAccounts`, `activityLogs`,
   `securityFlags` — the three superadmin data sets).
2. Store the JWT from `/api/auth/login` (e.g. in memory + an httpOnly cookie
   set by the server, not localStorage, once this goes to production) and
   send it as `Authorization: Bearer <token>` on every request.
3. Keep `AuthContext.jsx`'s `session.role` — it already matches the roles
   this API returns.
