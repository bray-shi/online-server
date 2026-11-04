# Gelat Online Server

Shared backend for **Windows** and **Phone** Gelat.

- Different from the **product key** server (`licese-key.onrender.com`)
- Stores businesses, users, products, sales

## Run locally

```bash
cd gelat-online-server
npm install
npm start
```

Open: http://localhost:3860/api/health

## Host on Render (same idea as license server)

1. Upload this folder to a **new** GitHub repo (e.g. `gelat-online`)
2. Render → Web Service → that repo
3. Build: `npm install`
4. Start: `npm start`
5. Copy the URL, e.g. `https://gelat-online-xxxx.onrender.com`

## Main API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/setup` | No | Create business + owner |
| POST | `/api/login` | No | Login |
| GET | `/api/products` | Yes | List products |
| POST | `/api/sales` | Yes | Create sale |
| GET | `/api/sales` | Yes | List sales |

Auth header: `Authorization: Bearer <token>`

## Note (Render free)

Free hosting may wipe files when the server sleeps. For production, use persistent disk or a real database later.
