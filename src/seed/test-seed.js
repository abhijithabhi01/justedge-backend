import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import { AdminAccount, defaultPermissionsForRole } from '../models/AdminAccount.js';
import { UserAccount, defaultUserPermissions } from '../models/UserAccount.js';
import { Device } from '../models/Device.js';
import { Alert } from '../models/Alert.js';
import { Automation } from '../models/Automation.js';
import { SecurityFlag } from '../models/SecurityFlag.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { BoardCatalog } from '../models/BoardCatalog.js';
import { BillingPlan } from '../models/BillingPlan.js';

const FIXTURE = {
  superadmin: {
    name: 'QA Superadmin',
    email: process.env.TEST_SUPERADMIN_EMAIL || 'qa.superadmin@hearth.test',
    password: process.env.TEST_SUPERADMIN_PASSWORD || 'QaSuperadmin@123',
    phone: '9000000001',
  },

  admin: {
    name: 'QA Admin',
    email: process.env.TEST_ADMIN_EMAIL || 'qa.admin@hearth.test',
    password: process.env.TEST_ADMIN_PASSWORD || 'QaAdmin@123',
    phone: '9000000002',
  },

  user1: {
    name: 'QA User One',
    email: process.env.TEST_USER1_EMAIL || 'qa.user1@hearth.test',
    password: process.env.TEST_USER1_PASSWORD || 'QaUser@123',
    phone: '9000000011',
  },

  user2: {
    name: 'QA User Two',
    email: process.env.TEST_USER2_EMAIL || 'qa.user2@hearth.test',
    password: process.env.TEST_USER2_PASSWORD || 'QaUser@123',
    phone: '9000000012',
  },
};

const ALL_USER_PERMISSIONS = defaultUserPermissions({
  addSensor: true,
  editSensor: true,
  removeSensor: true,
  automations: true,
  alerts: true,
  manageUsers: true,
  exportData: true,
});


async function upsertAdmin(
  { name, email, password, phone, role },
  createdBy = null
) {
  let admin = await AdminAccount.findOne({
    email: email.toLowerCase(),
  });

  if (!admin) {
    admin = new AdminAccount({
      name,
      email: email.toLowerCase(),
      phone,
      role,
      status: 'active',
      twoFactor: false,
      permissions: defaultPermissionsForRole(role),
      createdBy,
    });

    admin.passwordHash = await bcrypt.hash(password, 12);
    await admin.save();

    console.log(`[test-seed] created ${role}: ${email}`);
  } else {
    admin.name = name;
    admin.phone = phone;
    admin.role = role;
    admin.status = 'active';
    admin.permissions = defaultPermissionsForRole(role);
    admin.failedLoginAttempts = 0;
    admin.passwordHash = await bcrypt.hash(password, 12);

    if (createdBy) {
      admin.createdBy = createdBy;
    }

    await admin.save();

    console.log(`[test-seed] reset existing ${role}: ${email}`);
  }

  return admin;
}


async function upsertUser(
  { name, email, password, phone },
  createdBy
) {
  let user = await UserAccount.findOne({
    email: email.toLowerCase(),
  });

  if (!user) {
    user = new UserAccount({
      name,
      email: email.toLowerCase(),
      phone,
      role: 'User',
      status: 'active',
      permissions: ALL_USER_PERMISSIONS,
      createdBy,
    });

    user.passwordHash = await bcrypt.hash(password, 12);
    await user.save();

    console.log(`[test-seed] created user: ${email}`);
  } else {
    user.name = name;
    user.phone = phone;
    user.status = 'active';
    user.permissions = ALL_USER_PERMISSIONS;
    user.failedLoginAttempts = 0;
    user.passwordHash = await bcrypt.hash(password, 12);
    user.createdBy = createdBy;

    await user.save();

    console.log(`[test-seed] reset existing user: ${email}`);
  }

  return user;
}


