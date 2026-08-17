import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { liveAll, liveOne, history } from '../controllers/iotController.js';
import { getLatestReading, getRecentReadings, normalise } from '../services/iotFeed.js';

const router = Router();

// ── Unprotected — used by the built-in live.html UI (localhost only) ──────────
router.get('/ui/live/:deviceId', async (req, res) => {
  try {
    const item = await getLatestReading(req.params.deviceId);
    if (!item) return res.status(404).json({ error: 'No data' });
    res.json(normalise(item));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ui/history/:deviceId', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const items = await getRecentReadings(req.params.deviceId, limit);
    res.json({ readings: items.map(normalise) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Protected — for external/React dashboard use ──────────────────────────────
router.use(requireAuth);
router.get('/live',              liveAll);
router.get('/live/:deviceId',    liveOne);
router.get('/history/:deviceId', history);

export default router;