const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { 
  Branch, Item, Supplier, Customer, CommissionAgent, Transporter, User, RunningBalance, Purchase, Sale, StockBatch, sequelize 
} = require('../models');
const { logAudit } = require('../middleware/audit');
const { backupDeletedRecord } = require('../services/backupService');

// --- Branches ---
const getBranches = async (req, res, next) => {
  try {
    const branches = await Branch.findAll({ where: { isActive: true }, order: [['id', 'ASC']] });
    res.json({ success: true, branches });
  } catch (err) { next(err); }
};

const createBranch = async (req, res, next) => {
  try {
    const { name, code, location, address, phone } = req.body;
    const branch = await Branch.create({ name, code: code.toUpperCase(), location, address, phone });
    res.status(201).json({ success: true, branch });
  } catch (err) { next(err); }
};

const updateBranch = async (req, res, next) => {
  try {
    const branch = await Branch.findByPk(req.params.id);
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    const before = branch.toJSON();
    const { name, code, location, address, phone } = req.body;
    await branch.update({
      name,
      code: code ? code.toUpperCase() : branch.code,
      location,
      address,
      phone
    });
    await logAudit({ req, action: 'UPDATE_BRANCH', entityName: 'Branch', entityId: branch.id, entityReference: branch.code, beforeState: before, afterState: branch.toJSON() });
    res.json({ success: true, branch });
  } catch (err) { next(err); }
};

// Soft-delete: keeps historical invoices/ledger references resolvable.
const deleteBranch = async (req, res, next) => {
  try {
    const branch = await Branch.findByPk(req.params.id);
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    const activeCount = await Branch.count({ where: { isActive: true } });
    if (activeCount <= 1) {
      return res.status(400).json({ success: false, message: 'Cannot delete the only active branch. Create another branch first.' });
    }

    const assignedUsers = await User.count({ where: { branchId: branch.id, isActive: true } });
    if (assignedUsers > 0) {
      return res.status(400).json({ success: false, message: `Cannot delete: ${assignedUsers} active user(s) are assigned to ${branch.name}. Reassign them first.` });
    }

    await backupDeletedRecord({
      entityType: 'BRANCH',
      entityId: branch.id,
      entityReference: `${branch.name} (${branch.code})`,
      snapshot: branch.toJSON(),
      branchId: branch.id,
      deletedById: req.user.id,
      deletedByName: req.user.name,
      deletionReason: req.body?.reason || 'Deactivated/deleted via UI'
    });

    await branch.update({ isActive: false });
    await logAudit({ req, action: 'DELETE_BRANCH', entityName: 'Branch', entityId: branch.id, entityReference: branch.code });
    res.json({ success: true, message: `${branch.name} deleted (moved to inactive). History preserved.` });
  } catch (err) { next(err); }
};

// --- Items (Fruits) ---
const getItems = async (req, res, next) => {
  try {
    const items = await Item.findAll({ where: { isActive: true }, order: [['name', 'ASC'], ['variety', 'ASC']] });
    res.json({ success: true, items });
  } catch (err) { next(err); }
};

// Converts a pack-size value entered in grams into kg (the internal base unit).
// Values < 1 are treated as kg (e.g. 0.5 = half a kg); values >= 1 stay kg.
const packSizeToKg = (val) => {
  const n = parseFloat(val);
  if (!n || n <= 0) return 1;
  return n < 1 ? parseFloat(n.toFixed(4)) : parseFloat(n.toFixed(4));
};

// Resolves the kg-per-pack conversion factor from whichever form the UI sent:
//   packSizeUnit 'g'   -> packSizeGrams / 1000
//   packSizeUnit 'PCS' -> packSizePcs × pieceWeightGrams / 1000
//   otherwise          -> unitConversionFactor (already kg)
const resolvePackFactorKg = (body) => {
  const unit = (body.packSizeUnit || '').toLowerCase();
  if (unit === 'g' && body.packSizeGrams != null) {
    return parseFloat((parseFloat(body.packSizeGrams) / 1000).toFixed(4));
  }
  if (unit === 'pcs') {
    const pcs = parseFloat(body.packSizePcs);
    const pieceG = parseFloat(body.pieceWeightGrams);
    if (pcs > 0 && pieceG > 0) {
      return parseFloat(((pcs * pieceG) / 1000).toFixed(4));
    }
  }
  return body.unitConversionFactor != null ? packSizeToKg(body.unitConversionFactor) : null;
};

