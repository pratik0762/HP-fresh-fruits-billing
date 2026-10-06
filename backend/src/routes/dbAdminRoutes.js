const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dbAdminController');

// Every route requires BOTH: valid OWNER/ACCOUNTANT JWT + DB_ADMIN_TOKEN.
router.use(ctrl.requireDbAdmin);

router.get('/meta', ctrl.getMeta);
router.get('/schema', ctrl.getSchema);
router.get('/table/:name', ctrl.browseTable);
router.get('/query', ctrl.runQuery);

// Deleted Records Backup & Archive Management (Owner / Accountant)
router.get('/deleted-records', ctrl.getDeletedRecords);
router.get('/deleted-records/:id', ctrl.getDeletedRecordById);
router.delete('/deleted-records/:id', ctrl.purgeDeletedRecord);
router.delete('/deleted-records', ctrl.purgeAllDeletedRecords);

module.exports = router;
