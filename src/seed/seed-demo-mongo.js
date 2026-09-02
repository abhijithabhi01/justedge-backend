/**
 * Seeds demo admin + user and default sensors in demodata.
 * Does NOT touch AWS / DynamoDB.
 * Usage: node src/seed/seed-demo-mongo.js
 */
import 'dotenv/config';
import { connectDB } from '../config/db.js';
import {
  AdminAccount,
  defaultPermissionsForRole,
} from '../models/AdminAccount.js';
import {
  UserAccount,
  defaultUserPermissions,
} from '../models/UserAccount.js';
import { DemoData } from '../models/DemoData.js';

const DEMO_ADMIN = {
  name: process.env.DEMO_ADMIN_NAME || 'Demo Admin',
  email: (process.env.DEMO_ADMIN_EMAIL || 'demo.admin@justedge.io').toLowerCase(),
  password: process.env.DEMO_ADMIN_PASSWORD || 'Demo@1234',
  phone: '9000000001',
  companyName: 'Just Embedded Demo',
  role: 'Admin',
};

const DEMO_USER = {
  name: process.env.DEMO_USER_NAME || 'Demo User',
  email: (process.env.DEMO_USER_EMAIL || 'demo.user@justedge.io').toLowerCase(),
  password: process.env.DEMO_USER_PASSWORD || 'Demo@1234',
  phone: '9000000002',
};

const DEFAULT_SENSORS = [
  {
    deviceKey: 'DEMO_GPS_001',
    deviceName: 'GPS Tracker ESP32_001',
    boardType: 'GPS Tracker Board',
    lat: 12.2958,
    lng: 76.6394,
    temp: 27.0,
    humidity: 50,
    battery: 80,
    status: 'online',
  },
  {
    deviceKey: 'DEMO_TEMP_001',
    deviceName: 'Warehouse Sensor A',
    boardType: 'Temperature Board',
    lat: null,
    lng: null,
    temp: 26.5,
    humidity: 55,
    battery: 90,
    status: 'online',
  },
];

async function upsertAdmin() {
  let admin = await AdminAccount.findOne({ email: DEMO_ADMIN.email });
  if (!admin) {
    admin = new AdminAccount({
      name: DEMO_ADMIN.name,
      email: DEMO_ADMIN.email,
      phone: DEMO_ADMIN.phone,
      companyName: DEMO_ADMIN.companyName,
      role: DEMO_ADMIN.role,
      status: 'active',
      twoFactor: false,
      permissions: defaultPermissionsForRole('Admin'),
    });
  } else {
    admin.name = DEMO_ADMIN.name;
    admin.status = 'active';
    admin.role = 'Admin';
    admin.companyName = DEMO_ADMIN.companyName;
    admin.permissions = defaultPermissionsForRole('Admin');
  }
  await admin.setPassword(DEMO_ADMIN.password);
  await admin.save();
  return admin;
}

async function upsertUser(admin) {
  let user = await UserAccount.findOne({ email: DEMO_USER.email });
  if (!user) {
    user = new UserAccount({
      name: DEMO_USER.name,
      email: DEMO_USER.email,
      phone: DEMO_USER.phone,
      role: 'User',
      status: 'active',
      permissions: defaultUserPermissions(),
      createdBy: admin._id,
    });
  } else {
    user.name = DEMO_USER.name;
    user.status = 'active';
    user.createdBy = admin._id;
    user.permissions = defaultUserPermissions();
  }
  await user.setPassword(DEMO_USER.password);
  await user.save();
  return user;
}

async function seedDemoCollection(admin, user) {
  await DemoData.deleteMany({ kind: 'account' });
  await DemoData.create([
    {
      kind: 'account',
      role: 'Admin',
      email: DEMO_ADMIN.email,
      name: DEMO_ADMIN.name,
      refId: String(admin._id),
      meta: { passwordHint: 'default Demo@1234' },
    },
    {
      kind: 'account',
      role: 'User',
      email: DEMO_USER.email,
      name: DEMO_USER.name,
      refId: String(user._id),
      meta: { passwordHint: 'default Demo@1234' },
    },
  ]);

  await DemoData.deleteMany({ kind: 'sensor' });
  await DemoData.insertMany(
    DEFAULT_SENSORS.map((s) => ({
      kind: 'sensor',
      deviceKey: s.deviceKey,
      deviceName: s.deviceName,
      boardType: s.boardType,
      lat: s.lat,
      lng: s.lng,
      temp: s.temp,
      humidity: s.humidity,
      battery: s.battery,
      status: s.status,
    }))
  );

  console.log('demodata accounts + default sensors ready');
}

async function main() {
  await connectDB();
  const admin = await upsertAdmin();
  const user = await upsertUser(admin);
  await seedDemoCollection(admin, user);

  console.log('\nDemo logins (MongoDB only — not AWS):');
  console.log(`  Admin  ${DEMO_ADMIN.email}  /  ${DEMO_ADMIN.password}`);
  console.log(`  User   ${DEMO_USER.email}   /  ${DEMO_USER.password}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});