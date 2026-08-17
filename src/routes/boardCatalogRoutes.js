import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  listBoardCatalog, createBoardCatalogEntry, updateBoardCatalogEntry, removeBoardCatalogEntry,
} from '../controllers/boardCatalogController.js';

const router = Router();

// Public read — used on the marketing landing page's hardware picker, logged out.
router.get('/', listBoardCatalog);

router.post('/', requireAuth, requireRole('Superadmin'), createBoardCatalogEntry);
router.patch('/:id', requireAuth, requireRole('Superadmin'), updateBoardCatalogEntry);
router.delete('/:id', requireAuth, requireRole('Superadmin'), removeBoardCatalogEntry);

export default router;