const createItem = async (req, res, next) => {
  try {
    const { 
      name, variety, category, baseUnit, packagingUnit, packagingUnitLabel, packSizeUnit,
      unitConversionFactor, packSizeGrams, packSizePcs, pieceWeightGrams, reorderThreshold, shelfLifeDays 
    } = req.body;
    const factorKg = resolvePackFactorKg(req.body) ?? 1;
    const item = await Item.create({
      name, variety, category, baseUnit, packagingUnit,
      packagingUnitLabel: packagingUnitLabel || null,
      packSizeUnit: packSizeUnit || null,
      pieceWeightGrams: pieceWeightGrams != null ? parseFloat(pieceWeightGrams) : null,
      unitConversionFactor: factorKg,
      reorderThreshold: reorderThreshold != null && reorderThreshold !== '' ? parseFloat(reorderThreshold) : 0,
      shelfLifeDays: parseInt(shelfLifeDays) || 14
    });
    res.status(201).json({ success: true, item });
  } catch (err) { next(err); }
};

const updateItem = async (req, res, next) => {
  try {
    const item = await Item.findByPk(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    const before = item.toJSON();
    const { 
      name, variety, category, baseUnit, packagingUnit, packagingUnitLabel, packSizeUnit,
      unitConversionFactor, packSizeGrams, packSizePcs, pieceWeightGrams, reorderThreshold, shelfLifeDays 
    } = req.body;
    const factorKg = resolvePackFactorKg(req.body);
    await item.update({
      name,
      variety,
      category,
      baseUnit,
      packagingUnit,
      packagingUnitLabel: packagingUnitLabel !== undefined ? (packagingUnitLabel || null) : item.packagingUnitLabel,
      packSizeUnit: packSizeUnit !== undefined ? (packSizeUnit || null) : item.packSizeUnit,
      pieceWeightGrams: pieceWeightGrams !== undefined ? (pieceWeightGrams != null && pieceWeightGrams !== '' ? parseFloat(pieceWeightGrams) : null) : item.pieceWeightGrams,
      unitConversionFactor: factorKg != null ? factorKg : item.unitConversionFactor,
      reorderThreshold: reorderThreshold !== undefined ? (reorderThreshold !== '' && reorderThreshold != null ? parseFloat(reorderThreshold) : 0) : item.reorderThreshold,
      shelfLifeDays: shelfLifeDays != null ? (parseInt(shelfLifeDays) || 14) : item.shelfLifeDays
    });
    await logAudit({ req, action: 'UPDATE_ITEM', entityName: 'Item', entityId: item.id, entityReference: item.name, beforeState: before, afterState: item.toJSON() });
    res.json({ success: true, item });
  } catch (err) { next(err); }
};

// Soft-delete: blocked while physical stock still exists for the fruit.
const deleteItem = async (req, res, next) => {
  try {
    const item = await Item.findByPk(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    const liveStock = await StockBatch.findOne({
      where: { itemId: item.id, currentQuantity: { [Op.gt]: 0 } }
    });
    if (liveStock) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete: ${item.name} still has ${parseFloat(liveStock.currentQuantity)} ${item.baseUnit} in stock (batch ${liveStock.batchNumber}). Sell or write it off first.`
      });
    }

    await backupDeletedRecord({
      entityType: 'ITEM',
      entityId: item.id,
      entityReference: `${item.name}${item.variety ? ` (${item.variety})` : ''}`,
      snapshot: item.toJSON(),
      deletedById: req.user.id,
      deletedByName: req.user.name,
      deletionReason: req.body?.reason || 'Deactivated/deleted via UI'
    });

    await item.update({ isActive: false });
    await logAudit({ req, action: 'DELETE_ITEM', entityName: 'Item', entityId: item.id, entityReference: item.name });
    res.json({ success: true, message: `${item.name} deleted (moved to inactive). History preserved.` });
  } catch (err) { next(err); }
};

// --- Suppliers ---
const getSuppliers = async (req, res, next) => {
  try {
    // Branch isolation: every branch sees ONLY its own suppliers. Owner sees all.
    const where = { isActive: true };
    if (req.user.role !== 'OWNER') {
      where.branchId = req.user.branchId;
    }
    const suppliers = await Supplier.findAll({
      where,
      include: [{ model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] }],
      order: [['name', 'ASC']]
    });
    res.json({ success: true, suppliers });
  } catch (err) { next(err); }
};

// Stamps the owning branch name into the contact field so every party is
// self-identifying, e.g. "Ramesh Patel (Surat Mandi Wholesale Hub)".
const stampBranchContact = (contactPerson, branch) => {
  const base = (contactPerson || '').trim();
  if (!branch) return base;
  if (base.toLowerCase().includes(branch.name.toLowerCase())) return base;
  return base ? `${base} (${branch.name})` : branch.name;
};

const createSupplier = async (req, res, next) => {
  try {
    const { name, contactPerson, phone, email, address, gstNumber, openingBalance, branchId } = req.body;

    // A party always belongs to a branch: branch users create for their own
    // branch (forced); the Owner may pick any branch on their behalf.
    const targetBranchId = req.user.role === 'OWNER'
      ? (branchId ? parseInt(branchId) : req.user.branchId)
      : req.user.branchId;

    let branch = null;
    if (targetBranchId) {
      branch = await Branch.findByPk(targetBranchId);
      if (!branch) return res.status(400).json({ success: false, message: 'Branch not found' });
    }

    const supplier = await Supplier.create({
      name,
      contactPerson: stampBranchContact(contactPerson, branch),
      phone, email, address, gstNumber,
      openingBalance: parseFloat(openingBalance) || 0,
      branchId: targetBranchId || null
    });
    res.status(201).json({ success: true, supplier });
  } catch (err) { next(err); }
};

// Edit an existing supplier. Branch ownership is preserved — an owner may
// move a party to another branch; branch users cannot change branchId.
const updateSupplier = async (req, res, next) => {
  try {
    const supplier = await Supplier.findByPk(req.params.id);
    if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });

    if (req.user.role !== 'OWNER' && supplier.branchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Access denied: supplier belongs to another branch.' });
    }

    const before = supplier.toJSON();
    const { name, contactPerson, phone, email, address, gstNumber, openingBalance, branchId } = req.body;

    const newBranchId = (req.user.role === 'OWNER' && branchId !== undefined)
      ? (branchId ? parseInt(branchId) : null)
      : supplier.branchId;

    await supplier.update({
      name: name ?? supplier.name,
      contactPerson: contactPerson ?? supplier.contactPerson,
      phone: phone ?? supplier.phone,
      email: email ?? supplier.email,
      address: address ?? supplier.address,
      gstNumber: gstNumber ?? supplier.gstNumber,
      openingBalance: openingBalance !== undefined ? (parseFloat(openingBalance) || 0) : supplier.openingBalance,
      branchId: newBranchId
    });

    await logAudit({
      req,
      action: 'UPDATE_SUPPLIER',
      entityName: 'Supplier',
      entityId: supplier.id,
      entityReference: supplier.name,
      beforeState: { name: before.name, phone: before.phone, branchId: before.branchId },
      afterState: { name: supplier.name, phone: supplier.phone, branchId: supplier.branchId }
    });

    res.json({ success: true, supplier });
  } catch (err) { next(err); }
};

// --- Customers ---
const getCustomers = async (req, res, next) => {
  try {
    // Branch isolation: every branch sees ONLY its own customers. Owner sees all.
    const where = { isActive: true };
    if (req.user.role !== 'OWNER') {
      where.branchId = req.user.branchId;
    }
    const customers = await Customer.findAll({
      where,
      include: [{ model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] }],
      order: [['name', 'ASC']]
    });
    res.json({ success: true, customers });
  } catch (err) { next(err); }
};

const createCustomer = async (req, res, next) => {
  try {
    const { name, contactPerson, phone, email, address, gstNumber, creditLimit, openingBalance, branchId } = req.body;

    // A party always belongs to a branch: branch users create for their own
    // branch (forced); the Owner may pick any branch on their behalf.
    const targetBranchId = req.user.role === 'OWNER'
      ? (branchId ? parseInt(branchId) : req.user.branchId)
      : req.user.branchId;

    let branch = null;
    if (targetBranchId) {
      branch = await Branch.findByPk(targetBranchId);
      if (!branch) return res.status(400).json({ success: false, message: 'Branch not found' });
    }

    const customer = await Customer.create({
      name,
      contactPerson: stampBranchContact(contactPerson, branch),
      phone, email, address, gstNumber,
      creditLimit: parseFloat(creditLimit) || 50000,
      openingBalance: parseFloat(openingBalance) || 0,
      branchId: targetBranchId || null
    });
    res.status(201).json({ success: true, customer });
  } catch (err) { next(err); }
};

// Edit an existing customer. Branch ownership is preserved — an owner may
// move a party to another branch; branch users cannot change branchId.
const updateCustomer = async (req, res, next) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    if (req.user.role !== 'OWNER' && customer.branchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Access denied: customer belongs to another branch.' });
    }

    const before = customer.toJSON();
    const { name, contactPerson, phone, email, address, gstNumber, creditLimit, openingBalance, branchId } = req.body;

    const newBranchId = (req.user.role === 'OWNER' && branchId !== undefined)
      ? (branchId ? parseInt(branchId) : null)
      : customer.branchId;

    await customer.update({
      name: name ?? customer.name,
      contactPerson: contactPerson ?? customer.contactPerson,
      phone: phone ?? customer.phone,
      email: email ?? customer.email,
      address: address ?? customer.address,
      gstNumber: gstNumber ?? customer.gstNumber,
      creditLimit: creditLimit !== undefined ? (parseFloat(creditLimit) || 50000) : customer.creditLimit,
      openingBalance: openingBalance !== undefined ? (parseFloat(openingBalance) || 0) : customer.openingBalance,
      branchId: newBranchId
    });

    await logAudit({
      req,
      action: 'UPDATE_CUSTOMER',
      entityName: 'Customer',
      entityId: customer.id,
      entityReference: customer.name,
      beforeState: { name: before.name, phone: before.phone, branchId: before.branchId },
      afterState: { name: customer.name, phone: customer.phone, branchId: customer.branchId }
    });

    res.json({ success: true, customer });
  } catch (err) { next(err); }
};

// --- Deactivate ("delete") Suppliers & Customers ---
// Parties are soft-deleted (isActive=false) so historical bills/ledgers stay
// intact; deleting is blocked while money is still outstanding.
const deleteSupplier = async (req, res, next) => {
  try {
    const supplier = await Supplier.findByPk(req.params.id);
    if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });

    const pendingPurchase = await Purchase.findOne({
      where: { supplierId: supplier.id, paymentStatus: ['PENDING', 'PARTIAL'] }
    });
    if (pendingPurchase) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete: supplier has an unpaid bill (${pendingPurchase.invoiceNumber}). Settle it first.`
      });
    }

    await backupDeletedRecord({
      entityType: 'SUPPLIER',
      entityId: supplier.id,
      entityReference: supplier.name,
      snapshot: supplier.toJSON(),
      branchId: supplier.branchId,
      deletedById: req.user.id,
      deletedByName: req.user.name,
      deletionReason: req.body?.reason || 'Deactivated/deleted via UI'
    });

    await supplier.update({ isActive: false });
    res.json({ success: true, message: `${supplier.name} deleted (moved to inactive). History preserved.` });
  } catch (err) { next(err); }
};

