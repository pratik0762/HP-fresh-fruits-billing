/**
 * Role-Based Access Control Middleware
 * Roles: OWNER, BRANCH_MANAGER, STAFF, ACCOUNTANT
 */

const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: `Access denied. Role '${req.user.role}' is not authorized for this operation.` 
      });
    }

    next();
  };
};

/**
 * Ensures user has access to the requested branch:
 * - OWNER can access any branch or all branches (consolidated)
 * - BRANCH_MANAGER and STAFF can only access their own assigned branch
 */
const requireBranchAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // Determine requested branch from query, body, or header
  const requestedBranchId = req.query.branchId || req.body.branchId || req.headers['x-branch-id'];

  if (req.user.role === 'OWNER') {
    // Owner can operate on requested branch, or if not provided, all branches
    req.targetBranchId = requestedBranchId ? parseInt(requestedBranchId) : null;
    return next();
  }

  // For non-owners, force their assigned branchId
  if (!req.user.branchId) {
    return res.status(403).json({ success: false, message: 'User is not assigned to any branch.' });
  }

  if (requestedBranchId && parseInt(requestedBranchId) !== req.user.branchId) {
    return res.status(403).json({ 
      success: false, 
      message: 'Access denied: You are not authorized to view or mutate another branch.' 
    });
  }

  req.targetBranchId = req.user.branchId;
  next();
};

module.exports = {
  requireRole,
  requireBranchAccess
};
