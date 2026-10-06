const { Op } = require('sequelize');
const { 
  StockBatch, StockMovement, WastageEntry, StockTransfer, Item, Branch, Transporter, sequelize 
} = require('../models');
const StockService = require('../services/stockService');
const LedgerService = require('../services/ledgerService');
const { generateSequence } = require('../services/invoiceService');
const { logAudit } = require('../middleware/audit');

const getStockOverview = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const whereBatch = { status: 'ACTIVE', currentQuantity: { [Op.gt]: 0 } };
    if (branchId) whereBatch.branchId = branchId;

    const batches = await StockBatch.findAll({
      where: whereBatch,
      include: [
        { model: Item, as: 'item' },
        { model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] }
      ]
    });

    const items = await Item.findAll({ where: { isActive: true } });
    const branches = await Branch.findAll({ where: { isActive: true } });

    // Aggregate by Branch & Item
    const stockMap = {};

    for (const b of batches) {
      const key = `${b.branchId}_${b.itemId}`;
      const qty = parseFloat(b.currentQuantity || 0);
      const cost = parseFloat(b.landedCostPerUnit || 0);

      if (!stockMap[key]) {
        stockMap[key] = {
          branchId: b.branchId,
          branchName: b.branch?.name || '',
          branchCode: b.branch?.code || '',
          itemId: b.itemId,
          itemName: b.item?.name || '',
          variety: b.item?.variety || '',
          baseUnit: b.item?.baseUnit || 'kg',
          packagingUnit: b.item?.packagingUnit || 'crate',
          conversionFactor: parseFloat(b.item?.unitConversionFactor || 1),
          reorderThreshold: parseFloat(b.item?.reorderThreshold || 100),
          totalQuantityKg: 0,
          totalValuation: 0,
          activeBatchesCount: 0
        };
      }

      stockMap[key].totalQuantityKg = parseFloat((stockMap[key].totalQuantityKg + qty).toFixed(2));
      stockMap[key].totalValuation = parseFloat((stockMap[key].totalValuation + (qty * cost)).toFixed(2));
      stockMap[key].activeBatchesCount += 1;
    }

    const overviewList = Object.values(stockMap).map(item => {
      const crates = item.conversionFactor > 0 ? (item.totalQuantityKg / item.conversionFactor).toFixed(1) : 0;
      const avgCostPerKg = item.totalQuantityKg > 0 ? (item.totalValuation / item.totalQuantityKg).toFixed(2) : 0;
      return {
        ...item,
        quantityCrates: parseFloat(crates),
        averageCostPerKg: parseFloat(avgCostPerKg),
        isLowStock: item.totalQuantityKg <= item.reorderThreshold
      };
    });

    res.json({
      success: true,
      stock: overviewList
    });
  } catch (err) {
    next(err);
  }
};

const getBatches = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const { itemId, status = 'ACTIVE' } = req.query;

    const where = {};
    if (branchId) where.branchId = branchId;
    if (itemId) where.itemId = itemId;
    if (status) where.status = status;

    const batches = await StockBatch.findAll({
      where,
      include: [
        { model: Item, as: 'item' },
        { model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] }
      ],
      order: [['receivedDate', 'ASC']]
    });

    const today = new Date();
    const formatted = batches.map(b => {
      const recDate = new Date(b.receivedDate);
      const ageDays = Math.floor((today - recDate) / (1000 * 60 * 60 * 24));
      const shelfLife = b.item?.shelfLifeDays || 14;

      return {
        id: b.id,
        batchNumber: b.batchNumber,
        branchId: b.branchId,
        branchName: b.branch?.name,
        itemId: b.itemId,
        itemName: b.item?.name,
        variety: b.item?.variety,
        packagingUnit: b.item?.packagingUnit || null,
        packagingSizeKg: b.item ? parseFloat(b.item.unitConversionFactor || 1) : 1,
        initialQuantity: parseFloat(b.initialQuantity),
        currentQuantity: parseFloat(b.currentQuantity),
        unit: 'kg',
        landedCostPerUnit: parseFloat(b.landedCostPerUnit),
        valuation: parseFloat((parseFloat(b.currentQuantity) * parseFloat(b.landedCostPerUnit)).toFixed(2)),
        receivedDate: b.receivedDate,
        expiryDate: b.expiryDate,
        status: b.status,
        ageDays,
        shelfLifeDays: shelfLife,
        isNearExpiry: ageDays >= (shelfLife - 3)
      };
    });

    res.json({ success: true, batches: formatted });
  } catch (err) {
    next(err);
  }
};

