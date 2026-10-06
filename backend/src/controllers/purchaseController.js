const { 
  Purchase, PurchaseItem, Supplier, CommissionAgent, Transporter, Item, Branch, Payment,
  StockBatch, StockMovement, StockTransfer, WastageEntry, SaleBatchAllocation, Transaction, sequelize 
} = require('../models');
const LedgerService = require('../services/ledgerService');
const StockService = require('../services/stockService');
const { generateSequence } = require('../services/invoiceService');
const { logAudit } = require('../middleware/audit');
const { backupDeletedRecord } = require('../services/backupService');

const getPurchases = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const { supplierId, startDate, endDate, paymentStatus, page = 1, limit = 50 } = req.query;

    const where = {};
    if (branchId) where.branchId = branchId;
    if (supplierId) where.supplierId = supplierId;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (startDate && endDate) {
      where.purchaseDate = { [sequelize.Sequelize.Op.between]: [startDate, endDate] };
    }

    const purchases = await Purchase.findAll({
      where,
      include: [
        { model: Supplier, as: 'supplier', attributes: ['id', 'name', 'phone'] },
        { model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] },
        { model: CommissionAgent, as: 'agent', attributes: ['id', 'name'] },
        { model: Transporter, as: 'transporter', attributes: ['id', 'name', 'vehicleNumber'] },
        { model: PurchaseItem, as: 'items', include: [{ model: Item, as: 'item' }] }
      ],
      order: [['id', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    });

    res.json({ success: true, purchases });
  } catch (err) {
    next(err);
  }
};

const getPurchaseById = async (req, res, next) => {
  try {
    const purchase = await Purchase.findByPk(req.params.id, {
      include: [
        { model: Supplier, as: 'supplier' },
        { model: Branch, as: 'branch' },
        { model: CommissionAgent, as: 'agent' },
        { model: Transporter, as: 'transporter' },
        { model: PurchaseItem, as: 'items', include: [{ model: Item, as: 'item' }] }
      ]
    });

    if (!purchase) {
      return res.status(404).json({ success: false, message: 'Purchase not found' });
    }

    // Branch isolation: non-owners may only view their own branch's bills
    if (req.user.role !== 'OWNER' && purchase.branchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Access denied: bill belongs to another branch.' });
    }

    res.json({ success: true, purchase });
  } catch (err) {
    next(err);
  }
};

