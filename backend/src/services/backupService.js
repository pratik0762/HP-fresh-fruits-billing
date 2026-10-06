const { DeletedRecord, User } = require('../models');

/**
 * Backup a deleted record to the deleted_records archive.
 * Retained in the backend until explicitly purged by the Owner.
 */
async function backupDeletedRecord({
  entityType,
  entityId,
  entityReference,
  snapshot,
  branchId = null,
  deletedById = null,
  deletedByName = null,
  deletionReason = null,
  transaction = null
}) {
  try {
    let userName = deletedByName;
    if (!userName && deletedById) {
      try {
        const user = await User.findByPk(deletedById, { attributes: ['name', 'email'] });
        if (user) userName = `${user.name} (${user.email})`;
      } catch (e) {
        userName = `User #${deletedById}`;
      }
    }

    const record = await DeletedRecord.create({
      entityType: String(entityType).toUpperCase(),
      entityId: entityId ? String(entityId) : null,
      entityReference: entityReference ? String(entityReference) : null,
      snapshot: typeof snapshot === 'object' ? snapshot : { data: snapshot },
      branchId: branchId ? parseInt(branchId, 10) : null,
      deletedById: deletedById ? parseInt(deletedById, 10) : null,
      deletedByName: userName || 'System / Anonymous',
      deletionReason: deletionReason || null,
      deletedAt: new Date(),
      isPurged: false
    }, transaction ? { transaction } : undefined);

    console.log(`[BackupService] Archived deleted ${entityType} record (Ref: ${entityReference || entityId}, Backup ID: ${record.id})`);
    return record;
  } catch (error) {
    console.error(`[BackupService] Error saving deleted record backup for ${entityType}:`, error);
    return null;
  }
}

module.exports = {
  backupDeletedRecord
};
