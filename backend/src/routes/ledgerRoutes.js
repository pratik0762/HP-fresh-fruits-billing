const express = require('express');
const router = express.Router();
const ledgerController = require('../controllers/ledgerController');
const authMiddleware = require('../middleware/auth');
const { requireRole, requireBranchAccess } = require('../middleware/role');

router.use(authMiddleware);
router.use(requireBranchAccess);

router.get('/statement', ledgerController.getStatement);
router.get('/verify', ledgerController.verifyLedgerIntegrity);
// Reversals can only be done by Owner or Accountant
router.post('/reverse/:id', requireRole('OWNER', 'ACCOUNTANT'), ledgerController.reverseTransaction);

module.exports = router;