const createWastageEntry = async (req, res, next) => {
  const dbTx = await sequelize.transaction();
  try {
    const {
      branchId,
      itemId,
      stockBatchId,
      quantityKg,
      reason,
      actionTaken = 'Discarded',
      salvageRecoveryAmount = 0,
      entryDate,
      notes = ''
    } = req.body;

    const targetBranchId = req.user.role === 'OWNER' ? (branchId || req.user.branchId || 1) : req.user.branchId;
    const branch = await Branch.findByPk(targetBranchId, { transaction: dbTx });
    if (!branch) throw new Error('Branch not found');

    const wastage = await StockService.recordWastage({
      branchId: targetBranchId,
      branchCode: branch.code,
      itemId,
      stockBatchId,
      quantityKg,
      reason,
      actionTaken,
      salvageRecoveryAmount,
      entryDate,
      notes,
      userId: req.user.id
    }, dbTx);

    await dbTx.commit();

    await logAudit({
      req,
      action: 'RECORD_WASTAGE',
      entityName: 'WastageEntry',
      entityId: wastage.id,
      entityReference: wastage.entryNumber,
      afterState: wastage.toJSON()
    });

    res.status(201).json({
      success: true,
      message: `Fruit wastage of ${quantityKg} kg written off successfully`,
      wastage
    });
  } catch (err) {
    await dbTx.rollback();
    next(err);
  }
};

const getWastageEntries = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const where = branchId ? { branchId } : {};

    const entries = await WastageEntry.findAll({
      where,
      include: [
        { model: Item, as: 'item' },
        { model: Branch, as: 'branch' },
        { model: StockBatch, as: 'batch' }
      ],
      order: [['id', 'DESC']]
    });

    res.json({ success: true, entries });
  } catch (err) {
    next(err);
  }
};

const getTransfers = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const where = {};
    if (branchId) {
      where[Op.or] = [{ fromBranchId: branchId }, { toBranchId: branchId }];
    }

    const transfers = await StockTransfer.findAll({
      where,
      include: [
        { model: Branch, as: 'fromBranch' },
        { model: Branch, as: 'toBranch' },
        { model: Item, as: 'item' },
        { model: StockBatch, as: 'sourceBatch' },
        { model: Transporter, as: 'transporter' }
      ],
      order: [['id', 'DESC']]
    });

    res.json({ success: true, transfers });
  } catch (err) {
    next(err);
  }
};

