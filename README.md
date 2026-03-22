# 🫒 OLIVALIA — Webshop Setup Guide

## Projekt struktúra / Project Structure

```
olivalia/
├── frontend/
│   ├── index.html        ← Landing page (nyelvválasztó / language selector)
│   ├── shop-hu.html      ← Magyar bolt (HUF árak)
│   ├── shop-en.html      ← English shop (EUR prices)
│   └── admin.html        ← Admin panel (rendelések kezelése)
├── backend/
│   ├── server.js         ← Node.js backend (Stripe + Gmail + CSV)
│   ├── package.json
│   ├── .env.example      ← Környezeti változók sablonja
│   └── data/
│       ├── orders.json   ← Rendelések adatbázisa (auto-generált)
│       └── orders_export.csv ← Access-be importálható CSV (auto-generált)
└── README.md
```

---

## 1. GitHub Pages (Frontend)

A frontend **statikus HTML** fájlok — közvetlenül feltölthetők GitHub Pages-re.

1. Hozzon létre egy GitHub repository-t (pl. `olivalia-shop`)
2. Töltse fel a `frontend/` mappa tartalmát
3. Settings → Pages → Source: `main` branch, `/` (root)
4. A webshop elérhető lesz: `https://yourusername.github.io/olivalia-shop/`

---

## 2. Backend telepítése

### Lokális fejlesztés

```bash
cd backend
npm install
cp .env.example .env
# Töltse ki a .env fájlt (lásd lent)
npm run dev
```

### Éles (production) deploy — ajánlott: Railway vagy Render

**Railway:**
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

**Render:**
1. render.com → New Web Service
2. GitHub repo csatlakoztatása
3. Root Directory: `backend`
4. Build Command: `npm install`
5. Start Command: `node server.js`
6. Environment Variables beállítása (lásd lent)

---

## 3. Stripe beállítása

### API kulcsok
1. Lépjen be: [dashboard.stripe.com](https://dashboard.stripe.com)
2. Developers → API Keys
3. Másolja ki:
   - **Publishable key** → `STRIPE_PUBLISHABLE_KEY` (.env + frontend HTML fájlokban)
   - **Secret key** → `STRIPE_SECRET_KEY` (.env)

### Frontend kulcs cseréje
Mindkét shop HTML fájlban cserélje le:
```javascript
stripe = Stripe('pk_test_YOUR_STRIPE_PUBLISHABLE_KEY');
```
→
```javascript
stripe = Stripe('pk_live_xxxxxxxxxxxxxxxx');
```

### Webhook beállítása
1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. Endpoint URL: `https://your-backend-url.com/webhook`
3. Events: `payment_intent.succeeded`
4. Másolja ki a **Signing secret** → `STRIPE_WEBHOOK_SECRET`

### Apple Pay / Google Pay
1. Stripe Dashboard → Settings → Payment methods → Apple Pay
2. Domain verification: töltse fel a `.well-known/apple-developer-merchantid-domain-association` fájlt

### Magyarország — Stripe fiók beállítás
- Stripe Dashboard → Settings → Business settings
- Country: Hungary
- Currency: HUF (rendelések) és EUR (európai ügyfelek)

---

## 4. Gmail App Password beállítása

1. Lépjen be: [myaccount.google.com](https://myaccount.google.com)
2. Biztonság → 2-faktoros hitelesítés → **engedélyezze**
3. Biztonság → **Alkalmazásjelszók**
4. Alkalmazás: "Mail" / Eszköz: "Other (Custom name)" → "OLIVALIA"
5. Másolja ki a 16 karakteres jelszót → `GMAIL_APP_PASS`

---

## 5. .env fájl kitöltése

```env
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxx
GMAIL_USER=constroleum@gmail.com
GMAIL_APP_PASS=xxxx xxxx xxxx xxxx
ADMIN_KEY=sajat_admin_jelszo_itt
PORT=3000
FRONTEND_URL=https://yourusername.github.io/olivalia-shop
```

---

## 6. Admin Panel

URL: `https://your-backend-url.com/admin.html`

**Funkciók:**
- 📊 Statisztikák (rendelések, bevétel HUF/EUR)
- 📋 Rendelések listája (szűrés státusz szerint)
- 🔍 Rendelés részletek (termékek, szállítási cím, Stripe ID)
- 🔄 Státusz frissítés (Függőben → Fizetve → Elküldve → Kézbesítve)
- 📥 **CSV Export** — közvetlenül importálható Microsoft Access-be

---

## 7. Access import (CSV → Access)

Az `orders_export.csv` fájl automatikusan frissül minden fizetés után.

**Import lépései:**
1. Admin panel → 📥 CSV Export → letöltés
2. Access megnyitása
3. Külső adatok → Szövegfájl → `orders_export.csv`
4. Elválasztó: Vesszős (CSV), Fejléc: Igen, Kódolás: UTF-8

**Oszlopok:**
| Oszlop | Leírás |
|--------|--------|
| Rendelésszám | OLV-YYMMDD-XXXX formátum |
| Dátum | ISO 8601 timestamp |
| Státusz | pending/paid/shipped/delivered/cancelled |
| Vásárló adatok | Név, email, cím |
| Termék | Név, kiszerelés, mennyiség |
| Egységár (Ft) | Forintban |
| Végösszeg (Ft) | Szállítással együtt |
| Stripe Payment ID | Nyomonkövetéshez |

---

## 8. Szállítási díjak (beépítve)

### Magyarország
| Súly | Díj |
|------|-----|
| 1–5 kg | 1.990 Ft |
| 5–10 kg | 3.990 Ft |
| 20 kg+ | **INGYENES** |

### Európa
| | Díj |
|-|-|
| Fix díj | **€30** |

---

## 9. Termékek frissítése

A termékek a `shop-hu.html` és `shop-en.html` fájlokban a `PRODUCTS` tömbbe vannak beépítve.

**Új termék hozzáadása:**
```javascript
{ 
  id: 31,                          // Egyedi szám
  brand: 'OLEOESTEPA',             // Gyártó
  name: 'Új termék neve',          // EN/HU név
  format: '250ml Üveg',            // Kiszerelés
  size: 0.25,                      // Liter (súlyhoz kell)
  container: 'glass',              // glass / tin / pet
  price: 2500,                     // HUF ár
  stock: 10,                       // Kezdőkészlet
  emoji: '🍾',                     // Ikon
  desc: 'Leírás...',               // Termék leírás
  badge: null                      // null / 'Bio' / 'Prémium' / 'PDO' stb.
}
```

---

## 10. Tesztelés

### Stripe teszt kártyák
| Szám | Eredmény |
|------|---------|
| `4242 4242 4242 4242` | ✅ Sikeres fizetés |
| `4000 0000 0000 0002` | ❌ Visszautasított |
| `4000 0025 0000 3155` | 🔐 3D Secure |

Bármely jövőbeli lejárati dátum és CVC használható.

---

## Kapcsolat

**OLIVALIA · Constroleum Kft.**  
Budapest, Búza u. 2.  
constroleum@gmail.com
