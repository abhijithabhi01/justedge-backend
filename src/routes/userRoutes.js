import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, requireAnyAdmin } from '../middleware/rbac.js';
import {
  listUsers, getUser, createUser, updateUser, setUserStatus, setUserPermission, removeUser,
} from '../controllers/userController.js';

const router = Router();
router.use(requireAuth);

// Any signed-in admin/superadmin can list; a User can never list the roster.
router.get('/', requireAnyAdmin(), listUsers);
// Signed-in admin/superadmin OR the user themself — checked inside the controller.
router.get('/:id', getUser);

router.post('/', requirePermission('manageUsers'), createUser);
router.patch('/:id', requirePermission('manageUsers'), updateUser);
router.patch('/:id/status', requirePermission('manageUsers'), setUserStatus);
router.patch('/:id/permissions', requirePermission('manageUsers'), setUserPermission);
router.delete('/:id', requirePermission('manageUsers'), removeUser);

export default router;
