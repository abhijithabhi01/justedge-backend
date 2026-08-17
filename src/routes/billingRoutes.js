import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import {
  listPlans, createPlan, updatePlan, listSubscriptions, updateSubscription,
} from '../controllers/billingController.js';

const router = Router();
router.use(requireAuth);

// A User needs to see their own sensor's plan even without billing admin rights.
router.get('/plans', listPlans);
router.post('/plans', requirePermission('billingAccess'), createPlan);
router.patch('/plans/:id', requirePermission('billingAccess'), updatePlan);

router.get('/subscriptions', requirePermission('billingAccess'), listSubscriptions);
router.patch('/subscriptions/:deviceId', requirePermission('billingAccess'), updateSubscription);

export default router;
