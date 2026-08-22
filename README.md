# LauncherDesk — Node.js + Express + MongoDB Backend

REST API backend for the LauncherDesk React frontend.

---

## Tech Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Runtime     | Node.js ≥ 18                        |
| Framework   | Express 4                           |
| Database    | MongoDB (via Mongoose 8)            |
| Auth        | JWT (jsonwebtoken) + bcryptjs       |
| Email       | Nodemailer (SMTP)                   |
| File upload | Multer                              |
| Rate limit  | express-rate-limit                  |

---

## Project Structure

```
launcherdesk-backend/
├── src/
│   ├── server.js              ← Entry point
│   ├── config/
│   │   ├── db.js              ← MongoDB connection
│   │   └── email.js           ← Nodemailer + email templates
│   ├── middleware/
│   │   ├── auth.js            ← JWT protect + restrictTo
│   │   └── errorHandler.js    ← asyncHandler + AppError
│   ├── models/
│   │   ├── User.js
│   │   ├── Contact.js
│   │   ├── Lead.js
│   │   ├── Quote.js
│   │   ├── Service.js
│   │   ├── Blog.js
│   │   ├── FAQ.js
│   │   ├── Application.js
│   │   └── Product.js
│   ├── controllers/           ← Business logic
│   └── routes/                ← Express routers
├── uploads/                   ← File uploads (gitignored)
├── .env.example
└── package.json
```

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `MONGO_URI` — local or Atlas connection string
- `JWT_SECRET` — long random string
- SMTP credentials for email
- `CLIENT_URL` — your React dev server (default: `http://localhost:5173`)

### 3. Create upload directories

```bash
mkdir -p uploads/blog uploads/resumes uploads/products
```

### 4. Run in development

```bash
npm run dev
```

### 5. Run in production

```bash
npm start
```

---

## API Reference

### Auth

| Method | Endpoint           | Auth   | Description         |
|--------|--------------------|--------|---------------------|
| POST   | /api/auth/register | Public | Register a user     |
| POST   | /api/auth/login    | Public | Login, get JWT      |
| GET    | /api/auth/me       | User   | Get current user    |

### Contact

| Method | Endpoint         | Auth  | Description              |
|--------|-----------------|-------|--------------------------|
| POST   | /api/contact    | Public | Submit contact form      |
| GET    | /api/contact    | Admin  | List all enquiries       |
| PATCH  | /api/contact/:id| Admin  | Update status/notes      |

### Quotes

| Method | Endpoint        | Auth  | Description              |
|--------|-----------------|-------|--------------------------|
| POST   | /api/quotes     | Public | Request a service quote  |
| GET    | /api/quotes     | Admin  | List all quotes          |
| PATCH  | /api/quotes/:id | Admin  | Update quote status      |

### Leads

| Method | Endpoint       | Auth  | Description         |
|--------|---------------|-------|---------------------|
| POST   | /api/leads    | Public | Capture a lead      |
| GET    | /api/leads    | Admin  | List all leads      |
| PATCH  | /api/leads/:id| Admin  | Update lead status  |

### Services

| Method | Endpoint            | Auth  | Description         |
|--------|---------------------|-------|---------------------|
| GET    | /api/services       | Public | List services       |
| GET    | /api/services/:slug | Public | Get service detail  |
| POST   | /api/services       | Admin  | Create service      |
| PUT    | /api/services/:slug | Admin  | Update service      |
| DELETE | /api/services/:slug | Admin  | Deactivate service  |

### Blogs

| Method | Endpoint         | Auth  | Description         |
|--------|-----------------|-------|---------------------|
| GET    | /api/blogs       | Public | List published posts|
| GET    | /api/blogs/:slug | Public | Get a blog post     |
| POST   | /api/blogs       | Admin  | Create (+ image)    |
| PUT    | /api/blogs/:slug | Admin  | Update              |
| DELETE | /api/blogs/:slug | Admin  | Delete              |

### FAQs

| Method | Endpoint      | Auth  | Description       |
|--------|--------------|-------|-------------------|
| GET    | /api/faqs    | Public | List FAQs         |
| POST   | /api/faqs    | Admin  | Create FAQ        |
| PUT    | /api/faqs/:id| Admin  | Update FAQ        |
| DELETE | /api/faqs/:id| Admin  | Delete FAQ        |

### Applications (Careers)

| Method | Endpoint               | Auth  | Description          |
|--------|------------------------|-------|----------------------|
| POST   | /api/applications      | Public | Submit (+ resume)    |
| GET    | /api/applications      | Admin  | List applications    |
| PATCH  | /api/applications/:id  | Admin  | Update status        |

### Market (OfficeRestore)

| Method | Endpoint                    | Auth  | Description         |
|--------|-----------------------------|-------|---------------------|
| GET    | /api/market/products        | Public | List products       |
| GET    | /api/market/products/:slug  | Public | Product detail      |
| GET    | /api/market/categories      | Public | List categories     |
| POST   | /api/market/products        | Admin  | Create (+ images)   |
| PUT    | /api/market/products/:slug  | Admin  | Update              |
| DELETE | /api/market/products/:slug  | Admin  | Deactivate          |

---

## Connecting to the React Frontend

In your React app, point API calls to:

```js
// src/config/api.js
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
```

Add to `.env` in the React project:

```
VITE_API_URL=http://localhost:5000/api
```

### Example — Contact form submission

```js
const res = await fetch(`${API_BASE}/contact`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, mobile, email, state, whatsappOptin }),
})
const data = await res.json()
```

---

## Creating the First Admin User

After starting the server, register a user then promote them to admin directly in MongoDB:

```js
// In mongosh
db.users.updateOne({ email: "your@email.com" }, { $set: { role: "admin" } })
```

---

## Environment Variables Reference

| Variable        | Required | Description                               |
|-----------------|----------|-------------------------------------------|
| PORT            | No       | Server port (default 5000)                |
| NODE_ENV        | No       | `development` or `production`             |
| MONGO_URI       | Yes      | MongoDB connection string                 |
| JWT_SECRET      | Yes      | Secret key for JWT signing                |
| JWT_EXPIRE      | No       | Token expiry (default `7d`)               |
| CLIENT_URL      | No       | React app URL for CORS                    |
| SMTP_HOST       | Yes      | SMTP server host                          |
| SMTP_PORT       | Yes      | SMTP port (587 for TLS)                   |
| SMTP_USER       | Yes      | SMTP login username                       |
| SMTP_PASS       | Yes      | SMTP login password / app password        |
| EMAIL_FROM      | Yes      | Sender display name + address             |
| SUPPORT_EMAIL   | Yes      | Receives notification emails              |
| MAX_FILE_SIZE   | No       | Upload limit in bytes (default 5 MB)      |
