const { StockBatch, StockMovement, WastageEntry, StockTransfer, Item, Branch, Purchase, Supplier, sequelize } = require('../models');
const LedgerService = require('./ledgerService');

class StockService {
  /**
   * FIFO Stock Allocation for Sales
   * Deducts quantity strictly from the oldest available batches (receivedDate ASC)
   */
  static async allocateFIFO({
    branchId,
    itemId,
    quantityKg,
    referenceType = 'Sale',
    referenceId = null,
    referenceNumber = '',
    notes = ''
  }, dbTx) {
    const requiredQty = parseFloat(quantityKg);
    if (requiredQty <= 0) throw new Error('Quantity must be greater than 0');

    // Fetch active batches for this branch and item ordered by receivedDate ASC
    const batches = await StockBatch.findAll({
      where: {
        branchId,
        itemId,
        status: 'ACTIVE'
      },
      order: [['receivedDate', 'ASC'], ['id', 'ASC']],
      transaction: dbTx,
      lock: dbTx?.LOCK?.UPDATE || false
    });

    // Check total stock available
    const totalAvailable = batches.reduce((sum, b) => sum + parseFloat(b.currentQuantity), 0);
    if (totalAvailable < requiredQty) {
      const item = await Item.findByPk(itemId);
      const itemName = item ? `${item.name} (${item.variety || ''})` : `Item #${itemId}`;
      throw new Error(`Insufficient stock for ${itemName}. Required: ${requiredQty} kg, Available: ${totalAvailable.toFixed(2)} kg`);
    }

    let remainingNeeded = requiredQty;
    const allocations = [];
    let totalCogs = 0;

    for (const batch of batches) {
      if (remainingNeeded <= 0) break;

      const batchCurrentQty = parseFloat(batch.currentQuantity);
      if (batchCurrentQty <= 0) continue;

      const qtyToDeduct = Math.min(batchCurrentQty, remainingNeeded);
      const unitLandedCost = parseFloat(batch.landedCostPerUnit);
      const batchAllocationCost = parseFloat((qtyToDeduct * unitLandedCost).toFixed(2));

      // Update batch current quantity
      const newBatchQty = parseFloat((batchCurrentQty - qtyToDeduct).toFixed(2));
      batch.currentQuantity = newBatchQty;
      if (newBatchQty <= 0.001) {
        batch.status = 'DEPLETED';
      }
      await batch.save({ transaction: dbTx });

      // Create Stock Movement log
      await StockMovement.create({
        batchId: batch.id,
        branchId,
        itemId,
        movementType: 'SALE_OUT',
        quantity: qtyToDeduct,
        unit: 'kg',
        costPerUnit: unitLandedCost,
        referenceType,
        referenceId,
        referenceNumber,
        notes: `FIFO deduction for ${referenceNumber}`
      }, { transaction: dbTx });

      allocations.push({
        stockBatchId: batch.id,
        batchNumber: batch.batchNumber,
        quantityKg: qtyToDeduct,
        costPerKg: unitLandedCost,
        totalCost: batchAllocationCost
      });

      totalCogs += batchAllocationCost;
      remainingNeeded = parseFloat((remainingNeeded - qtyToDeduct).toFixed(2));
    }

    return {
      allocations,
      totalCogs: parseFloat(totalCogs.toFixed(2))
    };
  }

