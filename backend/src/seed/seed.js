const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');
const {
  Branch, User, Item, Supplier, Customer, CommissionAgent, Transporter,
  StockBatch, StockMovement, Transaction, RunningBalance,
  Purchase, PurchaseItem, Sale, SaleItem, SaleBatchAllocation,
  StockTransfer, WastageEntry, Payment, Expense, GatePass, AuditLog, Counter
} = require('../models');
const LedgerService = require('../services/ledgerService');
const StockService = require('../services/stockService');

async function seed() {
  console.log('--- Starting Multi-Branch Fruit Trading ERP Database Seeding ---');
  await sequelize.sync({ force: true });
  console.log('✓ Database schema refreshed cleanly.');

  // Advance document counters past the hard-coded demo documents so live-created
  // records continue gap-less (PB-DEL-2026-0003 onwards, etc.)
  await Counter.bulkCreate([
    { key: 'PB-DEL-2026', value: 2 },   // purchases seeded: 0001, 0002
    { key: 'INV-DEL-2026', value: 1 },  // sales seeded: 0001
    { key: 'PAY-DEL-2026', value: 2 },  // payments seeded: 0001, 0002
    { key: 'EXP-DEL-2026', value: 1 },  // expenses seeded: 0001
    { key: 'EXP-SHM-2026', value: 2 },  // expenses seeded: 0002 (Shimla)
    { key: 'GP-DEL-2026', value: 3 }    // gate passes seeded: 0001-0003
  ]);

  // 1. Seed Branches
  const bDelhi = await Branch.create({
    name: 'Azadpur Mandi Wholesale Hub',
    code: 'DEL',
    location: 'Azadpur, New Delhi',
    address: 'Shed 12, New Fruit Market, Azadpur, Delhi - 110033',
    phone: '+91 11 2767 8901'
  });

  const bShimla = await Branch.create({
    name: 'Shimla Orchards & Cold Storage',
    code: 'SHM',
    location: 'Kotgarh, Shimla, Himachal Pradesh',
    address: 'Agro Cold Chain Complex, NH-5, Kotgarh, HP - 172031',
    phone: '+91 177 283 4567'
  });

  const bMumbai = await Branch.create({
    name: 'Vashi APMC Western Distribution',
    code: 'MUM',
    location: 'Turbhe, Navi Mumbai, Maharashtra',
    address: 'Market II, Fruit Wing, APMC Market, Vashi, Navi Mumbai - 400703',
    phone: '+91 22 2788 1234'
  });
  console.log('✓ Branches seeded (Delhi, Shimla, Mumbai).');

  // 2. Seed Users
  const passwordOwner = await bcrypt.hash('admin123', 10);
  const passwordMgr = await bcrypt.hash('manager123', 10);
  const passwordStaff = await bcrypt.hash('staff123', 10);
  const passwordAcct = await bcrypt.hash('account123', 10);

  const uOwner = await User.create({
    name: 'Harish Patel (Managing Director)',
    email: 'owner@hpfruits.com',
    passwordHash: passwordOwner,
    role: 'OWNER',
    branchId: null,
    phone: '+91 98100 11223'
  });

  const uMgrDel = await User.create({
    name: 'Rajinder Kumar (Delhi Manager)',
    email: 'manager.delhi@hpfruits.com',
    passwordHash: passwordMgr,
    role: 'BRANCH_MANAGER',
    branchId: bDelhi.id,
    phone: '+91 98111 22334'
  });

  const uMgrShm = await User.create({
    name: 'Suresh Chauhan (Shimla Manager)',
    email: 'manager.shimla@hpfruits.com',
    passwordHash: passwordMgr,
    role: 'BRANCH_MANAGER',
    branchId: bShimla.id,
    phone: '+91 98160 33445'
  });

  const uStaffDel = await User.create({
    name: 'Vikas Sharma (Mandi Entry Clerk)',
    email: 'staff.delhi@hpfruits.com',
    passwordHash: passwordStaff,
    role: 'STAFF',
    branchId: bDelhi.id,
    phone: '+91 98112 44556'
  });

  const uAcct = await User.create({
    name: 'Deepak Mehrotra (Head Accountant)',
    email: 'accountant@hpfruits.com',
    passwordHash: passwordAcct,
    role: 'ACCOUNTANT',
    branchId: bDelhi.id,
    phone: '+91 98113 55667'
  });
  console.log('✓ Users seeded for all 4 roles.');

  // 3. Seed Items (Fruit catalogue with conversion factors and reorder thresholds)
  const itemsData = [
    {
      name: 'Apple',
      variety: 'Royal Delicious (Grade A)',
      category: 'Temperate Fruit',
      baseUnit: 'kg',
      packagingUnit: 'crate',
      unitConversionFactor: 20.0, // 20 kg per crate
      reorderThreshold: 300.0,
      shelfLifeDays: 21
    },
    {
      name: 'Apple',
      variety: 'Golden Delicious',
      category: 'Temperate Fruit',
      baseUnit: 'kg',
      packagingUnit: 'crate',
      unitConversionFactor: 20.0,
      reorderThreshold: 200.0,
      shelfLifeDays: 25
    },
    {
      name: 'Apple',
      variety: 'Kashmir Gala',
      category: 'Temperate Fruit',
      baseUnit: 'kg',
      packagingUnit: 'box',
      unitConversionFactor: 10.0, // 10 kg per box
      reorderThreshold: 150.0,
      shelfLifeDays: 18
    },
    {
      name: 'Kinnow',
      variety: 'Punjab Sweet Mandarin',
      category: 'Citrus',
      baseUnit: 'kg',
      packagingUnit: 'crate',
      unitConversionFactor: 25.0, // 25 kg per crate
      reorderThreshold: 400.0,
      shelfLifeDays: 14
    },
    {
      name: 'Orange',
      variety: 'Nagpur Santra (Sweet)',
      category: 'Citrus',
      baseUnit: 'kg',
      packagingUnit: 'crate',
      unitConversionFactor: 20.0,
      reorderThreshold: 250.0,
      shelfLifeDays: 12
    },
    {
      name: 'Mango',
      variety: 'Ratnagiri Alphonso (Hapus)',
      category: 'Tropical Fruit',
      baseUnit: 'kg',
      packagingUnit: 'box',
      unitConversionFactor: 4.0, // 4 kg box (1 dozen)
      reorderThreshold: 100.0,
      shelfLifeDays: 8
    },
    {
      name: 'Pomegranate',
      variety: 'Bhagwa Super Red',
      category: 'Sub-Tropical Fruit',
      baseUnit: 'kg',
      packagingUnit: 'box',
      unitConversionFactor: 10.0,
      reorderThreshold: 150.0,
      shelfLifeDays: 20
    },
    {
      name: 'Mosambi',
      variety: 'Nanded Sweet Lime',
      category: 'Citrus',
      baseUnit: 'kg',
      packagingUnit: 'crate',
      unitConversionFactor: 22.0,
      reorderThreshold: 200.0,
      shelfLifeDays: 10
    }
  ];

  const items = await Item.bulkCreate(itemsData);
  console.log(`✓ ${items.length} Fruit items seeded.`);

  // 4. Seed Suppliers (Fruit growers and cooperatives)
  const supp1 = await Supplier.create({
    name: 'Himachal Agro Orchards Ltd',
    contactPerson: 'Kalyan Singh Negi',
    phone: '+91 98160 88990',
    email: 'info@himachalagro.com',
    address: 'Thanedhar Apple Valley, Kotgarh, Shimla, HP',
    gstNumber: '02AAACH1234F1Z8',
    openingBalance: 0.0
  });

  const supp2 = await Supplier.create({
    name: 'Kashmir Valley Fruit Growers Syndicate',
    contactPerson: 'Ghulam Mohammad Mir',
    phone: '+91 94190 77889',
    email: 'sopore.fruits@kashmirproduce.org',
    address: 'Fruit Mandi Complex, Sopore, Baramulla, J&K',
    gstNumber: '01AAACK5678G1Z2',
    openingBalance: 0.0
  });

  const supp3 = await Supplier.create({
    name: 'Vidarbha Citrus Producers Co-op',
    contactPerson: 'Ganesh Deshmukh',
    phone: '+91 98222 66778',
    email: 'vidarbha.citrus@gmail.com',
    address: 'APMC Market Yard, Kalmeshwar, Nagpur, MH',
    gstNumber: '27AAACV9012H1Z5',
    openingBalance: 0.0
  });

  const supp4 = await Supplier.create({
    name: 'Malwa Kinnow Farm Produce',
    contactPerson: 'Harpreet Singh Brar',
    phone: '+91 98720 55667',
    email: 'kinnow.brar@malwafarms.in',
    address: 'GT Road, Abohar, Fazilka, Punjab',
    gstNumber: '03AAACM3456J1Z9',
    openingBalance: 0.0
  });
  console.log('✓ Suppliers seeded.');

  // 5. Seed Customers
  const cust1 = await Customer.create({
    name: 'Modern Fresh Supermarkets Pvt Ltd',
    contactPerson: 'Anil Kapoor (Head Procurement)',
    phone: '+91 98105 11223',
    email: 'procurement@modernfresh.com',
    address: 'Central Warehouse, Okhla Phase II, New Delhi - 110020',
    gstNumber: '07AAACM4455K1Z1',
    creditLimit: 300000.0,
    openingBalance: 0.0
  });

  const cust2 = await Customer.create({
    name: 'BigBasket Wholesale Hub (North)',
    contactPerson: 'Pooja Nair',
    phone: '+91 98188 33445',
    email: 'north.sourcing@bigbasket.com',
    address: 'Logistics Park, Bilaspur Chowk, NH-8, Gurugram, HR',
    gstNumber: '06AAACB7788L1Z3',
    creditLimit: 500000.0,
    openingBalance: 0.0
  });

  const cust3 = await Customer.create({
    name: 'Khan Market Premium Fruit Boutique',
    contactPerson: 'Sunil Aggarwal',
    phone: '+91 98110 55667',
    email: 'sunil@kmfruits.com',
    address: 'Shop 28-A, Khan Market, New Delhi - 110003',
    gstNumber: '07AAACS9900M1Z7',
    creditLimit: 100000.0,
    openingBalance: 0.0
  });

  const cust4 = await Customer.create({
    name: 'Subzi Mandi Local Retailer Syndicate',
    contactPerson: 'Mahesh Gupta',
    phone: '+91 98119 66778',
    email: 'mahesh.retail@gmail.com',
    address: 'Ghanta Ghar, Subzi Mandi, Delhi - 110007',
    gstNumber: '',
    creditLimit: 75000.0,
    openingBalance: 0.0
  });
  console.log('✓ Customers seeded.');

  // 6. Seed Commission Agents (Arhtiyas)
  const agent1 = await CommissionAgent.create({
    name: 'M/s Ram Gopal & Sons (Commission Agents)',
    contactPerson: 'Satish Aggarwal',
    phone: '+91 98111 88990',
    defaultCommissionRate: 5.0, // 5%
    address: 'Shop No. 44, Block C, Azadpur Mandi, Delhi - 110033'
  });

  const agent2 = await CommissionAgent.create({
    name: 'Kalka Apple Commission House',
    contactPerson: 'Mohan Lal Verma',
    phone: '+91 98160 44556',
    defaultCommissionRate: 4.5,
    address: 'Bypass Road, Solan Mandi, Himachal Pradesh'
  });
  console.log('✓ Commission Agents seeded.');

  // 7. Seed Transporters
  const trans1 = await Transporter.create({
    name: 'Himalayan Cold Chain Express',
    vehicleNumber: 'HP-01-AA-4582',
    driverName: 'Ramesh Thakur',
    driverPhone: '+91 98160 12345',
    transportCompany: 'Himalayan Logistics Ltd'
  });

  const trans2 = await Transporter.create({
    name: 'Punjab Green Freight Carrier',
    vehicleNumber: 'PB-05-AB-8821',
    driverName: 'Gurpreet Singh',
    driverPhone: '+91 98765 43210',
    transportCompany: 'Golden Roadways'
  });
  console.log('✓ Transporters seeded.');

  // 8. Create Purchase 1: Royal Delicious Apple into Delhi branch
  // Demonstrating: Commission Agent, Freight, and Weight Variance (Moisture/Transit shrinkage)
  const dbTx1 = await sequelize.transaction();
  const appleItem = items[0]; // Royal Delicious
  const purDate = new Date();
  purDate.setDate(purDate.getDate() - 5);
  const purDateStr = purDate.toISOString().split('T')[0];

  const p1BilledQty = 150; // 150 crates = 3000 kg billed
  const p1RecQty = 150;
  const p1Rate = 1400.0; // Rs 1400 per crate
  const p1Subtotal = p1RecQty * p1Rate; // 210,000
  const p1Freight = 9000.0;
  const p1Commission = parseFloat(((p1Subtotal * 5.0) / 100).toFixed(2)); // Rs 10,500
  const p1BilledWt = 3000.0; // kg
  const p1RecWt = 2960.0; // 40 kg transit moisture loss
  const p1WtLossAmt = parseFloat((40 * 70).toFixed(2)); // Rs 2800 loss
  const p1TotalPayable = p1Subtotal; // Rs 210,000
  const p1Paid = 100000.0;
  const p1Due = p1TotalPayable - p1Paid;

  const pur1 = await Purchase.create({
    invoiceNumber: 'PB-DEL-2026-0001',
    supplierInvoiceNumber: 'HA-EXP-9081',
    branchId: bDelhi.id,
    supplierId: supp1.id,
    hasAgent: true,
    agentId: agent1.id,
    agentCommissionRate: 5.0,
    agentCommissionAmount: p1Commission,
    transporterId: trans1.id,
    vehicleNumber: trans1.vehicleNumber,
    freightCharges: p1Freight,
    loadingCharges: 1500.0,
    otherCharges: 500.0,
    totalBilledWeight: p1BilledWt,
    totalReceivedWeight: p1RecWt,
    weightVariance: 40.0,
    weightVarianceReason: 'Moisture evaporation and transit shrinkage during mountain transit',
    weightVarianceLossAmount: p1WtLossAmt,
    subtotal: p1Subtotal,
    discountAmount: 0.0,
    totalAmount: p1TotalPayable,
    paidAmount: p1Paid,
    dueAmount: p1Due,
    paymentStatus: 'PARTIAL',
    paymentMode: 'BANK',
    purchaseDate: purDateStr,
    notes: 'Premium high-altitude Shimla Royal Delicious lot',
    createdBy: uMgrDel.id
  }, { transaction: dbTx1 });

  // Landed Cost calculation: (subtotal + freight + loading + other + commission) / netWeight
  const p1LandedTotal = p1Subtotal + p1Freight + 1500 + 500 + p1Commission; // 231,500
  const p1LandedPerKg = parseFloat((p1LandedTotal / p1RecWt).toFixed(2)); // ~Rs 78.21/kg

  const batch1 = await StockBatch.create({
    batchNumber: 'LOT-DEL-260313-1-101',
    branchId: bDelhi.id,
    itemId: appleItem.id,
    purchaseId: pur1.id,
    initialQuantity: p1RecWt,
    currentQuantity: p1RecWt,
    unit: 'kg',
    purchaseRate: 70.0, // Rs 70 per kg
    landedCostPerUnit: p1LandedPerKg,
    receivedDate: purDateStr,
    expiryDate: new Date(Date.now() + 20 * 86400000).toISOString().split('T')[0],
    status: 'ACTIVE'
  }, { transaction: dbTx1 });

  await PurchaseItem.create({
    purchaseId: pur1.id,
    itemId: appleItem.id,
    billedQuantity: p1BilledQty,
    receivedQuantity: p1RecQty,
    unit: 'crate',
    conversionFactor: 20.0,
    receivedWeightKg: p1RecWt,
    ratePerUnit: p1Rate,
    discountAmount: 0.0,
    subtotal: p1Subtotal,
    allocatedFreight: p1Freight,
    allocatedCommission: p1Commission,
    allocatedOtherCharges: 2000.0,
    landedCostTotal: p1LandedTotal,
    landedCostPerKg: p1LandedPerKg,
    batchId: batch1.id
  }, { transaction: dbTx1 });

  await StockMovement.create({
    batchId: batch1.id,
    branchId: bDelhi.id,
    itemId: appleItem.id,
    movementType: 'PURCHASE_IN',
    quantity: p1RecWt,
    unit: 'kg',
    costPerUnit: p1LandedPerKg,
    referenceType: 'Purchase',
    referenceId: pur1.id,
    referenceNumber: pur1.invoiceNumber,
    notes: 'Initial fruit lot arrival'
  }, { transaction: dbTx1 });

  // Immutable Ledger Postings for Purchase 1
  await LedgerService.postEntry({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    type: 'PURCHASE',
    referenceType: 'Purchase',
    referenceId: pur1.id,
    referenceNumber: pur1.invoiceNumber,
    partyType: 'SUPPLIER',
    partyId: supp1.id,
    partyName: supp1.name,
    accountType: 'ACCOUNTS_PAYABLE',
    debitAmount: 0,
    creditAmount: p1TotalPayable,
    notes: `Purchase Bill PB-DEL-2026-0001 from ${supp1.name}`,
    createdBy: uMgrDel.id
  }, dbTx1);

  await LedgerService.postEntry({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    type: 'WEIGHT_ADJUSTMENT',
    referenceType: 'Purchase',
    referenceId: pur1.id,
    referenceNumber: pur1.invoiceNumber,
    partyType: 'INTERNAL',
    accountType: 'WEIGHT_LOSS',
    debitAmount: p1WtLossAmt,
    creditAmount: 0,
    notes: `Weight variance shrinkage loss on arrival: 40 kg`,
    createdBy: uMgrDel.id
  }, dbTx1);

  await LedgerService.postEntry({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    type: 'AGENT_COMMISSION',
    referenceType: 'Purchase',
    referenceId: pur1.id,
    referenceNumber: pur1.invoiceNumber,
    partyType: 'COMMISSION_AGENT',
    partyId: agent1.id,
    partyName: agent1.name,
    accountType: 'COMMISSION_EXPENSE',
    debitAmount: p1Commission,
    creditAmount: 0,
    notes: `5% mandi commission payable to ${agent1.name}`,
    createdBy: uMgrDel.id
  }, dbTx1);

  // Partial Payment posting
  const payVoucher1 = await Payment.create({
    paymentNumber: 'PAY-DEL-2026-0001',
    branchId: bDelhi.id,
    voucherType: 'PAYMENT_SUPPLIER',
    partyType: 'SUPPLIER',
    partyId: supp1.id,
    amount: p1Paid,
    paymentMode: 'BANK',
    referenceType: 'Purchase',
    referenceId: pur1.id,
    bankReference: 'NEFT-SBIN20260313-9901',
    paymentDate: purDateStr,
    notes: 'Advance bank payment on bill PB-DEL-2026-0001',
    createdBy: uAcct.id
  }, { transaction: dbTx1 });

  await LedgerService.postEntry({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    type: 'SUPPLIER_PAYMENT',
    referenceType: 'Payment',
    referenceId: payVoucher1.id,
    referenceNumber: payVoucher1.paymentNumber,
    partyType: 'SUPPLIER',
    partyId: supp1.id,
    partyName: supp1.name,
    accountType: 'ACCOUNTS_PAYABLE',
    debitAmount: p1Paid,
    creditAmount: 0,
    notes: `Bank payment against bill PB-DEL-2026-0001`,
    createdBy: uAcct.id
  }, dbTx1);

  await LedgerService.postEntry({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    type: 'SUPPLIER_PAYMENT',
    referenceType: 'Payment',
    referenceId: payVoucher1.id,
    referenceNumber: payVoucher1.paymentNumber,
    partyType: 'SUPPLIER',
    partyId: supp1.id,
    partyName: supp1.name,
    accountType: 'BANK',
    debitAmount: 0,
    creditAmount: p1Paid,
    notes: `NEFT transfer to ${supp1.name}`,
    createdBy: uAcct.id
  }, dbTx1);

  await dbTx1.commit();
  console.log('✓ Purchase 1 and FIFO Lot 1 created with append-only ledger entries.');

  // 9. Create Purchase 2: Kinnow Mandarin into Delhi branch
  const dbTx2 = await sequelize.transaction();
  const kinnowItem = items[3]; // Kinnow Mandarin
  const pur2Date = new Date();
  pur2Date.setDate(pur2Date.getDate() - 3);
  const pur2DateStr = pur2Date.toISOString().split('T')[0];

  const p2RecQty = 200; // 200 crates = 5000 kg
  const p2Rate = 750.0; // Rs 750/crate
  const p2Subtotal = p2RecQty * p2Rate; // Rs 150,000
  const p2Freight = 12000.0;
  const p2LandedTotal = p2Subtotal + p2Freight + 2000.0;
  const p2LandedPerKg = parseFloat((p2LandedTotal / 5000).toFixed(2)); // ~Rs 32.80/kg

  const pur2 = await Purchase.create({
    invoiceNumber: 'PB-DEL-2026-0002',
    supplierInvoiceNumber: 'MK-2026-104',
    branchId: bDelhi.id,
    supplierId: supp4.id,
    hasAgent: false,
    transporterId: trans2.id,
    vehicleNumber: trans2.vehicleNumber,
    freightCharges: p2Freight,
    loadingCharges: 2000.0,
    otherCharges: 0.0,
    totalBilledWeight: 5000.0,
    totalReceivedWeight: 5000.0,
    weightVariance: 0.0,
    subtotal: p2Subtotal,
    discountAmount: 0.0,
    totalAmount: p2Subtotal,
    paidAmount: 0.0,
    dueAmount: p2Subtotal,
    paymentStatus: 'PENDING',
    paymentMode: 'CREDIT',
    purchaseDate: pur2DateStr,
    notes: 'Direct farm procurement from Abohar orchards',
    createdBy: uMgrDel.id
  }, { transaction: dbTx2 });

  const batch2 = await StockBatch.create({
    batchNumber: 'LOT-DEL-260315-4-102',
    branchId: bDelhi.id,
    itemId: kinnowItem.id,
    purchaseId: pur2.id,
    initialQuantity: 5000.0,
    currentQuantity: 5000.0,
    unit: 'kg',
    purchaseRate: 30.0,
    landedCostPerUnit: p2LandedPerKg,
    receivedDate: pur2DateStr,
    expiryDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    status: 'ACTIVE'
  }, { transaction: dbTx2 });

  await PurchaseItem.create({
    purchaseId: pur2.id,
    itemId: kinnowItem.id,
    billedQuantity: p2RecQty,
    receivedQuantity: p2RecQty,
    unit: 'crate',
    conversionFactor: 25.0,
    receivedWeightKg: 5000.0,
    ratePerUnit: p2Rate,
    discountAmount: 0.0,
    subtotal: p2Subtotal,
    allocatedFreight: p2Freight,
    allocatedCommission: 0.0,
    allocatedOtherCharges: 2000.0,
    landedCostTotal: p2LandedTotal,
    landedCostPerKg: p2LandedPerKg,
    batchId: batch2.id
  }, { transaction: dbTx2 });

  await StockMovement.create({
    batchId: batch2.id,
    branchId: bDelhi.id,
    itemId: kinnowItem.id,
    movementType: 'PURCHASE_IN',
    quantity: 5000.0,
    unit: 'kg',
    costPerUnit: p2LandedPerKg,
    referenceType: 'Purchase',
    referenceId: pur2.id,
    referenceNumber: pur2.invoiceNumber,
    notes: 'Direct Punjab Kinnow arrival'
  }, { transaction: dbTx2 });

  await LedgerService.postEntry({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    type: 'PURCHASE',
    referenceType: 'Purchase',
    referenceId: pur2.id,
    referenceNumber: pur2.invoiceNumber,
    partyType: 'SUPPLIER',
    partyId: supp4.id,
    partyName: supp4.name,
    accountType: 'ACCOUNTS_PAYABLE',
    debitAmount: 0,
    creditAmount: p2Subtotal,
    notes: `Credit purchase bill PB-DEL-2026-0002 from ${supp4.name}`,
    createdBy: uMgrDel.id
  }, dbTx2);

  await dbTx2.commit();
  console.log('✓ Purchase 2 and FIFO Lot 2 created.');

  // 10. Create Sale 1: Modern Fresh Supermarkets
  // Demonstrating: FIFO deduction from batch1, COGS calculation, and Gross Profit
  const dbTx3 = await sequelize.transaction();
  const sale1Date = new Date();
  sale1Date.setDate(sale1Date.getDate() - 2);
  const sale1DateStr = sale1Date.toISOString().split('T')[0];

  // Selling 50 crates Apple = 1000 kg (from batch1)
  const s1AppleQtyKg = 1000.0;
  const s1AppleRatePerKg = 110.0; // Selling at Rs 110/kg
  const s1AppleSubtotal = s1AppleQtyKg * s1AppleRatePerKg; // Rs 110,000

  // Deduct from batch1
  batch1.currentQuantity = parseFloat((parseFloat(batch1.currentQuantity) - s1AppleQtyKg).toFixed(2));
  await batch1.save({ transaction: dbTx3 });

  const s1AppleCogs = parseFloat((s1AppleQtyKg * parseFloat(batch1.landedCostPerUnit)).toFixed(2)); // ~Rs 78,210
  const s1TotalAmount = s1AppleSubtotal;
  const s1GrossProfit = parseFloat((s1TotalAmount - s1AppleCogs).toFixed(2)); // ~Rs 31,790

  const sale1 = await Sale.create({
    invoiceNumber: 'INV-DEL-2026-0001',
    branchId: bDelhi.id,
    customerId: cust1.id,
    hasAgent: false,
    transporterId: null,
    vehicleNumber: 'DL-1L-3344',
    freightCharges: 0.0,
    subtotal: s1TotalAmount,
    discountAmount: 0.0,
    taxAmount: 0.0,
    totalAmount: s1TotalAmount,
    totalCogs: s1AppleCogs,
    grossProfit: s1GrossProfit,
    paidAmount: 50000.0,
    dueAmount: s1TotalAmount - 50000.0,
    paymentStatus: 'PARTIAL',
    paymentMode: 'BANK',
    saleDate: sale1DateStr,
    notes: 'Bulk dispatch for modern retail distribution',
    createdBy: uStaffDel.id
  }, { transaction: dbTx3 });

  const saleItem1 = await SaleItem.create({
    saleId: sale1.id,
    itemId: appleItem.id,
    quantity: 50.0,
    unit: 'crate',
    conversionFactor: 20.0,
    weightKg: s1AppleQtyKg,
    ratePerUnit: 2200.0,
    discountAmount: 0.0,
    subtotal: s1AppleSubtotal,
    cogsAmount: s1AppleCogs,
    profitAmount: s1GrossProfit
  }, { transaction: dbTx3 });

  await SaleBatchAllocation.create({
    saleItemId: saleItem1.id,
    stockBatchId: batch1.id,
    quantityKg: s1AppleQtyKg,
    costPerKg: batch1.landedCostPerUnit,
    totalCost: s1AppleCogs
  }, { transaction: dbTx3 });

  await StockMovement.create({
    batchId: batch1.id,
    branchId: bDelhi.id,
    itemId: appleItem.id,
    movementType: 'SALE_OUT',
    quantity: s1AppleQtyKg,
    unit: 'kg',
    costPerUnit: batch1.landedCostPerUnit,
    referenceType: 'Sale',
    referenceId: sale1.id,
    referenceNumber: sale1.invoiceNumber,
    notes: `FIFO deduction for sale to ${cust1.name}`
  }, { transaction: dbTx3 });

  // Append-Only Ledger Postings for Sale 1
  await LedgerService.postEntry({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    type: 'SALE',
    referenceType: 'Sale',
    referenceId: sale1.id,
    referenceNumber: sale1.invoiceNumber,
    partyType: 'CUSTOMER',
    partyId: cust1.id,
    partyName: cust1.name,
    accountType: 'ACCOUNTS_RECEIVABLE',
    debitAmount: s1TotalAmount,
    creditAmount: 0,
    notes: `Sale Invoice INV-DEL-2026-0001 to ${cust1.name}`,
    createdBy: uStaffDel.id
  }, dbTx3);

  await LedgerService.postEntry({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    type: 'SALE',
    referenceType: 'Sale',
    referenceId: sale1.id,
    referenceNumber: sale1.invoiceNumber,
    partyType: 'CUSTOMER',
    partyId: cust1.id,
    partyName: cust1.name,
    accountType: 'SALES_REVENUE',
    debitAmount: 0,
    creditAmount: s1TotalAmount,
    notes: `Sales revenue for invoice ${sale1.invoiceNumber}`,
    createdBy: uStaffDel.id
  }, dbTx3);

  await LedgerService.postEntry({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    type: 'SALE',
    referenceType: 'Sale',
    referenceId: sale1.id,
    referenceNumber: sale1.invoiceNumber,
    partyType: 'INTERNAL',
    accountType: 'COST_OF_GOODS_SOLD',
    debitAmount: s1AppleCogs,
    creditAmount: 0,
    notes: `COGS for invoice ${sale1.invoiceNumber}`,
    createdBy: uStaffDel.id
  }, dbTx3);

  // Partial Payment receipt posting
  const receiptVoucher1 = await Payment.create({
    paymentNumber: 'PAY-DEL-2026-0002',
    branchId: bDelhi.id,
    voucherType: 'RECEIPT_CUSTOMER',
    partyType: 'CUSTOMER',
    partyId: cust1.id,
    amount: 50000.0,
    paymentMode: 'BANK',
    referenceType: 'Sale',
    referenceId: sale1.id,
    bankReference: 'UPI-HDFC-99220199',
    paymentDate: sale1DateStr,
    notes: `Partial payment received from ${cust1.name}`,
    createdBy: uAcct.id
  }, { transaction: dbTx3 });

  await LedgerService.postEntry({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    type: 'CUSTOMER_PAYMENT',
    referenceType: 'Payment',
    referenceId: receiptVoucher1.id,
    referenceNumber: receiptVoucher1.paymentNumber,
    partyType: 'CUSTOMER',
    partyId: cust1.id,
    partyName: cust1.name,
    accountType: 'BANK',
    debitAmount: 50000.0,
    creditAmount: 0,
    notes: `Bank receipt from ${cust1.name}`,
    createdBy: uAcct.id
  }, dbTx3);

  await LedgerService.postEntry({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    type: 'CUSTOMER_PAYMENT',
    referenceType: 'Payment',
    referenceId: receiptVoucher1.id,
    referenceNumber: receiptVoucher1.paymentNumber,
    partyType: 'CUSTOMER',
    partyId: cust1.id,
    partyName: cust1.name,
    accountType: 'ACCOUNTS_RECEIVABLE',
    debitAmount: 0,
    creditAmount: 50000.0,
    notes: `Credit applied to customer account`,
    createdBy: uAcct.id
  }, dbTx3);

  await dbTx3.commit();
  console.log('✓ Sale 1 created with FIFO deduction and verified COGS.');

  // 11. Create Fruit Spoilage / Wastage Entry
  const dbTx4 = await sequelize.transaction();
  await StockService.recordWastage({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    itemId: appleItem.id,
    stockBatchId: batch1.id,
    quantityKg: 30.0,
    reason: 'Transit Bruising and pressure rot on bottom crates',
    actionTaken: 'Sold to local juice vendor at salvage value',
    salvageRecoveryAmount: 300.0, // Rs 10/kg recovered in cash
    entryDate: new Date().toISOString().split('T')[0],
    notes: 'Inspected by warehouse quality auditor',
    userId: uMgrDel.id
  }, dbTx4);
  await dbTx4.commit();
  console.log('✓ Fruit wastage write-off recorded with ledger loss.');

  // 12. Create Operational Expenses (Labor/Palledar, Mandi Tax, Cold Storage Electricity)
  const dbTx5 = await sequelize.transaction();
  const expSeq1 = 'EXP-DEL-2026-0001';
  const exp1 = await Expense.create({
    expenseNumber: expSeq1,
    branchId: bDelhi.id,
    category: 'LABOR_PALLEDAR',
    amount: 4500.0,
    paymentMode: 'CASH',
    paidTo: 'Azadpur Mandi Hamal Union',
    description: 'Unloading charges for 350 fruit crates from HP & Punjab trucks',
    receiptNo: 'HAM-449',
    expenseDate: new Date().toISOString().split('T')[0],
    createdBy: uStaffDel.id
  }, { transaction: dbTx5 });

  await LedgerService.postEntry({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    type: 'OPERATING_EXPENSE',
    referenceType: 'Expense',
    referenceId: exp1.id,
    referenceNumber: expSeq1,
    partyType: 'INTERNAL',
    accountType: 'OPERATING_EXPENSE',
    debitAmount: 4500.0,
    creditAmount: 0,
    notes: `Labor/Palledar charges paid in cash`,
    createdBy: uStaffDel.id
  }, dbTx5);

  await LedgerService.postEntry({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    type: 'OPERATING_EXPENSE',
    referenceType: 'Expense',
    referenceId: exp1.id,
    referenceNumber: expSeq1,
    partyType: 'INTERNAL',
    accountType: 'CASH',
    debitAmount: 0,
    creditAmount: 4500.0,
    notes: `Cash disbursement for labor`,
    createdBy: uStaffDel.id
  }, dbTx5);

  // Cold Storage electricity expense
  const expSeq2 = 'EXP-SHM-2026-0002';
  const exp2 = await Expense.create({
    expenseNumber: expSeq2,
    branchId: bShimla.id,
    category: 'ELECTRICITY',
    amount: 18500.0,
    paymentMode: 'BANK',
    paidTo: 'Himachal Pradesh State Electricity Board',
    description: 'Cold storage temperature control electric power for March',
    receiptNo: 'EB-99201',
    expenseDate: new Date().toISOString().split('T')[0],
    createdBy: uMgrShm.id
  }, { transaction: dbTx5 });

  await LedgerService.postEntry({
    branchId: bShimla.id,
    branchCode: 'SHM',
    type: 'OPERATING_EXPENSE',
    referenceType: 'Expense',
    referenceId: exp2.id,
    referenceNumber: expSeq2,
    partyType: 'INTERNAL',
    accountType: 'OPERATING_EXPENSE',
    debitAmount: 18500.0,
    creditAmount: 0,
    notes: `Cold storage power utility bill`,
    createdBy: uMgrShm.id
  }, dbTx5);

  await LedgerService.postEntry({
    branchId: bShimla.id,
    branchCode: 'SHM',
    type: 'OPERATING_EXPENSE',
    referenceType: 'Expense',
    referenceId: exp2.id,
    referenceNumber: expSeq2,
    partyType: 'INTERNAL',
    accountType: 'BANK',
    debitAmount: 0,
    creditAmount: 18500.0,
    notes: `Bank payout for power bill`,
    createdBy: uMgrShm.id
  }, dbTx5);

  await dbTx5.commit();
  console.log('✓ Operational expenses seeded.');

  // 13. Create Gate Passes
  await GatePass.create({
    passNumber: 'GP-DEL-2026-0001',
    branchId: bDelhi.id,
    passType: 'INWARD',
    vehicleNumber: 'HP-01-AA-4582',
    driverName: 'Ramesh Thakur',
    driverPhone: '+91 98160 12345',
    purpose: 'PURCHASE_DELIVERY',
    referenceType: 'Purchase',
    referenceId: pur1.id,
    referenceNumber: pur1.invoiceNumber,
    timeIn: new Date(Date.now() - 5 * 86400000),
    timeOut: new Date(Date.now() - 5 * 86400000 + 4 * 3600000),
    grossWeightKg: 12450.0,
    tareWeightKg: 9490.0,
    netFruitWeightKg: 2960.0,
    securityGuardName: 'Prem Singh',
    status: 'EXITED',
    notes: 'Apple truck from Kotgarh unloaded cleanly',
    createdBy: uStaffDel.id
  });

  await GatePass.create({
    passNumber: 'GP-DEL-2026-0002',
    branchId: bDelhi.id,
    passType: 'INWARD',
    vehicleNumber: 'PB-05-AB-8821',
    driverName: 'Gurpreet Singh',
    driverPhone: '+91 98765 43210',
    purpose: 'PURCHASE_DELIVERY',
    referenceType: 'Purchase',
    referenceId: pur2.id,
    referenceNumber: pur2.invoiceNumber,
    timeIn: new Date(Date.now() - 3 * 86400000),
    timeOut: new Date(Date.now() - 3 * 86400000 + 3 * 3600000),
    grossWeightKg: 14200.0,
    tareWeightKg: 9200.0,
    netFruitWeightKg: 5000.0,
    securityGuardName: 'Prem Singh',
    status: 'EXITED',
    notes: 'Kinnow delivery from Abohar',
    createdBy: uStaffDel.id
  });

  await GatePass.create({
    passNumber: 'GP-DEL-2026-0003',
    branchId: bDelhi.id,
    passType: 'OUTWARD',
    vehicleNumber: 'DL-1L-3344',
    driverName: 'Mohd Aslam',
    driverPhone: '+91 98110 99887',
    purpose: 'SALE_DISPATCH',
    referenceType: 'Sale',
    referenceId: sale1.id,
    referenceNumber: sale1.invoiceNumber,
    timeIn: new Date(),
    timeOut: null,
    grossWeightKg: 4500.0,
    tareWeightKg: 3500.0,
    netFruitWeightKg: 1000.0,
    securityGuardName: 'Sunder Lal',
    status: 'IN_PREMISES',
    notes: 'Modern Fresh pickup vehicle loading at bay 2',
    createdBy: uStaffDel.id
  });
  console.log('✓ Gate passes seeded.');

  // 14. Initial cash on hand buffer in ledger
  const dbTx6 = await sequelize.transaction();
  await LedgerService.postEntry({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    type: 'CUSTOMER_PAYMENT',
    referenceType: 'OpeningBalance',
    accountType: 'CASH',
    debitAmount: 150000.0,
    creditAmount: 0,
    notes: 'Opening cash in chest for Mandi operations',
    createdBy: uAcct.id
  }, dbTx6);

  await LedgerService.postEntry({
    branchId: bDelhi.id,
    branchCode: 'DEL',
    type: 'CUSTOMER_PAYMENT',
    referenceType: 'OpeningBalance',
    accountType: 'BANK',
    debitAmount: 850000.0,
    creditAmount: 0,
    notes: 'Current account bank opening balance (HDFC Azadpur)',
    createdBy: uAcct.id
  }, dbTx6);
  await dbTx6.commit();

  console.log('======================================================');
  console.log('🎉 SEEDING COMPLETE: Multi-Branch Fruit ERP Initialized!');
  console.log('Credentials for immediate testing:');
  console.log('  Owner:          owner@hpfruits.com          / admin123');
  console.log('  Delhi Manager:  manager.delhi@hpfruits.com  / manager123');
  console.log('  Shimla Manager: manager.shimla@hpfruits.com / manager123');
  console.log('  Delhi Staff:    staff.delhi@hpfruits.com    / staff123');
  console.log('  Accountant:     accountant@hpfruits.com     / account123');
  console.log('======================================================');
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
