import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireEitherPermission } from '../middleware/rbac.js';
import {
  listAutomations, createAutomation, toggleAutomation, removeAutomation,
} from '../controllers/automationController.js';

const router = Router();
router.use(requireAuth);

router.get('/', listAutomations);

const writeGate = requireEitherPermission({ admin: 'manageSensors', user: 'automations' });
router.post('/', writeGate, createAutomation);
router.patch('/:id/toggle', writeGate, toggleAutomation);
router.delete('/:id', writeGate, removeAutomation);

export default router;
