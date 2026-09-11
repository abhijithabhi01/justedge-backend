import { Device } from '../models/Device.js';
import { BoardCatalog } from '../models/BoardCatalog.js';
import { simulateReading, forgetDevice } from '../services/sensorFeed.js';
import { putDeviceLocation, discoverBoards } from '../services/iotFeed.js';
import { logActivity } from '../middleware/activityLogger.js';

function toLite(device) {
  return {
    id: device._id.toString(),
    name: device.name,
    type: device.boardId,
    awsDeviceId: device.awsDeviceId,
  };
}

function mergeInventory(device, reading) {
  const lat = reading?.lat ?? reading?.latitude ?? device.lat ?? null;
  const lng = reading?.lng ?? reading?.longitude ?? device.lng ?? null;
  return {
    ...reading,
    boardId: device.boardId,
    imei: device.imei,
    simNo: device.simNo,
    subscriptionPlan: device.subscriptionPlan,
    subscriptionExpiry: device.subscriptionExpiry,
    assignedUserId: device.assignedUserId,
    createdBy: device.createdBy ? String(device.createdBy) : null,
    site: device.site || reading?.site || '',
    lat,
    lng,
    latitude: lat,
    longitude: lng,
  };
}

/** Superadmin → all devices. Company Admin → only devices they registered. */
function adminDeviceFilter(req) {
  if (!req.admin) return null;
  if (req.admin.role === 'Superadmin') return {};
  return { createdBy: req.admin._id };
}

function canManageDevice(req, device) {
  if (!req.admin) return false;
  if (req.admin.role === 'Superadmin') return true;
  return device.createdBy && String(device.createdBy) === String(req.admin._id);
}

export async function listRegisteredDevices(req, res) {
  const filter = adminDeviceFilter(req);
  if (filter === null) return res.status(403).json({ error: 'Forbidden' });

  const devices = await Device.find(filter).sort({ createdAt: -1 });
  res.json({ devices: devices.map((d) => d.toSafeJSON()) });
}

