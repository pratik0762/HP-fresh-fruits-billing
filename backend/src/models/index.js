const { sequelize, Sequelize } = require('../config/database');

const Branch = require('./Branch');
const User = require('./User');
const Item = require('./Item');
const Supplier = require('./Supplier');
const Customer = require('./Customer');
const CommissionAgent = require('./CommissionAgent');
const Transporter = require('./Transporter');
const Transaction = require('./Transaction');
const RunningBalance = require('./RunningBalance');
const StockBatch = require('./StockBatch');
const StockMovement = require('./StockMovement');
const Purchase = require('./Purchase');
const PurchaseItem = require('./PurchaseItem');
const Sale = require('./Sale');
const SaleItem = require('./SaleItem');
const SaleBatchAllocation = require('./SaleBatchAllocation');
const StockTransfer = require('./StockTransfer');
const WastageEntry = require('./WastageEntry');
const Payment = require('./Payment');
const Expense = require('./Expense');
const GatePass = require('./GatePass');
const AuditLog = require('./AuditLog');
const Counter = require('./Counter');
const DeletedRecord = require('./DeletedRecord');

// Define Associations
Branch.hasMany(DeletedRecord, { foreignKey: 'branchId', as: 'deletedRecords' });
DeletedRecord.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });

User.hasMany(DeletedRecord, { foreignKey: 'deletedById', as: 'deletedRecords' });
DeletedRecord.belongsTo(User, { foreignKey: 'deletedById', as: 'deletedBy' });

// Branch <-> User
Branch.hasMany(User, { foreignKey: 'branchId', as: 'users' });
User.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });

// Branch <-> Entities
Branch.hasMany(Purchase, { foreignKey: 'branchId', as: 'purchases' });
Purchase.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });

Branch.hasMany(Sale, { foreignKey: 'branchId', as: 'sales' });
Sale.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });

Branch.hasMany(StockBatch, { foreignKey: 'branchId', as: 'stockBatches' });
StockBatch.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });

Branch.hasMany(Transaction, { foreignKey: 'branchId', as: 'transactions' });
Transaction.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });

Branch.hasMany(Expense, { foreignKey: 'branchId', as: 'expenses' });
Expense.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });

Branch.hasMany(Payment, { foreignKey: 'branchId', as: 'payments' });
Payment.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });

Branch.hasMany(GatePass, { foreignKey: 'branchId', as: 'gatePasses' });
GatePass.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });

// Branch-scoped parties (customers/suppliers belong to a branch)
Branch.hasMany(Customer, { foreignKey: 'branchId', as: 'customers' });
Customer.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });

Branch.hasMany(Supplier, { foreignKey: 'branchId', as: 'suppliers' });
Supplier.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });

// Purchase Associations
Supplier.hasMany(Purchase, { foreignKey: 'supplierId', as: 'purchases' });
Purchase.belongsTo(Supplier, { foreignKey: 'supplierId', as: 'supplier' });

CommissionAgent.hasMany(Purchase, { foreignKey: 'agentId', as: 'purchases' });
Purchase.belongsTo(CommissionAgent, { foreignKey: 'agentId', as: 'agent' });

Transporter.hasMany(Purchase, { foreignKey: 'transporterId', as: 'purchases' });
Purchase.belongsTo(Transporter, { foreignKey: 'transporterId', as: 'transporter' });

User.hasMany(Purchase, { foreignKey: 'createdBy', as: 'createdPurchases' });
Purchase.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

Purchase.hasMany(PurchaseItem, { foreignKey: 'purchaseId', as: 'items', onDelete: 'CASCADE' });
PurchaseItem.belongsTo(Purchase, { foreignKey: 'purchaseId', as: 'purchase' });

Item.hasMany(PurchaseItem, { foreignKey: 'itemId', as: 'purchaseItems' });
PurchaseItem.belongsTo(Item, { foreignKey: 'itemId', as: 'item' });

// Sale Associations
Customer.hasMany(Sale, { foreignKey: 'customerId', as: 'sales' });
Sale.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });

CommissionAgent.hasMany(Sale, { foreignKey: 'agentId', as: 'sales' });
Sale.belongsTo(CommissionAgent, { foreignKey: 'agentId', as: 'agent' });