const createTransfer = async (req, res, next) => {
  const dbTx = await sequelize.transaction();
  try {
    const {
      toBranchId,
      itemId,
      sourceBatchId,
      quantity,
      unit = 'kg',
      transporterId = null,
      vehicleNumber = '',
      freightCost = 0,
      notes = ''
    } = req.body;

    // Branch authorization: non-owners may ONLY dispatch from their own branch
    // (req.targetBranchId is set by requireBranchAccess middleware)
    const fromBranchId = req.user.role === 'OWNER'
      ? parseInt(req.body.fromBranchId)
      : req.targetBranchId;

    const destBranchId = parseInt(toBranchId);

    if (!fromBranchId || !destBranchId) {
      throw new Error('Source and destination branches are required');
    }
    if (fromBranchId === destBranchId) {
      throw new Error('Source and destination branches cannot be the same');
    }

    const srcBatch = await StockBatch.findByPk(sourceBatchId, {
      transaction: dbTx,
      lock: dbTx.LOCK.UPDATE
    });
    if (srcBatch && srcBatch.branchId !== fromBranchId) {
      throw new Error('Source batch does not belong to the dispatching branch');
    }
    if (!srcBatch) throw new Error('Source batch not found');

    const qty = parseFloat(quantity);
    const available = parseFloat(srcBatch.currentQuantity);
    if (available < qty) {
      throw new Error(`Insufficient quantity in batch. Available: ${available} kg, Requested: ${qty} kg`);
    }

    // Deduct from source batch
    const newQty = parseFloat((available - qty).toFixed(2));
    srcBatch.currentQuantity = newQty;
    if (newQty <= 0.001) srcBatch.status = 'DEPLETED';
    await srcBatch.save({ transaction: dbTx });

    const transferSeq = `${Date.now().toString().slice(-8)}${Math.floor(100 + Math.random() * 900)}`;
    const transferNumber = `TR-${new Date().getFullYear()}-${transferSeq}`;

    // Record Stock Movement at source
    await StockMovement.create({
      batchId: srcBatch.id,
      branchId: fromBranchId,
      itemId,
      movementType: 'TRANSFER_OUT',
      quantity: qty,
      unit,
      costPerUnit: srcBatch.landedCostPerUnit,
      referenceType: 'StockTransfer',
      referenceNumber: transferNumber,
      notes: `Transfer dispatched to Branch #${destBranchId}`
    }, { transaction: dbTx });

    // Create Stock Transfer record
    const transfer = await StockTransfer.create({
      transferNumber,
      fromBranchId,
      toBranchId: destBranchId,
      itemId,
      quantity: qty,
      unit,
      weightKg: qty,
      sourceBatchId,
      unitCost: srcBatch.landedCostPerUnit,
      transporterId,
      vehicleNumber,
      freightCost,
      status: 'IN_TRANSIT',
      notes,
      createdBy: req.user.id
    }, { transaction: dbTx });

    await dbTx.commit();

    await logAudit({
      req,
      action: 'DISPATCH_TRANSFER',
      entityName: 'StockTransfer',
      entityId: transfer.id,
      entityReference: transferNumber,
      afterState: transfer.toJSON()
    });

    res.status(201).json({
      success: true,
      message: `Stock transfer ${transferNumber} dispatched successfully`,
      transfer
    });
  } catch (err) {
    await dbTx.rollback();
    next(err);
  }
};

const receiveTransfer = async (req, res, next) => {
  const dbTx = await sequelize.transaction();
  try {
    const { id } = req.params;
    const transfer = await StockTransfer.findByPk(id, {
      include: [
        { model: Branch, as: 'toBranch' },
        { model: StockBatch, as: 'sourceBatch' }
      ],
      transaction: dbTx,
      lock: dbTx.LOCK.UPDATE
    });

    if (!transfer) throw new Error('Transfer record not found');
    if (transfer.status !== 'IN_TRANSIT') {
      throw new Error(`Transfer cannot be received. Current status: ${transfer.status}`);
    }

    // Branch authorization: only the destination branch (or Owner) may receive
    if (req.user.role !== 'OWNER' && req.targetBranchId && transfer.toBranchId !== req.targetBranchId) {
      throw new Error('Access denied: only the destination branch can receive this transfer');
    }

    const toBranch = transfer.toBranch;
    const destBatchSeq = Math.floor(100 + Math.random() * 900);
    const destBatchNumber = `LOT-${toBranch.code}-TR-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${destBatchSeq}`;

    // Landed cost calculation for destination branch includes allocated transfer freight
    const baseCost = parseFloat(transfer.unitCost);
    const addFreightPerKg = transfer.weightKg > 0 ? (parseFloat(transfer.freightCost || 0) / parseFloat(transfer.weightKg)) : 0;
    const destLandedCost = parseFloat((baseCost + addFreightPerKg).toFixed(2));

    // Create new batch at destination branch
    const destBatch = await StockBatch.create({
      batchNumber: destBatchNumber,
      branchId: transfer.toBranchId,
      itemId: transfer.itemId,
      initialQuantity: transfer.quantity,
      currentQuantity: transfer.quantity,
      unit: transfer.unit,
      purchaseRate: baseCost,
      landedCostPerUnit: destLandedCost,
      receivedDate: new Date().toISOString().split('T')[0],
      expiryDate: transfer.sourceBatch ? transfer.sourceBatch.expiryDate : null,
      status: 'ACTIVE'
    }, { transaction: dbTx });

    // Record Stock Movement at destination
    await StockMovement.create({
      batchId: destBatch.id,
      branchId: transfer.toBranchId,
      itemId: transfer.itemId,
      movementType: 'TRANSFER_IN',
      quantity: transfer.quantity,
      unit: transfer.unit,
      costPerUnit: destLandedCost,
      referenceType: 'StockTransfer',
      referenceId: transfer.id,
      referenceNumber: transfer.transferNumber,
      notes: `Received from Branch #${transfer.fromBranchId}`
    }, { transaction: dbTx });

    transfer.destinationBatchId = destBatch.id;
    transfer.status = 'RECEIVED';
    transfer.receivedAt = new Date();
    transfer.receivedBy = req.user.id;
    await transfer.save({ transaction: dbTx });

    await dbTx.commit();

    await logAudit({
      req,
      action: 'RECEIVE_TRANSFER',
      entityName: 'StockTransfer',
      entityId: transfer.id,
      entityReference: transfer.transferNumber,
      afterState: transfer.toJSON()
    });

    res.json({
      success: true,
      message: `Stock transfer ${transfer.transferNumber} received at ${toBranch.name}`,
      transfer
    });
  } catch (err) {
    await dbTx.rollback();
    next(err);
  }
};

