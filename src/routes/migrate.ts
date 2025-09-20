import { Router } from 'express';
import { migrateUidToUsername } from '../utils/migrateUsers';
import { formatApiResponse } from '../utils/formatApiResponse';

const router = Router();

router.post('/migrate-users', async (req, res, next) => {
  try {
    await migrateUidToUsername();
    res.json(formatApiResponse('success', 'Migration completed', {}));
  } catch (error) {
    next(error);
  }
});

export default router;
