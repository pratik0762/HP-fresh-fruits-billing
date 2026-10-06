const express = require('express');
const router = express.Router();
const cashBankController = require('../controllers/cashBankController');
const authMiddleware = require('../middleware/auth');
const { requireRole, requireBranchAccess } = require('../middleware/role');

router.use(authMiddleware);
router.use(requireBranchAccess);

router.get('/cash-book', requireRole('OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'), cashBankController.getCashBook);
router.get('/bank-book', requireRole('OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'), cashBankController.getBankBook);

module.exports = router;