async function ensureBaseCatalog() {
  await BoardCatalog.updateOne(
    { id: 'sensor-board-generic' },
    {
      $setOnInsert: {
        id: 'sensor-board-generic',
        name: 'Generic Sensor Board',
        conn: 'WiFi',
        probes: [
          'Temperature',
          'Humidity',
          'Pressure',
          'Light',
          'CO2',
          'Vibration',
        ],
        desc: 'General-purpose environmental sensor board for QA tests.',
      },
    },
    { upsert: true }
  );


  await BoardCatalog.updateOne(
    { id: 'smart-meter-3phase' },
    {
      $setOnInsert: {
        id: 'smart-meter-3phase',
        name: 'Qubino Smart Meter 3-Phase',
        conn: 'RS485/Modbus',
        probes: [
          'Current',
          'Voltage',
          'Power',
          'Energy',
          'Frequency',
          'Power Factor',
        ],
        desc: '3-phase meter used by QA fixtures.',
      },
    },
    { upsert: true }
  );


  const plans = [
    {
      id: 'basic',
      name: 'Basic',
      desc: 'Core monitoring for a single site.',
      price: '$9/mo',
    },
    {
      id: 'pro',
      name: 'Pro',
      desc: 'Alerts, automations and multi-site support.',
      price: '$29/mo',
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      desc: 'Unlimited devices, priority support, custom SLAs.',
      price: 'Contact us',
    },
  ];


  for (const plan of plans) {
    await BillingPlan.updateOne(
      { id: plan.id },
      { $setOnInsert: plan },
      { upsert: true }
    );
  }
}


async function ensureDevice({
  name,
  imei,
  boardId,
  userId,
  subscriptionPlan,
}) {
  let device = await Device.findOne({ imei });

  if (!device) {
    device = await Device.create({
      name,
      boardId,
      imei,
      simNo: `QA-SIM-${imei.slice(-4)}`,
      subscriptionPlan,
      subscriptionExpiry: new Date(
        Date.now() + 180 * 86400000
      ),
      assignedUserId: userId,
    });

    console.log(`[test-seed] created device: ${imei}`);
  } else {
    device.name = name;
    device.boardId = boardId;
    device.simNo = `QA-SIM-${imei.slice(-4)}`;
    device.subscriptionPlan = subscriptionPlan;
    device.subscriptionExpiry = new Date(
      Date.now() + 180 * 86400000
    );
    device.assignedUserId = userId;

    await device.save();

    console.log(`[test-seed] reset device: ${imei}`);
  }

  return device;
}


async function ensureAlert({
  key,
  ownerId,
  deviceId,
  title,
  tone,
}) {
  let alert = await Alert.findOne({
    title,
    deviceId,
  });

  if (!alert) {
    alert = await Alert.create({
      ownerId,
      deviceId,
      icon: 'alert-triangle',
      tone,
      title,
      desc: `QA fixture alert (${key})`,
      resolved: false,
      snoozedUntil: null,
    });

    console.log(`[test-seed] created alert: ${key}`);
  } else {
    alert.ownerId = ownerId;
    alert.resolved = false;
    alert.snoozedUntil = null;
    alert.tone = tone;

    await alert.save();

    console.log(`[test-seed] reset alert: ${key}`);
  }

  return alert;
}


async function ensureAutomation({
  key,
  ownerId,
  deviceId,
  name,
}) {
  let automation = await Automation.findOne({
    name,
    deviceId,
  });

  if (!automation) {
    automation = await Automation.create({
      ownerId,
      deviceId,
      icon: 'zap',
      name,
      rule: `IF temperature > 30 THEN notify QA (${key})`,
      on: true,
      runs: 0,
      lastRun: null,
    });

    console.log(`[test-seed] created automation: ${key}`);
  } else {
    automation.ownerId = ownerId;
    automation.deviceId = deviceId;
    automation.rule =
      `IF temperature > 30 THEN notify QA (${key})`;
    automation.on = true;
    automation.runs = 0;
    automation.lastRun = null;

    await automation.save();

    console.log(`[test-seed] reset automation: ${key}`);
  }

  return automation;
}


async function ensureFlag({
  key,
  relatedAdminId,
  title,
  severity,
}) {
  let flag = await SecurityFlag.findOne({
    title,
  });

  if (!flag) {
    flag = await SecurityFlag.create({
      title,
      description: `QA fixture oversight flag (${key}).`,
      severity,
      category: 'security',
      relatedAdminId,
      resolved: false,
      resolvedBy: null,
      resolvedAt: null,
    });

    console.log(`[test-seed] created oversight flag: ${key}`);
  } else {
    flag.description =
      `QA fixture oversight flag (${key}).`;
    flag.severity = severity;
    flag.relatedAdminId = relatedAdminId;
    flag.resolved = false;
    flag.resolvedBy = null;
    flag.resolvedAt = null;

    await flag.save();

    console.log(`[test-seed] reset oversight flag: ${key}`);
  }

  return flag;
}


