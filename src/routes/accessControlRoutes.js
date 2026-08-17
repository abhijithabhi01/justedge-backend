import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { roleMatrix, accountAccess } from '../controllers/accessControlController.js';

const router = Router();
router.use(requireAuth, requirePermission('manageAccessControl'));

router.get('/roles', roleMatrix);
router.get('/accounts/:id', accountAccess);

export default router;