  /**
   * Create a new stock batch upon purchase entry
   */
  static async createPurchaseBatch({
    branchId,
    branchCode = 'DEL',
    itemId,
    purchaseId,
    receivedWeightKg,
    unit = 'kg',
    purchaseRate,
    landedCostPerKg,
    receivedDate,
    shelfLifeDays = 14,
    referenceNumber = ''
  }, dbTx) {
    const qty = parseFloat(receivedWeightKg);
    const cost = parseFloat(landedCostPerKg);
    const rate = parseFloat(purchaseRate);

    // Calculate estimated expiry date
    const recDate = new Date(receivedDate || Date.now());
    const expDate = new Date(recDate);
    expDate.setDate(expDate.getDate() + (shelfLifeDays || 14));

    // Millisecond timestamp + random suffix keeps lot numbers unique under bursts
    const batchSeq = `${Date.now().toString().slice(-7)}${Math.floor(100 + Math.random() * 900)}`;
    const batchNumber = `LOT-${branchCode}-${recDate.toISOString().slice(2, 10).replace(/-/g, '')}-${itemId}-${batchSeq}`;

    const batch = await StockBatch.create({
      batchNumber,
      branchId,
      itemId,
      purchaseId,
      initialQuantity: qty,
      currentQuantity: qty,
      // Quantities in stock_batches are ALWAYS in kg (FIFO allocation, wastage
      // and transfers all deduct kg). Labeling the batch with the purchase pack
      // unit (crate/box) made "4 kg of stock" display as "4 box".
      unit: 'kg',
      purchaseRate: rate,
      landedCostPerUnit: cost,
      receivedDate: recDate.toISOString().split('T')[0],
      expiryDate: expDate.toISOString().split('T')[0],
      status: 'ACTIVE'
    }, { transaction: dbTx });

    // Record Stock Movement
    await StockMovement.create({
      batchId: batch.id,
      branchId,
      itemId,
      movementType: 'PURCHASE_IN',
      quantity: qty,
      unit: 'kg',
      costPerUnit: cost,
      referenceType: 'Purchase',
      referenceId: purchaseId,
      referenceNumber,
      notes: `Initial stock from purchase ${referenceNumber}`
    }, { transaction: dbTx });

    return batch;
  }

  /**
   * Record fruit wastage / spoilage
   * Reduces batch stock and logs loss in append-only ledger.
   * Ledger is kept double-entry: WASTAGE_LOSS (debit) is offset by
   * INVENTORY_ASSET (credit) so the ledger balance never goes negative.
   */
  static async recordWastage({
    branchId,
    branchCode = 'DEL',
    itemId,
    stockBatchId,
    quantityKg,
    reason,
    actionTaken = 'Discarded',
    salvageRecoveryAmount = 0,
    entryDate,
    notes = '',
    userId
  }, dbTx) {
    const qty = parseFloat(quantityKg);
    if (qty <= 0) throw new Error('Wastage quantity must be greater than 0');

    // Fetch batch with lock
    const batch = await StockBatch.findByPk(stockBatchId, {
      transaction: dbTx,
      lock: dbTx?.LOCK?.UPDATE || false
    });

    if (!batch) throw new Error('Stock batch not found');
    const currentQty = parseFloat(batch.currentQuantity);
    if (currentQty < qty) {
      throw new Error(`Cannot write off ${qty} kg from batch ${batch.batchNumber}. Available: ${currentQty} kg`);
    }

    const unitCost = parseFloat(batch.landedCostPerUnit);
    const totalLossAmount = parseFloat((qty * unitCost).toFixed(2));
    const salvageAmt = parseFloat(salvageRecoveryAmount) || 0;
    const netLossAmount = parseFloat(Math.max(0, totalLossAmount - salvageAmt).toFixed(2));

    // Update batch
    const newQty = parseFloat((currentQty - qty).toFixed(2));
    batch.currentQuantity = newQty;
    if (newQty <= 0.001) {
      batch.status = 'DEPLETED';
    }
    await batch.save({ transaction: dbTx });

    const entrySeq = `${Date.now().toString().slice(-7)}${Math.floor(100 + Math.random() * 900)}`;
    const entryNumber = `WST-${branchCode}-${new Date().getFullYear()}-${entrySeq}`;

    // Create Wastage Entry (lives only in the wastage_entries table, which has
    // no wasReturned column — keep writes to columns that exist)
    const wastage = await WastageEntry.create({
      entryNumber,
      branchId,
      itemId,
      stockBatchId,
      quantity: qty,
      unit: 'kg',
      quantityKg: qty,
      costPerKg: unitCost,
      totalLossAmount,
      reason,
      actionTaken,
      salvageRecoveryAmount: salvageAmt,
      entryDate: entryDate || new Date().toISOString().split('T')[0],
      notes,
      createdBy: userId
    }, { transaction: dbTx });

    // Record Stock Movement
    await StockMovement.create({
      batchId: batch.id,
      branchId,
      itemId,
      movementType: 'WASTAGE_OUT',
      quantity: qty,
      unit: 'kg',
      costPerUnit: unitCost,
      referenceType: 'WastageEntry',
      referenceId: wastage.id,
      referenceNumber: entryNumber,
      notes: `Spoilage write-off: ${reason}`
    }, { transaction: dbTx });

    // Post to Append-Only Ledger (double-entry):
    //   Debit:  WASTAGE_LOSS ( Fruit spoilage expense )
    //   Credit: INVENTORY_ASSET ( the stock that spoiled )
    await LedgerService.postEntry({
      branchId,
      branchCode,
      type: 'WASTAGE_LOSS',
      referenceType: 'WastageEntry',
      referenceId: wastage.id,
      referenceNumber: entryNumber,
      partyType: 'INTERNAL',
      accountType: 'WASTAGE_LOSS',
      debitAmount: netLossAmount,
      creditAmount: 0,
      notes: `Wastage write-off for batch ${batch.batchNumber} (${qty} kg, Reason: ${reason})`,
      createdBy: userId
    }, dbTx);

    // Negative side of the same write-off: the spoiled fruit leaves inventory.
    await LedgerService.postEntry({
      branchId,
      branchCode,
      type: 'WASTAGE_LOSS',
      referenceType: 'WastageEntry',
      referenceId: wastage.id,
      referenceNumber: entryNumber,
      partyType: 'INTERNAL',
      accountType: 'INVENTORY_ASSET',
      debitAmount: 0,
      creditAmount: netLossAmount,
      notes: `Inventory reduced for ${qty} kg wastage of ${batch.batchNumber}`,
      createdBy: userId
    }, dbTx);

    // If salvage cash was recovered, debit cash (the credit to INVENTORY_ASSET
    // already nets out the full value; cash now only offsets the recovery)
    if (salvageAmt > 0) {
      await LedgerService.postEntry({
        branchId,
        branchCode,
        type: 'WASTAGE_LOSS',
        referenceType: 'WastageEntry',
        referenceId: wastage.id,
        referenceNumber: entryNumber,
        partyType: 'INTERNAL',
        accountType: 'CASH',
        debitAmount: salvageAmt,
        creditAmount: 0,
        notes: `Salvage cash recovery from discarded fruit`,
        createdBy: userId
      }, dbTx);
    }
  }

