/**
 * Hearth Admin Server — API Route Tester
 *
 * Run:
 *   node test-api.js
 *
 * Requires the server to be running on BASE_URL
 * Default: http://localhost:4000
 */

const BASE_URL =
  process.env.BASE_URL || 'http://localhost:4000';

const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || 'admin@hearth.io';

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || 'change-this-immediately';


// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;
let skipped = 0;


async function req(
  method,
  path,
  {
    body,
    token,
    expectStatus = 200,
    label,
  } = {}
) {
  const tag = label || `${method} ${path}`;

  const url = `${BASE_URL}${path}`;

  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res;
  let data;

  try {
    res = await fetch(url, {
      method,
      headers,
      body: body
        ? JSON.stringify(body)
        : undefined,
    });

    data = await res.json().catch(() => ({}));
  } catch (error) {
    console.log(
      `${RED}FAIL${RESET}  ${tag}\n` +
      `      ${RED}Network error: ${error.message}${RESET}`
    );

    failed++;
    return null;
  }

  const ok = Array.isArray(expectStatus)
    ? expectStatus.includes(res.status)
    : res.status === expectStatus;

  const preview = JSON.stringify(data).slice(0, 180);

  if (ok) {
    console.log(
      `${GREEN}PASS${RESET}  ` +
      `[${res.status}] ${tag} ` +
      `${DIM}${preview}${RESET}`
    );

    passed++;
  } else {
    console.log(
      `${RED}FAIL${RESET}  ` +
      `[${res.status}] ${tag} ` +
      `${DIM}${preview}${RESET}`
    );

    failed++;
  }

  return {
    status: res.status,
    data,
  };
}


function skip(label, reason = '') {
  console.log(
    `${YELLOW}SKIP${RESET}  ${label}` +
    (reason ? ` ${DIM}(${reason})${RESET}` : '')
  );

  skipped++;
}


function section(name) {
  console.log(
    `\n${'─'.repeat(60)}\n` +
    `  ${name}\n` +
    `${'─'.repeat(60)}`
  );
}


/**
 * Extract IDs regardless of whether the API returns:
 *
 * { id: "..." }
 * { _id: "..." }
 * { admin: { id: "..." } }
 * { admin: { _id: "..." } }
 * { user: { id: "..." } }
 * { device: { id: "..." } }
 * etc.
 */
function extractId(response, keys = []) {
  const data = response?.data;

  if (!data) {
    return null;
  }

  // Direct ID
  if (data.id) {
    return data.id;
  }

  if (data._id) {
    return data._id;
  }

  // Nested resource
  for (const key of keys) {
    if (data[key]?.id) {
      return data[key].id;
    }

    if (data[key]?._id) {
      return data[key]._id;
    }
  }

  return null;
}


function firstItem(response, collectionKeys = []) {
  const data = response?.data;

  if (!data) {
    return null;
  }

  // Direct array
  if (Array.isArray(data)) {
    return data[0] || null;
  }

  // Nested array
  for (const key of collectionKeys) {
    if (Array.isArray(data[key])) {
      return data[key][0] || null;
    }
  }

  return null;
}


function itemId(item) {
  return item?.id || item?._id || null;
}


// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function run() {

  console.log(
    `\nHearth API tester → ${BASE_URL}\n`
  );


  // ═══════════════════════════════════════════════════════════
  // Health & Public
  // ═══════════════════════════════════════════════════════════

  section('Health & public');

  await req(
    'GET',
    '/health',
    {
      expectStatus: 200,
      label: 'GET /health',
    }
  );

  await req(
    'GET',
    '/api/board-catalog',
    {
      expectStatus: 200,
      label: 'GET /api/board-catalog (public)',
    }
  );


  // ═══════════════════════════════════════════════════════════
  // Auth
  // ═══════════════════════════════════════════════════════════

  section('Auth');


  // Bad credentials

  await req(
    'POST',
    '/api/auth/login',
    {
      body: {
        email: 'nobody@example.com',
        password: 'wrong',
      },

      expectStatus: 401,

      label:
        'POST /api/auth/login (bad creds → 401)',
    }
  );


  // Correct credentials

  const loginRes = await req(
    'POST',
    '/api/auth/login',
    {
      body: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      },

      expectStatus: 200,

      label:
        'POST /api/auth/login (superadmin)',
    }
  );


  const token =
    loginRes?.data?.token;


  if (!token) {

    console.log(
      `\n${RED}` +
      `Could not obtain authentication token.` +
      `${RESET}`
    );

    console.log(
      `Check ADMIN_EMAIL / ADMIN_PASSWORD ` +
      `or run the seed first.\n`
    );

    skip(
      'GET /api/auth/me',
      'no authentication token'
    );

    skip(
      'POST /api/auth/logout',
      'no authentication token'
    );

    printSummary();

    return;
  }


  await req(
    'GET',
    '/api/auth/me',
    {
      token,
      expectStatus: 200,
      label: 'GET /api/auth/me',
    }
  );


  await req(
    'POST',
    '/api/auth/logout',
    {
      token,
      expectStatus: 200,
      label: 'POST /api/auth/logout',
    }
  );


  // Unauthenticated access

  await req(
    'GET',
    '/api/auth/me',
    {
      expectStatus: 401,
      label:
        'GET /api/auth/me (no token → 401)',
    }
  );


  // Re-login

  const login2 = await req(
    'POST',
    '/api/auth/login',
    {
      body: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      },

      expectStatus: 200,

      label:
        'POST /api/auth/login (re-auth after logout)',
    }
  );


  const tok =
    login2?.data?.token || token;


  // ═══════════════════════════════════════════════════════════
  // System
  // ═══════════════════════════════════════════════════════════

  section('System');

  await req(
    'GET',
    '/api/system/status',
    {
      token: tok,
      expectStatus: 200,
      label: 'GET /api/system/status',
    }
  );


  // ═══════════════════════════════════════════════════════════
  // Admins
  // ═══════════════════════════════════════════════════════════

  section('Admins');


  const adminsRes = await req(
    'GET',
    '/api/admins',
    {
      token: tok,
      expectStatus: 200,
      label: 'GET /api/admins',
    }
  );


  const firstAdmin =
    firstItem(adminsRes, ['admins']);

  const firstAdminId =
    itemId(firstAdmin);


  // CREATE

  const newAdmin = await req(
    'POST',
    '/api/admins',
    {
      token: tok,

      body: {
        name: 'Test Admin',
        email:
          `testadmin_${Date.now()}@hearth.io`,
        password: 'TestPass123!',
        role: 'Admin',
      },

      expectStatus: 201,

      label:
        'POST /api/admins (create)',
    }
  );


  const newAdminId =
    extractId(newAdmin, ['admin']);


  if (newAdminId) {

    // UPDATE

    await req(
      'PATCH',
      `/api/admins/${newAdminId}`,
      {
        token: tok,

        body: {
          name: 'Test Admin Renamed',
        },

        expectStatus: 200,

        label:
          'PATCH /api/admins/:id (update name)',
      }
    );


    // STATUS

    await req(
      'PATCH',
      `/api/admins/${newAdminId}/status`,
      {
        token: tok,

        body: {
          status: 'suspended',
        },

        expectStatus: 200,

        label:
          'PATCH /api/admins/:id/status',
      }
    );


    // PERMISSIONS

    await req(
      'PATCH',
      `/api/admins/${newAdminId}/permissions`,
      {
        token: tok,

        body: {
          manageUsers: true,
        },

        expectStatus: 200,

        label:
          'PATCH /api/admins/:id/permissions',
      }
    );


    // DELETE

    await req(
      'DELETE',
      `/api/admins/${newAdminId}`,
      {
        token: tok,

        expectStatus: 200,

        label:
          'DELETE /api/admins/:id',
      }
    );

  } else {

    skip(
      'PATCH /api/admins/:id',
      'POST /api/admins did not return an ID'
    );

    skip(
      'PATCH /api/admins/:id/status',
      'POST /api/admins did not return an ID'
    );

    skip(
      'PATCH /api/admins/:id/permissions',
      'POST /api/admins did not return an ID'
    );

    skip(
      'DELETE /api/admins/:id',
      'POST /api/admins did not return an ID'
    );
  }


  // ═══════════════════════════════════════════════════════════
  // Users
  // ═══════════════════════════════════════════════════════════

  section('Users');


  const usersRes = await req(
    'GET',
    '/api/users',
    {
      token: tok,
      expectStatus: 200,
      label: 'GET /api/users',
    }
  );


  const firstUser =
    firstItem(usersRes, ['users']);

  const firstUserId =
    itemId(firstUser);


  const newUser = await req(
    'POST',
    '/api/users',
    {
      token: tok,

      body: {
        name: 'Test User',
        email:
          `testuser_${Date.now()}@hearth.io`,
        password: 'UserPass123!',
      },

      expectStatus: 201,

      label:
        'POST /api/users (create)',
    }
  );


  const newUserId =
    extractId(newUser, ['user']);


  if (newUserId) {

    // GET BY ID

    await req(
      'GET',
      `/api/users/${newUserId}`,
      {
        token: tok,
        expectStatus: 200,
        label:
          'GET /api/users/:id',
      }
    );


    // UPDATE

    await req(
      'PATCH',
      `/api/users/${newUserId}`,
      {
        token: tok,

        body: {
          name: 'Test User Renamed',
        },

        expectStatus: 200,

        label:
          'PATCH /api/users/:id',
      }
    );


    // STATUS

    await req(
      'PATCH',
      `/api/users/${newUserId}/status`,
      {
        token: tok,

        body: {
          status: 'suspended',
        },

        expectStatus: 200,

        label:
          'PATCH /api/users/:id/status',
      }
    );


    // PERMISSIONS

    await req(
      'PATCH',
      `/api/users/${newUserId}/permissions`,
      {
        token: tok,

        body: {
          alerts: true,
        },

        expectStatus: 200,

        label:
          'PATCH /api/users/:id/permissions',
      }
    );


    // DELETE

    await req(
      'DELETE',
      `/api/users/${newUserId}`,
      {
        token: tok,

        expectStatus: 200,

        label:
          'DELETE /api/users/:id',
      }
    );

  } else {

    skip(
      'GET /api/users/:id',
      'POST /api/users did not return an ID'
    );

    skip(
      'PATCH /api/users/:id',
      'POST /api/users did not return an ID'
    );

    skip(
      'PATCH /api/users/:id/status',
      'POST /api/users did not return an ID'
    );

    skip(
      'PATCH /api/users/:id/permissions',
      'POST /api/users did not return an ID'
    );

    skip(
      'DELETE /api/users/:id',
      'POST /api/users did not return an ID'
    );
  }


  // ═══════════════════════════════════════════════════════════
  // Devices
  // ═══════════════════════════════════════════════════════════

  section('Devices');


  await req(
    'GET',
    '/api/devices',
    {
      token: tok,
      expectStatus: 200,
      label: 'GET /api/devices',
    }
  );


  await req(
    'GET',
    '/api/devices/live',
    {
      token: tok,
      expectStatus: 200,
      label: 'GET /api/devices/live',
    }
  );


  // IMPORTANT:
  // Backend expects:
  // name + boardId + imei

  const newDevice = await req(
    'POST',
    '/api/devices',
    {
      token: tok,

      body: {
        name: 'Test Sensor',

        boardId:
          'sensor-board-generic',

        imei:
          `QA-IMEI-${Date.now()}`,
      },

      expectStatus: 201,

      label:
        'POST /api/devices (create)',
    }
  );


  const newDeviceId =
    extractId(newDevice, ['device']);


  if (newDeviceId) {

    await req(
      'GET',
      `/api/devices/${newDeviceId}/live`,
      {
        token: tok,

        expectStatus: 200,

        label:
          'GET /api/devices/:id/live',
      }
    );


    await req(
      'PATCH',
      `/api/devices/${newDeviceId}`,
      {
        token: tok,

        body: {
          name: 'Test Sensor Renamed',
        },

        expectStatus: 200,

        label:
          'PATCH /api/devices/:id',
      }
    );


    await req(
      'DELETE',
      `/api/devices/${newDeviceId}`,
      {
        token: tok,

        expectStatus: 200,

        label:
          'DELETE /api/devices/:id',
      }
    );

  } else {

    skip(
      'GET /api/devices/:id/live',
      'POST /api/devices did not return an ID'
    );

    skip(
      'PATCH /api/devices/:id',
      'POST /api/devices did not return an ID'
    );

    skip(
      'DELETE /api/devices/:id',
      'POST /api/devices did not return an ID'
    );
  }


  // ═══════════════════════════════════════════════════════════
  // Alerts
  // ═══════════════════════════════════════════════════════════

  section('Alerts');


  const alertsRes = await req(
    'GET',
    '/api/alerts',
    {
      token: tok,
      expectStatus: 200,
      label: 'GET /api/alerts',
    }
  );


  const alerts =
    alertsRes?.data?.alerts ||
    (Array.isArray(alertsRes?.data)
      ? alertsRes.data
      : []);


  /*
   * Use DIFFERENT alerts for each destructive operation.
   *
   * Alert #1 → resolve
   * Alert #2 → snooze
   * Alert #3 → delete
   */

  if (alerts.length >= 1) {

    const id =
      itemId(alerts[0]);

    if (id) {
      await req(
        'PATCH',
        `/api/alerts/${id}/resolve`,
        {
          token: tok,
          expectStatus: 200,
          label:
            'PATCH /api/alerts/:id/resolve',
        }
      );
    }

  } else {
    skip(
      'PATCH /api/alerts/:id/resolve',
      'no alerts in DB'
    );
  }


  if (alerts.length >= 2) {

    const id =
      itemId(alerts[1]);

    if (id) {
      await req(
        'PATCH',
        `/api/alerts/${id}/snooze`,
        {
          token: tok,

          body: {
            until:
              new Date(
                Date.now() + 3600000
              ).toISOString(),
          },

          expectStatus: 200,

          label:
            'PATCH /api/alerts/:id/snooze',
        }
      );
    }

  } else {
    skip(
      'PATCH /api/alerts/:id/snooze',
      'requires at least 2 alerts'
    );
  }


  if (alerts.length >= 3) {

    const id =
      itemId(alerts[2]);

    if (id) {
      await req(
        'DELETE',
        `/api/alerts/${id}`,
        {
          token: tok,

          expectStatus: 200,

          label:
            'DELETE /api/alerts/:id',
        }
      );
    }

  } else {
    skip(
      'DELETE /api/alerts/:id',
      'requires at least 3 alerts'
    );
  }


  // ═══════════════════════════════════════════════════════════
  // Automations
  // ═══════════════════════════════════════════════════════════

  section('Automations');


  await req(
    'GET',
    '/api/automations',
    {
      token: tok,
      expectStatus: 200,
      label: 'GET /api/automations',
    }
  );


  /*
   * Backend expects:
   *
   * name
   * rule
   *
   * NOT:
   * trigger
   * action
   */

  const newAuto = await req(
    'POST',
    '/api/automations',
    {
      token: tok,

      body: {
        name: 'Test Rule',

        rule:
          'IF temperature > 30 THEN notify',
      },

      expectStatus: 201,

      label:
        'POST /api/automations (create)',
    }
  );


  const autoId =
    extractId(newAuto, ['automation']);


  if (autoId) {

    await req(
      'PATCH',
      `/api/automations/${autoId}/toggle`,
      {
        token: tok,

        expectStatus: 200,

        label:
          'PATCH /api/automations/:id/toggle',
      }
    );


    await req(
      'DELETE',
      `/api/automations/${autoId}`,
      {
        token: tok,

        expectStatus: 200,

        label:
          'DELETE /api/automations/:id',
      }
    );

  } else {

    skip(
      'PATCH /api/automations/:id/toggle',
      'POST /api/automations did not return an ID'
    );

    skip(
      'DELETE /api/automations/:id',
      'POST /api/automations did not return an ID'
    );
  }


  // ═══════════════════════════════════════════════════════════
  // Billing
  // ═══════════════════════════════════════════════════════════

  section('Billing');


  await req(
    'GET',
    '/api/billing/plans',
    {
      token: tok,
      expectStatus: 200,
      label:
        'GET /api/billing/plans',
    }
  );


  await req(
    'GET',
    '/api/billing/subscriptions',
    {
      token: tok,
      expectStatus: 200,
      label:
        'GET /api/billing/subscriptions',
    }
  );


  const newPlan = await req(
    'POST',
    '/api/billing/plans',
    {
      token: tok,

      body: {
        id:
          `plan_test_${Date.now()}`,

        name:
          'Test Plan',

        desc:
          'Test billing plan',

        price:
          '$5/mo',
      },

      expectStatus: 201,

      label:
        'POST /api/billing/plans (create)',
    }
  );


  const planId =
    extractId(newPlan, ['plan']);


  if (planId) {

    await req(
      'PATCH',
      `/api/billing/plans/${planId}`,
      {
        token: tok,

        body: {
          price: '$6/mo',
        },

        expectStatus: 200,

        label:
          'PATCH /api/billing/plans/:id',
      }
    );

  } else {

    skip(
      'PATCH /api/billing/plans/:id',
      'POST /api/billing/plans did not return an ID'
    );
  }


  // ═══════════════════════════════════════════════════════════
  // Board Catalog
  // ═══════════════════════════════════════════════════════════

  section('Board Catalog');


  const newBoard = await req(
    'POST',
    '/api/board-catalog',
    {
      token: tok,

      body: {
        id:
          `board_test_${Date.now()}`,

        name:
          'Test Board',

        conn:
          'WiFi',

        probes:
          ['Temperature'],

        desc:
          'Test board entry',
      },

      expectStatus: 201,

      label:
        'POST /api/board-catalog (create)',
    }
  );


  const boardId =
    extractId(
      newBoard,
      ['board', 'entry']
    );


  if (boardId) {

    await req(
      'PATCH',
      `/api/board-catalog/${boardId}`,
      {
        token: tok,

        body: {
          name:
            'Test Board Renamed',
        },

        expectStatus: 200,

        label:
          'PATCH /api/board-catalog/:id',
      }
    );


    await req(
      'DELETE',
      `/api/board-catalog/${boardId}`,
      {
        token: tok,

        expectStatus: 200,

        label:
          'DELETE /api/board-catalog/:id',
      }
    );

  } else {

    skip(
      'PATCH /api/board-catalog/:id',
      'POST /api/board-catalog did not return an ID'
    );

    skip(
      'DELETE /api/board-catalog/:id',
      'POST /api/board-catalog did not return an ID'
    );
  }


  // ═══════════════════════════════════════════════════════════
  // Activity Logs
  // ═══════════════════════════════════════════════════════════

  section('Activity Logs');


  await req(
    'GET',
    '/api/activity-logs',
    {
      token: tok,
      expectStatus: 200,
      label:
        'GET /api/activity-logs',
    }
  );


  await req(
    'GET',
    '/api/activity-logs/summary',
    {
      token: tok,
      expectStatus: 200,
      label:
        'GET /api/activity-logs/summary',
    }
  );


  // ═══════════════════════════════════════════════════════════
  // Access Control
  // ═══════════════════════════════════════════════════════════

  section('Access Control');


  await req(
    'GET',
    '/api/access-control/roles',
    {
      token: tok,
      expectStatus: 200,
      label:
        'GET /api/access-control/roles',
    }
  );


  if (firstAdminId) {

    await req(
      'GET',
      `/api/access-control/accounts/${firstAdminId}`,
      {
        token: tok,

        expectStatus: 200,

        label:
          'GET /api/access-control/accounts/:id',
      }
    );

  } else {

    skip(
      'GET /api/access-control/accounts/:id',
      'no admin ID returned'
    );
  }


  // ═══════════════════════════════════════════════════════════
  // Oversight
  // ═══════════════════════════════════════════════════════════

  section('Oversight');


  await req(
    'GET',
    '/api/oversight/summary',
    {
      token: tok,

      expectStatus: 200,

      label:
        'GET /api/oversight/summary',
    }
  );


  const flagsRes = await req(
    'GET',
    '/api/oversight/flags',
    {
      token: tok,

      expectStatus: 200,

      label:
        'GET /api/oversight/flags',
    }
  );


  const flags =
    flagsRes?.data?.flags ||
    (Array.isArray(flagsRes?.data)
      ? flagsRes.data
      : []);


  /*
   * Use two flags:
   *
   * flag #1 → resolve
   * flag #2 → reopen
   */

  if (flags.length >= 1) {

    const id =
      itemId(flags[0]);

    if (id) {

      await req(
        'PATCH',
        `/api/oversight/flags/${id}/resolve`,
        {
          token: tok,

          expectStatus: 200,

          label:
            'PATCH /api/oversight/flags/:id/resolve',
        }
      );
    }

  } else {

    skip(
      'PATCH /api/oversight/flags/:id/resolve',
      'no flags in DB'
    );
  }


  if (flags.length >= 2) {

    const id =
      itemId(flags[1]);

    if (id) {

      await req(
        'PATCH',
        `/api/oversight/flags/${id}/reopen`,
        {
          token: tok,

          expectStatus: 200,

          label:
            'PATCH /api/oversight/flags/:id/reopen',
        }
      );
    }

  } else {

    skip(
      'PATCH /api/oversight/flags/:id/reopen',
      'requires at least 2 flags'
    );
  }


  // ═══════════════════════════════════════════════════════════
  // Export
  // ═══════════════════════════════════════════════════════════

  section('Export');


  /*
   * IMPORTANT:
   *
   * The backend accepts:
   *
   * sensors
   * users
   * activity
   * billing
   *
   * NOT:
   *
   * devices
   * activity-logs
   * alerts
   */

  const exportTypes = [
    'sensors',
    'users',
    'activity',
    'billing',
  ];


  for (const type of exportTypes) {

    await req(
      'GET',
      `/api/export/${type}`,
      {
        token: tok,

        expectStatus:
          [200, 403],

        label:
          `GET /api/export/${type}`,
      }
    );
  }


  // ═══════════════════════════════════════════════════════════
  // 404
  // ═══════════════════════════════════════════════════════════

  section('404 catch-all');


  await req(
    'GET',
    '/api/does-not-exist',
    {
      token: tok,

      expectStatus: 404,

      label:
        'GET /api/does-not-exist → 404',
    }
  );


  // ═══════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════

  printSummary();
}


function printSummary() {

  const total =
    passed +
    failed +
    skipped;


  console.log(
    `\n${'═'.repeat(60)}`
  );

  console.log(
    `  Results: ` +
    `${GREEN}${passed} passed${RESET}  ` +
    `${RED}${failed} failed${RESET}  ` +
    `${YELLOW}${skipped} skipped${RESET}  ` +
    `(${total} total)`
  );

  console.log(
    `${'═'.repeat(60)}\n`
  );


  if (failed > 0) {
    process.exit(1);
  }
}


run().catch((error) => {

  console.error(
    '\nUnhandled error:',
    error
  );

  process.exit(1);
});