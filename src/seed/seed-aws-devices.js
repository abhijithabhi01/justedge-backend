/**
 * seed-aws-locations.js
 *
 * Updates install locations for the 4 physical AWS boards in DynamoDB.
 * Matches awsDeviceId values from seed-aws-devices.js exactly.
 *
 * Usage:
 *   node scripts/seed-aws-locations.js
 *
 * Environment variables (from .env):
 *   AWS_REGION        — e.g. ap-south-1
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   DYNAMO_TABLE      — your DynamoDB table name (e.g. iot-saas-platform or SensorData)
 *
 * The script is idempotent — safe to run multiple times.
 * Each run overwrites the location fields for the given deviceId.
 */

import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

// ── DynamoDB client setup ────────────────────────────────────────────────────
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const ddb = DynamoDBDocumentClient.from(client);

const TABLE = process.env.DYNAMO_TABLE || 'iot-saas-platform';

// ── Location data — matches awsDeviceId from seed-aws-devices.js ─────────────
// Coordinates are real Bengaluru neighbourhood centroids.
const LOCATIONS = [
  {
    deviceId: 'Susima_IoT1',
    lat:      12.9352,
    lng:      77.6245,
    site:     'Koramangala',
    city:     'Bengaluru',
    state:    'Karnataka',
    country:  'India',
  },
  {
    deviceId: 'DynamoDB_2',
    lat:      13.0358,
    lng:      77.5970,
    site:     'Hebbal',
    city:     'Bengaluru',
    state:    'Karnataka',
    country:  'India',
  },
  {
    deviceId: 'DynamoDB_3',
    lat:      12.9716,
    lng:      77.5946,
    site:     'MG Road',
    city:     'Bengaluru',
    state:    'Karnataka',
    country:  'India',
  },
  {
    deviceId: 'DynamoDB_4',
    lat:      13.0297,
    lng:      77.5469,
    site:     'Yeshwanthpur',
    city:     'Bengaluru',
    state:    'Karnataka',
    country:  'India',
  },
];

// ── Helper: check if device record exists in DynamoDB ────────────────────────
async function deviceExists(deviceId) {
  try {
    const res = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { deviceId },
    }));
    return !!res.Item;
  } catch (err) {
    // If the table uses a different key schema this will throw — surface the error
    throw new Error(`GetCommand failed for ${deviceId}: ${err.message}`);
  }
}

// ── Helper: update location fields on a device record ────────────────────────
async function updateLocation(loc) {
  const now = new Date().toISOString();

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { deviceId: loc.deviceId },

    // Only touch location fields — does NOT overwrite telemetry or other attrs
    UpdateExpression: `SET
      #loc.lat       = :lat,
      #loc.lng       = :lng,
      #loc.site      = :site,
      #loc.city      = :city,
      #loc.#st       = :state,
      #loc.country   = :country,
      updatedAt      = :updatedAt`,

    ExpressionAttributeNames: {
      '#loc': 'location',
      '#st':  'state',      // 'state' is a reserved word in DynamoDB
    },

    ExpressionAttributeValues: {
      ':lat':       loc.lat,
      ':lng':       loc.lng,
      ':site':      loc.site,
      ':city':      loc.city,
      ':state':     loc.state,
      ':country':   loc.country,
      ':updatedAt': now,
    },

    // Only update if the record already exists — do NOT create phantom records
    ConditionExpression: 'attribute_exists(deviceId)',
  }));
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[seed-aws-locations] table  : ${TABLE}`);
  console.log(`[seed-aws-locations] region : ${process.env.AWS_REGION || 'ap-south-1'}`);
  console.log(`[seed-aws-locations] devices: ${LOCATIONS.length}\n`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const loc of LOCATIONS) {
    try {
      // Guard: skip if the device row doesn't exist yet
      const exists = await deviceExists(loc.deviceId);
      if (!exists) {
        console.warn(`[SKIP]   ${loc.deviceId} — record not found in ${TABLE}. Run seed-aws-devices.js first.`);
        skipped++;
        continue;
      }

      await updateLocation(loc);
      console.log(`[OK]     ${loc.deviceId} → ${loc.site}, ${loc.city} (${loc.lat}, ${loc.lng})`);
      ok++;
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        console.warn(`[SKIP]   ${loc.deviceId} — ConditionExpression failed (record missing?)`);
        skipped++;
      } else {
        console.error(`[FAIL]   ${loc.deviceId} — ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n[seed-aws-locations] done — ${ok} updated, ${skipped} skipped, ${failed} failed.`);

  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed-aws-locations] fatal:', err);
  process.exit(1);
});