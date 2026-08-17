import { getLatestReading, getRecentReadings, getAllLatestReadings, normalise } from '../services/iotFeed.js';

/**
 * GET /api/iot/live
 * Latest reading for every device — polled every 5 s by the dashboard.
 */
export async function liveAll(req, res) {
  try {
    const items = await getAllLatestReadings(50);
    res.json({
      readings:  items.map(normalise),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[iot] liveAll error:', err.message);
    res.status(500).json({ error: 'Failed to fetch live readings' });
  }
}

/**
 * GET /api/iot/live/:deviceId
 * Latest single reading for one device.
 */
export async function liveOne(req, res) {
  try {
    const item = await getLatestReading(req.params.deviceId);
    if (!item) return res.status(404).json({ error: 'No data found for this device' });
    res.json(normalise(item));
  } catch (err) {
    console.error('[iot] liveOne error:', err.message);
    res.status(500).json({ error: 'Failed to fetch reading' });
  }
}

/**
 * GET /api/iot/history/:deviceId?limit=20
 * Recent N readings for sparkline / chart on the dashboard.
 */
export async function history(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const items = await getRecentReadings(req.params.deviceId, limit);
    res.json({
      deviceId: req.params.deviceId,
      readings: items.map(normalise),
    });
  } catch (err) {
    console.error('[iot] history error:', err.message);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
}