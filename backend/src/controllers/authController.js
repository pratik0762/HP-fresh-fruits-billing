const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { User, Branch } = require('../models');

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password.' });
    }

    const user = await User.findOne({
      where: { email: email.toLowerCase().trim() },
      include: [{ model: Branch, as: 'branch' }]
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, branchId: user.branchId },
      process.env.JWT_SECRET || 'super_secret_jwt_key_hp_fresh_fruits_erp_2026_ledger',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        branchId: user.branchId,
        branch: user.branch ? {
          id: user.branch.id,
          name: user.branch.name,
          code: user.branch.code,
          location: user.branch.location
        } : null
      }
    });
  } catch (err) {
    next(err);
  }
};

const getMe = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['passwordHash'] },
      include: [{ model: Branch, as: 'branch' }]
    });
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  login,
  getMe
};
