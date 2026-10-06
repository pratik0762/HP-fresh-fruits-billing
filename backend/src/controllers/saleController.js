const { 
  Sale, SaleItem, SaleBatchAllocation, Customer, CommissionAgent, Transporter, Item, Branch, Payment, RunningBalance, Transaction, StockBatch, StockMovement, WastageEntry, sequelize 
} = require('../models');
const LedgerService = require('../services/ledgerService');
const StockService = require('../services/stockService');
const { generateSequence } = require('../services/invoiceService');
const { logAudit } = require('../middleware/audit');
const { backupDeletedRecord } = require('../services/backupService');

const getSales = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const { customerId, startDate, endDate, paymentStatus, page = 1, limit = 50 } = req.query;

    const where = {};
    if (branchId) where.branchId = branchId;
    if (customerId) where.customerId = customerId;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (startDate && endDate) {
      where.saleDate = { [sequelize.Sequelize.Op.between]: [startDate, endDate] };
    }

    const sales = await Sale.findAll({
      where,
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name', 'phone', 'creditLimit'] },
        { model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] },
        { model: CommissionAgent, as: 'agent', attributes: ['id', 'name'] },
        { model: Transporter, as: 'transporter', attributes: ['id', 'name', 'vehicleNumber'] },
        { 
          model: SaleItem, 
          as: 'items', 
          include: [
            { model: Item, as: 'item' },
            { model: SaleBatchAllocation, as: 'batchAllocations' }
          ] 
        }
      ],
      order: [['id', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    });

    res.json({ success: true, sales });
  } catch (err) {
    next(err);
  }
};

const getSaleById = async (req, res, next) => {
  try {
    const sale = await Sale.findByPk(req.params.id, {
      include: [
        { model: Customer, as: 'customer' },
        { model: Branch, as: 'branch' },
        { model: CommissionAgent, as: 'agent' },
        { model: Transporter, as: 'transporter' },
        { 
          model: SaleItem, 
          as: 'items', 
          include: [
            { model: Item, as: 'item' },
            { model: SaleBatchAllocation, as: 'batchAllocations' }
          ] 
        }
      ]
    });

    if (!sale) {
      return res.status(404).json({ success: false, message: 'Sale invoice not found' });
    }

    // Branch isolation: non-owners may only view their own branch's invoices
    if (req.user.role !== 'OWNER' && sale.branchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Access denied: invoice belongs to another branch.' });
    }

    res.json({ success: true, sale });
  } catch (err) {
    next(err);
  }
};

