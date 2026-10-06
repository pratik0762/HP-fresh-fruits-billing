const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expenseController');
const authMiddleware = require('../middleware/auth');
const { requireRole, requireBranchAccess } = require('../middleware/role');

router.use(authMiddleware);
router.use(requireBranchAccess);

router.get('/', expenseController.getExpenses);
router.post('/', requireRole('OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'), expenseController.createExpense);

module.exports = router;
