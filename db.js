const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

let SQL = null;
let db = null;
let dbPath = null;

async function initDatabase(dataDir) {
  SQL = await initSqlJs();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, 'gelat-online.db');
  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }
  createTables();
  saveDatabase();
  return db;
}

function saveDatabase() {
  if (!db || !dbPath) return;
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function createTables() {
  db.run(`CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    currency TEXT DEFAULT 'NGN',
    tax_rate REAL DEFAULT 0,
    language TEXT DEFAULT 'en',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    full_name TEXT NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    last_login TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(business_id, username)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sku TEXT,
    barcode TEXT,
    category TEXT,
    cost_price REAL DEFAULT 0,
    selling_price REAL DEFAULT 0,
    quantity REAL DEFAULT 0,
    low_stock REAL DEFAULT 5,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    receipt_number TEXT NOT NULL,
    cashier_id TEXT,
    cashier_name TEXT,
    customer_name TEXT,
    subtotal REAL,
    discount REAL,
    tax REAL,
    total REAL,
    payment_method TEXT,
    amount_paid REAL,
    change_given REAL,
    payment_note TEXT,
    status TEXT DEFAULT 'completed',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    product_id TEXT,
    product_name TEXT,
    quantity REAL,
    unit_price REAL,
    cost_price REAL,
    total REAL,
    bill_for TEXT DEFAULT 'Main'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
}

function createBusiness({ name, address, phone, currency, taxRate, language, adminName, adminUsername, adminPassword }) {
  const businessId = uuidv4();
  run(
    `INSERT INTO businesses (id, name, address, phone, currency, tax_rate, language) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [businessId, name || 'My Shop', address || '', phone || '', currency || 'NGN', taxRate || 0, language || 'en']
  );
  const userId = uuidv4();
  const hash = bcrypt.hashSync(adminPassword || 'admin123', 10);
  run(
    `INSERT INTO users (id, business_id, full_name, username, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, businessId, adminName || 'Owner', adminUsername || 'admin', hash, 'admin']
  );
  return { businessId, userId };
}

function login(username, password) {
  const users = all(`SELECT * FROM users WHERE username = ? AND is_active = 1`, [username]);
  for (const u of users) {
    if (bcrypt.compareSync(password, u.password_hash)) {
      const token = uuidv4();
      run(`INSERT INTO sessions (token, user_id, business_id) VALUES (?, ?, ?)`, [token, u.id, u.business_id]);
      run(`UPDATE users SET last_login = datetime('now') WHERE id = ?`, [u.id]);
      const business = get(`SELECT * FROM businesses WHERE id = ?`, [u.business_id]);
      return {
        token,
        user: {
          id: u.id,
          fullName: u.full_name,
          username: u.username,
          role: u.role,
          businessId: u.business_id
        },
        business,
        permissions: rolePermissions(u.role)
      };
    }
  }
  return null;
}

function rolePermissions(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'admin' || r === 'owner') {
    return { pos: true, products: true, sales: true, users: true, settings: true, reports: true };
  }
  if (r === 'manager') {
    return { pos: true, products: true, sales: true, users: false, settings: true, reports: true };
  }
  return { pos: true, products: false, sales: true, users: false, settings: false, reports: false };
}

function session(token) {
  if (!token) return null;
  return get(`SELECT * FROM sessions WHERE token = ?`, [token]);
}

function getProducts(businessId) {
  return all(`SELECT * FROM products WHERE business_id = ? AND is_active = 1 ORDER BY name`, [businessId]);
}

function addProduct(businessId, p) {
  const id = uuidv4();
  run(
    `INSERT INTO products (id, business_id, name, sku, barcode, category, cost_price, selling_price, quantity, low_stock)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, businessId, p.name, p.sku || '', p.barcode || '', p.category || '',
      Number(p.costPrice || p.cost_price || 0),
      Number(p.sellingPrice || p.selling_price || 0),
      Number(p.quantity || 0),
      Number(p.lowStock || p.low_stock || 5)
    ]
  );
  return get(`SELECT * FROM products WHERE id = ?`, [id]);
}

function updateProduct(businessId, id, p) {
  run(
    `UPDATE products SET name=?, sku=?, barcode=?, category=?, cost_price=?, selling_price=?, quantity=?, low_stock=?
     WHERE id=? AND business_id=?`,
    [
      p.name, p.sku || '', p.barcode || '', p.category || '',
      Number(p.costPrice || p.cost_price || 0),
      Number(p.sellingPrice || p.selling_price || 0),
      Number(p.quantity || 0),
      Number(p.lowStock || p.low_stock || 5),
      id, businessId
    ]
  );
  return get(`SELECT * FROM products WHERE id = ? AND business_id = ?`, [id, businessId]);
}

function deleteProduct(businessId, id) {
  run(`UPDATE products SET is_active = 0 WHERE id = ? AND business_id = ?`, [id, businessId]);
}

