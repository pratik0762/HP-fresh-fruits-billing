const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');
const authMiddleware = require('../middleware/auth');
const { requireRole, requireBranchAccess } = require('../middleware/role');

router.use(authMiddleware);
router.use(requireBranchAccess);

router.get('/overview', stockController.getStockOverview);
router.get('/batches', stockController.getBatches);
router.get('/wastage', stockController.getWastageEntries);
router.post('/wastage', requireRole('OWNER', 'BRANCH_MANAGER', 'STAFF'), stockController.createWastageEntry);

// Consumer return (customer returns spoiled / chaffed fruit)
// Restores qty to active batches + refunds customer payment via ledger
router.post('/return-to-customer', requireRole('OWNER', 'ACCOUNTANT'), stockController.restockReturn);

// Supplier return (return a purchase back to the supplier)
// Removes the un-consumed stock batch(es) + refunds the supplier
router.post('/return-to-supplier', requireRole('OWNER', 'ACCOUNTANT'), stockController.purchaseReturn);

router.get('/transfers', stockController.getTransfers);
router.post('/transfers', requireRole('OWNER', 'BRANCH_MANAGER', 'STAFF'), stockController.createTransfer);
router.post('/transfers/:id/receive', requireRole('OWNER', 'BRANCH_MANAGER', 'STAFF'), stockController.receiveTransfer);

module.exports = router;