const createPurchase = async (req, res, next) => {
  const dbTx = await sequelize.transaction();
  try {
    const {
      branchId,
      supplierId,
      supplierInvoiceNumber,
      hasAgent = false,
      agentId = null,
      agentCommissionRate = 0,
      transporterId = null,
      vehicleNumber = '',
      freightCharges = 0,
      loadingCharges = 0,
      otherCharges = 0,
      items, // Array: [{ itemId, billedQuantity, receivedQuantity, unit, conversionFactor, ratePerUnit, discountAmount }]
      totalBilledWeight = 0,
      totalReceivedWeight = 0,
      weightVarianceReason = '',
      paymentMode = 'CREDIT',
      paidAmount = 0,
      purchaseDate,
      notes = ''
    } = req.body;

    const targetBranchId = req.user.role === 'OWNER' ? (branchId || req.user.branchId || 1) : req.user.branchId;
    const branch = await Branch.findByPk(targetBranchId, { transaction: dbTx });
    if (!branch) throw new Error('Branch not found');

    const supplier = await Supplier.findByPk(supplierId, { transaction: dbTx });
    if (!supplier) throw new Error('Supplier not found');

    // Party isolation: a branch can only buy from its own suppliers
    if (req.user.role !== 'OWNER' && supplier.branchId && supplier.branchId !== targetBranchId) {
      throw new Error(`Access denied: supplier "${supplier.name}" belongs to another branch.`);
    }

    if (!items || !items.length) {
      throw new Error('Purchase must contain at least one fruit item');
    }

    // 1. Calculate items subtotal and total weight.
    // Lines carry a single BILLED quantity; the ACTUAL received weight comes
    // from the weighbridge reconciliation section (totalReceivedWeight).
    // Payable is billed qty × rate; FIFO stock is created from the weighbridge
    // weight distributed proportionately across lines.
    let grossItemsSubtotal = 0;
    let totalLineDiscount = 0;
    let computedBilledWeightKg = 0;

    for (const line of items) {
      const conv = parseFloat(line.conversionFactor) || 1;
      const billedQty = parseFloat(line.billedQuantity ?? line.receivedQuantity);
      const rate = parseFloat(line.ratePerUnit);
      const disc = parseFloat(line.discountAmount) || 0;

      grossItemsSubtotal += (billedQty * rate);
      totalLineDiscount += disc;
      computedBilledWeightKg += (billedQty * conv);
    }

    const itemsNetSubtotal = parseFloat((grossItemsSubtotal - totalLineDiscount).toFixed(2));
    const numFreight = parseFloat(freightCharges) || 0;
    const numLoading = parseFloat(loadingCharges) || 0;
    const numOther = parseFloat(otherCharges) || 0;

    // Commission calculation
    let numCommission = 0;
    if (hasAgent && agentId) {
      const commRate = parseFloat(agentCommissionRate) || 0;
      numCommission = parseFloat(((itemsNetSubtotal * commRate) / 100).toFixed(2));
    }

    // Weight variance calculation: billed vs weighbridge received
    const billedWt = parseFloat(totalBilledWeight) || computedBilledWeightKg;
    const receivedWt = parseFloat(totalReceivedWeight) || computedBilledWeightKg;
    const weightDiff = parseFloat(Math.max(0, billedWt - receivedWt).toFixed(2));

    // Proportionate scale so FIFO batches always match the weighbridge reality:
    // e.g. billed 900 kg but weighbridge says 890 kg → batches get 98.89% of
    // each line's billed weight (totals exactly 890 kg). No phantom stock.
    const weightScale = computedBilledWeightKg > 0 && receivedWt > 0
      ? (receivedWt / computedBilledWeightKg)
      : 1;

    // Calculate approximate weight variance loss
    let weightLossAmount = 0;
    if (weightDiff > 0 && billedWt > 0) {
      const avgRatePerKg = itemsNetSubtotal / billedWt;
      weightLossAmount = parseFloat((weightDiff * avgRatePerKg).toFixed(2));
    }

    // Total bill amount for this entry = fruit cost + transportation & other
    // landed charges (freight, loading, other, agent commission), e.g.
    // fruit Rs 1,000 + transport Rs 500 -> bill total Rs 1,500.
    const totalPayableToSupplier = parseFloat(
      (itemsNetSubtotal + numFreight + numLoading + numOther + numCommission).toFixed(2)
    );

    const invoiceNumber = await generateSequence('PB', branch.code, dbTx);
    const numPaid = parseFloat(paidAmount) || 0;
    if (numPaid > totalPayableToSupplier) {
      throw new Error(`Paid amount (Rs ${numPaid.toFixed(2)}) cannot exceed the bill total (Rs ${totalPayableToSupplier.toFixed(2)})`);
    }
    const numDue = parseFloat((totalPayableToSupplier - numPaid).toFixed(2));
    const paymentStatus = numDue <= 0 ? 'PAID' : (numPaid > 0 ? 'PARTIAL' : 'PENDING');

    // 2. Create Purchase record
    const purchase = await Purchase.create({
      invoiceNumber,
      supplierInvoiceNumber,
      branchId: targetBranchId,
      supplierId,
      hasAgent: !!hasAgent,
      agentId: hasAgent ? agentId : null,
      agentCommissionRate: hasAgent ? parseFloat(agentCommissionRate) : 0,
      agentCommissionAmount: numCommission,
      transporterId: transporterId || null,
      vehicleNumber,
      freightCharges: numFreight,
      loadingCharges: numLoading,
      otherCharges: numOther,
      totalBilledWeight: billedWt,
      totalReceivedWeight: receivedWt,
      weightVariance: weightDiff,
      weightVarianceReason: weightDiff > 0 ? weightVarianceReason : null,
      weightVarianceLossAmount: weightLossAmount,
      subtotal: itemsNetSubtotal,
      discountAmount: totalLineDiscount,
      totalAmount: totalPayableToSupplier,
      paidAmount: numPaid,
      dueAmount: Math.max(0, numDue),
      paymentStatus,
      paymentMode,
      purchaseDate: purchaseDate || new Date().toISOString().split('T')[0],
      notes,
      createdBy: req.user.id
    }, { transaction: dbTx });

    // 3. Create line items and FIFO batches
    const totalAdditionalCost = numFreight + numLoading + numOther + numCommission;

    for (const line of items) {
      const itm = await Item.findByPk(line.itemId, { transaction: dbTx });
      const conv = parseFloat(line.conversionFactor) || (itm ? parseFloat(itm.unitConversionFactor) : 1);
      const billedQ = parseFloat(line.billedQuantity ?? line.receivedQuantity);
      const rate = parseFloat(line.ratePerUnit);
      const disc = parseFloat(line.discountAmount) || 0;
      const sub = parseFloat((billedQ * rate - disc).toFixed(2));

      // Billed weight for this line, scaled to the weighbridge received weight
      const lineBilledWeightKg = billedQ * conv;
      const lineWeightKg = parseFloat((lineBilledWeightKg * weightScale).toFixed(2));

      // Weight-proportionate allocation of freight & commission
      const weightShare = receivedWt > 0 ? (lineWeightKg / receivedWt) : 0;
      const allocFreight = parseFloat((numFreight * weightShare).toFixed(2));
      const allocComm = parseFloat((numCommission * weightShare).toFixed(2));
      const allocOther = parseFloat(((numLoading + numOther) * weightShare).toFixed(2));

      const landedTotal = parseFloat((sub + allocFreight + allocComm + allocOther).toFixed(2));
      const landedPerKg = lineWeightKg > 0 ? parseFloat((landedTotal / lineWeightKg).toFixed(2)) : rate;

      // Create Stock Batch for this fruit line
      const stockBatch = await StockService.createPurchaseBatch({
        branchId: targetBranchId,
        branchCode: branch.code,
        itemId: line.itemId,
        purchaseId: purchase.id,
        receivedWeightKg: lineWeightKg,
        unit: 'kg',
        purchaseRate: rate,
        landedCostPerKg: landedPerKg,
        receivedDate: purchaseDate,
        shelfLifeDays: itm?.shelfLifeDays || 14,
        referenceNumber: invoiceNumber
      }, dbTx);

      await PurchaseItem.create({
        purchaseId: purchase.id,
        itemId: line.itemId,
        billedQuantity: billedQ,
        receivedQuantity: billedQ,
        unit: line.unit || 'crate',
        conversionFactor: conv,
        receivedWeightKg: lineWeightKg,
        ratePerUnit: rate,
        discountAmount: disc,
        subtotal: sub,
        allocatedFreight: allocFreight,
        allocatedCommission: allocComm,
        allocatedOtherCharges: allocOther,
        landedCostTotal: landedTotal,
        landedCostPerKg: landedPerKg,
        batchId: stockBatch.id
      }, { transaction: dbTx });
    }

    // 4. Append-Only Ledger Postings (IMMUTABLE)
    // Credit Supplier (Accounts Payable for the full bill: fruit cost +
    // transportation & other landed charges)
    await LedgerService.postEntry({
      branchId: targetBranchId,
      branchCode: branch.code,
      type: 'PURCHASE',
      referenceType: 'Purchase',
      referenceId: purchase.id,
      referenceNumber: invoiceNumber,
      partyType: 'SUPPLIER',
      partyId: supplier.id,
      partyName: supplier.name,
      accountType: 'ACCOUNTS_PAYABLE',
      debitAmount: 0,
      creditAmount: totalPayableToSupplier,
      notes: `Purchase Bill ${invoiceNumber} from ${supplier.name}`,
      createdBy: req.user.id
    }, dbTx);

    // If there was weight shrinkage / variance loss
    if (weightLossAmount > 0) {
      await LedgerService.postEntry({
        branchId: targetBranchId,
        branchCode: branch.code,
        type: 'WEIGHT_ADJUSTMENT',
        referenceType: 'Purchase',
        referenceId: purchase.id,
        referenceNumber: invoiceNumber,
        partyType: 'INTERNAL',
        accountType: 'WEIGHT_LOSS',
        debitAmount: weightLossAmount,
        creditAmount: 0,
        notes: `Weight variance loss (${weightDiff} kg) on Bill ${invoiceNumber}: ${weightVarianceReason}`,
        createdBy: req.user.id
      }, dbTx);
    }

    // If Commission Agent was involved
    if (numCommission > 0 && agentId) {
      const agent = await CommissionAgent.findByPk(agentId, { transaction: dbTx });
      await LedgerService.postEntry({
        branchId: targetBranchId,
        branchCode: branch.code,
        type: 'AGENT_COMMISSION',
        referenceType: 'Purchase',
        referenceId: purchase.id,
        referenceNumber: invoiceNumber,
        partyType: 'COMMISSION_AGENT',
        partyId: agent.id,
        partyName: agent.name,
        accountType: 'COMMISSION_EXPENSE',
        debitAmount: numCommission,
        creditAmount: 0,
        notes: `Agent commission payable on purchase ${invoiceNumber}`,
        createdBy: req.user.id
      }, dbTx);
    }

    // If immediate partial or full payment was made
    if (numPaid > 0) {
      const paySeq = await generateSequence('PAY', branch.code, dbTx);
      const paymentVoucher = await Payment.create({
        paymentNumber: paySeq,
        branchId: targetBranchId,
        voucherType: 'PAYMENT_SUPPLIER',
        partyType: 'SUPPLIER',
        partyId: supplier.id,
        amount: numPaid,
        paymentMode: paymentMode === 'CREDIT' ? 'CASH' : paymentMode,
        referenceType: 'Purchase',
        referenceId: purchase.id,
        paymentDate: purchaseDate || new Date().toISOString().split('T')[0],
        notes: `Initial payment for Purchase Bill ${invoiceNumber}`,
        createdBy: req.user.id
      }, { transaction: dbTx });

      // Ledger: Debit Accounts Payable (Supplier), Credit Cash/Bank
      await LedgerService.postEntry({
        branchId: targetBranchId,
        branchCode: branch.code,
        type: 'SUPPLIER_PAYMENT',
        referenceType: 'Payment',
        referenceId: paymentVoucher.id,
        referenceNumber: paySeq,
        partyType: 'SUPPLIER',
        partyId: supplier.id,
        partyName: supplier.name,
        accountType: 'ACCOUNTS_PAYABLE',
        debitAmount: numPaid,
        creditAmount: 0,
        notes: `Payment towards bill ${invoiceNumber}`,
        createdBy: req.user.id
      }, dbTx);

      await LedgerService.postEntry({
        branchId: targetBranchId,
        branchCode: branch.code,
        type: 'SUPPLIER_PAYMENT',
        referenceType: 'Payment',
        referenceId: paymentVoucher.id,
        referenceNumber: paySeq,
        partyType: 'SUPPLIER',
        partyId: supplier.id,
        partyName: supplier.name,
        accountType: paymentMode === 'BANK' ? 'BANK' : 'CASH',
        debitAmount: 0,
        creditAmount: numPaid,
        notes: `Disbursement for bill ${invoiceNumber}`,
        createdBy: req.user.id
      }, dbTx);
    }

    await dbTx.commit();

    // Log audit action
    await logAudit({
      req,
      action: 'CREATE_PURCHASE',
      entityName: 'Purchase',
      entityId: purchase.id,
      entityReference: invoiceNumber,
      afterState: { id: purchase.id, invoiceNumber, totalAmount: totalPayableToSupplier }
    });

    res.status(201).json({
      success: true,
      message: `Purchase bill ${invoiceNumber} created successfully`,
      purchase
    });
  } catch (err) {
    await dbTx.rollback();
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Defective-goods returns handled from the Edit Bill form.
//
// Every line carries a CUMULATIVE `returnedQuantity` (in the line's own unit,
// e.g. boxes). On save we compare the posted values against what is stored and
// process only the DELTA:
//   delta > 0 → stock leaves this bill's FIFO lots (RETURN_OUT movement) and
//               the cost is refunded — DEBIT supplier ACCOUNTS_PAYABLE so what
//               we owe the supplier goes down.
//   delta < 0 → stock comes back into this bill's lot (RETURN_IN movement) and
//               the earlier refund is reversed (CREDIT ACCOUNTS_PAYABLE).
//   delta = 0 → nothing to do.
//
// `stockMode`:
//   'full'  – after a full re-post (MODE 2): the lots were just rebuilt at
//             full quantity, so the TOTAL recorded return must be taken out
//             again (stored returns survive an edit).
//   'delta' – header-only edits (MODE 1): the lots already reflect previously
//             recorded returns, so only the delta is applied.
//
// Returns { lines, totalKg, refund, message } or null when nothing changed.
// ---------------------------------------------------------------------------
const applyPurchaseReturns = async ({ purchase, body, oldReturns, currentItems, stockMode, branch: branchArg, supplier: supplierArg }, dbTx, userId) => {
  if (!currentItems || !currentItems.length) return null;

  const rawReturns = Array.isArray(body.returns)
    ? body.returns
    : (Array.isArray(body.items) ? body.items.map(i => ({ itemId: i.itemId, quantity: i.returnedQuantity, reason: i.returnReason })) : []);
  const payloadByItem = new Map();
  for (const r of rawReturns) {
    if (!r || r.itemId === undefined || r.itemId === null) continue;
    const qty = parseFloat(r.quantity);
    if (isNaN(qty) || qty < 0) throw new Error('Return quantity must be zero or more on every line');
    const key = parseInt(r.itemId);
    payloadByItem.set(key, parseFloat(((payloadByItem.get(key) || 0) + qty).toFixed(2)));
  }

  // A bill can list the same fruit on two lines — returns are tracked per item.
  const linesByItem = new Map();
  for (const line of currentItems) {
    if (!linesByItem.has(line.itemId)) linesByItem.set(line.itemId, []);
    linesByItem.get(line.itemId).push(line);
  }

  const branch = branchArg || await Branch.findByPk(purchase.branchId, { transaction: dbTx });
  const supplier = supplierArg || await Supplier.findByPk(purchase.supplierId, { transaction: dbTx });
  if (!branch) throw new Error('Branch not found');
  if (!supplier) throw new Error('Supplier not found');

  const reason = String(body.returnReason || '').trim() || 'Defective fruit returned to supplier (Edit Bill)';

  const summary = { lines: [], totalKg: 0, refund: 0, message: '' };
  let outKg = 0, inKg = 0, outRefund = 0, inRefund = 0;

  for (const [itemId, lines] of linesByItem) {
    const billedTotal = lines.reduce((s, l) => s + parseFloat(l.billedQuantity || 0), 0);
    const netSubtotal = lines.reduce((s, l) => s + parseFloat(l.subtotal || 0), 0);
    const netUnitPrice = billedTotal > 0 ? netSubtotal / billedTotal : 0;

    const oldQty = parseFloat((oldReturns.get(itemId) || 0).toFixed(2));
    // Lines omitted from the payload keep their stored return.
    const newQty = payloadByItem.has(itemId)
      ? payloadByItem.get(itemId)
      : oldQty;

    if (newQty > billedTotal + 0.001) {
      const itmRow = await Item.findByPk(itemId, { attributes: ['id', 'name'], transaction: dbTx });
      const itemName = itmRow ? itmRow.name : `item #${itemId}`;
      throw new Error(`Return quantity (${newQty}) cannot exceed billed quantity (${billedTotal}) for ${itemName}`);
    }

    const conv = parseFloat(lines[0].conversionFactor || 1);
    const delta = parseFloat((newQty - oldQty).toFixed(2));
    const stockKg = parseFloat((delta * conv).toFixed(2));
    const refundDelta = parseFloat((delta * netUnitPrice).toFixed(2));

    // Persist the cumulative return on the line (first line holds the total).
    for (let i = 0; i < lines.length; i++) {
      const value = i === 0 ? newQty : 0;
      if (parseFloat(lines[i].returnedQuantity || 0) !== value) {
        lines[i].returnedQuantity = value;
        await lines[i].save({ transaction: dbTx });
      }
    }

    // --- Stock adjustment ---
    // 'full' mode: the rebuilt lot is at full quantity → take the TOTAL return
    // out again. 'delta' mode: the lot already reflects stored returns → apply
    // only the change.
    const removalKg = stockMode === 'full'
      ? parseFloat((newQty * conv).toFixed(2))
      : (delta > 0 ? stockKg : 0);

    if (removalKg > 0) {
      await StockService.purchaseReturn({
        branchId: purchase.branchId,
        branchCode: branch.code,
        itemId,
        quantityKg: removalKg,
        reason,
        actionTaken: 'Returned to supplier (defective goods)',
        referenceType: 'PurchaseReturn',
        referenceId: purchase.id,
        referenceNumber: purchase.invoiceNumber,
        purchaseId: purchase.id,
        supplierId: supplier.id,
        supplierName: supplier.name,
        refundAmount: refundDelta > 0 ? refundDelta : 0,
        notes: `Defective-goods return recorded on Edit Bill ${purchase.invoiceNumber}`,
        userId,
        dbTx
      });
    }

    if (delta < 0) {
      // Return was reduced/cancelled: the stock comes back into this bill's lot.
      // (In 'full' mode the rebuilt lot is already at full quantity — no-op.)
      if (stockMode === 'delta' && lines[0].batchId) {
        const batch = await StockBatch.findByPk(lines[0].batchId, {
          transaction: dbTx,
          lock: dbTx?.LOCK?.UPDATE || false
        });
        if (batch) {
          batch.currentQuantity = parseFloat((parseFloat(batch.currentQuantity || 0) + Math.abs(stockKg)).toFixed(2));
          if (batch.status === 'DEPLETED' && batch.currentQuantity > 0.001) batch.status = 'ACTIVE';
          await batch.save({ transaction: dbTx });

          await StockMovement.create({
            batchId: batch.id,
            branchId: purchase.branchId,
            itemId,
            movementType: 'RETURN_IN',
            quantity: Math.abs(stockKg),
            unit: 'kg',
            costPerUnit: parseFloat(batch.landedCostPerUnit || 0),
            referenceType: 'PurchaseReturn',
            referenceId: purchase.id,
            referenceNumber: purchase.invoiceNumber,
            notes: `Supplier return reduced on edit of bill ${purchase.invoiceNumber}`
          }, { transaction: dbTx });
        }
      }

      // Reverse the earlier refund so what we owe the supplier goes back up.
      const reversalAmt = Math.abs(refundDelta);
      if (reversalAmt >= 0.01) {
        await LedgerService.postEntry({
          branchId: purchase.branchId,
          branchCode: branch.code,
          type: 'PURCHASE',
          referenceType: 'PurchaseReturn',
          referenceId: purchase.id,
          referenceNumber: purchase.invoiceNumber,
          partyType: 'SUPPLIER',
          partyId: supplier.id,
          partyName: supplier.name,
          accountType: 'ACCOUNTS_PAYABLE',
          debitAmount: 0,
          creditAmount: reversalAmt,
          notes: `Supplier return reduced by ${Math.abs(delta)} unit(s) on edit of bill ${purchase.invoiceNumber} — refund of Rs ${reversalAmt.toFixed(2)} reversed`,
          createdBy: userId
        }, dbTx);
      }
    }

    if (Math.abs(delta) > 0.001) {
      const itmRow = await Item.findByPk(itemId, { attributes: ['id', 'name'], transaction: dbTx });
      summary.lines.push({
        itemId,
        itemName: itmRow ? itmRow.name : `#${itemId}`,
        previousQty: oldQty,
        returnedQty: newQty,
        quantityKg: Math.abs(stockKg),
        refund: refundDelta
      });
      summary.totalKg = parseFloat((summary.totalKg + Math.abs(stockKg)).toFixed(2));
      summary.refund = parseFloat((summary.refund + refundDelta).toFixed(2));
      if (stockKg > 0) outKg = parseFloat((outKg + stockKg).toFixed(2));
      if (stockKg < 0) inKg = parseFloat((inKg + Math.abs(stockKg)).toFixed(2));
      if (refundDelta > 0) outRefund = parseFloat((outRefund + refundDelta).toFixed(2));
      if (refundDelta < 0) inRefund = parseFloat((inRefund + Math.abs(refundDelta)).toFixed(2));
    }
  }

  if (!summary.lines.length) return null;

  const parts = [];
  if (outKg > 0) parts.push(`${outKg} kg returned to supplier — refund of Rs ${outRefund.toFixed(2)} recorded`);
  if (inKg > 0) parts.push(`${inKg} kg return reduced — Rs ${inRefund.toFixed(2)} added back to the payable`);
  summary.message = parts.join('; ');
  return summary;
};

const updatePurchase = async (req, res, next) => {
  const dbTx = await sequelize.transaction();
  try {
    const purchase = await Purchase.findByPk(req.params.id, {
      include: [{ model: PurchaseItem, as: 'items' }],
      transaction: dbTx,
      lock: dbTx.LOCK.UPDATE
    });
    if (!purchase) {
      await dbTx.rollback();
      return res.status(404).json({ success: false, message: 'Purchase bill not found' });
    }
    if (req.user.role !== 'OWNER' && purchase.branchId !== req.user.branchId) {
      await dbTx.rollback();
      return res.status(403).json({ success: false, message: 'Access denied: bill belongs to another branch.' });
    }

    const body = req.body;
    const fullEdit = Array.isArray(body.items) && body.items.length > 0;

    // Cumulative defective-goods returns already recorded on the lines —
    // captured before any teardown so both edit modes can process the delta.
    const oldReturns = new Map();
    for (const it of purchase.items || []) {
      oldReturns.set(
        it.itemId,
        parseFloat((parseFloat(oldReturns.get(it.itemId) || 0) + parseFloat(it.returnedQuantity || 0)).toFixed(2))
      );
    }

    // ------------------------------------------------------------------
    // MODE 1: Header-only correction (charges, challan, vehicle, notes).
    // Safe on bills with payments — quantities, rates and FIFO batches stay
    // untouched. Transportation & other landed charges ARE part of the bill
    // total, so they re-derive total / due / status (and the payable ledger).
    // ------------------------------------------------------------------
    if (!fullEdit) {
      const {
        supplierInvoiceNumber,
        purchaseDate,
        vehicleNumber = '',
        freightCharges,
        loadingCharges,
        otherCharges,
        weightVarianceReason,
        notes,
        paidAmount,   // optional NEW advance ("Paid Now - New Advance")
        paymentMode
      } = body;

      // Editable header fields only. Supplier, quantities and rates are NOT editable
      // in this mode (landed costs & FIFO batches are derived from them).
      if (supplierInvoiceNumber !== undefined) purchase.supplierInvoiceNumber = supplierInvoiceNumber;
      if (purchaseDate) purchase.purchaseDate = purchaseDate;
      purchase.vehicleNumber = vehicleNumber;
      const oldTotal = parseFloat(purchase.totalAmount) || 0;
      if (freightCharges !== undefined) purchase.freightCharges = parseFloat(freightCharges) || 0;
      if (loadingCharges !== undefined) purchase.loadingCharges = parseFloat(loadingCharges) || 0;
      if (otherCharges !== undefined) purchase.otherCharges = parseFloat(otherCharges) || 0;
      if (weightVarianceReason !== undefined) purchase.weightVarianceReason = weightVarianceReason;
      if (notes !== undefined) purchase.notes = notes;

      // Bill total = fruit cost + transportation & other landed charges
      // (mirrors createPurchase), so a charge correction updates the total.
      const correctedTotal = parseFloat((
        parseFloat(purchase.subtotal || 0) +
        parseFloat(purchase.freightCharges || 0) +
        parseFloat(purchase.loadingCharges || 0) +
        parseFloat(purchase.otherCharges || 0) +
        parseFloat(purchase.agentCommissionAmount || 0)
      ).toFixed(2));
      // Optional NEW advance payment recorded with this correction ("Paid Now -
      // New Advance" in the edit modal). Recorded payments are preserved; the
      // advance is added on top and validated against the bill total, so a
      // partially paid bill (e.g. balance Rs 500) can be settled here.
      const recordedPaid = parseFloat(purchase.paidAmount) || 0;
      const newAdvance = paidAmount !== undefined ? (parseFloat(paidAmount) || 0) : 0;
      const newPaid = parseFloat((recordedPaid + newAdvance).toFixed(2));
      if (newAdvance > 0 && newPaid > correctedTotal) {
        throw new Error(
          `Total paid (Rs ${newPaid.toFixed(2)} = Rs ${recordedPaid.toFixed(2)} on record + Rs ${newAdvance.toFixed(2)} new) cannot exceed the bill total (Rs ${correctedTotal.toFixed(2)})`
        );
      }
      const paidFinal = newAdvance > 0 ? newPaid : recordedPaid;
      const correctedDue = Math.max(0, parseFloat((correctedTotal - paidFinal).toFixed(2)));
      purchase.totalAmount = correctedTotal;
      purchase.paidAmount = paidFinal;
      purchase.dueAmount = correctedDue;
      purchase.paymentStatus = correctedDue <= 0 ? 'PAID' : (paidFinal > 0 ? 'PARTIAL' : 'PENDING');
      await purchase.save({ transaction: dbTx });

      // Keep the append-only payable ledger in sync with the corrected total.
      const totalDelta = parseFloat((correctedTotal - oldTotal).toFixed(2));
      if (Math.abs(totalDelta) >= 0.01) {
        const chargeSupplier = await Supplier.findByPk(purchase.supplierId, { transaction: dbTx });
        const chargeBranch = await Branch.findByPk(purchase.branchId, { transaction: dbTx });
        await LedgerService.postEntry({
          branchId: purchase.branchId,
          branchCode: chargeBranch ? chargeBranch.code : 'DEL',
          type: 'PURCHASE',
          referenceType: 'Purchase',
          referenceId: purchase.id,
          referenceNumber: purchase.invoiceNumber,
          partyType: 'SUPPLIER',
          partyId: purchase.supplierId,
          partyName: chargeSupplier ? chargeSupplier.name : null,
          accountType: 'ACCOUNTS_PAYABLE',
          debitAmount: totalDelta < 0 ? Math.abs(totalDelta) : 0,
          creditAmount: totalDelta > 0 ? totalDelta : 0,
          notes: `Charge correction on Bill ${purchase.invoiceNumber} (transportation / landed charges)`,
          createdBy: req.user.id
        }, dbTx);
      }

      // Post the advance as a real payment voucher + double-entry ledger
      // (mirrors createPurchase / full re-post), inside the same transaction.
      if (newAdvance > 0) {
        const payBranch = await Branch.findByPk(purchase.branchId, { transaction: dbTx });
        const paySupplier = await Supplier.findByPk(purchase.supplierId, { transaction: dbTx });
        const paySeq = await generateSequence('PAY', payBranch ? payBranch.code : 'DEL', dbTx);
        const effectiveMode = paymentMode || purchase.paymentMode || 'CREDIT';
        const payMode = effectiveMode === 'CREDIT' ? 'CASH' : effectiveMode;

        const paymentVoucher = await Payment.create({
          paymentNumber: paySeq,
          branchId: purchase.branchId,
          voucherType: 'PAYMENT_SUPPLIER',
          partyType: 'SUPPLIER',
          partyId: purchase.supplierId,
          amount: newAdvance,
          paymentMode: payMode,
          referenceType: 'Purchase',
          referenceId: purchase.id,
          paymentDate: purchase.purchaseDate,
          notes: `Advance payment for Purchase Bill ${purchase.invoiceNumber}`,
          createdBy: req.user.id
        }, { transaction: dbTx });

        await LedgerService.postEntry({
          branchId: purchase.branchId,
          branchCode: payBranch ? payBranch.code : 'DEL',
          type: 'SUPPLIER_PAYMENT',
          referenceType: 'Payment',
          referenceId: paymentVoucher.id,
          referenceNumber: paySeq,
          partyType: 'SUPPLIER',
          partyId: purchase.supplierId,
          partyName: paySupplier ? paySupplier.name : null,
          accountType: 'ACCOUNTS_PAYABLE',
          debitAmount: newAdvance,
          creditAmount: 0,
          notes: `Payment towards bill ${purchase.invoiceNumber}`,
          createdBy: req.user.id
        }, dbTx);

        await LedgerService.postEntry({
          branchId: purchase.branchId,
          branchCode: payBranch ? payBranch.code : 'DEL',
          type: 'SUPPLIER_PAYMENT',
          referenceType: 'Payment',
          referenceId: paymentVoucher.id,
          referenceNumber: paySeq,
          partyType: 'SUPPLIER',
          partyId: purchase.supplierId,
          partyName: paySupplier ? paySupplier.name : null,
          accountType: payMode === 'BANK' ? 'BANK' : 'CASH',
          debitAmount: 0,
          creditAmount: newAdvance,
          notes: `Disbursement for bill ${purchase.invoiceNumber}`,
          createdBy: req.user.id
        }, dbTx);
      }      // Defective-goods returns recorded in the modal — allowed even when the
      // line items are locked because this bill already has payments.
      const returnSummary = await applyPurchaseReturns(
        { purchase, body, oldReturns, currentItems: purchase.items, stockMode: 'delta' },
        dbTx,
        req.user.id
      );

      await dbTx.commit();

      await logAudit({
        req,
        action: 'UPDATE_PURCHASE',
        entityName: 'Purchase',
        entityId: purchase.id,
        entityReference: purchase.invoiceNumber,
        afterState: {
          freightCharges: purchase.freightCharges,
          loadingCharges: purchase.loadingCharges,
          otherCharges: purchase.otherCharges,
          paidAmount: purchase.paidAmount,
          dueAmount: purchase.dueAmount,
          paymentStatus: purchase.paymentStatus,
          returns: returnSummary ? returnSummary.lines : []
        }
      });

      return res.json({
        success: true,
        message: `Bill ${purchase.invoiceNumber} updated${newAdvance > 0 ? ` - Rs ${newAdvance.toFixed(2)} advance recorded (balance Rs ${correctedDue.toFixed(2)})` : ''}${returnSummary ? `. ${returnSummary.message}` : ''}. Note: landed cost/FIFO batches keep the original posted charges.`,
        purchase
      });
    }

    // ------------------------------------------------------------------
    // MODE 2: Full re-post (supplier, date, items, quantities, rates...).
    // The bill is atomically torn down and re-posted: ledger entries are
    // reversed, FIFO batches removed, items recreated and everything
    // re-posted — mirroring createPurchase inside a single transaction.
    // Recorded payment vouchers stay untouched (they are real money
    // movements); only the bill's own payable is recalculated.
    // Stock must still be unconsumed (no sales/wastage/transfers).
    // ------------------------------------------------------------------

    // Block the re-post once any of the bill's stock has been consumed by a
    // sale, wastage or transfer — undoing FIFO deductions downstream is not reliable.
    const oldBatchIds = purchase.items.map(i => i.batchId).filter(Boolean);
    const consumed = await SaleBatchAllocation.count({ where: { stockBatchId: oldBatchIds }, transaction: dbTx });
    const transferUsed = await StockTransfer.count({ where: { sourceBatchId: oldBatchIds }, transaction: dbTx });
    const wastageUsed = await WastageEntry.count({ where: { stockBatchId: oldBatchIds }, transaction: dbTx });
    if (consumed > 0 || transferUsed > 0 || wastageUsed > 0) {
      await dbTx.rollback();
      return res.status(400).json({
        success: false,
        message: 'Cannot fully edit: stock from this bill has already been sold/written-off/transferred. Delete those transactions first.'
      });
    }

    const {
      supplierId,
      supplierInvoiceNumber,
      hasAgent = false,
      agentId = null,
      agentCommissionRate = 0,
      transporterId = null,
      vehicleNumber = '',
      freightCharges = 0,
      loadingCharges = 0,
      otherCharges = 0,
      items,
      totalBilledWeight = 0,
      totalReceivedWeight = 0,
      weightVarianceReason = '',
      paymentMode,
      paidAmount,
      purchaseDate,
      notes
    } = body;

    const branch = await Branch.findByPk(purchase.branchId, { transaction: dbTx });
    if (!branch) throw new Error('Branch not found');

    const supplier = await Supplier.findByPk(supplierId || purchase.supplierId, { transaction: dbTx });
    if (!supplier) throw new Error('Supplier not found');

    let agent = null;
    if (hasAgent) {
      agent = await CommissionAgent.findByPk(agentId, { transaction: dbTx });
      if (!agent) throw new Error('Commission agent not found');
    }

    // 1. Recalculate items subtotal and total weight (mirrors createPurchase).
    // Lines carry a single BILLED quantity; actual received weight comes from
    // the weighbridge section (totalReceivedWeight).
    let grossItemsSubtotal = 0;
    let totalLineDiscount = 0;
    let computedBilledWeightKg = 0;

    for (const line of items) {
      const billedQty = parseFloat(line.billedQuantity ?? line.receivedQuantity);
      const rate = parseFloat(line.ratePerUnit);
      if (!billedQty || billedQty <= 0) throw new Error('Billed quantity must be greater than zero on every line');
      if (isNaN(rate) || rate < 0) throw new Error('Rate per unit must be zero or more on every line');
      const conv = parseFloat(line.conversionFactor) || 1;
      grossItemsSubtotal += billedQty * rate;
      totalLineDiscount += parseFloat(line.discountAmount) || 0;
      computedBilledWeightKg += billedQty * conv;
    }

    const itemsNetSubtotal = parseFloat((grossItemsSubtotal - totalLineDiscount).toFixed(2));
    const numFreight = parseFloat(freightCharges) || 0;
    const numLoading = parseFloat(loadingCharges) || 0;
    const numOther = parseFloat(otherCharges) || 0;

    let numCommission = 0;
    if (hasAgent && agent) {
      const commRate = parseFloat(agentCommissionRate) || 0;
      numCommission = parseFloat(((itemsNetSubtotal * commRate) / 100).toFixed(2));
    }

    const billedWt = parseFloat(totalBilledWeight) || computedBilledWeightKg;
    const receivedWt = parseFloat(totalReceivedWeight) || computedBilledWeightKg;
    const weightDiff = parseFloat(Math.max(0, billedWt - receivedWt).toFixed(2));

    let weightLossAmount = 0;
    if (weightDiff > 0 && billedWt > 0) {
      const avgRatePerKg = itemsNetSubtotal / billedWt;
      weightLossAmount = parseFloat((weightDiff * avgRatePerKg).toFixed(2));
    }

    // Bill total = fruit cost + transportation & other landed charges
    // (mirrors createPurchase), e.g. fruit Rs 1,000 + transport Rs 500 -> Rs 1,500.
    const totalPayableToSupplier = parseFloat(
      (itemsNetSubtotal + numFreight + numLoading + numOther + numCommission).toFixed(2)
    );

    // Recorded payments are preserved: existing vouchers are NOT reversed or
    // deleted. `paidAmount` from the client only represents any NEW advance
    // payment entered alongside the edit, added on top of what's on record.
    const recordedPaid = await Payment.sum('amount', {
      where: { referenceType: 'Purchase', referenceId: purchase.id }
    }) || 0;
    const newAdvance = paidAmount !== undefined ? (parseFloat(paidAmount) || 0) : 0;
    const newPaid = parseFloat((recordedPaid + newAdvance).toFixed(2));
    if (newPaid > totalPayableToSupplier) {
      throw new Error(`Total paid (Rs ${newPaid.toFixed(2)} = Rs ${parseFloat(recordedPaid).toFixed(2)} on record + Rs ${newAdvance.toFixed(2)} new) cannot exceed the bill total (Rs ${totalPayableToSupplier.toFixed(2)})`);
    }
    const newDue = parseFloat((totalPayableToSupplier - newPaid).toFixed(2));
    const newStatus = newDue <= 0 ? 'PAID' : (newPaid > 0 ? 'PARTIAL' : 'PENDING');

    // Capture before-state for audit
    const beforeState = {
      supplierId: purchase.supplierId,
      purchaseDate: purchase.purchaseDate,
      totalAmount: purchase.totalAmount,
      items: purchase.items.map(i => ({ itemId: i.itemId, receivedQuantity: i.receivedQuantity, ratePerUnit: i.ratePerUnit }))
    };

    // 2. Reverse all ledger entries tied to this bill
    const ledgerEntries = await Transaction.findAll({
      where: { referenceType: 'Purchase', referenceId: purchase.id, isReversed: false },
      transaction: dbTx
    });
    for (const entry of ledgerEntries) {
      await LedgerService.reverseTransaction(entry.id, `Purchase bill ${purchase.invoiceNumber} fully edited & re-posted`, req.user.id, dbTx);
    }

    // 3. Remove old FIFO batches + their movements, then old line items
    for (const item of purchase.items) {
      if (item.batchId) {
        await StockMovement.destroy({ where: { batchId: item.batchId }, transaction: dbTx });
        await StockBatch.destroy({ where: { id: item.batchId }, transaction: dbTx });
      }
    }
    await PurchaseItem.destroy({ where: { purchaseId: purchase.id }, transaction: dbTx });

    // 4. Rewrite the purchase header in place (same invoiceNumber is kept)
    purchase.supplierId = supplier.id;
    if (supplierInvoiceNumber !== undefined) purchase.supplierInvoiceNumber = supplierInvoiceNumber;
    purchase.hasAgent = !!hasAgent;
    purchase.agentId = hasAgent ? agent.id : null;
    purchase.agentCommissionRate = hasAgent ? (parseFloat(agentCommissionRate) || 0) : 0;
    purchase.agentCommissionAmount = numCommission;
    purchase.transporterId = transporterId || null;
    purchase.vehicleNumber = vehicleNumber;
    purchase.freightCharges = numFreight;
    purchase.loadingCharges = numLoading;
    purchase.otherCharges = numOther;
    purchase.totalBilledWeight = billedWt;
    purchase.totalReceivedWeight = receivedWt;
    purchase.weightVariance = weightDiff;
    purchase.weightVarianceReason = weightDiff > 0 ? weightVarianceReason : null;
    purchase.weightVarianceLossAmount = weightLossAmount;
    purchase.subtotal = itemsNetSubtotal;
    purchase.discountAmount = totalLineDiscount;
    purchase.totalAmount = totalPayableToSupplier;
    purchase.paidAmount = newPaid;
    purchase.dueAmount = Math.max(0, newDue);
    purchase.paymentStatus = newStatus;
    // NOTE: existing Payment vouchers & their ledger entries are intentionally
    // left intact — only bill-derived entries (payable, weight loss, commission)
    // were reversed above and are re-posted below without a payment component.
    if (paymentMode) purchase.paymentMode = paymentMode;
    if (purchaseDate) purchase.purchaseDate = purchaseDate;
    if (notes !== undefined) purchase.notes = notes;
    await purchase.save({ transaction: dbTx });

    // 5. Recreate line items and FIFO batches (mirrors createPurchase).
    // FIFO batches are built from the weighbridge received weight scaled
    // proportionately per line — matching the create path.
    const weightScale = computedBilledWeightKg > 0 && receivedWt > 0
      ? (receivedWt / computedBilledWeightKg)
      : 1;

    for (const line of items) {
      const itm = await Item.findByPk(line.itemId, { transaction: dbTx });
      if (!itm) throw new Error(`Fruit item not found (id ${line.itemId})`);
      const conv = parseFloat(line.conversionFactor) || (itm ? parseFloat(itm.unitConversionFactor) : 1);
      const billedQ = parseFloat(line.billedQuantity) || parseFloat(line.receivedQuantity);
      const rate = parseFloat(line.ratePerUnit);
      const disc = parseFloat(line.discountAmount) || 0;
      const sub = parseFloat((billedQ * rate - disc).toFixed(2));

      const lineWeightKg = parseFloat(((billedQ * conv) * weightScale).toFixed(2));

      const weightShare = receivedWt > 0 ? (lineWeightKg / receivedWt) : 0;
      const allocFreight = parseFloat((numFreight * weightShare).toFixed(2));
      const allocComm = parseFloat((numCommission * weightShare).toFixed(2));
      const allocOther = parseFloat(((numLoading + numOther) * weightShare).toFixed(2));

      const landedTotal = parseFloat((sub + allocFreight + allocComm + allocOther).toFixed(2));
      const landedPerKg = lineWeightKg > 0 ? parseFloat((landedTotal / lineWeightKg).toFixed(2)) : rate;

      const stockBatch = await StockService.createPurchaseBatch({
        branchId: purchase.branchId,
        branchCode: branch.code,
        itemId: line.itemId,
        purchaseId: purchase.id,
        receivedWeightKg: lineWeightKg,
        unit: 'kg',
        purchaseRate: rate,
        landedCostPerKg: landedPerKg,
        receivedDate: purchase.purchaseDate,
        shelfLifeDays: itm?.shelfLifeDays || 14,
        referenceNumber: purchase.invoiceNumber
      }, dbTx);

      await PurchaseItem.create({
        purchaseId: purchase.id,
        itemId: line.itemId,
        billedQuantity: billedQ,
        receivedQuantity: billedQ,
        unit: line.unit || 'crate',
        conversionFactor: conv,
        receivedWeightKg: lineWeightKg,
        ratePerUnit: rate,
        discountAmount: disc,
        subtotal: sub,
        allocatedFreight: allocFreight,
        allocatedCommission: allocComm,
        allocatedOtherCharges: allocOther,
        landedCostTotal: landedTotal,
        landedCostPerKg: landedPerKg,
        batchId: stockBatch.id
      }, { transaction: dbTx });
    }

    // 6. Re-post append-only ledger entries (mirrors createPurchase)
    await LedgerService.postEntry({
      branchId: purchase.branchId,
      branchCode: branch.code,
      type: 'PURCHASE',
      referenceType: 'Purchase',
      referenceId: purchase.id,
      referenceNumber: purchase.invoiceNumber,
      partyType: 'SUPPLIER',
      partyId: supplier.id,
      partyName: supplier.name,
      accountType: 'ACCOUNTS_PAYABLE',
      debitAmount: 0,
      creditAmount: totalPayableToSupplier,
      notes: `Purchase Bill ${purchase.invoiceNumber} from ${supplier.name} (edited re-post)`,
      createdBy: req.user.id
    }, dbTx);

    if (weightLossAmount > 0) {
      await LedgerService.postEntry({
        branchId: purchase.branchId,
        branchCode: branch.code,
        type: 'WEIGHT_ADJUSTMENT',
        referenceType: 'Purchase',
        referenceId: purchase.id,
        referenceNumber: purchase.invoiceNumber,
        partyType: 'INTERNAL',
        accountType: 'WEIGHT_LOSS',
        debitAmount: weightLossAmount,
        creditAmount: 0,
        notes: `Weight variance loss (${weightDiff} kg) on edited Bill ${purchase.invoiceNumber}: ${weightVarianceReason}`,
        createdBy: req.user.id
      }, dbTx);
    }

    if (numCommission > 0 && agent) {
      await LedgerService.postEntry({
        branchId: purchase.branchId,
        branchCode: branch.code,
        type: 'AGENT_COMMISSION',
        referenceType: 'Purchase',
        referenceId: purchase.id,
        referenceNumber: purchase.invoiceNumber,
        partyType: 'COMMISSION_AGENT',
        partyId: agent.id,
        partyName: agent.name,
        accountType: 'COMMISSION_EXPENSE',
        debitAmount: numCommission,
        creditAmount: 0,
        notes: `Agent commission payable on edited purchase ${purchase.invoiceNumber}`,
        createdBy: req.user.id
      }, dbTx);
    }

    if (newAdvance > 0) {
      const paySeq = await generateSequence('PAY', branch.code, dbTx);
      const paymentVoucher = await Payment.create({
        paymentNumber: paySeq,
        branchId: purchase.branchId,
        voucherType: 'PAYMENT_SUPPLIER',
        partyType: 'SUPPLIER',
        partyId: supplier.id,
        amount: newAdvance,
        paymentMode: purchase.paymentMode === 'CREDIT' ? 'CASH' : purchase.paymentMode,
        referenceType: 'Purchase',
        referenceId: purchase.id,
        paymentDate: purchase.purchaseDate,
        notes: `Initial payment for edited Purchase Bill ${purchase.invoiceNumber}`,
        createdBy: req.user.id
      }, { transaction: dbTx });

      await LedgerService.postEntry({
        branchId: purchase.branchId,
        branchCode: branch.code,
        type: 'SUPPLIER_PAYMENT',
        referenceType: 'Payment',
        referenceId: paymentVoucher.id,
        referenceNumber: paySeq,
        partyType: 'SUPPLIER',
        partyId: supplier.id,
        partyName: supplier.name,
        accountType: 'ACCOUNTS_PAYABLE',
        debitAmount: newAdvance,
        creditAmount: 0,
        notes: `Payment towards edited bill ${purchase.invoiceNumber}`,
        createdBy: req.user.id
      }, dbTx);

      await LedgerService.postEntry({
        branchId: purchase.branchId,
        branchCode: branch.code,
        type: 'SUPPLIER_PAYMENT',
        referenceType: 'Payment',
        referenceId: paymentVoucher.id,
        referenceNumber: paySeq,
        partyType: 'SUPPLIER',
        partyId: supplier.id,
        partyName: supplier.name,
        accountType: purchase.paymentMode === 'BANK' ? 'BANK' : 'CASH',
        debitAmount: 0,
        creditAmount: newAdvance,
        notes: `Disbursement for edited bill ${purchase.invoiceNumber}`,
        createdBy: req.user.id
      }, dbTx);
    }

    // Defective-goods returns: the lots were just rebuilt at full quantity
    // above, so the cumulative returns recorded on the lines are taken out of
    // stock again (stored returns survive a full edit).
    const freshReturnItems = await PurchaseItem.findAll({
      where: { purchaseId: purchase.id },
      transaction: dbTx
    });
    const returnSummary = await applyPurchaseReturns(
      { purchase, body, oldReturns, currentItems: freshReturnItems, stockMode: 'full', branch, supplier },
      dbTx,
      req.user.id
    );

    await dbTx.commit();

    await logAudit({
      req,
      action: 'UPDATE_PURCHASE_FULL',
      entityName: 'Purchase',
      entityId: purchase.id,
      entityReference: purchase.invoiceNumber,
      beforeState,
      afterState: {
        supplierId: purchase.supplierId,
        purchaseDate: purchase.purchaseDate,
        totalAmount: purchase.totalAmount,
        items: items.map(i => ({ itemId: i.itemId, receivedQuantity: i.receivedQuantity, ratePerUnit: i.ratePerUnit })),
        returns: returnSummary ? returnSummary.lines : []
      }
    });

    res.json({
      success: true,
      message: `Bill ${purchase.invoiceNumber} re-posted with the updated details. Ledger reversed & FIFO batches rebuilt.${returnSummary ? ` ${returnSummary.message}.` : ''}`,
      purchase
    });
  } catch (err) {
    await dbTx.rollback();
    next(err);
  }
};

const deletePurchase = async (req, res, next) => {
  const dbTx = await sequelize.transaction();
  try {
    const purchase = await Purchase.findByPk(req.params.id, {
      include: [{ model: PurchaseItem, as: 'items' }],
      transaction: dbTx,
      lock: dbTx.LOCK.UPDATE
    });
    if (!purchase) {
      await dbTx.rollback();
      return res.status(404).json({ success: false, message: 'Purchase bill not found' });
    }
    if (req.user.role !== 'OWNER' && purchase.branchId !== req.user.branchId) {
      await dbTx.rollback();
      return res.status(403).json({ success: false, message: 'Access denied: bill belongs to another branch.' });
    }

    if (parseFloat(purchase.paidAmount || 0) > 0) {
      await dbTx.rollback();
      return res.status(400).json({
        success: false,
        message: `Cannot delete: Rs ${parseFloat(purchase.paidAmount).toFixed(2)} was already paid on this bill. Reverse the payment vouchers in Ledgers first.`
      });
    }

    // Block deletion once any of the bill's stock has been consumed by a sale,
    // wastage or transfer — undoing FIFO deductions downstream is not reliable.
    const items = purchase.items || [];
    const consumed = await SaleBatchAllocation.count({
      where: { stockBatchId: items.map(i => i.batchId).filter(Boolean) }
    });
    const transferUsed = await StockTransfer.count({ where: { sourceBatchId: items.map(i => i.batchId).filter(Boolean) } });
    const wastageUsed = await WastageEntry.count({ where: { stockBatchId: items.map(i => i.batchId).filter(Boolean) } });

    if (consumed > 0 || transferUsed > 0 || wastageUsed > 0) {
      await dbTx.rollback();
      return res.status(400).json({
        success: false,
        message: `Cannot delete: stock from this bill has already been sold/written-off/transferred. Delete those transactions first.`
      });
    }

    const branch = await Branch.findByPk(purchase.branchId, { transaction: dbTx });

    // Reverse all ledger entries tied to this bill — including the refund
    // entries posted for defective-goods returns ('PurchaseReturn').
    const ledgerEntries = await Transaction.findAll({
      where: {
        referenceType: { [sequelize.Sequelize.Op.in]: ['Purchase', 'PurchaseReturn'] },
        referenceId: purchase.id,
        isReversed: false
      },
      transaction: dbTx
    });
    for (const entry of ledgerEntries) {
      await LedgerService.reverseTransaction(entry.id, `Purchase bill ${purchase.invoiceNumber} deleted`, req.user.id, dbTx);
    }

    // Remove FIFO batches + their movements
    for (const item of items) {
      if (item.batchId) {
        await StockMovement.destroy({ where: { batchId: item.batchId }, transaction: dbTx });
        await StockBatch.destroy({ where: { id: item.batchId }, transaction: dbTx });
      }
    }

    // Detach any payment vouchers, then archive and delete bill
    await Payment.update(
      { referenceType: 'DeletedPurchase', referenceId: null },
      { where: { referenceType: 'Purchase', referenceId: purchase.id }, transaction: dbTx }
    );

    // Create deleted record backup archive snapshot for the Owner
    await backupDeletedRecord({
      entityType: 'PURCHASE',
      entityId: purchase.id,
      entityReference: purchase.invoiceNumber,
      snapshot: {
        purchase: purchase.toJSON(),
        items: (items || []).map(it => it.toJSON ? it.toJSON() : it),
        ledgerEntries: ledgerEntries.map(e => ({ id: e.id, entryNumber: e.entryNumber, debitAmount: e.debitAmount, creditAmount: e.creditAmount, accountType: e.accountType }))
      },
      branchId: purchase.branchId,
      deletedById: req.user.id,
      deletedByName: req.user.name,
      deletionReason: req.body?.reason || 'Deleted via UI',
      transaction: dbTx
    });

    await PurchaseItem.destroy({ where: { purchaseId: purchase.id }, transaction: dbTx });
    await purchase.destroy({ transaction: dbTx });

    await dbTx.commit();

    await logAudit({
      req,
      action: 'DELETE_PURCHASE',
      entityName: 'Purchase',
      entityId: purchase.id,
      entityReference: purchase.invoiceNumber,
      beforeState: { invoiceNumber: purchase.invoiceNumber, totalAmount: purchase.totalAmount, supplierId: purchase.supplierId },
      afterState: null
    });

    res.json({
      success: true,
      message: `Bill ${purchase.invoiceNumber} deleted. Ledger reversed and stock batches removed.`,
      deletedInvoiceNumber: purchase.invoiceNumber
    });
  } catch (err) {
    await dbTx.rollback();
    next(err);
  }
};

module.exports = {
  getPurchases,
  getPurchaseById,
  createPurchase,
  updatePurchase,
  deletePurchase
};
