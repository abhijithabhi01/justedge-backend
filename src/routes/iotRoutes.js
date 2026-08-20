import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { liveAll, liveOne, history } from '../controllers/iotController.js';
import {
  getLatestReading,
  getRecentReadings,
  getAllBoardReadings,
  normalise,
  BOARDS,
} from '../services/iotFeed.js';

const router = Router();

// ── Unprotected — used by the built-in live.html UI ──────────────────────────

/**
 * GET /api/iot/ui/live-all
 * Latest reading for every known board (all in SensorData table).
 */
router.get('/ui/live-all', async (req, res) => {
  try {
    const boards = await getAllBoardReadings();
    res.json({
      boards,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/iot/ui/boards
 * List of known board IDs / labels.
 */
router.get('/ui/boards', (req, res) => {
  res.json({ boards: BOARDS });
});

/**
 * GET /api/iot/ui/live/:deviceId
 * Latest single reading for one device.
 */
router.get('/ui/live/:deviceId', async (req, res) => {
  try {
    const item = await getLatestReading(req.params.deviceId);
    if (!item) return res.status(404).json({ error: 'No data' });
    const out = normalise(item);
    const board = BOARDS.find(b => b.deviceId === req.params.deviceId);
    if (board) out.label = board.label;
    res.json(out);
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
