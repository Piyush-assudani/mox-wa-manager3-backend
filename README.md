# Morihix WA Manager 3 Backend

This is the high-performance backend service for Morihix WA Manager 3. It provides RESTful APIs, real-time Socket.IO events, and webhook handling for managing WhatsApp campaigns, contacts, media, and real-time messaging using the official WhatsApp Cloud API.

## Features

- **WhatsApp Cloud API Integration:** Sends and receives messages, media, and template messages.
- **Webhook Handling:** Listens for inbound messages, delivery statuses, and read receipts with indexed lookup.
- **Campaign Management:** Built-in pacing logic to prevent spam blocks by Meta.
- **Database:** Server-local SQLite or PostgreSQL with indexed lookups for contacts, messages, and campaigns.
- **Media Uploads:** Cloudinary and local upload storage integration.
- **Security & Reliability:** IP abuse defense, rate limiting, universal permissive CORS, in-memory caching, and resilient edge-case handling.

## Setup Instructions

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment Variables:** Configure `.env` with your credentials:
   ```env
   PORT=6000
   NODE_ENV=development
   BASE_URL=https://mox-wa3.piyushassudani.in
   FRONTEND_URL=http://localhost:3000

   # Meta WhatsApp API
   META_WHATSAPP_TOKEN=your_token
   META_PHONE_ID=your_phone_id
   META_WABA_ID=your_waba_id
   META_WEBHOOK_VERIFY_TOKEN=your_verify_token

   # Storage & Database
   USE_LOCAL_STORAGE=true
   DB_PATH=data/morihix_data.db
   ```

3. **Start the server:**
   ```bash
   npm run dev
   # or for production:
   npm start
   ```
