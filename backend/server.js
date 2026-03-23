require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors({ 
  origin: [
    process.env.FRONTEND_URL,
    'https://constroleum.github.io',
    /\.github\.io$/,
    'http://localhost:3000',
    'http://127.0.0.1:5500'
  ],
  credentials: true
}));

// ⚠️ WEBHOOK must be registered BEFORE express.json()
// Stripe needs the raw, unparsed body to verify the signature.
// If express.json() runs first, constructEvent() will throw "No signatures found".
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const orders = loadOrders();
    const order = orders.find(o => o.paymentIntentId === pi.id);
    if (order) {
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
      saveOrders(orders);
      await exportToCSV();

      const lang = order.currency === 'HUF' ? 'hu' : 'en';

      // Email to customer
      try {
        const { error } = await resend.emails.send({
          from: 'OLIVALIA <onboarding@resend.dev>',
          to: order.customer.email,
          subject: lang === 'hu'
            ? `🫒 Rendelés visszaigazolás — ${order.orderId}`
            : `🫒 Order Confirmation — ${order.orderId}`,
          html: buildCustomerEmail(order, lang)
        });
        if (error) throw new Error(error.message);
        console.log(`✅ Customer email sent to ${order.customer.email}`);
      } catch (mailErr) {
        console.error('❌ Customer email failed:', mailErr.message);
      }

      // Email to admin
      try {
        const adminMail = buildAdminEmail(order);
        const { error } = await resend.emails.send({
          from: 'OLIVALIA Shop <onboarding@resend.dev>',
          to: 'constroleum@gmail.com',
          subject: adminMail.subject,
          html: adminMail.html
        });
        if (error) throw new Error(error.message);
        console.log('✅ Admin email sent');
      } catch (mailErr) {
        console.error('❌ Admin email failed:', mailErr.message);
      }
    } else {
      console.warn(`⚠️ Webhook: no order found for paymentIntentId ${pi.id}`);
    }
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── ORDER STORAGE (JSON file — easy to open / export to Access) ─────────────
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
const CSV_FILE = path.join(__dirname, 'data', 'orders_export.csv');
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '[]');

function loadOrders() { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8')); }
function saveOrders(orders) { fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2)); }

// ─── ORDER REFERENCE GENERATOR ───────────────────────────────────────────────
function generateOrderId() {
  const date = new Date();
  const y = date.getFullYear().toString().slice(-2);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `OLV-${y}${m}${d}-${rand}`;
}