function createSale(businessId, { saleData, items, userId, cashierName }) {
  const saleId = uuidv4();
  const receipt = 'R' + Date.now();
  run(
    `INSERT INTO sales (id, business_id, receipt_number, cashier_id, cashier_name, customer_name, subtotal, discount, tax, total, payment_method, amount_paid, change_given, payment_note, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      saleId, businessId, receipt, userId || null, cashierName || '',
      saleData.customerName || 'Walk-in',
      Number(saleData.subtotal || 0), Number(saleData.discount || 0), Number(saleData.tax || 0), Number(saleData.total || 0),
      saleData.paymentMethod || 'Cash',
      Number(saleData.amountPaid || saleData.total || 0),
      Number(saleData.changeGiven || 0),
      saleData.paymentNote || '',
      'completed'
    ]
  );
  for (const it of items || []) {
    run(
      `INSERT INTO sale_items (id, sale_id, business_id, product_id, product_name, quantity, unit_price, cost_price, total, bill_for)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(), saleId, businessId, it.productId || null, it.productName,
        Number(it.quantity || 0), Number(it.unitPrice || 0), Number(it.costPrice || 0),
        Number(it.total || 0), it.billFor || 'Main'
      ]
    );
    if (it.productId) {
      run(`UPDATE products SET quantity = quantity - ? WHERE id = ? AND business_id = ?`, [
        Number(it.quantity || 0), it.productId, businessId
      ]);
    }
  }
  return { id: saleId, receiptNumber: receipt };
}

function getSales(businessId, limit = 200) {
  return all(
    `SELECT * FROM sales WHERE business_id = ? ORDER BY created_at DESC LIMIT ?`,
    [businessId, limit]
  );
}

function deleteSale(businessId, id) {
  const items = all(`SELECT * FROM sale_items WHERE sale_id = ? AND business_id = ?`, [id, businessId]);
  for (const it of items) {
    if (it.product_id) {
      run(`UPDATE products SET quantity = quantity + ? WHERE id = ? AND business_id = ?`, [
        Number(it.quantity || 0), it.product_id, businessId
      ]);
    }
  }
  run(`DELETE FROM sale_items WHERE sale_id = ? AND business_id = ?`, [id, businessId]);
  run(`DELETE FROM sales WHERE id = ? AND business_id = ?`, [id, businessId]);
}

function getUsers(businessId) {
  return all(`SELECT id, business_id, full_name as fullName, username, role, is_active as isActive, last_login as lastLogin, created_at FROM users WHERE business_id = ?`, [businessId]);
}

function addUser(businessId, { fullName, username, password, role }) {
  const id = uuidv4();
  const hash = bcrypt.hashSync(password || '1234', 10);
  run(
    `INSERT INTO users (id, business_id, full_name, username, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, businessId, fullName, username, hash, role || 'cashier']
  );
  return get(`SELECT id, full_name as fullName, username, role FROM users WHERE id = ?`, [id]);
}

function updateUser(businessId, id, data) {
  if (data.password) {
    run(`UPDATE users SET password_hash = ? WHERE id = ? AND business_id = ?`, [
      bcrypt.hashSync(data.password, 10), id, businessId
    ]);
  }
  if (data.fullName || data.role || data.isActive != null) {
    const u = get(`SELECT * FROM users WHERE id = ? AND business_id = ?`, [id, businessId]);
    if (!u) return null;
    run(
      `UPDATE users SET full_name = ?, role = ?, is_active = ? WHERE id = ? AND business_id = ?`,
      [
        data.fullName || u.full_name,
        data.role || u.role,
        data.isActive != null ? (data.isActive ? 1 : 0) : u.is_active,
        id, businessId
      ]
    );
  }
  return get(`SELECT id, full_name as fullName, username, role FROM users WHERE id = ?`, [id]);
}

function getBusiness(businessId) {
  return get(`SELECT * FROM businesses WHERE id = ?`, [businessId]);
}

function updateBusiness(businessId, data) {
  const b = getBusiness(businessId);
  if (!b) return null;
  run(
    `UPDATE businesses SET name=?, address=?, phone=?, currency=?, tax_rate=?, language=? WHERE id=?`,
    [
      data.name != null ? data.name : b.name,
      data.address != null ? data.address : b.address,
      data.phone != null ? data.phone : b.phone,
      data.currency != null ? data.currency : b.currency,
      data.taxRate != null ? data.taxRate : b.tax_rate,
      data.language != null ? data.language : b.language,
      businessId
    ]
  );
  return getBusiness(businessId);
}

function dashboard(businessId) {
  const today = new Date().toISOString().slice(0, 10);
  const sales = all(
    `SELECT * FROM sales WHERE business_id = ? AND date(created_at) = date('now') AND status = 'completed'`,
    [businessId]
  );
  const todaySales = sales.reduce((s, x) => s + Number(x.total || 0), 0);
  const low = all(
    `SELECT COUNT(*) as c FROM products WHERE business_id = ? AND is_active = 1 AND quantity <= low_stock`,
    [businessId]
  );
  return {
    todaySales,
    todayTransactions: sales.length,
    todayProfit: 0,
    lowStockCount: low[0] ? low[0].c : 0,
    recentSales: sales.slice(0, 10)
  };
}

module.exports = {
  initDatabase,
  createBusiness,
  login,
  session,
  getProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  createSale,
  getSales,
  deleteSale,
  getUsers,
  addUser,
  updateUser,
  getBusiness,
  updateBusiness,
  dashboard,
  rolePermissions
};
