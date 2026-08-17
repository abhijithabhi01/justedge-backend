import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireEitherPermission } from '../middleware/rbac.js';
import { listAlerts, resolveAlert, snoozeAlert, dismissAlert } from '../controllers/alertController.js';

const router = Router();
router.use(requireAuth);

// Anyone signed in can read (scoped per-account inside the controller).
router.get('/', listAlerts);

const writeGate = requireEitherPermission({ admin: 'manageSensors', user: 'alerts' });
router.patch('/:id/resolve', writeGate, resolveAlert);
router.patch('/:id/snooze', writeGate, snoozeAlert);
router.delete('/:id', writeGate, dismissAlert);

export default router;