Transporter.hasMany(Sale, { foreignKey: 'transporterId', as: 'sales' });
Sale.belongsTo(Transporter, { foreignKey: 'transporterId', as: 'transporter' });

User.hasMany(Sale, { foreignKey: 'createdBy', as: 'createdSales' });
Sale.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

Sale.hasMany(SaleItem, { foreignKey: 'saleId', as: 'items', onDelete: 'CASCADE' });
SaleItem.belongsTo(Sale, { foreignKey: 'saleId', as: 'sale' });

Item.hasMany(SaleItem, { foreignKey: 'itemId', as: 'saleItems' });
SaleItem.belongsTo(Item, { foreignKey: 'itemId', as: 'item' });

SaleItem.hasMany(SaleBatchAllocation, { foreignKey: 'saleItemId', as: 'batchAllocations', onDelete: 'CASCADE' });
SaleBatchAllocation.belongsTo(SaleItem, { foreignKey: 'saleItemId', as: 'saleItem' });

StockBatch.hasMany(SaleBatchAllocation, { foreignKey: 'stockBatchId', as: 'saleAllocations' });
SaleBatchAllocation.belongsTo(StockBatch, { foreignKey: 'stockBatchId', as: 'batch' });

// Stock Batch & Movements
Item.hasMany(StockBatch, { foreignKey: 'itemId', as: 'batches' });
StockBatch.belongsTo(Item, { foreignKey: 'itemId', as: 'item' });

Purchase.hasMany(StockBatch, { foreignKey: 'purchaseId', as: 'batches' });
StockBatch.belongsTo(Purchase, { foreignKey: 'purchaseId', as: 'purchase' });

StockBatch.hasMany(StockMovement, { foreignKey: 'batchId', as: 'movements' });
StockMovement.belongsTo(StockBatch, { foreignKey: 'batchId', as: 'batch' });

Item.hasMany(StockMovement, { foreignKey: 'itemId', as: 'stockMovements' });
StockMovement.belongsTo(Item, { foreignKey: 'itemId', as: 'item' });

// Stock Transfer
Branch.hasMany(StockTransfer, { foreignKey: 'fromBranchId', as: 'outgoingTransfers' });
StockTransfer.belongsTo(Branch, { foreignKey: 'fromBranchId', as: 'fromBranch' });

Branch.hasMany(StockTransfer, { foreignKey: 'toBranchId', as: 'incomingTransfers' });
StockTransfer.belongsTo(Branch, { foreignKey: 'toBranchId', as: 'toBranch' });

Item.hasMany(StockTransfer, { foreignKey: 'itemId', as: 'transfers' });
StockTransfer.belongsTo(Item, { foreignKey: 'itemId', as: 'item' });

StockBatch.hasMany(StockTransfer, { foreignKey: 'sourceBatchId', as: 'sourceTransfers' });
StockTransfer.belongsTo(StockBatch, { foreignKey: 'sourceBatchId', as: 'sourceBatch' });

Transporter.hasMany(StockTransfer, { foreignKey: 'transporterId', as: 'transfers' });
StockTransfer.belongsTo(Transporter, { foreignKey: 'transporterId', as: 'transporter' });

// Wastage Entries
Branch.hasMany(WastageEntry, { foreignKey: 'branchId', as: 'wastages' });
WastageEntry.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });

Item.hasMany(WastageEntry, { foreignKey: 'itemId', as: 'wastages' });
WastageEntry.belongsTo(Item, { foreignKey: 'itemId', as: 'item' });

StockBatch.hasMany(WastageEntry, { foreignKey: 'stockBatchId', as: 'wastages' });
WastageEntry.belongsTo(StockBatch, { foreignKey: 'stockBatchId', as: 'batch' });

// Audit & Users
User.hasMany(AuditLog, { foreignKey: 'userId', as: 'auditLogs' });
AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });

module.exports = {
  sequelize,
  Sequelize,
  Branch,
  User,
  Item,
  Supplier,
  Customer,
  CommissionAgent,
  Transporter,
  Transaction,
  RunningBalance,
  StockBatch,
  StockMovement,
  Purchase,
  PurchaseItem,
  Sale,
  SaleItem,
  SaleBatchAllocation,
  StockTransfer,
  WastageEntry,
  Payment,
  Expense,
  GatePass,
  AuditLog,
  Counter,
  DeletedRecord
};