const createSale = async (req, res, next) => {
  const dbTx = await sequelize.transaction();
  try {
    const {
      branchId,
      customerId,
      hasAgent = false,
      agentId = null,
      agentCommissionRate = 0,
      transporterId = null,
      vehicleNumber = '',
      freightCharges = 0,
      items, // [{ itemId, quantity, unit, conversionFactor, ratePerUnit, discountAmount }]
      discountAmount = 0,
      taxAmount = 0,
      paymentMode = 'CREDIT',
      paidAmount = 0,
      saleDate,
      notes = ''
    } = req.body;

    const targetBranchId = req.user.role === 'OWNER' ? (branchId || req.user.branchId || 1) : req.user.branchId;
    const branch = await Branch.findByPk(targetBranchId, { transaction: dbTx });
    if (!branch) throw new Error('Branch not found');

    const customer = await Customer.findByPk(customerId, { transaction: dbTx, lock: dbTx.LOCK.UPDATE });
    if (!customer) throw new Error('Customer not found');

    // Party isolation: a branch can only sell to its own customers
    if (req.user.role !== 'OWNER' && customer.branchId && customer.branchId !== targetBranchId) {
      throw new Error(`Access denied: customer "${customer.name}" belongs to another branch.`);
    }

    if (!items || !items.length) {
      throw new Error('Sale must contain at least one fruit item');
    }

    // 1. Calculate Items Subtotal
    let itemsSubtotal = 0;
    let itemsTotalDiscount = 0;

    for (const line of items) {
      const q = parseFloat(line.quantity);
      const rate = parseFloat(line.ratePerUnit);
      const disc = parseFloat(line.discountAmount) || 0;
      const sub = parseFloat((q * rate - disc).toFixed(2));
      itemsSubtotal += (q * rate);
      itemsTotalDiscount += disc;
    }

    const overallDiscount = parseFloat(discountAmount) || 0;
    const totalDiscount = parseFloat((itemsTotalDiscount + overallDiscount).toFixed(2));
    const numTax = parseFloat(taxAmount) || 0;
    const numFreight = parseFloat(freightCharges) || 0;
    // Freight charged to the customer is part of the bill (matches the SaleCreate UI summary)
    const totalBillAmount = parseFloat((itemsSubtotal - totalDiscount + numTax + numFreight).toFixed(2));

    // Credit limit check
    const numPaid = parseFloat(paidAmount) || 0;
    if (numPaid > totalBillAmount) {
      throw new Error(`Paid amount (Rs ${numPaid.toFixed(2)}) cannot exceed the invoice total (Rs ${totalBillAmount.toFixed(2)})`);
    }
    const dueAmt = parseFloat((totalBillAmount - numPaid).toFixed(2));

    if (dueAmt > 0) {
      // Find current running balance of customer
      const custBalanceRecord = await RunningBalance.findOne({
        where: { branchId: targetBranchId, entityType: 'CUSTOMER', entityId: customer.id },
        transaction: dbTx
      });
      const currentBalance = custBalanceRecord ? parseFloat(custBalanceRecord.currentBalance) : 0;
      const limit = parseFloat(customer.creditLimit) || 50000;

      if ((currentBalance + dueAmt) > limit) {
        throw new Error(`Credit limit exceeded! Customer balance: Rs ${currentBalance.toFixed(2)}, Sale due: Rs ${dueAmt.toFixed(2)}, Allowed Limit: Rs ${limit.toFixed(2)}`);
      }
    }

    // Commission on sale
    let numCommission = 0;
    if (hasAgent && agentId) {
      const commRate = parseFloat(agentCommissionRate) || 0;
      numCommission = parseFloat(((totalBillAmount * commRate) / 100).toFixed(2));
    }

    const invoiceNumber = await generateSequence('INV', branch.code, dbTx);
    const paymentStatus = dueAmt <= 0 ? 'PAID' : (numPaid > 0 ? 'PARTIAL' : 'PENDING');

    // 2. Perform FIFO Allocation for each fruit item
    let overallSaleCogs = 0;
    const processedItems = [];

    for (const line of items) {
      const itm = await Item.findByPk(line.itemId, { transaction: dbTx });
      const conv = parseFloat(line.conversionFactor) || (itm ? parseFloat(itm.unitConversionFactor) : 1);
      const q = parseFloat(line.quantity);
      const lineWeightKg = parseFloat((q * conv).toFixed(2));
      const rate = parseFloat(line.ratePerUnit);
      const disc = parseFloat(line.discountAmount) || 0;
      const sub = parseFloat((q * rate - disc).toFixed(2));

      // Strictly allocate from oldest batches (FIFO) with row locking
      const { allocations, totalCogs } = await StockService.allocateFIFO({
        branchId: targetBranchId,
        itemId: line.itemId,
        quantityKg: lineWeightKg,
        referenceType: 'Sale',
        referenceNumber: invoiceNumber,
        notes: `Sale to ${customer.name}`
      }, dbTx);

      overallSaleCogs += totalCogs;

      processedItems.push({
        line,
        lineWeightKg,
        rate,
        disc,
        sub,
        totalCogs,
        allocations
      });
    }

    const grossProfit = parseFloat((totalBillAmount - overallSaleCogs - numCommission).toFixed(2));

    // 3. Create Sale record
    const sale = await Sale.create({
      invoiceNumber,
      branchId: targetBranchId,
      customerId,
      hasAgent: !!hasAgent,
      agentId: hasAgent ? agentId : null,
      agentCommissionRate: hasAgent ? parseFloat(agentCommissionRate) : 0,
      agentCommissionAmount: numCommission,
      transporterId: transporterId || null,
      vehicleNumber,
      freightCharges: numFreight,
      subtotal: itemsSubtotal,
      discountAmount: totalDiscount,
      taxAmount: numTax,
      totalAmount: totalBillAmount,
      totalCogs: parseFloat(overallSaleCogs.toFixed(2)),
      grossProfit,
      paidAmount: numPaid,
      dueAmount: Math.max(0, dueAmt),
      paymentStatus,
      paymentMode,
      saleDate: saleDate || new Date().toISOString().split('T')[0],
      notes,
      createdBy: req.user.id
    }, { transaction: dbTx });

    // 4. Create SaleItems & Batch Allocation records
    for (const itemData of processedItems) {
      const saleItem = await SaleItem.create({
        saleId: sale.id,
        itemId: itemData.line.itemId,
        quantity: itemData.line.quantity,
        unit: itemData.line.unit || 'kg',
        conversionFactor: itemData.line.conversionFactor || 1,
        weightKg: itemData.lineWeightKg,
        ratePerUnit: itemData.rate,
        discountAmount: itemData.disc,
        subtotal: itemData.sub,
        cogsAmount: itemData.totalCogs,
        profitAmount: parseFloat((itemData.sub - itemData.totalCogs).toFixed(2))
      }, { transaction: dbTx });

      for (const alloc of itemData.allocations) {
        await SaleBatchAllocation.create({
          saleItemId: saleItem.id,
          stockBatchId: alloc.stockBatchId,
          quantityKg: alloc.quantityKg,
          costPerKg: alloc.costPerKg,
          totalCost: alloc.totalCost
        }, { transaction: dbTx });
      }
    }

    // 5. Append-Only Ledger Postings
    // Debit Customer (Accounts Receivable) for full invoice amount
    await LedgerService.postEntry({
      branchId: targetBranchId,
      branchCode: branch.code,
      type: 'SALE',
      referenceType: 'Sale',
      referenceId: sale.id,
      referenceNumber: invoiceNumber,
      partyType: 'CUSTOMER',
      partyId: customer.id,
      partyName: customer.name,
      accountType: 'ACCOUNTS_RECEIVABLE',
      debitAmount: totalBillAmount,
      creditAmount: 0,
      notes: `Sale Invoice ${invoiceNumber} to ${customer.name}`,
      createdBy: req.user.id
    }, dbTx);

    // Credit Sales Revenue
    await LedgerService.postEntry({
      branchId: targetBranchId,
      branchCode: branch.code,
      type: 'SALE',
      referenceType: 'Sale',
      referenceId: sale.id,
      referenceNumber: invoiceNumber,
      partyType: 'CUSTOMER',
      partyId: customer.id,
      partyName: customer.name,
      accountType: 'SALES_REVENUE',
      debitAmount: 0,
      creditAmount: totalBillAmount,
      notes: `Sales revenue for invoice ${invoiceNumber}`,
      createdBy: req.user.id
    }, dbTx);

    // COGS & Inventory Asset entries
    await LedgerService.postEntry({
      branchId: targetBranchId,
      branchCode: branch.code,
      type: 'SALE',
      referenceType: 'Sale',
      referenceId: sale.id,
      referenceNumber: invoiceNumber,
      partyType: 'INTERNAL',
      accountType: 'COST_OF_GOODS_SOLD',
      debitAmount: parseFloat(overallSaleCogs.toFixed(2)),
      creditAmount: 0,
      notes: `FIFO COGS for invoice ${invoiceNumber}`,
      createdBy: req.user.id
    }, dbTx);

    // If commission agent involved
    if (numCommission > 0 && agentId) {
      const agent = await CommissionAgent.findByPk(agentId, { transaction: dbTx });
      await LedgerService.postEntry({
        branchId: targetBranchId,
        branchCode: branch.code,
        type: 'AGENT_COMMISSION',
        referenceType: 'Sale',
        referenceId: sale.id,
        referenceNumber: invoiceNumber,
        partyType: 'COMMISSION_AGENT',
        partyId: agent.id,
        partyName: agent.name,
        accountType: 'COMMISSION_EXPENSE',
        debitAmount: numCommission,
        creditAmount: 0,
        notes: `Agent commission on sale ${invoiceNumber}`,
        createdBy: req.user.id
      }, dbTx);
    }

    // If immediate payment received (Cash/Bank/UPI)
    if (numPaid > 0) {
      const paySeq = await generateSequence('PAY', branch.code, dbTx);
      const paymentVoucher = await Payment.create({
        paymentNumber: paySeq,
        branchId: targetBranchId,
        voucherType: 'RECEIPT_CUSTOMER',
        partyType: 'CUSTOMER',
        partyId: customer.id,
        amount: numPaid,
        paymentMode: paymentMode === 'CREDIT' ? 'CASH' : paymentMode,
        referenceType: 'Sale',
        referenceId: sale.id,
        paymentDate: saleDate || new Date().toISOString().split('T')[0],
        notes: `Immediate payment received for Sale ${invoiceNumber}`,
        createdBy: req.user.id
      }, { transaction: dbTx });

      // Ledger: Debit Cash/Bank, Credit Accounts Receivable (Customer)
      await LedgerService.postEntry({
        branchId: targetBranchId,
        branchCode: branch.code,
        type: 'CUSTOMER_PAYMENT',
        referenceType: 'Payment',
        referenceId: paymentVoucher.id,
        referenceNumber: paySeq,
        partyType: 'CUSTOMER',
        partyId: customer.id,
        partyName: customer.name,
        accountType: paymentMode === 'BANK' ? 'BANK' : 'CASH',
        debitAmount: numPaid,
        creditAmount: 0,
        notes: `Cash/Bank receipt for invoice ${invoiceNumber}`,
        createdBy: req.user.id
      }, dbTx);

      await LedgerService.postEntry({
        branchId: targetBranchId,
        branchCode: branch.code,
        type: 'CUSTOMER_PAYMENT',
        referenceType: 'Payment',
        referenceId: paymentVoucher.id,
        referenceNumber: paySeq,
        partyType: 'CUSTOMER',
        partyId: customer.id,
        partyName: customer.name,
        accountType: 'ACCOUNTS_RECEIVABLE',
        debitAmount: 0,
        creditAmount: numPaid,
        notes: `Payment receipt applied against invoice ${invoiceNumber}`,
        createdBy: req.user.id
      }, dbTx);
    }

    await dbTx.commit();

    await logAudit({
      req,
      action: 'CREATE_SALE',
      entityName: 'Sale',
      entityId: sale.id,
      entityReference: invoiceNumber,
      afterState: { id: sale.id, invoiceNumber, totalAmount: totalBillAmount, cogs: overallSaleCogs }
    });

    res.status(201).json({
      success: true,
      message: `Sale invoice ${invoiceNumber} created successfully`,
      sale
    });
  } catch (err) {
    await dbTx.rollback();
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Defective-goods returns handled from the Sales Edit form.
//
// Every line carries a CUMULATIVE `returnedQuantity` (in the line's own unit).
// On save the posted values are compared with what is stored and only the
// DELTA is processed:
//   delta > 0 → stock comes back into the lots this invoice drew from
//               (RETURN_IN) and the refund is recorded — DR sales revenue,
//               CR cash when the invoice is settled, otherwise CR the
//               customer's receivable (they owe us less).
//   delta < 0 → the stock leaves again (RETURN_OUT) and the refund is reversed.
// Movements + ledger entries are always appended; history is never mutated.
// ---------------------------------------------------------------------------

// Build the effective per-item return map for this save and validate it.
// `lines` are the lines being saved (posted items on a full re-post, the stored
// items on a header-only edit). Lines omitted from body.returns keep their
// stored return; returns posted for items no longer on the invoice are ignored
// (their goods were physically returned — the refund entries stay on the books).
const parseSaleReturnPlan = async ({ body, lines, oldReturns }, dbTx) => {
  const payload = new Map();
  const rawReturns = Array.isArray(body.returns)
    ? body.returns
    : (Array.isArray(body.items) ? body.items.map(i => ({ itemId: i.itemId, quantity: i.returnedQuantity, reason: i.returnReason })) : []);
  for (const r of rawReturns) {
    if (!r || r.itemId === undefined || r.itemId === null) continue;
    const qty = parseFloat(r.quantity);
    if (isNaN(qty) || qty < 0) throw new Error('Return quantity must be zero or more on every line');
    const id = parseInt(r.itemId);
    payload.set(id, parseFloat(((payload.get(id) || 0) + qty).toFixed(2)));
  }

  // Invoiced quantity per fruit (the same fruit can appear on two lines)
  const invoiced = new Map();
  for (const l of lines || []) {
    const id = parseInt(l.itemId);
    invoiced.set(id, parseFloat((parseFloat(invoiced.get(id) || 0) + parseFloat(l.quantity || 0)).toFixed(2)));
  }

  const effective = new Map();
  for (const [id, maxQty] of invoiced) {
    const qty = payload.has(id) ? payload.get(id) : parseFloat((oldReturns.get(id) || 0).toFixed(2));
    if (qty > maxQty + 0.001) {
      const row = await Item.findByPk(id, { attributes: ['id', 'name'], transaction: dbTx });
      const name = row ? row.name : `item #${id}`;
      throw new Error(payload.has(id)
        ? `Return quantity (${qty}) cannot exceed invoiced quantity (${maxQty}) for ${name}`
        : `Recorded return (${qty}) exceeds invoiced quantity (${maxQty}) for ${name} — reduce the return before shrinking this line`);
    }
    effective.set(id, qty);
  }

  const reason = String(body.returnReason || '').trim() || 'Defective fruit returned by customer (Sales Edit)';
  return { effective, reason };
};

// Remove previously recorded return stock from the invoice's lots.
// Used right after a full re-post restores the FULL allocations (the returned
// portion is already back in stock, so the restore must be netted out) and on
// invoice deletion. `allocs` are the SaleBatchAllocation rows of the line.
const debitSaleReturnStock = async ({ sale, itemId, quantityKg, reason, allocs, notes, userId }, dbTx) => {
  const kg = parseFloat(quantityKg);
  if (kg <= 0) return 0;
  let toRemove = parseFloat(kg.toFixed(2));
  let removed = 0;

  for (const alloc of allocs || []) {
    if (toRemove <= 0) break;
    const allocKg = parseFloat(alloc.quantityKg || 0);
    if (allocKg <= 0) continue;
    const take = parseFloat(Math.min(toRemove, allocKg).toFixed(2));
    const batch = await StockBatch.findByPk(alloc.stockBatchId, {
      transaction: dbTx,
      lock: dbTx?.LOCK?.UPDATE || false
    });
    if (!batch) continue;
    const cur = parseFloat(batch.currentQuantity || 0);
    if (cur < take - 0.001) continue; // try the next lot for the remainder
    batch.currentQuantity = parseFloat((cur - take).toFixed(2));
    if (batch.currentQuantity <= 0.001) batch.status = 'DEPLETED';
    await batch.save({ transaction: dbTx });

    await StockMovement.create({
      batchId: batch.id,
      branchId: sale.branchId,
      itemId,
      movementType: 'RETURN_OUT',
      quantity: take,
      unit: 'kg',
      costPerUnit: parseFloat(batch.landedCostPerUnit || 0),
      referenceType: 'SaleReturn',
      referenceId: sale.id,
      referenceNumber: sale.invoiceNumber,
      notes: notes || `Customer return reduced on ${sale.invoiceNumber}: ${reason}`
    }, { transaction: dbTx });

    removed = parseFloat((removed + take).toFixed(2));
    toRemove = parseFloat((toRemove - take).toFixed(2));
  }

  if (toRemove > 0.001) {
    throw new Error(
      `Cannot take back ${kg} kg on invoice ${sale.invoiceNumber}: only ${removed} kg of this invoice's lots are still available (stock may be consumed by later sales).`
    );
  }
  return removed;
};

// Put returned stock back into the lots the invoice drew from: adds to the
// recorded batches (reopening DEPLETED lots), logs RETURN_IN movements and
// writes an auditable return record (mirrors StockService.restockReturn).
const creditSaleReturnStock = async ({ sale, branchCode = 'DEL', itemId, quantityKg, reason, allocs, userId }, dbTx) => {
  const kg = parseFloat(quantityKg);
  if (kg <= 0) return 0;
  let toAdd = parseFloat(kg.toFixed(2));
  let added = 0;
  let firstBatch = null;

  for (const alloc of allocs || []) {
    if (toAdd <= 0) break;
    const allocKg = parseFloat(alloc.quantityKg || 0);
    if (allocKg <= 0) continue;
    const take = parseFloat(Math.min(toAdd, allocKg).toFixed(2));
    const batch = await StockBatch.findByPk(alloc.stockBatchId, {
      transaction: dbTx,
      lock: dbTx?.LOCK?.UPDATE || false
    });
    if (!batch) continue;
    batch.currentQuantity = parseFloat((parseFloat(batch.currentQuantity || 0) + take).toFixed(2));
    if (batch.status === 'DEPLETED' && batch.currentQuantity > 0.001) batch.status = 'ACTIVE';
    await batch.save({ transaction: dbTx });
    if (!firstBatch) firstBatch = batch;

    await StockMovement.create({
      batchId: batch.id,
      branchId: sale.branchId,
      itemId,
      movementType: 'RETURN_IN',
      quantity: take,
      unit: 'kg',
      costPerUnit: parseFloat(batch.landedCostPerUnit || 0),
      referenceType: 'SaleReturn',
      referenceId: sale.id,
      referenceNumber: sale.invoiceNumber,
      notes: `Defective fruit returned by customer on ${sale.invoiceNumber}: ${reason}`
    }, { transaction: dbTx });

    added = parseFloat((added + take).toFixed(2));
    toAdd = parseFloat((toAdd - take).toFixed(2));
  }

  if (toAdd > 0.001) {
    throw new Error(`Cannot record return of ${kg} kg on invoice ${sale.invoiceNumber}: only ${added} kg matches this invoice's lots.`);
  }

  // Auditable return record (0 loss — it never touches the P&L)
  if (added > 0 && firstBatch) {
    const seq = `${Date.now().toString().slice(-7)}${Math.floor(1000 + Math.random() * 9000)}`;
    await WastageEntry.create({
      entryNumber: `RTRN-${branchCode}-${new Date().getFullYear()}-${seq}`,
      branchId: sale.branchId,
      itemId,
      stockBatchId: firstBatch.id,
      quantity: added,
      unit: 'kg',
      quantityKg: added,
      costPerKg: parseFloat(firstBatch.landedCostPerUnit || 0),
      totalLossAmount: 0,
      reason,
      actionTaken: 'Customer return (defective goods)',
      salvageRecoveryAmount: 0,
      entryDate: new Date().toISOString().split('T')[0],
      notes: `Returned against sale invoice ${sale.invoiceNumber}`,
      createdBy: userId
    }, { transaction: dbTx });
  }

  return added;
};

// Undo previously recorded return stock on the OLD allocations (used right
// after a full re-post restores them, and on delete): the restore credits the
// FULL allocation while the returned portion is already back in stock.
const undoRecordedSaleReturns = async ({ sale, items, oldReturns, reason, notes, userId }, dbTx) => {
  for (const item of items || []) {
    const oldQty = parseFloat((oldReturns.get(item.itemId) || 0).toFixed(2));
    if (oldQty <= 0) continue;
    const conv = parseFloat(item.conversionFactor || 1);
    await debitSaleReturnStock({
      sale,
      itemId: item.itemId,
      quantityKg: parseFloat((oldQty * conv).toFixed(2)),
      reason,
      allocs: item.batchAllocations || [],
      notes,
      userId
    }, dbTx);
  }
};

// Post the NET refund for this save as double-entry ledger entries
// (type 'SALE', referenceType 'SaleReturn' — kept by a full re-post, reversed
// when the invoice is deleted).
const postSaleReturnRefund = async ({ sale, customer, branch, lines, effective, oldReturns, reason, userId }, dbTx) => {
  // Net unit price per fruit (the same fruit can appear on two lines)
  const agg = new Map();
  for (const l of lines || []) {
    const id = parseInt(l.itemId);
    const q = parseFloat(l.quantity) || 0;
    const rate = parseFloat(l.ratePerUnit) || 0;
    const disc = parseFloat(l.discountAmount) || 0;
    const cur = agg.get(id) || { qty: 0, sub: 0 };
    cur.qty += q;
    cur.sub += q * rate - disc;
    agg.set(id, cur);
  }

  let moneyDelta = 0;
  const detail = [];
  for (const [id, a] of agg) {
    const newQty = effective.get(id);
    if (newQty === undefined) continue;
    const oldQty = parseFloat((oldReturns.get(id) || 0).toFixed(2));
    const delta = parseFloat((newQty - oldQty).toFixed(2));
    if (!delta) continue;
    const netUnit = a.qty > 0 ? a.sub / a.qty : 0;
    moneyDelta = parseFloat((moneyDelta + delta * netUnit).toFixed(2));
    const row = await Item.findByPk(id, { attributes: ['id', 'name'], transaction: dbTx });
    detail.push(`${row ? row.name : `item #${id}`} ${delta > 0 ? '+' : ''}${delta} unit(s) (${delta > 0 ? '-' : '+'}Rs ${Math.abs(delta * netUnit).toFixed(2)})`);
  }

  if (Math.abs(moneyDelta) < 0.01 || !detail.length) return moneyDelta;

  // Settled invoice → the refund is paid back in cash; still outstanding →
  // adjust what the customer owes us instead.
  const refundAccount = parseFloat(sale.dueAmount || 0) > 0 ? 'ACCOUNTS_RECEIVABLE' : 'CASH';
  const isRefund = moneyDelta > 0;
  const amt = Math.abs(moneyDelta);

  await LedgerService.postEntry({
    branchId: sale.branchId,
    branchCode: branch.code,
    type: 'SALE',
    referenceType: 'SaleReturn',
    referenceId: sale.id,
    referenceNumber: sale.invoiceNumber,
    partyType: 'CUSTOMER',
    partyId: customer.id,
    partyName: customer.name,
    accountType: 'SALES_REVENUE',
    debitAmount: isRefund ? amt : 0,
    creditAmount: isRefund ? 0 : amt,
    notes: `Customer return refund on ${sale.invoiceNumber}: ${detail.join('; ')} (reason: ${reason})`,
    createdBy: userId
  }, dbTx);

  await LedgerService.postEntry({
    branchId: sale.branchId,
    branchCode: branch.code,
    type: 'SALE',
    referenceType: 'SaleReturn',
    referenceId: sale.id,
    referenceNumber: sale.invoiceNumber,
    partyType: 'CUSTOMER',
    partyId: customer.id,
    partyName: customer.name,
    accountType: refundAccount,
    debitAmount: isRefund ? 0 : amt,
    creditAmount: isRefund ? amt : 0,
    notes: isRefund
      ? (refundAccount === 'CASH'
          ? `Cash refund paid for defective goods returned on ${sale.invoiceNumber}`
          : `Returned goods adjusted against dues of ${customer.name} on ${sale.invoiceNumber}`)
      : `Return reduced on ${sale.invoiceNumber} — ${refundAccount === 'CASH' ? 'cash refunded back to the business' : 'customer dues restored'}`,
    createdBy: userId
  }, dbTx);

  return moneyDelta;
};

const updateSale = async (req, res, next) => {
  const dbTx = await sequelize.transaction();
  try {
    const sale = await Sale.findByPk(req.params.id, {
      include: [{
        model: SaleItem,
        as: 'items',
        include: [{ model: SaleBatchAllocation, as: 'batchAllocations' }]
      }],
      transaction: dbTx,
      lock: dbTx.LOCK.UPDATE
    });
    if (!sale) {
      await dbTx.rollback();
      return res.status(404).json({ success: false, message: 'Sale invoice not found' });
    }
    if (req.user.role !== 'OWNER' && sale.branchId !== req.user.branchId) {
      await dbTx.rollback();
      return res.status(403).json({ success: false, message: 'Access denied: invoice belongs to another branch.' });
    }

    const body = req.body;
    const fullEdit = Array.isArray(body.items) && body.items.length > 0;

    // Cumulative defective-goods returns already recorded on the lines —
    // captured before any teardown so both edit modes can process the delta.
    const oldReturns = new Map();
    for (const it of sale.items || []) {
      oldReturns.set(
        it.itemId,
        parseFloat((parseFloat(oldReturns.get(it.itemId) || 0) + parseFloat(it.returnedQuantity || 0)).toFixed(2))
      );
    }
    // Validate + resolve the returns posted with this save (cumulative totals).
    const returnPlan = await parseSaleReturnPlan({
      body,
      lines: fullEdit ? body.items : (sale.items || []),
      oldReturns
    }, dbTx);

    // ------------------------------------------------------------------
    // MODE 2: Full re-post (customer, date, items, quantities, rates...).
    // The invoice is atomically torn down and re-posted: FIFO stock is
    // restored from the recorded batch allocations, invoice-derived ledger
    // entries are reversed, items are re-allocated FIFO and everything is
    // re-posted — mirroring createSale inside a single transaction.
    // Recorded receipt vouchers stay untouched; only a NEW advance receipt
    // (paidAmount) creates a fresh voucher. Same invoice number is kept.
    // ------------------------------------------------------------------
    if (fullEdit) {
      const {
        customerId,
        hasAgent = false,
        agentId = null,
        agentCommissionRate = 0,
        transporterId = null,
        vehicleNumber = '',
        freightCharges = 0,
        items,
        discountAmount = 0,
        taxAmount = 0,
        paymentMode,
        paidAmount,
        saleDate,
        notes
      } = body;

      const branch = await Branch.findByPk(sale.branchId, { transaction: dbTx });
      if (!branch) throw new Error('Branch not found');

      const customer = await Customer.findByPk(customerId || sale.customerId, { transaction: dbTx, lock: dbTx.LOCK.UPDATE });
      if (!customer) throw new Error('Customer not found');

      let agent = null;
      if (hasAgent) {
        agent = await CommissionAgent.findByPk(agentId, { transaction: dbTx });
        if (!agent) throw new Error('Commission agent not found');
      }

      // 1. Recalculate totals (mirrors createSale)
      let itemsSubtotal = 0;
      let itemsTotalDiscount = 0;
      for (const line of items) {
        const q = parseFloat(line.quantity);
        const rate = parseFloat(line.ratePerUnit);
        if (!q || q <= 0) throw new Error('Quantity must be greater than zero on every line');
        if (isNaN(rate) || rate < 0) throw new Error('Rate per unit must be zero or more on every line');
        itemsSubtotal += q * rate;
        itemsTotalDiscount += parseFloat(line.discountAmount) || 0;
      }

      const overallDiscount = parseFloat(discountAmount) || 0;
      const totalDiscount = parseFloat((itemsTotalDiscount + overallDiscount).toFixed(2));
      const numTax = parseFloat(taxAmount) || 0;
      const numFreight = parseFloat(freightCharges) || 0;
      const totalBillAmount = parseFloat(Math.max(0, itemsSubtotal - totalDiscount + numTax + numFreight).toFixed(2));

      // Recorded receipts are preserved: existing RECEIPT_CUSTOMER vouchers are
      // NOT reversed or deleted. `paidAmount` from the client only represents a
      // NEW advance receipt collected alongside the edit.
      const recordedPaid = await Payment.sum('amount', {
        where: { referenceType: 'Sale', referenceId: sale.id }
      }) || 0;
      const newAdvance = paidAmount !== undefined ? (parseFloat(paidAmount) || 0) : 0;
      const newPaid = parseFloat((parseFloat(recordedPaid) + newAdvance).toFixed(2));
      if (newPaid > totalBillAmount) {
        throw new Error(`Total received (Rs ${newPaid.toFixed(2)} = Rs ${parseFloat(recordedPaid).toFixed(2)} on record + Rs ${newAdvance.toFixed(2)} new) cannot exceed the invoice total (Rs ${totalBillAmount.toFixed(2)})`);
      }
      const newDue = parseFloat((totalBillAmount - newPaid).toFixed(2));

      // Credit limit check with the projected receivable (the old invoice due is
      // still part of the live balance, so exclude it from the projection).
      if (newDue > 0) {
        const custBalanceRecord = await RunningBalance.findOne({
          where: { branchId: sale.branchId, entityType: 'CUSTOMER', entityId: customer.id },
          transaction: dbTx
        });
        const currentBalance = custBalanceRecord ? parseFloat(custBalanceRecord.currentBalance) : 0;
        const projectedBalance = parseFloat((currentBalance - parseFloat(sale.dueAmount || 0) + newDue).toFixed(2));
        const limit = parseFloat(customer.creditLimit) || 50000;
        if (projectedBalance > limit) {
          throw new Error(`Credit limit exceeded! Projected customer balance: Rs ${projectedBalance.toFixed(2)}, Allowed Limit: Rs ${limit.toFixed(2)}`);
        }
      }

      // 2. Restore FIFO stock from the recorded batch allocations
      for (const item of sale.items) {
        for (const alloc of item.batchAllocations || []) {
          const batch = await StockBatch.findByPk(alloc.stockBatchId, {
            transaction: dbTx,
            lock: dbTx.LOCK.UPDATE
          });
          if (batch) {
            batch.currentQuantity = parseFloat((parseFloat(batch.currentQuantity) + parseFloat(alloc.quantityKg)).toFixed(2));
            if (batch.status === 'DEPLETED' && batch.currentQuantity > 0.001) {
              batch.status = 'ACTIVE';
            }
            await batch.save({ transaction: dbTx });
          }

          await StockMovement.create({
            batchId: alloc.stockBatchId,
            branchId: sale.branchId,
            itemId: item.itemId,
            movementType: 'SALE_CANCEL_RETURN',
            quantity: parseFloat(alloc.quantityKg),
            unit: 'kg',
            costPerUnit: parseFloat(alloc.costPerKg),
            referenceType: 'SaleEdit',
            referenceId: sale.id,
            referenceNumber: sale.invoiceNumber,
            notes: `Stock returned for re-edit of invoice ${sale.invoiceNumber}`
          }, { transaction: dbTx });
        }
      }

      // The restore above credited the FULL allocations, but the portion the
      // customer already returned is back in stock too — take it out again so
      // the cycle is neutral. The current return entries are re-added to the
      // freshly allocated lots further below.
      await undoRecordedSaleReturns({
        sale,
        items: sale.items,
        oldReturns,
        reason: returnPlan.reason,
        notes: `Prior customer return re-applied on edit of ${sale.invoiceNumber}`,
        userId: req.user.id
      }, dbTx);

      // 3. Reverse every invoice-derived ledger entry (append-only reversal).
      //    Receipt vouchers referenceType 'Payment' — left untouched.
      const ledgerEntries = await Transaction.findAll({
        where: { referenceType: { [sequelize.Sequelize.Op.in]: ['Sale', 'SaleEdit'] }, referenceId: sale.id, isReversed: false },
        transaction: dbTx
      });
      for (const entry of ledgerEntries) {
        await LedgerService.reverseTransaction(entry.id, `Sale invoice ${sale.invoiceNumber} fully edited & re-posted`, req.user.id, dbTx);
      }

      // 4. Remove old line items + their FIFO allocation records
      for (const item of sale.items) {
        await SaleBatchAllocation.destroy({ where: { saleItemId: item.id }, transaction: dbTx });
      }
      await SaleItem.destroy({ where: { saleId: sale.id }, transaction: dbTx });

      // 5. Re-allocate FIFO for the new quantities
      let overallSaleCogs = 0;
      const processedItems = [];
      for (const line of items) {
        const itm = await Item.findByPk(line.itemId, { transaction: dbTx });
        if (!itm) throw new Error(`Fruit item not found (id ${line.itemId})`);
        const conv = parseFloat(line.conversionFactor) || (itm ? parseFloat(itm.unitConversionFactor) : 1);
        const q = parseFloat(line.quantity);
        const lineWeightKg = parseFloat((q * conv).toFixed(2));
        const rate = parseFloat(line.ratePerUnit);
        const disc = parseFloat(line.discountAmount) || 0;
        const sub = parseFloat((q * rate - disc).toFixed(2));

        const { allocations, totalCogs } = await StockService.allocateFIFO({
          branchId: sale.branchId,
          itemId: line.itemId,
          quantityKg: lineWeightKg,
          referenceType: 'Sale',
          referenceNumber: sale.invoiceNumber,
          notes: `Sale to ${customer.name}`
        }, dbTx);

        overallSaleCogs += totalCogs;
        processedItems.push({ line, conv, lineWeightKg, rate, disc, sub, totalCogs, allocations });
      }

      let numCommission = 0;
      if (hasAgent && agent) {
        const commRate = parseFloat(agentCommissionRate) || 0;
        numCommission = parseFloat(((totalBillAmount * commRate) / 100).toFixed(2));
      }
      const grossProfit = parseFloat((totalBillAmount - overallSaleCogs - numCommission).toFixed(2));

      const paymentStatus = newDue <= 0 ? 'PAID' : (newPaid > 0 ? 'PARTIAL' : 'PENDING');

      const beforeState = {
        customerId: sale.customerId,
        saleDate: sale.saleDate,
        totalAmount: sale.totalAmount,
        items: sale.items.map(i => ({ itemId: i.itemId, quantity: i.quantity, ratePerUnit: i.ratePerUnit }))
      };

      // 6. Rewrite the invoice header in place (same invoiceNumber)
      sale.customerId = customer.id;
      sale.hasAgent = !!hasAgent;
      sale.agentId = hasAgent ? agent.id : null;
      sale.agentCommissionRate = hasAgent ? (parseFloat(agentCommissionRate) || 0) : 0;
      sale.agentCommissionAmount = numCommission;
      sale.transporterId = transporterId || null;
      sale.vehicleNumber = vehicleNumber;
      sale.freightCharges = numFreight;
      sale.subtotal = parseFloat(itemsSubtotal.toFixed(2));
      sale.discountAmount = totalDiscount;
      sale.taxAmount = numTax;
      sale.totalAmount = totalBillAmount;
      sale.totalCogs = parseFloat(overallSaleCogs.toFixed(2));
      sale.grossProfit = grossProfit;
      sale.paidAmount = newPaid;
      sale.dueAmount = Math.max(0, newDue);
      sale.paymentStatus = paymentStatus;
      if (paymentMode) sale.paymentMode = paymentMode;
      if (saleDate) sale.saleDate = saleDate;
      if (notes !== undefined) sale.notes = notes;
      await sale.save({ transaction: dbTx });

      // 7. Recreate SaleItems & FIFO batch allocation records
      const allocsByItem = new Map();
      for (const itemData of processedItems) {
        const lineItemId = parseInt(itemData.line.itemId);
        const isFirstLine = !allocsByItem.has(lineItemId); // first line of a fruit carries its cumulative return
        const saleItem = await SaleItem.create({
          saleId: sale.id,
          itemId: itemData.line.itemId,
          quantity: itemData.line.quantity,
          unit: itemData.line.unit || 'kg',
          conversionFactor: itemData.conv,
          weightKg: itemData.lineWeightKg,
          ratePerUnit: itemData.rate,
          discountAmount: itemData.disc,
          subtotal: itemData.sub,
          cogsAmount: itemData.totalCogs,
          profitAmount: parseFloat((itemData.sub - itemData.totalCogs).toFixed(2)),
          returnedQuantity: isFirstLine ? (returnPlan.effective.get(lineItemId) || 0) : 0
        }, { transaction: dbTx });

        if (!allocsByItem.has(lineItemId)) allocsByItem.set(lineItemId, []);
        allocsByItem.get(lineItemId).push(...itemData.allocations);

        for (const alloc of itemData.allocations) {
          await SaleBatchAllocation.create({
            saleItemId: saleItem.id,
            stockBatchId: alloc.stockBatchId,
            quantityKg: alloc.quantityKg,
            costPerKg: alloc.costPerKg,
            totalCost: alloc.totalCost
          }, { transaction: dbTx });
        }
      }

      // Re-apply the recorded defective-goods returns to the freshly allocated
      // lots (lines were rebuilt at full quantity above) and record the refund
      // delta. Refund entries already on the books are kept — 'SaleReturn' is
      // not part of the reversal in step 3.
      const returnSummary = { lines: [], totalKg: 0, refund: 0, message: '' };
      for (const [lineItemId, allocs] of allocsByItem) {
        const newQty = returnPlan.effective.get(lineItemId) || 0;
        if (newQty <= 0) continue;
        const conv = parseFloat((processedItems.find(pi => parseInt(pi.line.itemId) === lineItemId)?.conv) || 1);
        const kg = parseFloat((newQty * conv).toFixed(2));
        await creditSaleReturnStock({
          sale,
          branchCode: branch.code,
          itemId: lineItemId,
          quantityKg: kg,
          reason: returnPlan.reason,
          allocs,
          userId: req.user.id
        }, dbTx);

        const oldQty = parseFloat((oldReturns.get(lineItemId) || 0).toFixed(2));
        const delta = parseFloat((newQty - oldQty).toFixed(2));
        if (Math.abs(delta) > 0.001) {
          const deltaKg = parseFloat((Math.abs(delta) * conv).toFixed(2));
          returnSummary.lines.push({ itemId: lineItemId, previousQty: oldQty, returnedQty: newQty, quantityKg: deltaKg });
          returnSummary.totalKg = parseFloat((returnSummary.totalKg + deltaKg).toFixed(2));
        }
      }
      if (returnSummary.lines.length) {
        returnSummary.refund = await postSaleReturnRefund({
          sale, customer, branch, lines: items,
          effective: returnPlan.effective, oldReturns, reason: returnPlan.reason,
          userId: req.user.id
        }, dbTx);
        returnSummary.message = returnSummary.refund >= 0
          ? `${returnSummary.totalKg} kg returned by customer — refund of Rs ${returnSummary.refund.toFixed(2)} recorded`
          : `Customer return reduced by ${returnSummary.totalKg} kg — Rs ${Math.abs(returnSummary.refund).toFixed(2)} reversed`;
      }

      // 8. Re-post invoice-derived ledger entries (mirrors createSale)
      await LedgerService.postEntry({
        branchId: sale.branchId,
        branchCode: branch.code,
        type: 'SALE',
        referenceType: 'Sale',
        referenceId: sale.id,
        referenceNumber: sale.invoiceNumber,
        partyType: 'CUSTOMER',
        partyId: customer.id,
        partyName: customer.name,
        accountType: 'ACCOUNTS_RECEIVABLE',
        debitAmount: totalBillAmount,
        creditAmount: 0,
        notes: `Sale Invoice ${sale.invoiceNumber} to ${customer.name} (edited re-post)`,
        createdBy: req.user.id
      }, dbTx);

      await LedgerService.postEntry({
        branchId: sale.branchId,
        branchCode: branch.code,
        type: 'SALE',
        referenceType: 'Sale',
        referenceId: sale.id,
        referenceNumber: sale.invoiceNumber,
        partyType: 'CUSTOMER',
        partyId: customer.id,
        partyName: customer.name,
        accountType: 'SALES_REVENUE',
        debitAmount: 0,
        creditAmount: totalBillAmount,
        notes: `Sales revenue for edited invoice ${sale.invoiceNumber}`,
        createdBy: req.user.id
      }, dbTx);

      await LedgerService.postEntry({
        branchId: sale.branchId,
        branchCode: branch.code,
        type: 'SALE',
        referenceType: 'Sale',
        referenceId: sale.id,
        referenceNumber: sale.invoiceNumber,
        partyType: 'INTERNAL',
        accountType: 'COST_OF_GOODS_SOLD',
        debitAmount: parseFloat(overallSaleCogs.toFixed(2)),
        creditAmount: 0,
        notes: `FIFO COGS for edited invoice ${sale.invoiceNumber}`,
        createdBy: req.user.id
      }, dbTx);

      if (numCommission > 0 && agent) {
        await LedgerService.postEntry({
          branchId: sale.branchId,
          branchCode: branch.code,
          type: 'AGENT_COMMISSION',
          referenceType: 'Sale',
          referenceId: sale.id,
          referenceNumber: sale.invoiceNumber,
          partyType: 'COMMISSION_AGENT',
          partyId: agent.id,
          partyName: agent.name,
          accountType: 'COMMISSION_EXPENSE',
          debitAmount: numCommission,
          creditAmount: 0,
          notes: `Agent commission on edited sale ${sale.invoiceNumber}`,
          createdBy: req.user.id
        }, dbTx);
      }

      // 9. New advance receipt (if collected alongside the edit)
      if (newAdvance > 0) {
        const paySeq = await generateSequence('PAY', branch.code, dbTx);
        const paymentVoucher = await Payment.create({
          paymentNumber: paySeq,
          branchId: sale.branchId,
          voucherType: 'RECEIPT_CUSTOMER',
          partyType: 'CUSTOMER',
          partyId: customer.id,
          amount: newAdvance,
          paymentMode: sale.paymentMode === 'CREDIT' ? 'CASH' : sale.paymentMode,
          referenceType: 'Sale',
          referenceId: sale.id,
          paymentDate: sale.saleDate,
          notes: `Advance receipt for edited Sale ${sale.invoiceNumber}`,
          createdBy: req.user.id
        }, { transaction: dbTx });

        await LedgerService.postEntry({
          branchId: sale.branchId,
          branchCode: branch.code,
          type: 'CUSTOMER_PAYMENT',
          referenceType: 'Payment',
          referenceId: paymentVoucher.id,
          referenceNumber: paySeq,
          partyType: 'CUSTOMER',
          partyId: customer.id,
          partyName: customer.name,
          accountType: sale.paymentMode === 'BANK' ? 'BANK' : 'CASH',
          debitAmount: newAdvance,
          creditAmount: 0,
          notes: `Cash/Bank receipt for edited invoice ${sale.invoiceNumber}`,
          createdBy: req.user.id
        }, dbTx);

        await LedgerService.postEntry({
          branchId: sale.branchId,
          branchCode: branch.code,
          type: 'CUSTOMER_PAYMENT',
          referenceType: 'Payment',
          referenceId: paymentVoucher.id,
          referenceNumber: paySeq,
          partyType: 'CUSTOMER',
          partyId: customer.id,
          partyName: customer.name,
          accountType: 'ACCOUNTS_RECEIVABLE',
          debitAmount: 0,
          creditAmount: newAdvance,
          notes: `Advance receipt applied against invoice ${sale.invoiceNumber}`,
          createdBy: req.user.id
        }, dbTx);
      }

      await dbTx.commit();

      await logAudit({
        req,
        action: 'UPDATE_SALE_FULL',
        entityName: 'Sale',
        entityId: sale.id,
        entityReference: sale.invoiceNumber,
        beforeState,
        afterState: {
          customerId: sale.customerId,
          saleDate: sale.saleDate,
          totalAmount: sale.totalAmount,
          items: items.map(i => ({ itemId: i.itemId, quantity: i.quantity, ratePerUnit: i.ratePerUnit })),
          returns: returnSummary ? returnSummary.lines : []
        }
      });

      return    res.json({
      success: true,
      message: `Invoice ${sale.invoiceNumber} re-posted with the updated details. FIFO stock re-allocated & ledger reversed.${parseFloat(recordedPaid) > 0 ? ` Recorded receipts of Rs ${parseFloat(recordedPaid).toFixed(2)} kept — due recalculated.` : ''}${returnSummary ? ` ${returnSummary.message}.` : ''}`,
      sale
    });
    }

    // ------------------------------------------------------------------
    // MODE 1: Header-only correction (vehicle, freight, discount, tax, notes).
    // Line items (quantities, rates, FIFO COGS) are NOT editable here.
    // ------------------------------------------------------------------
    const {
      customerId,
      saleDate,
      vehicleNumber = '',
      freightCharges,
      discountAmount,
      taxAmount,
      notes
    } = body;

    const items = sale.items || [];
    const itemsSubtotal = items.reduce((acc, i) => acc + parseFloat(i.subtotal || 0), 0);
    const itemsLineDiscount = items.reduce((acc, i) => acc + parseFloat(i.discountAmount || 0), 0);

    // Header-level recalcs: overall discount / tax / freight stay editable.
    // Line items (quantities, rates, FIFO COGS) are NOT editable — delete & re-create
    // the invoice if the fruit quantities themselves were entered wrong.
    const overallDiscount = discountAmount !== undefined ? (parseFloat(discountAmount) || 0) : parseFloat(sale.discountAmount || 0) - itemsLineDiscount;
    const numTax = taxAmount !== undefined ? (parseFloat(taxAmount) || 0) : parseFloat(sale.taxAmount || 0);
    const numFreight = freightCharges !== undefined ? (parseFloat(freightCharges) || 0) : parseFloat(sale.freightCharges || 0);

    const totalDiscount = parseFloat((itemsLineDiscount + Math.max(0, overallDiscount)).toFixed(2));
    const newTotal = parseFloat(Math.max(0, itemsSubtotal - totalDiscount + numTax + numFreight).toFixed(2));

    const paidAmt = parseFloat(sale.paidAmount || 0);
    if (paidAmt > newTotal) {
      await dbTx.rollback();
      return res.status(400).json({
        success: false,
        message: `Cannot reduce total below the already-collected amount (Rs ${paidAmt.toFixed(2)}). Record a negative adjustment via ledger reversal instead.`
      });
    }

    const newDue = parseFloat((newTotal - paidAmt).toFixed(2));
    const oldTotal = parseFloat(sale.totalAmount);
    const delta = parseFloat((newTotal - oldTotal).toFixed(2));

    // Update the invoice header
    if (customerId) {
      const cust = await Customer.findByPk(customerId, { transaction: dbTx });
      if (!cust) { await dbTx.rollback(); return res.status(400).json({ success: false, message: 'Customer not found' }); }
      sale.customerId = cust.id;
    }
    if (saleDate) sale.saleDate = saleDate;
    sale.vehicleNumber = vehicleNumber;
    sale.freightCharges = numFreight;
    sale.discountAmount = totalDiscount;
    sale.taxAmount = numTax;
    sale.totalAmount = newTotal;
    // Keep stored profit consistent with the create formula (bill − FIFO COGS −
    // commission) so header edits (discount/freight/tax) don't leave stale margins
    // in the stored value that the 14-day trend chart aggregates.
    sale.grossProfit = parseFloat((newTotal - parseFloat(sale.totalCogs || 0) - parseFloat(sale.agentCommissionAmount || 0)).toFixed(2));
    sale.dueAmount = Math.max(0, newDue);
    sale.paymentStatus = newDue <= 0 ? 'PAID' : (paidAmt > 0 ? 'PARTIAL' : 'PENDING');
    if (notes !== undefined) sale.notes = notes;
    await sale.save({ transaction: dbTx });

    // Adjust the ledger to match the new invoice total (append-only: post a
    // delta adjustment entry rather than mutating history).
    if (delta !== 0) {
      const branch = await Branch.findByPk(sale.branchId, { transaction: dbTx });
      await LedgerService.postEntry({
        branchId: sale.branchId,
        branchCode: branch.code,
        type: 'SALE',
        referenceType: 'SaleEdit',
        referenceId: sale.id,
        referenceNumber: sale.invoiceNumber,
        partyType: 'CUSTOMER',
        partyId: sale.customerId,
        partyName: (await Customer.findByPk(sale.customerId, { transaction: dbTx })).name,
        accountType: 'ACCOUNTS_RECEIVABLE',
        debitAmount: delta > 0 ? delta : 0,
        creditAmount: delta < 0 ? -delta : 0,
        notes: `Invoice edit adjustment (${delta > 0 ? '+' : ''}${delta}) on ${sale.invoiceNumber}`,
        createdBy: req.user.id
      }, dbTx);

      await LedgerService.postEntry({
        branchId: sale.branchId,
        branchCode: branch.code,
        type: 'SALE',
        referenceType: 'SaleEdit',
        referenceId: sale.id,
        referenceNumber: sale.invoiceNumber,
        partyType: 'INTERNAL',
        accountType: 'SALES_REVENUE',
        debitAmount: delta < 0 ? -delta : 0,
        creditAmount: delta > 0 ? delta : 0,
        notes: `Revenue adjustment for edited invoice ${sale.invoiceNumber}`,
        createdBy: req.user.id
      }, dbTx);
    }

    // Defective-goods returns recorded in the modal: apply the stock delta and
    // post the refund (double-entry) before committing.
    const returnKg = 0;
    let returnSummary = { lines: [], totalKg: 0, refund: 0, message: '' };
    const changedItems = [];
    const grouped = new Map();
    for (const line of items) {
      const id = parseInt(line.itemId);
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(line);
    }
    for (const [id, group] of grouped) {
      if (!returnPlan.effective.has(id)) continue;
      const newQty = returnPlan.effective.get(id);
      const oldQty = parseFloat((oldReturns.get(id) || 0).toFixed(2));
      const delta = parseFloat((newQty - oldQty).toFixed(2));
      if (Math.abs(delta) <= 0.001) continue;
      changedItems.push({ id, group });
      const conv = parseFloat(group[0].conversionFactor || 1);
      const kg = parseFloat((Math.abs(delta) * conv).toFixed(2));
      if (delta > 0) {
        await creditSaleReturnStock({
          sale,
          branchCode: (await Branch.findByPk(sale.branchId, { transaction: dbTx })).code,
          itemId: id,
          quantityKg: kg,
          reason: returnPlan.reason,
          allocs: group[0].batchAllocations || [],
          userId: req.user.id
        }, dbTx);
      } else {
        await debitSaleReturnStock({
          sale,
          itemId: id,
          quantityKg: kg,
          reason: returnPlan.reason,
          allocs: group[0].batchAllocations || [],
          userId: req.user.id
        }, dbTx);
      }
      returnSummary.lines.push({ itemId: id, previousQty: oldQty, returnedQty: newQty, quantityKg: kg });
      returnSummary.totalKg = parseFloat((returnSummary.totalKg + kg).toFixed(2));
    }
    if (returnSummary.lines.length) {
      const branchRow = await Branch.findByPk(sale.branchId, { transaction: dbTx });
      const customerRow = await Customer.findByPk(sale.customerId, { transaction: dbTx });
      returnSummary.refund = await postSaleReturnRefund({
        sale, customer: customerRow, branch: branchRow, lines: items,
        effective: returnPlan.effective, oldReturns, reason: returnPlan.reason,
        userId: req.user.id
      }, dbTx);
      returnSummary.message = returnSummary.refund >= 0
        ? `${returnSummary.totalKg} kg returned by customer — refund of Rs ${returnSummary.refund.toFixed(2)} recorded`
        : `Customer return reduced by ${returnSummary.totalKg} kg — Rs ${Math.abs(returnSummary.refund).toFixed(2)} reversed`;
    }
    await dbTx.commit();

    await logAudit({
      req,
      action: 'UPDATE_SALE',
      entityName: 'Sale',
      entityId: sale.id,
      entityReference: sale.invoiceNumber,
      beforeState: { totalAmount: oldTotal },
      afterState: { totalAmount: newTotal, freightCharges: numFreight, taxAmount: numTax, discountAmount: totalDiscount },
      returns: returnSummary.lines
    });

    res.json({
      success: true,
      message: `Invoice ${sale.invoiceNumber} updated (total Rs ${oldTotal.toFixed(2)} → Rs ${newTotal.toFixed(2)})${returnSummary ? ` ${returnSummary.message}` : ''}`,
      sale
    });
  } catch (err) {
    await dbTx.rollback();
    next(err);
  }
};

const deleteSale = async (req, res, next) => {
  const dbTx = await sequelize.transaction();
  try {
    const sale = await Sale.findByPk(req.params.id, {
      include: [{
        model: SaleItem,
        as: 'items',
        include: [{ model: SaleBatchAllocation, as: 'batchAllocations' }]
      }],
      transaction: dbTx,
      lock: dbTx.LOCK.UPDATE
    });
    if (!sale) {
      await dbTx.rollback();
      return res.status(404).json({ success: false, message: 'Sale invoice not found' });
    }
    if (req.user.role !== 'OWNER' && sale.branchId !== req.user.branchId) {
      await dbTx.rollback();
      return res.status(403).json({ success: false, message: 'Access denied: invoice belongs to another branch.' });
    }

    const branch = await Branch.findByPk(sale.branchId, { transaction: dbTx });

    // 2. Restore FIFO stock from the recorded batch allocations
    for (const item of sale.items) {
      for (const alloc of item.batchAllocations || []) {
        const batch = await StockBatch.findByPk(alloc.stockBatchId, {
          transaction: dbTx,
          lock: dbTx.LOCK.UPDATE
        });
        if (batch) {
          batch.currentQuantity = parseFloat((parseFloat(batch.currentQuantity) + parseFloat(alloc.quantityKg)).toFixed(2));
          if (batch.status === 'DEPLETED' && batch.currentQuantity > 0.001) {
            batch.status = 'ACTIVE';
          }
          await batch.save({ transaction: dbTx });
        }

        await StockMovement.create({
          batchId: alloc.stockBatchId,
          branchId: sale.branchId,
          itemId: item.itemId,
          movementType: 'SALE_CANCEL_RETURN',
          quantity: parseFloat(alloc.quantityKg),
          unit: 'kg',
          costPerUnit: parseFloat(alloc.costPerKg),
          referenceType: 'SaleDelete',
          referenceId: sale.id,
          referenceNumber: sale.invoiceNumber,
          notes: `Stock returned on deletion of invoice ${sale.invoiceNumber}`
        }, { transaction: dbTx });
      }
    }

    // Undo previously recorded return stock BEFORE deleting — the restore
    // above credited the full allocations, and the returned portion is already
    // back in stock.
    if (sale.items && sale.items.length) {
      await undoRecordedSaleReturns({
        sale,
        items: sale.items,
        oldReturns,
        reason: 'Defective fruit returned by customer (invoice deleted)',
        notes: `Prior customer return re-applied on deletion of invoice ${sale.invoiceNumber}`,
        userId: req.user.id
      }, dbTx);
    }

    // 3. Reverse every ledger entry tied to this invoice (append-only reversal)
    //    — including refund entries posted for defective-goods returns
    //    ('SaleReturn' = sticky, reversed on delete).
    const ledgerEntries = await Transaction.findAll({
      where: {
        referenceType: { [sequelize.Sequelize.Op.in]: ['Sale', 'SaleReturn'] },
        referenceId: sale.id,
        isReversed: false
      },
      transaction: dbTx
    });
    for (const entry of ledgerEntries) {
      await LedgerService.reverseTransaction(entry.id, `Sale invoice ${sale.invoiceNumber} deleted`, req.user.id, dbTx);
    }

    // 4. Unwind receipt vouchers collected against this invoice. Deleting a paid
    //    invoice must also reverse its receipts — otherwise cash would keep a
    //    phantom inflow for a sale that no longer exists. Each receipt's ledger
    //    entries get an explicit REVERSAL pair (visible in the audit ledger), and
    //    the voucher rows are removed with the invoice.
    const receiptVouchers = await Payment.findAll({
      where: { referenceType: 'Sale', referenceId: sale.id },
      transaction: dbTx
    });
    for (const voucher of receiptVouchers) {
      const voucherEntries = await Transaction.findAll({
        where: { referenceType: 'Payment', referenceId: voucher.id, isReversed: false },
        transaction: dbTx
      });
      for (const entry of voucherEntries) {
        await LedgerService.reverseTransaction(
          entry.id,
          `Receipt ${voucher.paymentNumber} reversed — invoice ${sale.invoiceNumber} deleted`,
          req.user.id,
          dbTx
        );
      }
    }
    // 5. Create deleted record backup archive snapshot for the Owner
    await backupDeletedRecord({
      entityType: 'SALE',
      entityId: sale.id,
      entityReference: sale.invoiceNumber,
      snapshot: {
        sale: sale.toJSON(),
        items: (sale.items || []).map(it => it.toJSON ? it.toJSON() : it),
        receiptVouchers: receiptVouchers.map(v => v.toJSON ? v.toJSON() : v),
        ledgerEntries: ledgerEntries.map(e => ({ id: e.id, entryNumber: e.entryNumber, debitAmount: e.debitAmount, creditAmount: e.creditAmount, accountType: e.accountType }))
      },
      branchId: sale.branchId,
      deletedById: req.user.id,
      deletedByName: req.user.name,
      deletionReason: req.body?.reason || 'Deleted via UI',
      transaction: dbTx
    });

    // 6. Cascade-delete items, then the invoice itself
    await SaleItem.destroy({ where: { saleId: sale.id }, transaction: dbTx });
    await sale.destroy({ transaction: dbTx });

    await dbTx.commit();

    await logAudit({
      req,
      action: 'DELETE_SALE',
      entityName: 'Sale',
      entityId: sale.id,
      entityReference: sale.invoiceNumber,
      beforeState: { invoiceNumber: sale.invoiceNumber, totalAmount: sale.totalAmount, customerId: sale.customerId },
      afterState: null
    });

    const refundedTotal = receiptVouchers.reduce((acc, v) => acc + parseFloat(v.amount || 0), 0);

    res.json({
      success: true,
      message: `Invoice ${sale.invoiceNumber} deleted. FIFO stock restored, invoice & receipt ledger entries reversed${refundedTotal > 0 ? ` (Rs ${refundedTotal.toFixed(2)} receipts unwound)` : ''}.`,
      deletedInvoiceNumber: sale.invoiceNumber
    });
  } catch (err) {
    await dbTx.rollback();
    next(err);
  }
};

module.exports = {
  getSales,
  getSaleById,
  createSale,
  updateSale,
  deleteSale
};