const deleteCustomer = async (req, res, next) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const pendingSale = await Sale.findOne({
      where: { customerId: customer.id, paymentStatus: ['PENDING', 'PARTIAL'] }
    });
    if (pendingSale) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete: customer has an unpaid invoice (${pendingSale.invoiceNumber}). Collect it first.`
      });
    }

    await backupDeletedRecord({
      entityType: 'CUSTOMER',
      entityId: customer.id,
      entityReference: customer.name,
      snapshot: customer.toJSON(),
      branchId: customer.branchId,
      deletedById: req.user.id,
      deletedByName: req.user.name,
      deletionReason: req.body?.reason || 'Deactivated/deleted via UI'
    });

    await customer.update({ isActive: false });
    res.json({ success: true, message: `${customer.name} deleted (moved to inactive). History preserved.` });
  } catch (err) { next(err); }
};

// --- Commission Agents ---
const getAgents = async (req, res, next) => {
  try {
    const agents = await CommissionAgent.findAll({ where: { isActive: true }, order: [['name', 'ASC']] });
    res.json({ success: true, agents });
  } catch (err) { next(err); }
};

const createAgent = async (req, res, next) => {
  try {
    const { name, contactPerson, phone, defaultCommissionRate, address } = req.body;
    const agent = await CommissionAgent.create({
      name, contactPerson, phone,
      defaultCommissionRate: parseFloat(defaultCommissionRate) || 5.0,
      address
    });
    res.status(201).json({ success: true, agent });
  } catch (err) { next(err); }
};

const updateAgent = async (req, res, next) => {
  try {
    const agent = await CommissionAgent.findByPk(req.params.id);
    if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

    const before = agent.toJSON();
    const { name, contactPerson, phone, defaultCommissionRate, address } = req.body;
    await agent.update({
      name,
      contactPerson,
      phone,
      defaultCommissionRate: defaultCommissionRate != null ? (parseFloat(defaultCommissionRate) || 5.0) : agent.defaultCommissionRate,
      address
    });
    await logAudit({ req, action: 'UPDATE_AGENT', entityName: 'CommissionAgent', entityId: agent.id, entityReference: agent.name, beforeState: before, afterState: agent.toJSON() });
    res.json({ success: true, agent });
  } catch (err) { next(err); }
};

// Soft-delete: blocked while the agent still has outstanding commission payable.
const deleteAgent = async (req, res, next) => {
  try {
    const agent = await CommissionAgent.findByPk(req.params.id);
    if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

    const outstanding = await RunningBalance.findOne({
      where: { entityType: 'COMMISSION_AGENT', entityId: agent.id, currentBalance: { [Op.gt]: 0 } }
    });
    if (outstanding) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete: ${agent.name} has ₹${parseFloat(outstanding.currentBalance).toFixed(2)} unpaid commission. Settle it first.`
      });
    }

    await backupDeletedRecord({
      entityType: 'AGENT',
      entityId: agent.id,
      entityReference: agent.name,
      snapshot: agent.toJSON(),
      deletedById: req.user.id,
      deletedByName: req.user.name,
      deletionReason: req.body?.reason || 'Deactivated/deleted via UI'
    });

    await agent.update({ isActive: false });
    await logAudit({ req, action: 'DELETE_AGENT', entityName: 'CommissionAgent', entityId: agent.id, entityReference: agent.name });
    res.json({ success: true, message: `${agent.name} deleted (moved to inactive). History preserved.` });
  } catch (err) { next(err); }
};