  /**
   * Consumer return to stock (customer returns spoiled / chaffed fruit).
   *
   * Runs in ONE transaction and is fully append-only + ledger-consistent:
   *   1. Restores quantity to the active FIFO batch(es) + logs RETURN_IN movement
   *   2. Writes a WastageEntry so the return record is auditable
   *   3. Posts a double-entry mirror so the ledger stays balanced:
   *        DEBIT  INVENTORY_ASSET  (stock added back)
   *        CREDIT WASTAGE_LOSS     (remove the spoilage expense)
   */
  static async restockReturn({
    branchId,
    branchCode = 'DEL',
    itemId,
    quantityKg,
    reason,
    actionTaken = 'Returned to grower (claim)',
    salvageRecoveryAmount = 0,
    referenceType = 'WastageEntry',
    referenceId = null,
    referenceNumber = '',
    notes = '',
    userId,
    dbTx
  }) {
    const qty = parseFloat(quantityKg);
    if (qty <= 0) throw new Error('Return quantity must be greater than 0');
    if (!reason) throw new Error('Return reason is required (audit trail)');

    // --- 1. Restore the returned quantity to the existing active FIFO batch(es) ---
    const batches = await StockBatch.findAll({
      where: {
        branchId,
        itemId,
        status: 'ACTIVE'
      },
      order: [['receivedDate', 'ASC'], ['id', 'ASC']],
      transaction: dbTx,
      lock: dbTx?.LOCK?.UPDATE || false
    });

    let totalRestored = 0;
    const movementNotes = [];
    let entryNumber = '';

    for (const batch of batches) {
      if (totalRestored >= qty) break;

      const batchCurrentQty = parseFloat(batch.currentQuantity || 0);
      if (batchCurrentQty <= 0) continue;

      const toAdd = Math.min(qty - totalRestored, batchCurrentQty);
      const unitCost = parseFloat(batch.landedCostPerUnit || 0);

      batch.currentQuantity = parseFloat((batchCurrentQty + toAdd).toFixed(2));
      if (batch.status === 'EXPIRED') batch.status = 'ACTIVE';
      await batch.save({ transaction: dbTx });

      const entrySeq = `${Date.now().toString().slice(-7)}${Math.floor(100 + Math.random() * 900)}`;
      entryNumber = `RTRN-${branchCode}-${new Date().getFullYear()}-${entrySeq}`;

      // Log the stock return as a RETURN_IN movement
      await StockMovement.create({
        batchId: batch.id,
        branchId,
        itemId,
        movementType: 'RETURN_IN',
        quantity: toAdd,
        unit: 'kg',
        costPerUnit: unitCost,
        referenceType,
        referenceId,
        referenceNumber,
        notes: `Returned stock claim ${referenceNumber || ''}${referenceNumber ? ' / ' : ''}${reason}`
      }, { transaction: dbTx });

      movementNotes.push(`Added ${toAdd} kg to lot ${batch.batchNumber}`);
      totalRestored = parseFloat((totalRestored + toAdd).toFixed(2));
    }

    if (totalRestored < qty) {
      throw new Error(`Cannot return ${qty} kg. Only ${totalRestored} kg is available in active lots for batch ${itemId}.`);
    }

    // --- 2. Create the WastageEntry record (uses only live DB columns) ---
    const wastage = await WastageEntry.create({
      entryNumber,
      branchId,
      itemId,
      stockBatchId: batches[0] ? batches[0].id : null,
      quantity: totalRestored,
      unit: 'kg',
      quantityKg: totalRestored,
      costPerKg: parseFloat((totalRestored > 0 ? batches[0] : {}).landedCostPerUnit || 0),
      totalLossAmount: 0,
      reason,
      actionTaken,
      salvageRecoveryAmount: salvageRecoveryAmount,
      entryDate: new Date().toISOString().split('T')[0],
      notes,
      createdBy: userId
    }, { transaction: dbTx });

    // --- 3. Post to the append-only ledger (double-entry) ---
    if (salvageRecoveryAmount > 0) {
      await LedgerService.postEntry({
        branchId,
        branchCode,
        type: 'WASTAGE_LOSS',
        referenceType: 'WastageEntry',
        referenceId: wastage.id,
        referenceNumber: entryNumber,
        partyType: 'INTERNAL',
        accountType: 'WASTAGE_LOSS',
        debitAmount: 0,
        creditAmount: salvageRecoveryAmount,
        notes: `Salvage cash recovered from returned fruit`
      }, dbTx);

      await LedgerService.postEntry({
        branchId,
        branchCode,
        type: 'WASTAGE_LOSS',
        referenceType: 'WastageEntry',
        referenceId: wastage.id,
        referenceNumber: entryNumber,
        partyType: 'INTERNAL',
        accountType: 'CASH',
        debitAmount: salvageRecoveryAmount,
        creditAmount: 0,
        notes: `Salvage cash received for returned fruit`
      }, dbTx);
    }

    // Stock is added back to inventory: INVENTORY_ASSET debit (stock comes in)
    // plus WASTAGE_LOSS credit (remove the spoilage expense we would have booked)
    await LedgerService.postEntry({
      branchId,
      branchCode,
      type: 'WASTAGE_LOSS',
      referenceType: 'WastageEntry',
      referenceId: wastage.id,
      referenceNumber: entryNumber,
      partyType: 'INTERNAL',
      accountType: 'INVENTORY_ASSET',
      debitAmount: totalRestored,
      creditAmount: 0,
      notes: `Returned fruit added back to stock: ${totalRestored} kg (${reason})`
    }, dbTx);

    await LedgerService.postEntry({
      branchId,
      branchCode,
      type: 'WASTAGE_LOSS',
      referenceType: 'WastageEntry',
      referenceId: wastage.id,
      referenceNumber: entryNumber,
      partyType: 'INTERNAL',
      accountType: 'WASTAGE_LOSS',
      debitAmount: totalRestored,
      creditAmount: 0,
      notes: `Return-to-stock reversal of earlier wastage (batch ${batches[0]?.batchNumber || '??'}, ${totalRestored} kg, reason: ${reason}), movementType: RETURN_IN`
    }, dbTx);

    return wastage;
  }

