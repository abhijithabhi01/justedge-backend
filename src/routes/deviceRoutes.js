import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';

import {
  listRegisteredDevices,
  liveFleetSnapshot,
  liveDeviceReading,
  createDevice,
  updateDevice,
  assignDevice,
  removeDevice,
  listMyDevices,
  liveMyFleetSnapshot,
  liveMyDeviceReading,
} from '../controllers/deviceController.js';

const router = Router();

router.use(requireAuth);


// ─────────────────────────────────────────────
// USER-SCOPED SENSOR APIs
// These must come BEFORE /:id routes.
// ─────────────────────────────────────────────

router.get('/mine', listMyDevices);

router.get(
  '/mine/live',
  liveMyFleetSnapshot
);

router.get(
  '/mine/:id/live',
  liveMyDeviceReading
);


// ─────────────────────────────────────────────
// ADMIN SENSOR APIs
// ─────────────────────────────────────────────

router.get(
  '/',
  requirePermission('manageSensors'),
  listRegisteredDevices
);

router.get(
  '/live',
  requirePermission('manageSensors'),
  liveFleetSnapshot
);

router.get(
  '/:id/live',
  requirePermission('manageSensors'),
  liveDeviceReading
);

router.post(
  '/',
  requirePermission('manageSensors'),
  createDevice
);

router.patch(
  '/:id',
  requirePermission('manageSensors'),
  updateDevice
);

router.patch(
  '/:id/assign',
  assignDevice
);

router.delete(
  '/:id',
  requirePermission('manageSensors'),
  removeDevice
);

export default router;