const { GatePass, Branch, sequelize } = require('../models');
const { generateSequence } = require('../services/invoiceService');
const { logAudit } = require('../middleware/audit');

const getGatePasses = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const { passType, status, page = 1, limit = 50 } = req.query;

    const where = {};
    if (branchId) where.branchId = branchId;
    if (passType) where.passType = passType;
    if (status) where.status = status;

    const passes = await GatePass.findAll({
      where,
      include: [{ model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] }],
      order: [['timeIn', 'DESC'], ['id', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    });

    res.json({ success: true, passes });
  } catch (err) {
    next(err);
  }
};

const createGatePass = async (req, res, next) => {
  try {
    const {
      branchId,
      passType, // INWARD, OUTWARD
      vehicleNumber,
      driverName = '',
      driverPhone = '',
      purpose, // PURCHASE_DELIVERY, SALE_DISPATCH, STOCK_TRANSFER, EMPTY_CRATES, OTHER
      referenceType = null,
      referenceId = null,
      referenceNumber = '',
      grossWeightKg = null,
      tareWeightKg = null,
      securityGuardName = '',
      notes = ''
    } = req.body;

    const targetBranchId = req.user.role === 'OWNER' ? (branchId || req.user.branchId || 1) : req.user.branchId;
    const branch = await Branch.findByPk(targetBranchId);
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    let netWeight = null;
    if (grossWeightKg && tareWeightKg) {
      netWeight = parseFloat((parseFloat(grossWeightKg) - parseFloat(tareWeightKg)).toFixed(2));
    }

    const passSeq = await generateSequence('GP', branch.code);

    const gatePass = await GatePass.create({
      passNumber: passSeq,
      branchId: targetBranchId,
      passType,
      vehicleNumber: vehicleNumber.toUpperCase().trim(),
      driverName,
      driverPhone,
      purpose,
      referenceType,
      referenceId,
      referenceNumber,
      timeIn: new Date(),
      grossWeightKg: grossWeightKg ? parseFloat(grossWeightKg) : null,
      tareWeightKg: tareWeightKg ? parseFloat(tareWeightKg) : null,
      netFruitWeightKg: netWeight,
      securityGuardName,
      status: 'IN_PREMISES',
      notes,
      createdBy: req.user.id
    });

    await logAudit({
      req,
      action: 'CREATE_GATE_PASS',
      entityName: 'GatePass',
      entityId: gatePass.id,
      entityReference: passSeq,
      afterState: gatePass.toJSON()
    });

    res.status(201).json({
      success: true,
      message: `Gate pass ${passSeq} issued for vehicle ${vehicleNumber}`,
      gatePass
    });
  } catch (err) {
    next(err);
  }
};

const markExit = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tareWeightKg, notes } = req.body;

    const pass = await GatePass.findByPk(id);
    if (!pass) return res.status(404).json({ success: false, message: 'Gate pass not found' });

    // Non-owners may only operate on their own branch's gate passes
    if (req.user.role !== 'OWNER' && req.targetBranchId && pass.branchId !== req.targetBranchId) {
      return res.status(403).json({ success: false, message: 'Access denied: gate pass belongs to another branch.' });
    }

    pass.timeOut = new Date();
    pass.status = 'EXITED';

    if (tareWeightKg) {
      pass.tareWeightKg = parseFloat(tareWeightKg);
      if (pass.grossWeightKg) {
        pass.netFruitWeightKg = parseFloat((parseFloat(pass.grossWeightKg) - parseFloat(tareWeightKg)).toFixed(2));
      }
    }

    if (notes) pass.notes = (pass.notes ? `${pass.notes} | ` : '') + notes;
    await pass.save();

    await logAudit({
      req,
      action: 'EXIT_GATE_PASS',
      entityName: 'GatePass',
      entityId: pass.id,
      entityReference: pass.passNumber,
      afterState: pass.toJSON()
    });

    res.json({
      success: true,
      message: `Vehicle ${pass.vehicleNumber} marked as exited`,
      pass
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getGatePasses,
  createGatePass,
  markExit
};