  /**
   * Supplier return (defective fruit returned back to the supplier).
   * Removes the un-consumed stock batch(es) — scoped to the purchase bill being
   * edited when `purchaseId` (or referenceType 'Purchase' + referenceId) is
   * supplied, so returning goods never touches other bills' lots — and posts
   * the refund to the append-only ledger:
   *    CREDIT INVENTORY_ASSET   (returned stock leaves the warehouse)
   *    DEBIT  ACCOUNTS_PAYABLE  (refund drives what we owe the supplier down)
   *
   * Extra params (all optional, backward compatible):
   *   purchaseId  - restrict stock removal to that bill's lots
   *   supplierId / supplierName - tag the AP refund on the real counterparty
   *   refundAmount - money to refund at the bill rate (falls back to landed cost)
   */
  static async purchaseReturn({
    branchId,
    branchCode = 'DEL',
    itemId,
    quantityKg,
    reason,
    actionTaken = 'Returned to supplier (claim)',
    salvageRecoveryAmount = 0,
    referenceType = 'Purchase',
    referenceId = null,
    referenceNumber = '',
    purchaseId = null,
    supplierId = null,
    supplierName = null,
    refundAmount = null,
    notes = '',
    userId,
    dbTx
  }) {
    const qty = parseFloat(quantityKg);
    if (qty <= 0) throw new Error('Supplier-return quantity must be greater than 0');
    if (!reason) throw new Error('Return reason is required (audit trail)');

    // A bill-scoped return may only reduce that bill's own lots.
    const scopedPurchaseId = purchaseId || (referenceType === 'Purchase' && referenceId ? referenceId : null);
    const batchWhere = { branchId, itemId, status: 'ACTIVE' };
    if (scopedPurchaseId) batchWhere.purchaseId = scopedPurchaseId;

    const batches = await StockBatch.findAll({
      where: batchWhere,
      order: [['receivedDate', 'ASC'], ['id', 'ASC']],
      transaction: dbTx,
      lock: dbTx?.LOCK?.UPDATE || false
    });

    // The AP refund must hit the SUPPLIER's running balance — partyId is the
    // supplier id (never the purchase id, which would create a phantom party).
    let partyId = supplierId || null;
    let partyName = supplierName || null;
    if (!partyId && scopedPurchaseId) {
      const owningBill = await Purchase.findByPk(scopedPurchaseId, { attributes: ['id', 'supplierId'], transaction: dbTx });
      if (owningBill) partyId = owningBill.supplierId;
    }
    if (partyId && !partyName) {
      const supplierRow = await Supplier.findByPk(partyId, { attributes: ['id', 'name'], transaction: dbTx });
      partyName = supplierRow ? supplierRow.name : null;
    }

    let totalRemoved = 0;
    let landedValueRemoved = 0;
    let entryNumber = '';
    let firstTouchedBatchId = null;
    const removalNotes = [];

    for (const batch of batches) {
      const batchCurrentQty = parseFloat(batch.currentQuantity || 0);
      if (batchCurrentQty <= 0) continue;

      const toRemove = Math.min(parseFloat((qty - totalRemoved).toFixed(2)), batchCurrentQty);
      const batchUnitCost = parseFloat(batch.landedCostPerUnit || 0);
      batch.currentQuantity = parseFloat((batchCurrentQty - toRemove).toFixed(2));
      if (batch.currentQuantity <= 0.001) {
        batch.status = 'DEPLETED';
      }
      await batch.save({ transaction: dbTx });

      const entrySeq = `${Date.now().toString().slice(-7)}${Math.floor(100 + Math.random() * 900)}`;
      entryNumber = `RPTR-${branchCode}-${new Date().getFullYear()}-${entrySeq}`;
      if (!firstTouchedBatchId) firstTouchedBatchId = batch.id;

      // Log the removal as a RETURN_OUT movement
      await StockMovement.create({
        batchId: batch.id,
        branchId,
        itemId,
        movementType: 'RETURN_OUT',
        quantity: toRemove,
        unit: 'kg',
        costPerUnit: batchUnitCost,
        referenceType,
        referenceId,
        referenceNumber,
        notes: `Return to supplier claim ${referenceNumber || ''}${referenceNumber ? ' / ' : ''}${reason}`
      }, { transaction: dbTx });

      removalNotes.push(`Removed ${toRemove} kg from lot ${batch.batchNumber}`);
      totalRemoved = parseFloat((totalRemoved + toRemove).toFixed(2));
      landedValueRemoved = parseFloat((landedValueRemoved + toRemove * batchUnitCost).toFixed(2));
    }

    if (totalRemoved < qty) {
      throw new Error(
        `Cannot return ${qty} kg to supplier. Only ${totalRemoved} kg is available in active lots${
          scopedPurchaseId ? ` on this bill (item #${itemId})` : ` for item #${itemId}`
        }.`
      );
    }

    const avgCostPerKg = totalRemoved > 0 ? parseFloat((landedValueRemoved / totalRemoved).toFixed(2)) : 0;

    // --- 2. Write the WastageEntry record (uses only live DB columns) ---
    const wastage = await WastageEntry.create({
      entryNumber,
      branchId,
      itemId,
      stockBatchId: firstTouchedBatchId,
      quantity: totalRemoved,
      unit: 'kg',
      quantityKg: totalRemoved,
      costPerKg: avgCostPerKg,
      totalLossAmount: 0,
      reason,
      actionTaken,
      salvageRecoveryAmount: salvageRecoveryAmount,
      entryDate: new Date().toISOString().split('T')[0],
      notes,
      createdBy: userId
    }, { transaction: dbTx });

    // --- 3. Post to the append-only ledger (double-entry) ---
    // Bill-scoped entries hang off the bill itself ('PurchaseReturn') so a full
    // bill re-post keeps them (returns are re-applied to the rebuilt lots),
    // while deleting the bill reverses them. Unscoped API returns keep the
    // original WastageEntry reference.
    const ledgerRefType = scopedPurchaseId ? 'PurchaseReturn' : 'WastageEntry';
    const ledgerRefId = scopedPurchaseId || wastage.id;

    // The returned stock leaves the warehouse: CREDIT INVENTORY_ASSET
    await LedgerService.postEntry({
      branchId,
      branchCode,
      type: 'PURCHASE',
      referenceType: ledgerRefType,
      referenceId: ledgerRefId,
      referenceNumber: referenceNumber || entryNumber,
      partyType: 'INTERNAL',
      accountType: 'INVENTORY_ASSET',
      debitAmount: 0,
      creditAmount: landedValueRemoved,
      notes: `Return to supplier for ${removalNotes.join('; ') || `${totalRemoved} kg`} (reason: ${reason}), movementType: RETURN_OUT`,
      createdBy: userId || 1
    }, dbTx);

    // DEBIT ACCOUNTS_PAYABLE: the cost of the returned goods is refunded to us
    // — what we owe the supplier goes down by the refund amount.
    const payableDelta = parseFloat((refundAmount !== null && refundAmount !== undefined
      ? parseFloat(refundAmount)
      : landedValueRemoved).toFixed(2));
    if (payableDelta > 0) {
      await LedgerService.postEntry({
        branchId,
        branchCode,
        type: 'PURCHASE',
        referenceType: ledgerRefType,
        referenceId: ledgerRefId,
        referenceNumber: referenceNumber || entryNumber,
        partyType: partyId ? 'SUPPLIER' : 'INTERNAL',
        partyId,
        partyName,
        accountType: 'ACCOUNTS_PAYABLE',
        debitAmount: payableDelta,
        creditAmount: 0,
        notes: `Refund on return of ${totalRemoved} kg to ${partyName || 'supplier'}${referenceNumber ? ` against bill ${referenceNumber}` : ''} (reason: ${reason})`,
        createdBy: userId || 1
      }, dbTx);
    }

    if (salvageRecoveryAmount > 0) {
      await LedgerService.postEntry({
        branchId,
        branchCode,
        type: 'PURCHASE',
        referenceType: ledgerRefType,
        referenceId: ledgerRefId,
        referenceNumber: referenceNumber || entryNumber,
        partyType: 'INTERNAL',
        accountType: 'CASH',
        debitAmount: salvageRecoveryAmount,
        creditAmount: 0,
        notes: `Salvage cash recovery from returned fruit`,
        createdBy: userId || 1
      }, dbTx);
    }

    return wastage;
  }
}

module.exports = StockService;
