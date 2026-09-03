import { Device } from '../models/Device.js';
import { BoardCatalog } from '../models/BoardCatalog.js';
import { simulateReading, forgetDevice } from '../services/sensorFeed.js';
import { putDeviceLocation } from '../services/iotFeed.js';
import { logActivity } from '../middleware/activityLogger.js';

function toLite(device) {
  return { id: device._id.toString(), name: device.name, type: device.boardId, awsDeviceId: device.awsDeviceId };
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
    site: device.site || reading?.site || '',
    lat,
    lng,
    latitude: lat,
    longitude: lng,
  };
}

export async function listRegisteredDevices(req, res) {
  const devices = await Device.find().sort({ createdAt: -1 });
  res.json({ devices: devices.map((d) => d.toSafeJSON()) });
}

export async function liveFleetSnapshot(req, res) {
  try {
    const devices = await Device.find();
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
    const reading = await simulateReading(toLite(device));
    res.json(mergeInventory(device, reading));
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Device not found' });
    res.status(err.status || 500).json({ error: err.message });
  }
}

export async function createDevice(req, res) {
  const { name, boardId, imei, simNo, subscriptionPlan, assignedUserId, awsDeviceId, site, lat, lng } = req.body;
  if (!name || !boardId || !imei) return res.status(400).json({ error: 'name, boardId and imei are required' });

  const board = await BoardCatalog.findOne({ id: boardId });
  if (!board) return res.status(400).json({ error: `Unknown boardId: ${boardId}` });

  const existing = await Device.findOne({ imei: imei.trim() });
  if (existing) return res.status(409).json({ error: 'A device with that IMEI is already registered' });

  if (awsDeviceId) {
    const linked = await Device.findOne({ awsDeviceId });
    if (linked) return res.status(409).json({ error: `${awsDeviceId} is already linked to another registered device` });
  }

  const parseCoord = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const device = await Device.create({
    name: name.trim(),
    boardId,
    imei: imei.trim(),
    simNo: simNo?.trim() || '',
    subscriptionPlan: subscriptionPlan?.trim() || '',
    assignedUserId: assignedUserId || null,
    awsDeviceId: awsDeviceId?.trim() || null,
    site: site?.trim() || '',
    lat: parseCoord(lat),
    lng: parseCoord(lng),
  });

  if (device.awsDeviceId && device.lat != null && device.lng != null) {
    await putDeviceLocation(device.awsDeviceId, {
      lat: device.lat,
      lng: device.lng,
      site: device.site,
    });
  }

  await logActivity(req, { action: 'Registered device', target: device.name, targetType: 'sensor', category: 'sensor', severity: 'info' });
  res.status(201).json({ device: device.toSafeJSON() });
}

export async function updateDevice(req, res) {
  const device = await Device.findById(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const { name, imei, simNo, subscriptionPlan, awsDeviceId, site, lat, lng } = req.body;
  if (imei !== undefined && imei.trim() !== device.imei) {
    const dupe = await Device.findOne({ imei: imei.trim(), _id: { $ne: device._id } });
    if (dupe) return res.status(409).json({ error: 'A device with that IMEI is already registered' });
    device.imei = imei.trim();
  }
  if (awsDeviceId !== undefined && awsDeviceId.trim() !== (device.awsDeviceId || '')) {
    const linked = awsDeviceId.trim()
      ? await Device.findOne({ awsDeviceId: awsDeviceId.trim(), _id: { $ne: device._id } })
      : null;
    if (linked) return res.status(409).json({ error: `${awsDeviceId} is already linked to another registered device` });
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

  await logActivity(req, { action: 'Updated device', target: device.name, targetType: 'sensor', category: 'sensor', severity: 'info' });
  res.json({ device: device.toSafeJSON() });
}

export async function assignDevice(req, res) {
  const device = await Device.findById(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const isAdminManager = req.admin && (req.admin.role === 'Superadmin' || req.admin.permissions?.manageSensors);
  const isOwningUser = req.user
    && device.assignedUserId
    && String(device.assignedUserId) === String(req.user._id)
    && req.user.permissions?.editSensor;

  if (!isAdminManager && !isOwningUser) {
    return res.status(403).json({ error: 'Missing permission: manageSensors or editSensor' });
  }

  const { assignedUserId } = req.body;
  device.assignedUserId = assignedUserId || null;
  await device.save();

  await logActivity(req, {
    action: assignedUserId ? 'Assigned device' : 'Unassigned device',
    target: device.name, targetType: 'sensor', category: 'sensor', severity: 'info',
  });
  res.json({ device: device.toSafeJSON() });
}

export async function removeDevice(req, res) {
  const device = await Device.findById(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  await device.deleteOne();
  forgetDevice(device._id.toString());

  await logActivity(req, { action: 'Removed device', target: device.name, targetType: 'sensor', category: 'sensor', severity: 'warn' });
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
    const readings = await Promise.all(devices.map(async (d) =>
      mergeInventory(d, await simulateReading(toLite(d)))
    ));
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