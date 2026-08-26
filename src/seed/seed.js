import 'dotenv/config';
import { connectDB } from '../config/db.js';
import { AdminAccount, defaultPermissionsForRole } from '../models/AdminAccount.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { SecurityFlag } from '../models/SecurityFlag.js';
import { BoardCatalog } from '../models/BoardCatalog.js';
import { BillingPlan } from '../models/BillingPlan.js';
import mongoose from 'mongoose';

async function run() {
  await connectDB();

  const existingCount = await AdminAccount.countDocuments();
  if (existingCount === 0) {
    const name = process.env.SEED_SUPERADMIN_NAME || 'Super Admin';
    const email = process.env.SEED_SUPERADMIN_EMAIL || 'superadmin@justedge.local';
    const password = process.env.SEED_SUPERADMIN_PASSWORD || 'Admin@1234';

    const superadmin = new AdminAccount({
      name, email: email.toLowerCase(), companyName: process.env.SEED_COMPANY_NAME || 'JustEdge', role: 'Superadmin', status: 'active', twoFactor: false,
      permissions: defaultPermissionsForRole('Superadmin'),
    });
    await superadmin.setPassword(password);
    await superadmin.save();

    await ActivityLog.create({
      actorId: superadmin._id, actorName: superadmin.name, actorRole: 'Superadmin',
      action: 'Created admin account', target: `${superadmin.name} (Superadmin)`,
      targetType: 'admin', category: 'admin', severity: 'warn', ip: 'seed-script',
    });

    await SecurityFlag.create({
      title: 'Two-factor not enabled',
      description: `${superadmin.name} does not have two-factor authentication turned on yet.`,
      severity: 'warn', category: 'access', relatedAdminId: superadmin._id,
    });

    console.log(`[seed] created Superadmin ${email} — sign in and change the password immediately.`);
  } else {
    console.log(`[seed] ${existingCount} admin account(s) already exist — skipping admin seed.`);
  }

  // Board catalog and billing plans are separate, idempotent seeds so they
  // still populate even on a DB that already has admin accounts (e.g. an
  // existing deployment picking up this update) — the hardware picker and
  // Device creation both depend on these existing.
  const boardCatalogCount = await BoardCatalog.countDocuments();
  if (boardCatalogCount === 0) {
    await BoardCatalog.insertMany([
      {
        id: 'smart-meter-3phase', name: 'Qubino Smart Meter 3-Phase', conn: 'RS485/Modbus',
        probes: ['Current', 'Voltage', 'Power', 'Energy', 'Frequency', 'Power Factor'],
        desc: 'Panel-mount 3-phase smart meter for current, voltage, power and energy monitoring.',
      },
      {
        id: 'sensor-board-generic', name: 'Generic Sensor Board', conn: 'WiFi',
        probes: ['Temperature', 'Humidity', 'Pressure', 'Light', 'CO2', 'Vibration'],
        desc: 'General-purpose environmental sensor board for rooms, warehouses and enclosures.',
      },
    ]);
    console.log('[seed] added default board catalog entries.');
  } else {
    console.log(`[seed] ${boardCatalogCount} board catalog entr(y/ies) already exist — skipping.`);
  }

  const billingPlanCount = await BillingPlan.countDocuments();
  if (billingPlanCount === 0) {
    await BillingPlan.insertMany([
      { id: 'basic', name: 'Basic', desc: 'Core monitoring for a single site.', price: '$9/mo' },
      { id: 'pro', name: 'Pro', desc: 'Alerts, automations and multi-site support.', price: '$29/mo' },
      { id: 'enterprise', name: 'Enterprise', desc: 'Unlimited devices, priority support, custom SLAs.', price: 'Contact us' },
    ]);
    console.log('[seed] added default billing plans.');
  } else {
    console.log(`[seed] ${billingPlanCount} billing plan(s) already exist — skipping.`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
