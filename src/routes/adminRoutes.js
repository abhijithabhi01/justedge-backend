import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  listAdmins, createAdmin, updateAdmin, setAdminStatus, removeAdmin, setAdminPermission,
} from '../controllers/adminController.js';

const router = Router();
router.use(requireAuth);

// Any signed-in admin can see the roster; only Superadmins can change it.
router.get('/', requireRole('Superadmin'), listAdmins);
router.post('/', requireRole('Superadmin'), createAdmin);
router.patch('/:id', requireRole('Superadmin'), updateAdmin);
router.patch('/:id/status', requireRole('Superadmin'), setAdminStatus);
router.patch('/:id/permissions', requireRole('Superadmin'), setAdminPermission);
router.delete('/:id', requireRole('Superadmin'), removeAdmin);

export default router;
