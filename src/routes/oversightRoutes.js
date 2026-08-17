import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { oversightSummary, listFlags, resolveFlag, reopenFlag } from '../controllers/oversightController.js';

const router = Router();
router.use(requireAuth, requirePermission('systemOversight'));

router.get('/summary', oversightSummary);
router.get('/flags', listFlags);
router.patch('/flags/:id/resolve', resolveFlag);
router.patch('/flags/:id/reopen', reopenFlag);

export default router;
