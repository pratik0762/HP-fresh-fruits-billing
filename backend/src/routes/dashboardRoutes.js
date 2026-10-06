const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const authMiddleware = require('../middleware/auth');
const { requireBranchAccess } = require('../middleware/role');

router.use(authMiddleware);
router.use(requireBranchAccess);

router.get('/stats', dashboardController.getDashboardStats);

module.exports = router;