// ─── EMAIL TEMPLATES ──────────────────────────────────────────────────────────
function buildCustomerEmail(order, lang = 'hu') {
  const isHU = lang === 'hu';
  const currency = order.currency === 'HUF' ? 'Ft' : '€';
  const itemRows = order.items.map(i => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;">${i.name} (${i.format})</td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;text-align:center;">${i.qty}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;text-align:right;">${currency === 'Ft' ? i.price.toLocaleString('hu-HU') + ' Ft' : '€' + i.priceEUR}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:Georgia,serif;">
  <div style="max-width:600px;margin:0 auto;background:#111111;border:1px solid #2a2a2a;">
    <!-- Header -->
    <div style="background:#0A0A0A;padding:32px;text-align:center;border-bottom:1px solid #B8986A33;">
      <div style="color:#F5F0E8;font-family:Georgia,serif;font-size:28px;letter-spacing:8px;font-weight:300;">OLIVALIA</div>
      <div style="color:#B8986A;font-size:10px;letter-spacing:4px;text-transform:uppercase;margin-top:6px;">A new world of olive oil</div>
    </div>
    <!-- Body -->
    <div style="padding:32px;">
      <p style="color:#F5F0E8;font-size:18px;font-weight:300;margin-bottom:8px;">
        ${isHU ? `Kedves ${order.customer.firstName}!` : `Dear ${order.customer.firstName},`}
      </p>
      <p style="color:#C8BFB0;font-size:13px;line-height:1.8;margin-bottom:24px;">
        ${isHU ? 'Köszönjük rendelését! Örömmel értesítjük, hogy megkaptuk és feldolgozzuk.' : 'Thank you for your order! We are delighted to confirm receipt and are processing it now.'}
      </p>

      <!-- Order ref box -->
      <div style="background:#0A0A0A;border:1px solid #B8986A33;padding:16px 20px;margin-bottom:24px;text-align:center;">
        <div style="color:#B8986A;font-size:9px;letter-spacing:4px;text-transform:uppercase;margin-bottom:6px;">
          ${isHU ? 'Rendelésszám' : 'Order Reference'}
        </div>
        <div style="color:#F5F0E8;font-size:20px;letter-spacing:3px;">${order.orderId}</div>
      </div>

      <!-- Items table -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <thead>
          <tr style="background:#0A0A0A;">
            <th style="padding:10px 12px;text-align:left;color:#B8986A;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-weight:400;">${isHU ? 'Termék' : 'Product'}</th>
            <th style="padding:10px 12px;text-align:center;color:#B8986A;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-weight:400;">${isHU ? 'Db' : 'Qty'}</th>
            <th style="padding:10px 12px;text-align:right;color:#B8986A;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-weight:400;">${isHU ? 'Ár' : 'Price'}</th>
          </tr>
        </thead>
        <tbody style="color:#C8BFB0;font-size:13px;">
          ${itemRows}
        </tbody>
      </table>

      <!-- Totals -->
      <div style="border-top:1px solid #B8986A33;padding-top:16px;">
        <div style="display:flex;justify-content:space-between;color:#C8BFB0;font-size:12px;margin-bottom:6px;">
          <span>${isHU ? 'Szállítás' : 'Shipping'}</span>
          <span>${order.shippingDisplay}</span>
        </div>
        <div style="display:flex;justify-content:space-between;color:#F5F0E8;font-size:18px;font-weight:300;margin-top:8px;">
          <span style="color:#B8986A;font-size:10px;letter-spacing:3px;text-transform:uppercase;">${isHU ? 'Végösszeg' : 'Total'}</span>
          <span>${order.totalDisplay}</span>
        </div>
      </div>

      <!-- Shipping address -->
      <div style="margin-top:24px;background:#0A0A0A;border:1px solid #2a2a2a;padding:16px 20px;">
        <div style="color:#B8986A;font-size:9px;letter-spacing:3px;text-transform:uppercase;margin-bottom:10px;">
          ${isHU ? 'Szállítási cím' : 'Shipping Address'}
        </div>
        <div style="color:#C8BFB0;font-size:13px;line-height:1.8;">
          ${order.customer.firstName} ${order.customer.lastName}<br>
          ${order.customer.address}<br>
          ${order.customer.zip} ${order.customer.city}<br>
          ${order.customer.country}
        </div>
      </div>

      <p style="color:#C8BFB0;font-size:12px;line-height:1.8;margin-top:24px;">
        ${isHU
          ? 'Csapatunk hamarosan felveszi Önnel a kapcsolatot a szállítás részleteivel. Kérdés esetén írjon a <a href="mailto:constroleum@gmail.com" style="color:#B8986A;">constroleum@gmail.com</a> címre.'
          : 'Our team will contact you shortly with shipping details. For any questions please email <a href="mailto:constroleum@gmail.com" style="color:#B8986A;">constroleum@gmail.com</a>.'}
      </p>
    </div>
    <!-- Footer -->
    <div style="background:#0A0A0A;padding:20px;text-align:center;border-top:1px solid #B8986A33;">
      <div style="color:#666;font-size:10px;letter-spacing:2px;">OLIVALIA · Constroleum Kft. · Budapest, Búza u. 2.</div>
    </div>
  </div>
</body>
</html>`;
}

function buildAdminEmail(order) {
  const itemRows = order.items.map(i => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e5e5;font-size:14px;">${i.name} (${i.format})</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e5e5;font-size:14px;text-align:center;">${i.qty}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e5e5;font-size:14px;text-align:right;">${i.price ? i.price.toLocaleString('hu-HU') + ' Ft' : '€' + (i.priceEUR || '')}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:4px;overflow:hidden;border:1px solid #ddd;">

    <!-- Header -->
    <div style="background:#0A0A0A;padding:24px 32px;display:flex;align-items:center;justify-content:space-between;">
      <div style="color:#B8986A;font-size:20px;letter-spacing:6px;font-family:Georgia,serif;">OLIVALIA</div>
      <div style="background:#B8986A;color:#000;font-size:11px;font-weight:bold;letter-spacing:2px;padding:6px 14px;border-radius:2px;">ÚJ RENDELÉS</div>
    </div>

    <!-- Order ref + date -->
    <div style="background:#fafafa;padding:20px 32px;border-bottom:1px solid #e5e5e5;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:11px;color:#999;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Rendelésszám</div>
        <div style="font-size:22px;color:#0A0A0A;letter-spacing:2px;font-family:Georgia,serif;">${order.orderId}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:11px;color:#999;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">Dátum</div>
        <div style="font-size:14px;color:#333;">${new Date(order.createdAt).toLocaleString('hu-HU')}</div>
      </div>
    </div>

    <div style="padding:28px 32px;">

      <!-- Customer info -->
      <div style="margin-bottom:24px;">
        <div style="font-size:10px;color:#B8986A;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px;font-weight:bold;">🙋 Vásárló adatai</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:5px 0;color:#999;font-size:12px;width:120px;">Név</td><td style="padding:5px 0;font-size:14px;color:#222;font-weight:bold;">${order.customer.firstName} ${order.customer.lastName}</td></tr>
          <tr><td style="padding:5px 0;color:#999;font-size:12px;">Email</td><td style="padding:5px 0;font-size:14px;color:#222;"><a href="mailto:${order.customer.email}" style="color:#B8986A;">${order.customer.email}</a></td></tr>
          <tr><td style="padding:5px 0;color:#999;font-size:12px;">Telefon</td><td style="padding:5px 0;font-size:14px;color:#222;">${order.customer.phone || '—'}</td></tr>
        </table>
      </div>

      <!-- Shipping address -->
      <div style="background:#fafafa;border:1px solid #e5e5e5;border-radius:4px;padding:16px 20px;margin-bottom:24px;">
        <div style="font-size:10px;color:#B8986A;letter-spacing:3px;text-transform:uppercase;margin-bottom:10px;font-weight:bold;">📦 Szállítási cím</div>
        <div style="font-size:14px;color:#333;line-height:1.8;">
          ${order.customer.firstName} ${order.customer.lastName}<br>
          ${order.customer.address}<br>
          ${order.customer.zip} ${order.customer.city}<br>
          ${order.customer.country}
        </div>
      </div>

      <!-- Items -->
      <div style="margin-bottom:24px;">
        <div style="font-size:10px;color:#B8986A;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px;font-weight:bold;">🫒 Rendelt termékek</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e5e5;border-radius:4px;">
          <thead>
            <tr style="background:#fafafa;">
              <th style="padding:10px 14px;text-align:left;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#999;font-weight:normal;">Termék</th>
              <th style="padding:10px 14px;text-align:center;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#999;font-weight:normal;">Db</th>
              <th style="padding:10px 14px;text-align:right;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#999;font-weight:normal;">Ár</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>
      </div>

      <!-- Totals -->
      <div style="border-top:2px solid #0A0A0A;padding-top:16px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;color:#666;margin-bottom:6px;">
          <span>Szállítás</span><span>${order.shippingDisplay}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:20px;font-weight:bold;color:#0A0A0A;margin-top:8px;">
          <span>Végösszeg</span><span style="color:#B8986A;">${order.totalDisplay}</span>
        </div>
      </div>

      <!-- Stripe ID -->
      <div style="margin-top:24px;padding:12px 16px;background:#fafafa;border:1px solid #e5e5e5;border-radius:4px;">
        <span style="font-size:11px;color:#999;letter-spacing:1px;">Stripe Payment ID: </span>
        <code style="font-size:11px;color:#666;">${order.paymentIntentId}</code>
      </div>

    </div>

    <!-- Footer -->
    <div style="background:#0A0A0A;padding:16px 32px;text-align:center;">
      <div style="color:#666;font-size:10px;letter-spacing:2px;">OLIVALIA · Constroleum Kft. · admin panel: olivalia-shop.onrender.com/admin.html</div>
    </div>
  </div>
</body>
</html>`;

  return {
    subject: `🫒 Új rendelés: ${order.orderId} — ${order.customer.firstName} ${order.customer.lastName} — ${order.totalDisplay}`,
    html
  };
}

// ─── CSV EXPORT (for Access import) ─────────────────────────────────────────
async function exportToCSV() {
  const orders = loadOrders();
  const rows = [];
  for (const order of orders) {
    for (const item of order.items) {
      rows.push({
        order_id:       order.orderId,
        date:           order.createdAt,
        status:         order.status,
        first_name:     order.customer.firstName,
        last_name:      order.customer.lastName,
        email:          order.customer.email,
        phone:          order.customer.phone || '',
        address:        order.customer.address,
        city:           order.customer.city,
        zip:            order.customer.zip,
        country:        order.customer.country,
        product_name:   item.name,
        format:         item.format,
        qty:            item.qty,
        unit_price_huf: item.price || Math.round((item.priceEUR || 0) * 385),
        total_price_huf: (item.price || Math.round((item.priceEUR || 0) * 385)) * item.qty,
        shipping_huf:   order.shippingHUF || 0,
        order_total_huf: order.totalHUF || 0,
        currency:       order.currency,
        payment_id:     order.paymentIntentId
      });
    }
  }

  const csvWriter = createObjectCsvWriter({
    path: CSV_FILE,
    header: [
      { id: 'order_id',         title: 'Rendelésszám' },
      { id: 'date',             title: 'Dátum' },
      { id: 'status',           title: 'Státusz' },
      { id: 'first_name',       title: 'Keresztnév' },
      { id: 'last_name',        title: 'Vezetéknév' },
      { id: 'email',            title: 'Email' },
      { id: 'phone',            title: 'Telefon' },
      { id: 'address',          title: 'Cím' },
      { id: 'city',             title: 'Város' },
      { id: 'zip',              title: 'Irányítószám' },
      { id: 'country',          title: 'Ország' },
      { id: 'product_name',     title: 'Termék' },
      { id: 'format',           title: 'Kiszerelés' },
      { id: 'qty',              title: 'Mennyiség' },
      { id: 'unit_price_huf',   title: 'Egységár (Ft)' },
      { id: 'total_price_huf',  title: 'Sor összeg (Ft)' },
      { id: 'shipping_huf',     title: 'Szállítás (Ft)' },
      { id: 'order_total_huf',  title: 'Végösszeg (Ft)' },
      { id: 'currency',         title: 'Deviza' },
      { id: 'payment_id',       title: 'Stripe Payment ID' },
    ]
  });
  await csvWriter.writeRecords(rows);
  return CSV_FILE;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// CREATE PAYMENT INTENT
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { items, customer, shipping, total, currency } = req.body;
    const orderId = generateOrderId();
    const isHUF = currency === 'HUF';

    // Stripe expects amount in smallest currency unit (fillér/cent)
    let amountCents;
    if (isHUF) {
      amountCents = Math.round(total); // HUF has no decimals, Stripe accepts whole HUF
    } else {
      amountCents = Math.round(parseFloat(total) * 100); // EUR → cents
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: currency.toLowerCase(),
      metadata: {
        orderId,
        customerEmail: customer.email,
        customerName: `${customer.firstName} ${customer.lastName}`
      },
      receipt_email: customer.email,
      payment_method_types: ['card'],
    });

    // Store pending order
    const orders = loadOrders();
    const shippingHUF = isHUF ? shipping : Math.round(shipping * 385);
    const totalHUF = isHUF ? total : Math.round(parseFloat(total) * 385);
    const newOrder = {
      orderId,
      createdAt: new Date().toISOString(),
      status: 'pending',
      currency,
      customer,
      items,
      shipping,
      shippingHUF,
      total,
      totalHUF,
      shippingDisplay: isHUF ? (shipping === 0 ? 'INGYENES' : `${shipping.toLocaleString()} Ft`) : `€${shipping}`,
      totalDisplay: isHUF ? `${parseInt(total).toLocaleString('hu-HU')} Ft` : `€${parseFloat(total).toFixed(2)}`,
      paymentIntentId: paymentIntent.id,
    };
    orders.push(newOrder);
    saveOrders(orders);

    res.json({ clientSecret: paymentIntent.client_secret, orderId });
  } catch (error) {
    console.error('Payment intent error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ADMIN — get all orders
app.get('/admin/orders', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  res.json(loadOrders());
});

// ADMIN — update order status
app.patch('/admin/orders/:orderId', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const orders = loadOrders();
  const order = orders.find(o => o.orderId === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.status = req.body.status;
  order.updatedAt = new Date().toISOString();
  saveOrders(orders);
  exportToCSV();
  res.json(order);
});

// ADMIN — download CSV
app.get('/admin/export-csv', async (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  await exportToCSV();
  res.download(CSV_FILE, `olivalia_orders_${new Date().toISOString().split('T')[0]}.csv`);
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🫒 OLIVALIA backend running on port ${PORT}`);
  if (!process.env.RESEND_API_KEY) {
    console.error('❌ EMAIL CONFIG ERROR — RESEND_API_KEY not set. Emails will NOT send.');
  } else {
    console.log('✅ Resend API key found — email ready');
  }
});
