import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { listActivity, activitySummary } from '../controllers/activityLogController.js';

const router = Router();
router.use(requireAuth, requirePermission('viewActivityLogs'));

router.get('/', listActivity);
router.get('/summary', activitySummary);

export default router;
