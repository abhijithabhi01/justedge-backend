/**
 * seed-gps-device.js
 *
 * Registers the GPS board (ESP32_001) in Mongo and optionally assigns it
 * to a user so it appears on their dashboard.
 *
 *   node src/seed/seed-gps-device.js
 *
 * Env:
 *   MONGO_URI
 *   SEED_ASSIGN_USER_EMAIL  — user to assign the GPS board to
 *   GPS_DEVICE_ID           — default ESP32_001
 *   GPS_DEVICE_NAME         — default "GPS Tracker ESP32_001"
 */

import 'dotenv/config';
import { connectDB } from '../config/db.js';
import { Device } from '../models/Device.js';
import { UserAccount } from '../models/UserAccount.js';
import { BoardCatalog } from '../models/BoardCatalog.js';

const AWS_ID = process.env.GPS_DEVICE_ID || 'ESP32_001';
const NAME = process.env.GPS_DEVICE_NAME || 'GPS Tracker ESP32_001';
const BOARD_ID = 'gps-board';
const IMEI = process.env.GPS_IMEI || 'GPS100000000001';

async function ensureGpsBoardCatalog() {
  let board = await BoardCatalog.findOne({ id: BOARD_ID });
  if (!board) {
    board = await BoardCatalog.create({
      id: BOARD_ID,
      name: 'GPS Tracker Board',
      conn: 'WiFi / LTE',
      probes: ['GPS', 'Latitude', 'Longitude'],
      desc: 'GPS tracker board reporting latitude / longitude to DynamoDB',
    });
    console.log('[seed-gps] Created board catalog entry:', BOARD_ID);
  }
  return board;
}

async function run() {
  await connectDB();

  try {
    await ensureGpsBoardCatalog();

    let assignedUserId = null;
    const email = process.env.SEED_ASSIGN_USER_EMAIL;
    if (email) {
      const user = await UserAccount.findOne({ email: email.toLowerCase() });
      if (!user) {
        console.warn(`[seed-gps] User not found: ${email} — leaving unassigned`);
      } else {
        assignedUserId = user._id;
        console.log(`[seed-gps] Will assign to ${user.name || user.email} (${user._id})`);
      }
    }

    const existing = await Device.findOne({
      $or: [{ awsDeviceId: AWS_ID }, { imei: IMEI }],
    });

    if (existing) {
      existing.name = NAME;
      existing.boardId = BOARD_ID;
      existing.awsDeviceId = AWS_ID;
      existing.subscriptionPlan = existing.subscriptionPlan || 'pro';
      existing.subscriptionExpiry =
        existing.subscriptionExpiry || new Date('2027-12-31');
      if (assignedUserId) existing.assignedUserId = assignedUserId;
      await existing.save();
      console.log('[seed-gps] Updated device:', existing._id.toString(), existing.name);
    } else {
      const device = await Device.create({
        name: NAME,
        boardId: BOARD_ID,
        imei: IMEI,
        simNo: '',
        subscriptionPlan: 'pro',
        subscriptionExpiry: new Date('2027-12-31'),
        assignedUserId,
        awsDeviceId: AWS_ID,
      });
      console.log('[seed-gps] Created device:', device._id.toString(), device.name);
    }

    console.log('[seed-gps] Done. awsDeviceId =', AWS_ID);
    console.log('[seed-gps] Run the GPS simulator: npm run simulate:gps');
  } catch (err) {
    console.error('[seed-gps]', err.message);
    process.exitCode = 1;
  } finally {
    process.exit(0);
  }
}

run();