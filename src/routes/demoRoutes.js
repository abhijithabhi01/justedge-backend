import { Router } from 'express';
import {
  getDemoLive,
  demoLogin,
  listDemoAccounts,
} from '../controllers/demoController.js';

const router = Router();

router.get('/live', getDemoLive);
router.get('/accounts', listDemoAccounts);
router.post('/login', demoLogin);

export default router;