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
 * Latest reading for every known board (Susima_IoT1 + DynamoDB_2/3/4).
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
 * List of known board IDs / labels (so the UI can render placeholders).
 */
router.get('/ui/boards', (req, res) => {
  res.json({ boards: BOARDS });
});

/**
 * GET /api/iot/ui/live/:deviceId
 * Latest single reading for one device (looks up the correct table).
 */
router.get('/ui/live/:deviceId', async (req, res) => {
  try {
    const board = BOARDS.find(b => b.deviceId === req.params.deviceId);
    const table = board?.table;
    const item  = await getLatestReading(req.params.deviceId, table);
    if (!item) return res.status(404).json({ error: 'No data' });
    const out = normalise(item);
    if (board) {
      out.label = board.label;
      out.table = board.table;
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ui/history/:deviceId', async (req, res) => {
  try {
    const board = BOARDS.find(b => b.deviceId === req.params.deviceId);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const items = await getRecentReadings(req.params.deviceId, limit, board?.table);
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
