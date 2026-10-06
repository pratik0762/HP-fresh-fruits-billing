const express = require('express');
const router = express.Router();
const gatePassController = require('../controllers/gatePassController');
const authMiddleware = require('../middleware/auth');
const { requireBranchAccess } = require('../middleware/role');

router.use(authMiddleware);
router.use(requireBranchAccess);

router.get('/', gatePassController.getGatePasses);
router.post('/', gatePassController.createGatePass);
router.put('/:id/exit', gatePassController.markExit);

module.exports = router;