// --- Transporters ---
const getTransporters = async (req, res, next) => {
  try {
    const transporters = await Transporter.findAll({ where: { isActive: true }, order: [['name', 'ASC']] });
    res.json({ success: true, transporters });
  } catch (err) { next(err); }
};

const createTransporter = async (req, res, next) => {
  try {
    const { name, vehicleNumber, driverName, driverPhone, transportCompany } = req.body;
    const transporter = await Transporter.create({
      name, vehicleNumber, driverName, driverPhone, transportCompany
    });
    res.status(201).json({ success: true, transporter });
  } catch (err) { next(err); }
};

const updateTransporter = async (req, res, next) => {
  try {
    const transporter = await Transporter.findByPk(req.params.id);
    if (!transporter) return res.status(404).json({ success: false, message: 'Transporter not found' });

    const before = transporter.toJSON();
    const { name, vehicleNumber, driverName, driverPhone, transportCompany } = req.body;
    await transporter.update({ name, vehicleNumber, driverName, driverPhone, transportCompany });
    await logAudit({ req, action: 'UPDATE_TRANSPORTER', entityName: 'Transporter', entityId: transporter.id, entityReference: transporter.name, beforeState: before, afterState: transporter.toJSON() });
    res.json({ success: true, transporter });
  } catch (err) { next(err); }
};

