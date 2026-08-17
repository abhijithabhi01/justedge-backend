import { BoardCatalog } from '../models/BoardCatalog.js';
import { Device } from '../models/Device.js';
import { logActivity } from '../middleware/activityLogger.js';

export async function listBoardCatalog(req, res) {
  const boards = await BoardCatalog.find().sort({ name: 1 });
  res.json({ boards: boards.map((b) => b.toSafeJSON()) });
}

export async function createBoardCatalogEntry(req, res) {
  const { id, name, conn, probes, desc } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name are required' });

  const existing = await BoardCatalog.findOne({ id });
  if (existing) return res.status(409).json({ error: `Board id already exists: ${id}` });

  const board = await BoardCatalog.create({ id, name, conn: conn || '', probes: probes || [], desc: desc || '' });
  await logActivity(req, { action: 'Added board catalog entry', target: board.name, targetType: 'other', category: 'admin', severity: 'info' });
  res.status(201).json({ board: board.toSafeJSON() });
}

export async function updateBoardCatalogEntry(req, res) {
  const board = await BoardCatalog.findOne({ id: req.params.id });
  if (!board) return res.status(404).json({ error: 'Board not found' });

  const { name, conn, probes, desc } = req.body;
  if (name !== undefined) board.name = name;
  if (conn !== undefined) board.conn = conn;
  if (probes !== undefined) board.probes = probes;
  if (desc !== undefined) board.desc = desc;

  await board.save();
  await logActivity(req, { action: 'Updated board catalog entry', target: board.name, targetType: 'other', category: 'admin', severity: 'info' });
  res.json({ board: board.toSafeJSON() });
}

export async function removeBoardCatalogEntry(req, res) {
  const board = await BoardCatalog.findOne({ id: req.params.id });
  if (!board) return res.status(404).json({ error: 'Board not found' });

  const inUse = await Device.countDocuments({ boardId: board.id });
  if (inUse > 0) return res.status(409).json({ error: `${inUse} device(s) still reference this board type` });

  await board.deleteOne();
  await logActivity(req, { action: 'Removed board catalog entry', target: board.name, targetType: 'other', category: 'admin', severity: 'warn' });
  res.json({ ok: true });
}
