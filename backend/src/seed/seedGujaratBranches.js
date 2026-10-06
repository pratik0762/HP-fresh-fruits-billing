/**
 * Adds Ahmedabad, Surat and Baroda branches with per-branch users.
 *
 * NON-DESTRUCTIVE: safe to run multiple times. Existing branches, users and
 * transactions are never touched or deleted — only missing branches/users are
 * created. If a user email already exists, its role/branch/password are left
 * as they are.
 *
 * Privacy model:
 *  - Every branch gets its own MANAGER, STAFF and ACCOUNTANT logins bound to
 *    that branch (users.branchId). All data routes filter by the logged-in
 *    user's branch, so e.g. Ahmedabad staff can never see Surat or Baroda
 *    sales, stock, ledgers or reports.
 *  - Only the OWNER (branchId null) can view consolidated all-branch data.
 *
 * Run: npm run seed:branches --prefix backend   (or node src/seed/seedGujaratBranches.js)
 */
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');
const { Branch, User } = require('../models');

const BRANCHES = [
  {
    name: 'Ahmedabad Fruit Mandi & Distribution',
    code: 'AMD',
    location: 'Jamalpur APMC, Ahmedabad, Gujarat',
    address: 'Shop 14-15, APMC Market Yard, Jamalpur, Ahmedabad, GJ - 380001',
    phone: '+91 79 2210 4455',
    users: [
      { name: 'Nirav Shah (Ahmedabad Manager)', email: 'manager.ahmedabad@hpfruits.com', role: 'BRANCH_MANAGER', password: 'manager123' },
      { name: 'Kaival Patel (Ahmedabad Entry Clerk)', email: 'staff.ahmedabad@hpfruits.com', role: 'STAFF', password: 'staff123' },
      { name: 'Meera Desai (Ahmedabad Accountant)', email: 'accountant.ahmedabad@hpfruits.com', role: 'ACCOUNTANT', password: 'account123' }
    ]
  },
  {
    name: 'Surat Mandi Wholesale Hub',
    code: 'SRT',
    location: 'Aerala Market, Surat, Gujarat',
    address: 'Block C, Fruit Wing, Aerala Market Yard, Surat, GJ - 395003',
    phone: '+91 261 227 7788',
    users: [
      { name: 'Jignesh Modi (Surat Manager)', email: 'manager.surat@hpfruits.com', role: 'BRANCH_MANAGER', password: 'manager123' },
      { name: 'Harsh Trivedi (Surat Entry Clerk)', email: 'staff.surat@hpfruits.com', role: 'STAFF', password: 'staff123' },
      { name: 'Priya Bhatt (Surat Accountant)', email: 'accountant.surat@hpfruits.com', role: 'ACCOUNTANT', password: 'account123' }
    ]
  },
  {
    name: 'Baroda City Fruit Distribution',
    code: 'BDQ',
    location: 'Kirti Stambh Mandi, Vadodara, Gujarat',
    address: 'Mandi Complex, Kirti Stambh, Vadodara, GJ - 390001',
    phone: '+91 265 243 1122',
    users: [
      { name: 'Rakesh Solanki (Baroda Manager)', email: 'manager.baroda@hpfruits.com', role: 'BRANCH_MANAGER', password: 'manager123' },
      { name: 'Dhruv Amin (Baroda Entry Clerk)', email: 'staff.baroda@hpfruits.com', role: 'STAFF', password: 'staff123' },
      { name: 'Kinjal Mehta (Baroda Accountant)', email: 'accountant.baroda@hpfruits.com', role: 'ACCOUNTANT', password: 'account123' }
    ]
  }
];

async function seedBranches() {
  await sequelize.authenticate();
  console.log('--- Adding Gujarat branches & users (non-destructive) ---');

  const passwordCache = {};

  for (const cfg of BRANCHES) {
    let branch = await Branch.findOne({ where: { code: cfg.code } });

    if (branch) {
      console.log(`= Branch ${cfg.code} (${cfg.name}) already exists — skipped.`);
    } else {
      branch = await Branch.create({
        name: cfg.name,
        code: cfg.code,
        location: cfg.location,
        address: cfg.address,
        phone: cfg.phone
      });
      console.log(`✓ Branch created: ${cfg.name} (${cfg.code}) [id ${branch.id}]`);
    }

    for (const u of cfg.users) {
      const existing = await User.findOne({ where: { email: u.email.toLowerCase() } });
      if (existing) {
        console.log(`  = User ${u.email} already exists — skipped.`);
        continue;
      }

      if (!passwordCache[u.password]) {
        passwordCache[u.password] = await bcrypt.hash(u.password, 10);
      }

      await User.create({
        name: u.name,
        email: u.email.toLowerCase(),
        passwordHash: passwordCache[u.password],
        role: u.role,
        branchId: branch.id
      });
      console.log(`  ✓ User created: ${u.email} (${u.role} → ${cfg.code})`);
    }
  }

  console.log('======================================================');
  console.log('🎉 Gujarat branch setup complete!');
  console.log('');
  console.log('Branch logins (each sees ONLY their own branch):');
  console.log('  Ahmedabad: manager.ahmedabad@hpfruits.com / manager123');
  console.log('             staff.ahmedabad@hpfruits.com  / staff123');
  console.log('             accountant.ahmedabad@hpfruits.com / account123');
  console.log('  Surat:     manager.surat@hpfruits.com    / manager123');
  console.log('             staff.surat@hpfruits.com      / staff123');
  console.log('             accountant.surat@hpfruits.com / account123');
  console.log('  Baroda:    manager.baroda@hpfruits.com   / manager123');
  console.log('             staff.baroda@hpfruits.com     / staff123');
  console.log('             accountant.baroda@hpfruits.com / account123');
  console.log('');
  console.log('  Owner (sees ALL branches): owner@hpfruits.com / admin123');
  console.log('======================================================');

  process.exit(0);
}

seedBranches().catch(err => {
  console.error('Branch seeding failed:', err);
  process.exit(1);
});