export async function liveFleetSnapshot(req, res) {
  try {
    const filter = adminDeviceFilter(req);
    if (filter === null) return res.status(403).json({ error: 'Forbidden' });

    const devices = await Device.find(filter);
    const readings = await Promise.all(
      devices.map(async (d) => {
        try {
          return mergeInventory(d, await simulateReading(toLite(d)));
        } catch (err) {
          console.error(`[devices/live] failed for ${d.name}:`, err.message);
          return mergeInventory(d, {
            id: d._id.toString(),
            name: d.name,
            type: d.boardId,
            status: 'unknown',
            battery: null,
            lastPing: null,
            serverTime: new Date().toISOString(),
            relays: [],
            sensors: [],
            source: 'error',
          });
        }
      })
    );
    res.json({ devices: readings, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

export async function liveDeviceReading(req, res) {
  try {
    const device = await Device.findById(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    if (req.admin && !canManageDevice(req, device)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const reading = await simulateReading(toLite(device));
    res.json(mergeInventory(device, reading));
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Device not found' });
    res.status(err.status || 500).json({ error: err.message });
  }
}

export async function createDevice(req, res) {
  const {
    name,
    boardId,
    imei,
    simNo,
    subscriptionPlan,
    assignedUserId,
    awsDeviceId,
    site,
    lat,
    lng,
  } = req.body;
  if (!name || !boardId || !imei) {
    return res.status(400).json({ error: 'name, boardId and imei are required' });
  }

  // Admin path: manageSensors (enforced by route). User path: addSensor (enforced by route).
  const isUser = !!req.user && !req.admin;
  if (isUser && !req.user.permissions?.addSensor) {
    return res.status(403).json({ error: 'Missing permission: addSensor' });
  }
  if (!req.admin && !req.user) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const board = await BoardCatalog.findOne({ id: boardId });
  if (!board) return res.status(400).json({ error: `Unknown boardId: ${boardId}` });

  const existing = await Device.findOne({ imei: imei.trim() });
  if (existing) {
    return res.status(409).json({ error: 'A device with that IMEI is already registered' });
  }

  const awsId = awsDeviceId?.trim() || null;
  const requireAws =
    String(process.env.REQUIRE_AWS_DEVICE || '').toLowerCase() === 'true' ||
    String(process.env.SENSOR_DATA_SOURCE || '').toLowerCase() === 'aws';

  // Company admins must link a live AWS board when SENSOR_DATA_SOURCE=aws
  if (requireAws && !awsId && req.admin && req.admin.role !== 'Superadmin') {
    return res.status(400).json({
      error:
        'Select a live AWS device. No simulated sensors are allowed while SENSOR_DATA_SOURCE=aws.',
    });
  }

  let awsMatched = false;

  if (awsId) {
    // 1) Already assigned to another admin / inventory row?
    const linked = await Device.findOne({ awsDeviceId: awsId });
    if (linked) {
      return res.status(409).json({
        error: `AWS device "${awsId}" is already assigned to another sensor and cannot be claimed.`,
      });
    }

    // 2) Does this device exist in DynamoDB?
    let boards = [];
    try {
      boards = await discoverBoards();
    } catch (err) {
      console.error('[devices] discoverBoards failed:', err.message);
      return res.status(503).json({
        error: 'Could not reach AWS device registry. Try again later.',
      });
    }

    awsMatched = boards.some((b) => String(b.deviceId) === String(awsId));
    if (!awsMatched) {
      return res.status(404).json({
        error: `No AWS device found with id "${awsId}". Check GPS_Device_Data (deviceName) and try again.`,
      });
    }
  }

  const parseCoord = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Users who self-register a board are automatically assigned as the owner.
  // Admins may optionally assign someone (or leave unassigned).
  let finalAssignedUserId = assignedUserId || null;
  let createdBy = null;
  if (isUser) {
    finalAssignedUserId = req.user._id;
    createdBy = req.user.createdBy || null;
  } else {
    createdBy = req.admin._id;
  }

  let device;
  try {
    device = await Device.create({
      name: name.trim(),
      boardId,
      imei: imei.trim(),
      simNo: simNo?.trim() || '',
      subscriptionPlan: subscriptionPlan?.trim() || '',
      assignedUserId: finalAssignedUserId,
      awsDeviceId: awsId,
      site: site?.trim() || '',
      lat: parseCoord(lat),
      lng: parseCoord(lng),
      // Scope to the creating admin so other company admins do not see it
      createdBy,
    });
  } catch (err) {
    // Race: two parallel creates with the same IMEI — unique index wins
    if (err?.code === 11000 || /duplicate key/i.test(String(err?.message || ''))) {
      return res.status(409).json({
        error: 'A device with that IMEI is already registered',
      });
    }
    console.error('[devices] create failed:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to register device' });
  }

  if (device.awsDeviceId && device.lat != null && device.lng != null) {
    try {
      await putDeviceLocation(device.awsDeviceId, {
        lat: device.lat,
        lng: device.lng,
        site: device.site,
      });
    } catch (err) {
      // Device is already saved — don't fail the request if AWS location write flakes
      console.error('[devices] putDeviceLocation failed:', err.message);
    }
  }

  try {
    await logActivity(req, {
      action: 'Registered device',
      target: device.name,
      targetType: 'sensor',
      category: 'sensor',
      severity: 'info',
    });
  } catch (err) {
    console.error('[devices] logActivity failed:', err.message);
  }

  res.status(201).json({
    device: device.toSafeJSON(),
    awsMatched,
  });
}

export async function updateDevice(req, res) {
  const device = await Device.findById(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const isAdminManager =
    req.admin &&
    (req.admin.role === 'Superadmin' || req.admin.permissions?.manageSensors) &&
    canManageDevice(req, device);
  const isOwningUser =
    req.user &&
    device.assignedUserId &&
    String(device.assignedUserId) === String(req.user._id) &&
    req.user.permissions?.editSensor;

  if (!isAdminManager && !isOwningUser) {
    return res.status(403).json({ error: 'Missing permission: manageSensors or editSensor' });
  }

  const { name, imei, simNo, subscriptionPlan, awsDeviceId, site, lat, lng } = req.body;
  if (imei !== undefined && imei.trim() !== device.imei) {
    const dupe = await Device.findOne({ imei: imei.trim(), _id: { $ne: device._id } });
    if (dupe) return res.status(409).json({ error: 'A device with that IMEI is already registered' });
    device.imei = imei.trim();
  }
  if (awsDeviceId !== undefined && awsDeviceId.trim() !== (device.awsDeviceId || '')) {
    const linked = awsDeviceId.trim()
      ? await Device.findOne({
          awsDeviceId: awsDeviceId.trim(),
          _id: { $ne: device._id },
        })
      : null;
    if (linked) {
      return res.status(409).json({
        error: `${awsDeviceId} is already linked to another registered device`,
      });
    }
    device.awsDeviceId = awsDeviceId.trim() || null;
  }
  if (name !== undefined) device.name = name.trim();
  if (simNo !== undefined) device.simNo = simNo.trim();
  if (subscriptionPlan !== undefined) device.subscriptionPlan = subscriptionPlan.trim();
  if (site !== undefined) device.site = String(site).trim();
  if (lat !== undefined) {
    const n = lat === '' || lat === null ? null : Number(lat);
    device.lat = Number.isFinite(n) ? n : null;
  }
  if (lng !== undefined) {
    const n = lng === '' || lng === null ? null : Number(lng);
    device.lng = Number.isFinite(n) ? n : null;
  }

  await device.save();

  if (device.awsDeviceId && device.lat != null && device.lng != null) {
    await putDeviceLocation(device.awsDeviceId, {
      lat: device.lat,
      lng: device.lng,
      site: device.site,
    });
  }

  await logActivity(req, {
    action: 'Updated device',
    target: device.name,
    targetType: 'sensor',
    category: 'sensor',
    severity: 'info',
  });
  res.json({ device: device.toSafeJSON() });
}

export async function assignDevice(req, res) {
  const device = await Device.findById(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const isAdminManager =
    req.admin &&
    (req.admin.role === 'Superadmin' || req.admin.permissions?.manageSensors) &&
    canManageDevice(req, device);
  const isOwningUser =
    req.user &&
    device.assignedUserId &&
    String(device.assignedUserId) === String(req.user._id) &&
    req.user.permissions?.editSensor;

  if (!isAdminManager && !isOwningUser) {
    return res.status(403).json({ error: 'Missing permission: manageSensors or editSensor' });
  }

  const { assignedUserId } = req.body;
  device.assignedUserId = assignedUserId || null;
  await device.save();

  await logActivity(req, {
    action: assignedUserId ? 'Assigned device' : 'Unassigned device',
    target: device.name,
    targetType: 'sensor',
    category: 'sensor',
    severity: 'info',
  });
  res.json({ device: device.toSafeJSON() });
}

export async function removeDevice(req, res) {
  const device = await Device.findById(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const isAdminManager =
    req.admin &&
    (req.admin.role === 'Superadmin' || req.admin.permissions?.manageSensors) &&
    canManageDevice(req, device);
  const isOwningUser =
    req.user &&
    device.assignedUserId &&
    String(device.assignedUserId) === String(req.user._id) &&
    req.user.permissions?.removeSensor;

  if (!isAdminManager && !isOwningUser) {
    return res.status(403).json({ error: 'Missing permission: manageSensors or removeSensor' });
  }

  await device.deleteOne();
  forgetDevice(device._id.toString());

  await logActivity(req, {
    action: 'Removed device',
    target: device.name,
    targetType: 'sensor',
    category: 'sensor',
    severity: 'warn',
  });
  res.json({ ok: true });
}

export async function listMyDevices(req, res) {
  if (!req.user) {
    return res.status(403).json({ error: 'Only User accounts can use this endpoint' });
  }

  const devices = await Device.find({
    assignedUserId: req.user._id,
  }).sort({ createdAt: -1 });

  res.json({ devices: devices.map((d) => d.toSafeJSON()) });
}

export async function liveMyFleetSnapshot(req, res) {
  if (!req.user) {
    return res.status(403).json({ error: 'Only User accounts can use this endpoint' });
  }

  try {
    const devices = await Device.find({ assignedUserId: req.user._id });
    const readings = await Promise.all(
      devices.map(async (d) => mergeInventory(d, await simulateReading(toLite(d))))
    );
    res.json({ devices: readings, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

export async function liveMyDeviceReading(req, res) {
  if (!req.user) {
    return res.status(403).json({ error: 'Only User accounts can use this endpoint' });
  }

  try {
    const device = await Device.findOne({
      _id: req.params.id,
      assignedUserId: req.user._id,
    });
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const reading = await simulateReading(toLite(device));
    res.json(mergeInventory(device, reading));
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Device not found' });
    res.status(err.status || 500).json({ error: err.message });
  }
}