const { AuditLog } = require('../models');

/**
 * Audit Logging Helper
 */
const logAudit = async ({
  req,
  action,
  entityName,
  entityId = null,
  entityReference = null,
  beforeState = null,
  afterState = null
}) => {
  try {
    const user = req.user;
    await AuditLog.create({
      userId: user ? user.id : null,
      userName: user ? user.name : 'System',
      userRole: user ? user.role : 'System',
      branchId: user ? user.branchId : (req.targetBranchId || null),
      action,
      entityName,
      entityId,
      entityReference,
      beforeState: beforeState ? JSON.stringify(beforeState) : null,
      afterState: afterState ? JSON.stringify(afterState) : null,
      ipAddress: req.ip || req.connection?.remoteAddress
    });
  } catch (err) {
    console.error('Audit Log Error:', err);
  }
};

module.exports = {
  logAudit
};
