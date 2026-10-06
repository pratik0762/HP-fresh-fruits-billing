const jwt = require('jsonwebtoken');
const { User, Branch } = require('../models');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required. Please login.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_jwt_key_hp_fresh_fruits_erp_2026_ledger');

    const user = await User.findByPk(decoded.id, {
      include: [{ model: Branch, as: 'branch', attributes: ['id', 'name', 'code', 'location'] }]
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User account is inactive or not found.' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid authentication token.' });
  }
};

module.exports = authMiddleware;
