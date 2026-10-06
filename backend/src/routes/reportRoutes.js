const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const authMiddleware = require('../middleware/auth');
const { requireBranchAccess, requireRole } = require('../middleware/role');

router.use(authMiddleware);
router.use(requireBranchAccess);

// P&L report, Aging report, Inventory valuation, Top Performers
router.get('/profit-loss', requireRole('OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'), reportController.getProfitLoss);
router.get('/aging', requireRole('OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'), reportController.getAging);
router.get('/inventory-valuation', requireRole('OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'), reportController.getInventoryValuation);
router.get('/top-performers', requireRole('OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'), reportController.getTopPerformers);

module.exports = router;
