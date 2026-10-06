const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const authMiddleware = require('../middleware/auth');
const { requireRole, requireBranchAccess } = require('../middleware/role');

router.use(authMiddleware);
router.use(requireBranchAccess);

router.get('/', paymentController.getPayments);
router.post('/', requireRole('OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'), paymentController.createPayment);

module.exports = router;
