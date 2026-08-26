/**
 * seed-aws-devices.js
 *
 * Registers the 4 physical AWS boards from DynamoDB as Device records in
 * MongoDB and links them to the Admin account (or a named user if provided).
 *
 * Run once after SENSOR_DATA_SOURCE=aws is set:
 *   node src/seed/seed-aws-devices.js
 *
 * Environment variables:
 *   MONGO_URI              — MongoDB connection string (from .env)
 *   SEED_ADMIN_EMAIL       — Admin whose account the devices are registered under
 *                            (defaults to admin@justedge.local)
 *   SEED_ASSIGN_USER_EMAIL — Optional: assign all 4 boards to this User account
 *
 * The script is idempotent: running it twice updates existing records rather
 * than creating duplicates (keyed on awsDeviceId).
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { Device } from '../models/Device.js';
import { AdminAccount } from '../models/AdminAccount.js';
import { UserAccount } from '../models/UserAccount.js';
import { BoardCatalog } from '../models/BoardCatalog.js';

// ── The 4 boards reporting into your DynamoDB SensorData table ──────────────
// awsDeviceId must match the deviceId column in DynamoDB exactly.
// boardId must match a BoardCatalog.id value (sensor-board-generic is the
// default generic board; change per device if you have specific types).
const AWS_BOARDS = [
  {
    awsDeviceId:      'Susima_IoT1',
    name:             'Susima IoT 1',
    boardId:          'sensor-board-generic',
    imei:             'AWS100000000001',   // placeholder — update with real IMEI if known
    simNo:            '',
    subscriptionPlan: 'pro',
    subscriptionExpiry: new Date('2027-12-31'),
  },
  {
    awsDeviceId:      'DynamoDB_2',
    name:             'AWS Sensor Board 2',
    boardId:          'sensor-board-generic',
    imei:             'AWS100000000002',
    simNo:            '',
    subscriptionPlan: 'pro',
    subscriptionExpiry: new Date('2027-12-31'),
  },
  {
    awsDeviceId:      'DynamoDB_3',
    name:             'AWS Sensor Board 3',
    boardId:          'sensor-board-generic',
    imei:             'AWS100000000003',
    simNo:            '',
    subscriptionPlan: 'pro',
    subscriptionExpiry: new Date('2027-12-31'),
  },
  {
    awsDeviceId:      'DynamoDB_4',
    name:             'AWS Sensor Board 4',
    boardId:          'sensor-board-generic',
    imei:             'AWS100000000004',
    simNo:            '',
    subscriptionPlan: 'pro',
    subscriptionExpiry: new Date('2027-12-31'),
  },
];

async function run() {
  await connectDB();

  try {
    // Verify board catalog exists
    const catalog = await BoardCatalog.find();
    if (catalog.length === 0) {
      console.error('[seed-aws] No board catalog entries found. Run seed.js first.');
      process.exit(1);
    }
    const catalogIds = new Set(catalog.map(b => b.id));

    // Resolve optional user assignment
    const assignEmail = process.env.SEED_ASSIGN_USER_EMAIL;
    let assignedUserId = null;
    if (assignEmail) {
      const user = await UserAccount.findOne({ email: assignEmail.toLowerCase() });
      if (!user) {
        console.warn(`[seed-aws] User ${assignEmail} not found — boards will be unassigned.`);
      } else {
        assignedUserId = user._id;
        console.log(`[seed-aws] Will assign all boards to user: ${user.name} (${user.email})`);
      }
    }

    let created = 0;
    let updated = 0;

    for (const board of AWS_BOARDS) {
      if (!catalogIds.has(board.boardId)) {
        console.warn(`[seed-aws] boardId "${board.boardId}" not in catalog — skipping ${board.awsDeviceId}`);
        continue;
      }

      // Check if this awsDeviceId is already linked to a different Device
      const existing = await Device.findOne({ awsDeviceId: board.awsDeviceId });

      if (existing) {
        // Update name/plan/expiry but keep imei & simNo as-is (may have been
        // manually corrected via the admin UI).
        existing.name             = board.name;
        existing.subscriptionPlan = board.subscriptionPlan;
        existing.subscriptionExpiry = board.subscriptionExpiry;
        if (assignedUserId) existing.assignedUserId = assignedUserId;
        await existing.save();
        console.log(`[seed-aws] updated  ${board.awsDeviceId} → "${board.name}" (id: ${existing._id})`);
        updated++;
      } else {
        // New registration — check IMEI uniqueness first
        const iemClash = await Device.findOne({ imei: board.imei });
        if (iemClash) {
          console.warn(`[seed-aws] IMEI ${board.imei} already used by "${iemClash.name}" — update AWS_BOARDS.imei for ${board.awsDeviceId}`);
          continue;
        }

        const device = await Device.create({
          name:               board.name,
          boardId:            board.boardId,
          imei:               board.imei,
          simNo:              board.simNo,
          subscriptionPlan:   board.subscriptionPlan,
          subscriptionExpiry: board.subscriptionExpiry,
          assignedUserId:     assignedUserId || null,
          awsDeviceId:        board.awsDeviceId,
        });
        console.log(`[seed-aws] created  ${board.awsDeviceId} → "${board.name}" (id: ${device._id})`);
        created++;
      }
    }

    console.log(`\n[seed-aws] done — ${created} created, ${updated} updated.`);
    console.log('[seed-aws] Make sure SENSOR_DATA_SOURCE=aws is set in your .env before starting the server.');
  } finally {
    await mongoose.disconnect();
  }
}

run().catch(err => {
  console.error('[seed-aws] failed:', err);
  process.exit(1);
});