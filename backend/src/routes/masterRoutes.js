const express = require('express');
const router = express.Router();
const masterController = require('../controllers/masterController');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

router.use(authMiddleware);

// Branches
router.get('/branches', masterController.getBranches);
router.post('/branches', requireRole('OWNER'), masterController.createBranch);
router.put('/branches/:id', requireRole('OWNER'), masterController.updateBranch);
router.delete('/branches/:id', requireRole('OWNER'), masterController.deleteBranch);

// Items (Fruits)
router.get('/items', masterController.getItems);
router.post('/items', requireRole('OWNER', 'BRANCH_MANAGER'), masterController.createItem);
router.put('/items/:id', requireRole('OWNER', 'BRANCH_MANAGER'), masterController.updateItem);
router.delete('/items/:id', requireRole('OWNER'), masterController.deleteItem);

// Suppliers
router.get('/suppliers', masterController.getSuppliers);
router.post('/suppliers', requireRole('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'), masterController.createSupplier);
// Edit: owner (any branch) or the owning branch's manager/accountant
router.put('/suppliers/:id', requireRole('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'), masterController.updateSupplier);
router.delete('/suppliers/:id', requireRole('OWNER'), masterController.deleteSupplier);

// Customers
router.get('/customers', masterController.getCustomers);
router.post('/customers', requireRole('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'), masterController.createCustomer);
// Edit: owner (any branch) or the owning branch's manager/accountant
router.put('/customers/:id', requireRole('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'), masterController.updateCustomer);
router.delete('/customers/:id', requireRole('OWNER'), masterController.deleteCustomer);

// Commission Agents
router.get('/agents', masterController.getAgents);
router.post('/agents', requireRole('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'), masterController.createAgent);
router.put('/agents/:id', requireRole('OWNER', 'BRANCH_MANAGER'), masterController.updateAgent);
router.delete('/agents/:id', requireRole('OWNER'), masterController.deleteAgent);

// Transporters
router.get('/transporters', masterController.getTransporters);
router.post('/transporters', requireRole('OWNER', 'BRANCH_MANAGER'), masterController.createTransporter);
router.put('/transporters/:id', requireRole('OWNER', 'BRANCH_MANAGER'), masterController.updateTransporter);
router.delete('/transporters/:id', requireRole('OWNER'), masterController.deleteTransporter);

// Users
router.get('/users', requireRole('OWNER'), masterController.getUsers);
router.post('/users', requireRole('OWNER'), masterController.createUser);
router.put('/users/:id', requireRole('OWNER'), masterController.updateUser);
router.delete('/users/:id', requireRole('OWNER'), masterController.deleteUser);

module.exports = router;
