const express = require('express');
const router = express.Router();
const purchaseController = require('../controllers/purchaseController');
const authMiddleware = require('../middleware/auth');
const { requireRole, requireBranchAccess } = require('../middleware/role');

router.use(authMiddleware);
router.use(requireBranchAccess);

router.get('/', purchaseController.getPurchases);
router.get('/:id', purchaseController.getPurchaseById);
// Accountant cannot enter stock/purchases
router.post('/', requireRole('OWNER', 'BRANCH_MANAGER', 'STAFF'), purchaseController.createPurchase);
// Edit/delete are Owner & Manager operations
router.put('/:id', requireRole('OWNER', 'BRANCH_MANAGER'), purchaseController.updatePurchase);
router.delete('/:id', requireRole('OWNER', 'BRANCH_MANAGER'), purchaseController.deletePurchase);

module.exports = router;
