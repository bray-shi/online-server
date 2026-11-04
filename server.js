/**
 * Gelat Online Server
 * Shared by Windows + Phone apps. Separate from product-key license server.
 */
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-token'] || '');
  const s = db.session(token);
  if (!s) return res.status(401).json({ error: 'Please log in' });
  req.token = token;
  req.userId = s.user_id;
  req.businessId = s.business_id;
  next();
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'gelat-online', time: new Date().toISOString() });
});

// Create new business (first-time setup on phone/laptop)
app.post('/api/setup', (req, res) => {
  try {
    const b = req.body || {};
    if (!b.adminUsername || !b.adminPassword) {
      return res.status(400).json({ error: 'Admin username and password required' });
    }
    const result = db.createBusiness({
      name: b.shopName || b.name || 'My Shop',
      address: b.address || '',
      phone: b.phone || '',
      currency: b.currency || 'NGN',
      taxRate: Number(b.taxRate || 0),
      language: b.language || 'en',
      adminName: b.adminName || 'Owner',
      adminUsername: b.adminUsername,
      adminPassword: b.adminPassword
    });
    res.json({ success: true, businessId: result.businessId, message: 'Business created. You can log in.' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Setup failed' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const result = db.login(username, password);
  if (!result) return res.status(401).json({ error: 'Invalid username or password' });
  res.json(result);
});

app.get('/api/me', auth, (req, res) => {
  const business = db.getBusiness(req.businessId);
  res.json({ businessId: req.businessId, business });
});

app.get('/api/dashboard', auth, (req, res) => {
  res.json(db.dashboard(req.businessId));
});

app.get('/api/products', auth, (req, res) => {
  res.json(db.getProducts(req.businessId));
});

app.post('/api/products', auth, (req, res) => {
  try {
    res.json(db.addProduct(req.businessId, req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/products/:id', auth, (req, res) => {
  const p = db.updateProduct(req.businessId, req.params.id, req.body || {});
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json(p);
});

app.delete('/api/products/:id', auth, (req, res) => {
  db.deleteProduct(req.businessId, req.params.id);
  res.json({ success: true });
});

app.get('/api/sales', auth, (req, res) => {
  res.json(db.getSales(req.businessId, Number(req.query.limit) || 200));
});

app.post('/api/sales', auth, (req, res) => {
  try {
    const { saleData, items, userId } = req.body || {};
    const result = db.createSale(req.businessId, {
      saleData: saleData || {},
      items: items || [],
      userId: userId || req.userId,
      cashierName: req.body.cashierName || ''
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/sales/:id', auth, (req, res) => {
  db.deleteSale(req.businessId, req.params.id);
  res.json({ success: true });
});

app.get('/api/users', auth, (req, res) => {
  res.json(db.getUsers(req.businessId));
});

app.post('/api/users', auth, (req, res) => {
  try {
    res.json(db.addUser(req.businessId, req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not add user' });
  }
});

app.put('/api/users/:id', auth, (req, res) => {
  const u = db.updateUser(req.businessId, req.params.id, req.body || {});
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json(u);
});

app.get('/api/settings', auth, (req, res) => {
  const b = db.getBusiness(req.businessId);
  if (!b) return res.status(404).json({ error: 'Business not found' });
  res.json({
    shop_name: b.name,
    shop_address: b.address,
    shop_phone: b.phone,
    currency: b.currency,
    tax_rate: b.tax_rate,
    language: b.language
  });
});

app.put('/api/settings', auth, (req, res) => {
  const b = db.updateBusiness(req.businessId, {
    name: req.body.shop_name,
    address: req.body.shop_address,
    phone: req.body.shop_phone,
    currency: req.body.currency,
    taxRate: req.body.tax_rate,
    language: req.body.language
  });
  res.json(b);
});

app.get('/', (req, res) => {
  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Gelat Online</title></head>
  <body style="font-family:system-ui;padding:40px;max-width:560px;margin:auto">
  <h1>Gelat Online Server</h1>
  <p>This is the <strong>data API</strong> for Windows + Phone Gelat.</p>
  <p>Health: <a href="/api/health">/api/health</a></p>
  <p>Product keys are handled by your separate license server.</p>
  </body></html>`);
});

const PORT = process.env.PORT || 3860;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');

db.initDatabase(DATA).then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('Gelat Online Server on port', PORT);
    console.log('Health: http://localhost:' + PORT + '/api/health');
  });
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
