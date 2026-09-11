import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, requireEitherPermission } from '../middleware/rbac.js';

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
// ADMIN + USER SENSOR APIs
// Write operations accept either an admin with
// manageSensors or a User with the matching
// fleet permission (add/edit/remove). Controllers
// enforce ownership for the User path.
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
  requireEitherPermission({ admin: 'manageSensors', user: 'addSensor' }),
  createDevice
);

router.patch(
  '/:id',
  requireEitherPermission({ admin: 'manageSensors', user: 'editSensor' }),
  updateDevice
);

router.patch(
  '/:id/assign',
  assignDevice
);

router.delete(
  '/:id',
  requireEitherPermission({ admin: 'manageSensors', user: 'removeSensor' }),
  removeDevice
);

export default router;