async function run() {
  await connectDB();

  console.log('\n[test-seed] Setting up QA fixtures...\n');

  await ensureBaseCatalog();


  // Two Superadmins are kept so delete/suspend tests
  // can safely target a non-current account.
  const superadmin = await upsertAdmin(
    FIXTURE.superadmin
  );

  const admin = await upsertAdmin(
    FIXTURE.admin,
    superadmin._id
  );


  const user1 = await upsertUser(
    FIXTURE.user1,
    superadmin._id
  );

  const user2 = await upsertUser(
    FIXTURE.user2,
    superadmin._id
  );


  const device1 = await ensureDevice({
    name: 'QA Sensor One',
    imei: 'QA-IMEI-000000001',
    boardId: 'sensor-board-generic',
    userId: user1._id,
    subscriptionPlan: 'pro',
  });


  const device2 = await ensureDevice({
    name: 'QA Sensor Two',
    imei: 'QA-IMEI-000000002',
    boardId: 'smart-meter-3phase',
    userId: user2._id,
    subscriptionPlan: 'basic',
  });


  // Multiple alerts so resolve/snooze/delete
  // can be tested independently.

  const alert1 = await ensureAlert({
    key: 'alert-resolve',
    ownerId: user1._id,
    deviceId: device1._id.toString(),
    title: 'QA Alert - Resolve',
    tone: 'warn',
  });


  const alert2 = await ensureAlert({
    key: 'alert-snooze',
    ownerId: user1._id,
    deviceId: device1._id.toString(),
    title: 'QA Alert - Snooze',
    tone: 'info',
  });


  const alert3 = await ensureAlert({
    key: 'alert-delete',
    ownerId: user2._id,
    deviceId: device2._id.toString(),
    title: 'QA Alert - Delete',
    tone: 'critical',
  });


  // Two automations so toggle/delete can be
  // tested independently.

  const automation1 = await ensureAutomation({
    key: 'automation-toggle',
    ownerId: user1._id,
    deviceId: device1._id.toString(),
    name: 'QA Automation - Toggle',
  });


  const automation2 = await ensureAutomation({
    key: 'automation-delete',
    ownerId: user2._id,
    deviceId: device2._id.toString(),
    name: 'QA Automation - Delete',
  });


  // Two flags so resolve/reopen can be tested.

  const flag1 = await ensureFlag({
    key: 'flag-resolve',
    relatedAdminId: admin._id,
    title: 'QA Flag - Resolve',
    severity: 'warn',
  });


  const flag2 = await ensureFlag({
    key: 'flag-reopen',
    relatedAdminId: admin._id,
    title: 'QA Flag - Reopen',
    severity: 'critical',
  });


  // Activity-log fixture for export/activity tests.

  const activityExists = await ActivityLog.exists({
    action: 'QA seed fixture activity',
  });

  if (!activityExists) {
    await ActivityLog.create({
      actorId: superadmin._id,
      actorName: superadmin.name,
      actorRole: superadmin.role,
      action: 'QA seed fixture activity',
      target: 'QA test fixtures',
      targetType: 'data',
      category: 'data',
      severity: 'info',
      ip: 'test-seed',
      userAgent: 'test-seed',
    });

    console.log(
      '[test-seed] created activity log fixture'
    );
  }


  console.log('\n[test-seed] QA credentials');

  console.log(
    `  Superadmin: ${FIXTURE.superadmin.email} / ${FIXTURE.superadmin.password}`
  );

  console.log(
    `  Admin:      ${FIXTURE.admin.email} / ${FIXTURE.admin.password}`
  );

  console.log(
    `  User 1:     ${FIXTURE.user1.email} / ${FIXTURE.user1.password}`
  );

  console.log(
    `  User 2:     ${FIXTURE.user2.email} / ${FIXTURE.user2.password}`
  );


  console.log('\n[test-seed] Fixture IDs');

  console.log(`  admin:       ${admin._id}`);
  console.log(`  user1:       ${user1._id}`);
  console.log(`  user2:       ${user2._id}`);
  console.log(`  device1:     ${device1._id}`);
  console.log(`  device2:     ${device2._id}`);
  console.log(`  alert1:      ${alert1._id}`);
  console.log(`  alert2:      ${alert2._id}`);
  console.log(`  alert3:      ${alert3._id}`);
  console.log(`  automation1: ${automation1._id}`);
  console.log(`  automation2: ${automation2._id}`);
  console.log(`  flag1:       ${flag1._id}`);
  console.log(`  flag2:       ${flag2._id}`);

  console.log(
    '\n[test-seed] Done. Restart the server if necessary, then run the full API test.\n'
  );

  await mongoose.disconnect();
}


run().catch(async (err) => {
  console.error('[test-seed] failed:', err);

  try {
    await mongoose.disconnect();
  } catch {}

  process.exit(1);
});