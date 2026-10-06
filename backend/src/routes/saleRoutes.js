const express = require('express');
const router = express.Router();
const saleController = require('../controllers/saleController');
const authMiddleware = require('../middleware/auth');
const { requireRole, requireBranchAccess } = require('../middleware/role');

router.use(authMiddleware);
router.use(requireBranchAccess);

router.get('/', saleController.getSales);
router.get('/:id', saleController.getSaleById);
router.post('/', requireRole('OWNER', 'BRANCH_MANAGER', 'STAFF'), saleController.createSale);
// Edit/delete are Owner & Manager operations (accountant/staff are read+create only)
router.put('/:id', requireRole('OWNER', 'BRANCH_MANAGER'), saleController.updateSale);
router.delete('/:id', requireRole('OWNER', 'BRANCH_MANAGER'), saleController.deleteSale);

module.exports = router;