// Consumer return to stock (customer returns spoiled / chaffed fruit)
// Restores qty to active batches + refunds customer payment via ledger
const restockReturn = async (req, res, next) => {
  const dbTx = await sequelize.transaction();
  try {
    const {
      branchId,
      itemId,
      quantityKg,
      reason,
      actionTaken = 'Returned to grower (claim)',
      salvageRecoveryAmount = 0,
      referenceType = 'WastageEntry',
      referenceId = null,
      referenceNumber = '',
      notes = '',
      userId
    } = req.body;

    const targetBranchId = req.user.role === 'OWNER' ? (branchId || req.user.branchId || 1) : req.user.branchId;
    const branch = await Branch.findByPk(targetBranchId, { transaction: dbTx });
    if (!branch) throw new Error('Branch not found');

    const wastage = await StockService.restockReturn({
      branchId: targetBranchId,
      branchCode: branch.code,
      itemId,
      quantityKg,
      reason,
      actionTaken,
      salvageRecoveryAmount,
      referenceType,
      referenceId,
      referenceNumber,
      notes,
      userId: req.user.id
    }, dbTx);

    await dbTx.commit();

    await logAudit({
      req,
      action: 'CONSUMER_RETURN',
      entityName: 'WastageEntry',
      entityId: wastage.id,
      entityReference: wastage.entryNumber,
      afterState: wastage.toJSON()
    });

    res.status(201).json({
      success: true,
      message: `Returned ${quantityKg} kg to stock successfully`,
      wastage
    });
  } catch (err) {
    await dbTx.rollback();
    next(err);
  }
};

// Supplier return (return a purchase back to the supplier)
// Removes un-consumed stock batch(es) + refunds supplier payment via ledger
const purchaseReturn = async (req, res, next) => {
  const dbTx = await sequelize.transaction();
  try {
    const {
      branchId,
      itemId,
      quantityKg,
      reason,
      actionTaken = 'Returned to supplier (claim)',
      salvageRecoveryAmount = 0,
      referenceType = 'Purchase',
      referenceId = null,
      referenceNumber = '',
      notes = '',
      userId
    } = req.body;

    const targetBranchId = req.user.role === 'OWNER' ? (branchId || req.user.branchId || 1) : req.user.branchId;
    const branch = await Branch.findByPk(targetBranchId, { transaction: dbTx });
    if (!branch) throw new Error('Branch not found');

    const wastage = await StockService.purchaseReturn({
      branchId: targetBranchId,
      branchCode: branch.code,
      itemId,
      quantityKg,
      reason,
      actionTaken,
      salvageRecoveryAmount,
      referenceType,
      referenceId,
      referenceNumber,
      notes,
      userId: req.user.id
    }, dbTx);

    await dbTx.commit();

    await logAudit({
      req,
      action: 'SUPPLIER_RETURN',
      entityName: 'WastageEntry',
      entityId: wastage.id,
      entityReference: wastage.entryNumber,
      afterState: wastage.toJSON()
    });

    res.status(201).json({
      success: true,
      message: `Returned ${quantityKg} kg to supplier. Stock reduced and supplier payment refunded.`,
      wastage
    });
  } catch (err) {
    await dbTx.rollback();
    next(err);
  }
};

module.exports = {
  getStockOverview,
  getBatches,
  createWastageEntry,
  getWastageEntries,
  getTransfers,
  createTransfer,
  receiveTransfer,
  restockReturn,
  purchaseReturn
};