const deleteTransporter = async (req, res, next) => {
  try {
    const transporter = await Transporter.findByPk(req.params.id);
    if (!transporter) return res.status(404).json({ success: false, message: 'Transporter not found' });

    await backupDeletedRecord({
      entityType: 'TRANSPORTER',
      entityId: transporter.id,
      entityReference: transporter.name,
      snapshot: transporter.toJSON(),
      deletedById: req.user.id,
      deletedByName: req.user.name,
      deletionReason: req.body?.reason || 'Deactivated/deleted via UI'
    });

    await transporter.update({ isActive: false });
    await logAudit({ req, action: 'DELETE_TRANSPORTER', entityName: 'Transporter', entityId: transporter.id, entityReference: transporter.name });
    res.json({ success: true, message: `${transporter.name} deleted (moved to inactive). History preserved.` });
  } catch (err) { next(err); }
};

// --- Users ---
const getUsers = async (req, res, next) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['passwordHash'] },
      include: [{ model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] }],
      where: { isActive: true },
      order: [['id', 'ASC']]
    });
    res.json({ success: true, users });
  } catch (err) { next(err); }
};

const createUser = async (req, res, next) => {
  try {
    const { name, email, password, role, branchId, phone } = req.body;
    const passwordHash = await bcrypt.hash(password || 'password123', 10);
    const user = await User.create({
      name,
      email: email.toLowerCase().trim(),
      passwordHash,
      role: role || 'STAFF',
      branchId: branchId ? parseInt(branchId) : null,
      phone
    });
    res.status(201).json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        branchId: user.branchId
      }
    });
  } catch (err) { next(err); }
};

