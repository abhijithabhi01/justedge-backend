import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireEitherPermission } from '../middleware/rbac.js';
import { exportData } from '../controllers/exportController.js';

const router = Router();
router.use(requireAuth, requireEitherPermission({ admin: 'exportData', user: 'exportData' }));

router.get('/:type', exportData);

export default router;
