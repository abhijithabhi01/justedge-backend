import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import {
  AdminAccount,
  defaultPermissionsForRole,
} from '../models/AdminAccount.js';
import {
  UserAccount,
  defaultUserPermissions,
} from '../models/UserAccount.js';
import { BoardCatalog } from '../models/BoardCatalog.js';
import { BillingPlan } from '../models/BillingPlan.js';
import { Device } from '../models/Device.js';
import { Alert } from '../models/Alert.js';
import { Automation } from '../models/Automation.js';

const accounts = {
  superadmin: {
    name: process.env.DEMO_SUPERADMIN_NAME || 'JustEdge Superadmin',
    email: process.env.DEMO_SUPERADMIN_EMAIL || 'superadmin@justedge.local',
    password: process.env.DEMO_SUPERADMIN_PASSWORD || 'ChangeMe@123',
    phone: '9000000001',
    companyName: process.env.DEMO_COMPANY_NAME || 'JustEdge',
    role: 'Superadmin',
  },
  admin: {
    name: process.env.DEMO_ADMIN_NAME || 'JustEdge Admin',
    email: process.env.DEMO_ADMIN_EMAIL || 'admin@justedge.local',
    password: process.env.DEMO_ADMIN_PASSWORD || 'ChangeMe@123',
    phone: '9000000002',
    companyName: process.env.DEMO_ADMIN_COMPANY_NAME || 'Demo Company',
    role: 'Admin',
  },
  user: {
    name: process.env.DEMO_USER_NAME || 'JustEdge User',
    email: process.env.DEMO_USER_EMAIL || 'user@justedge.local',
    password: process.env.DEMO_USER_PASSWORD || 'ChangeMe@123',
    phone: '9000000003',
  },
};

async function upsertAdmin(account, createdBy = null) {
  const admin = await AdminAccount.findOneAndUpdate(
    { email: account.email.toLowerCase() },
    {
      $set: {
        name: account.name,
        phone: account.phone,
        companyName: account.companyName,
        role: account.role,
        status: 'active',
        twoFactor: false,
        permissions: defaultPermissionsForRole(account.role),
        failedLoginAttempts: 0,
        createdBy,
      },
      $setOnInsert: { email: account.email.toLowerCase() },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await admin.setPassword(account.password);
  await admin.save();
  return admin;
}

async function upsertUser(account, createdBy) {
  const user = await UserAccount.findOneAndUpdate(
    { email: account.email.toLowerCase() },
    {
      $set: {
        name: account.name,
        phone: account.phone,
        role: 'User',
        status: 'active',
        permissions: defaultUserPermissions({
          addSensor: true,
          editSensor: true,
          removeSensor: true,
          automations: true,
          alerts: true,
          manageUsers: false,
          exportData: true,
        }),
        failedLoginAttempts: 0,
        createdBy,
      },
      $setOnInsert: { email: account.email.toLowerCase() },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await user.setPassword(account.password);
  await user.save();
  return user;
}

async function seedCatalog() {
  await BoardCatalog.updateOne(
    { id: 'sensor-board-generic' },
    {
      $setOnInsert: {
        id: 'sensor-board-generic',
        name: 'Generic Sensor Board',
        conn: 'WiFi',
        probes: ['Temperature', 'Humidity'],
        desc: 'General-purpose environmental sensor board.',
      },
    },
    { upsert: true }
  );

  await BillingPlan.updateOne(
    { id: 'pro' },
    {
      $setOnInsert: {
        id: 'pro',
        name: 'Pro',
        desc: 'Alerts, automations and multi-site support.',
        price: '$29/mo',
      },
    },
    { upsert: true }
  );
}

async function seedUserData(user) {
  const device = await Device.findOneAndUpdate(
    { imei: 'JUSTEDGE-DEMO-0001' },
    {
      $set: {
        name: 'Demo Cold Room Sensor',
        boardId: 'sensor-board-generic',
        simNo: 'DEMO-SIM-0001',
        subscriptionPlan: 'pro',
        subscriptionExpiry: new Date('2027-12-31T00:00:00.000Z'),
        assignedUserId: user._id,
      },
      $setOnInsert: { imei: 'JUSTEDGE-DEMO-0001' },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await Alert.updateOne(
    { title: 'Demo temperature alert', deviceId: String(device._id) },
    {
      $set: {
        ownerId: user._id,
        icon: 'alert-triangle',
        tone: 'warn',
        desc: 'Demo Cold Room Sensor is above its temperature threshold.',
        resolved: false,
        snoozedUntil: null,
      },
      $setOnInsert: {
        title: 'Demo temperature alert',
        deviceId: String(device._id),
      },
    },
    { upsert: true }
  );

  await Automation.updateOne(
    { name: 'Demo temperature notification', deviceId: String(device._id) },
    {
      $set: {
        ownerId: user._id,
        icon: 'zap',
        rule: 'IF temperature > 8°C THEN notify JustEdge User',
        on: true,
        runs: 0,
        lastRun: null,
      },
      $setOnInsert: {
        name: 'Demo temperature notification',
        deviceId: String(device._id),
      },
    },
    { upsert: true }
  );
}

async function run() {
  await connectDB();

  try {
    await seedCatalog();
    const superadmin = await upsertAdmin(accounts.superadmin);
    const admin = await upsertAdmin(accounts.admin, superadmin._id);
    const user = await upsertUser(accounts.user, admin._id);
    await seedUserData(user);

    console.log('\n[demo-seed] Seeded accounts');
    console.log(`  Superadmin: ${accounts.superadmin.email} / ${accounts.superadmin.password}`);
    console.log(`  Admin:      ${accounts.admin.email} / ${accounts.admin.password}`);
    console.log(`  User:       ${accounts.user.email} / ${accounts.user.password}`);
    console.log(`[demo-seed] Admin id: ${admin._id}`);
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error('[demo-seed] failed:', err);
  process.exit(1);
});