const updateUser = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const before = user.toJSON();
    delete before.passwordHash;
    const { name, email, password, role, branchId, phone } = req.body;
    const updates = {
      name,
      email: email ? email.toLowerCase().trim() : user.email,
      role: role || user.role,
      branchId: branchId !== undefined ? (branchId ? parseInt(branchId) : null) : user.branchId,
      phone
    };
    if (password) {
      updates.passwordHash = await bcrypt.hash(password, 10);
    }
    await user.update(updates);
    await logAudit({ req, action: 'UPDATE_USER', entityName: 'User', entityId: user.id, entityReference: user.email, beforeState: before, afterState: { ...user.toJSON(), passwordHash: undefined } });
    res.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, branchId: user.branchId }
    });
  } catch (err) { next(err); }
};

// Soft-delete (deactivate): guards against self-deletion and removing the last owner.
const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    }
    if (user.role === 'OWNER') {
      const activeOwners = await User.count({ where: { role: 'OWNER', isActive: true } });
      if (activeOwners <= 1) {
        return res.status(400).json({ success: false, message: 'Cannot delete the last active Owner account.' });
      }
    }

    const snap = user.toJSON();
    delete snap.passwordHash;

    await backupDeletedRecord({
      entityType: 'USER',
      entityId: user.id,
      entityReference: `${user.name} (${user.email})`,
      snapshot: snap,
      branchId: user.branchId,
      deletedById: req.user.id,
      deletedByName: req.user.name,
      deletionReason: req.body?.reason || 'Deactivated/deleted via UI'
    });

    await user.update({ isActive: false });
    await logAudit({ req, action: 'DELETE_USER', entityName: 'User', entityId: user.id, entityReference: user.email });
    res.json({ success: true, message: `${user.name} deleted (deactivated). History preserved.` });
  } catch (err) { next(err); }
};

module.exports = {
  getBranches,
  createBranch,
  updateBranch,
  deleteBranch,
  getItems,
  createItem,
  updateItem,
  deleteItem,
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  getTransporters,
  createTransporter,
  updateTransporter,
  deleteTransporter,
  getUsers,
  createUser,
  updateUser,
  deleteUser
};
