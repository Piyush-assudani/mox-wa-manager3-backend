const express = require("express");
const router = express.Router();

const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - Morihix WA Manager 3</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #059669;
      --primary-dark: #047857;
      --primary-light: #ecfdf5;
      --accent: #25D366;
      --slate-900: #0f172a;
      --slate-800: #1e293b;
      --slate-700: #334155;
      --slate-600: #475569;
      --slate-500: #64748b;
      --slate-200: #e2e8f0;
      --slate-100: #f1f5f9;
      --slate-50: #f8fafc;
      --surface: #ffffff;
      --radius-lg: 16px;
      --radius-md: 12px;
      --shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05), 0 2px 4px -2px rgba(15, 23, 42, 0.05);
      --shadow-lg: 0 20px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04);
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--slate-50);
      color: var(--slate-700);
      line-height: 1.7;
      -webkit-font-smoothing: antialiased;
    }

    .header-hero {
      background: radial-gradient(circle at 80% 20%, rgba(16, 185, 129, 0.15) 0%, transparent 50%),
                  linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #ffffff;
      padding: 72px 24px 64px;
      text-align: center;
      position: relative;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background: rgba(37, 211, 102, 0.15);
      border: 1px solid rgba(37, 211, 102, 0.3);
      color: #34d399;
      font-size: 13px;
      font-weight: 600;
      border-radius: 9999px;
      margin-bottom: 20px;
      letter-spacing: 0.02em;
    }

    .header-hero h1 {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 38px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
      background: linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .header-hero p {
      font-size: 16px;
      color: #94a3b8;
      max-width: 600px;
      margin: 0 auto;
    }

    .meta-bar {
      margin-top: 24px;
      font-size: 13px;
      color: #64748b;
    }

    .main-container {
      max-width: 860px;
      margin: -32px auto 80px;
      padding: 0 24px;
      position: relative;
      z-index: 10;
    }

    .content-card {
      background: var(--surface);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      border: 1px solid var(--slate-200);
      padding: 48px;
    }

    @media (max-width: 640px) {
      .content-card {
        padding: 28px 20px;
      }
      .header-hero h1 {
        font-size: 28px;
      }
    }

    h2 {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 22px;
      font-weight: 700;
      color: var(--slate-900);
      margin: 40px 0 16px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    h2:first-of-type {
      margin-top: 0;
    }

    h2::before {
      content: "";
      display: inline-block;
      width: 4px;
      height: 22px;
      background: var(--primary);
      border-radius: 4px;
    }

    h3 {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 16px;
      font-weight: 600;
      color: var(--slate-800);
      margin: 24px 0 8px;
    }

    p, li {
      font-size: 15px;
      color: var(--slate-600);
      margin-bottom: 14px;
    }

    ul {
      padding-left: 24px;
      margin-bottom: 20px;
    }

    li {
      margin-bottom: 8px;
    }

    strong {
      color: var(--slate-800);
      font-weight: 600;
    }

    .callout-box {
      background: var(--primary-light);
      border: 1px solid rgba(5, 150, 105, 0.2);
      border-left: 4px solid var(--primary);
      border-radius: var(--radius-md);
      padding: 18px 22px;
      margin: 24px 0;
    }

    .callout-box p {
      color: var(--primary-dark);
      margin: 0;
      font-size: 14px;
      font-weight: 500;
    }

    .callout-box p strong {
      color: var(--primary-dark);
    }

    .contact-card {
      background: var(--slate-100);
      border: 1px solid var(--slate-200);
      border-radius: var(--radius-md);
      padding: 24px;
      margin-top: 24px;
    }

    .contact-card p {
      margin-bottom: 8px;
      color: var(--slate-700);
    }

    a {
      color: var(--primary);
      text-decoration: none;
      font-weight: 500;
      transition: color 0.15s ease;
    }

    a:hover {
      color: var(--primary-dark);
      text-decoration: underline;
    }

    footer {
      text-align: center;
      padding: 32px 24px;
      font-size: 13px;
      color: var(--slate-500);
      border-top: 1px solid var(--slate-200);
      background: var(--surface);
    }
  </style>
</head>
<body>

  <header class="header-hero">
    <div class="badge">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
      Meta Business &amp; API Compliance
    </div>
    <h1>Privacy Policy</h1>
    <p>Enterprise WhatsApp Marketing &amp; Business Messaging Platform</p>
    <div class="meta-bar">Effective Date: October 2026 &bull; Version 2.0</div>
  </header>

  <main class="main-container">
    <div class="content-card">
      <h2>1. Introduction</h2>
      <p>
        Welcome to the WhatsApp Business Automation Platform ("we", "our", or "us"). We provide enterprise-grade messaging, conversational CRM, and automated communication tools integrated directly with the official Meta WhatsApp Cloud API.
      </p>
      <p>
        This Privacy Policy explains how our platform collects, processes, stores, and protects personal information when you or your end users interact with our WhatsApp Business messaging endpoints, web management console, and associated APIs. We are deeply committed to respecting your privacy and protecting the confidentiality of your personal and business data.
      </p>

      <h2>2. Information We Collect</h2>
      <p>In operating our WhatsApp marketing and communication services, we collect only data necessary to facilitate reliable messaging:</p>
      
      <h3>a) End-User Contact &amp; Message Information</h3>
      <ul>
        <li><strong>Contact Identifiers:</strong> WhatsApp phone numbers, recipient display names, and designated contact list tags.</li>
        <li><strong>Message Content:</strong> Inbound and outbound text messages, media attachments (images, documents, audio, videos), interactive button replies, and quick-reply selections sent via WhatsApp.</li>
        <li><strong>Delivery Status &amp; Metadata:</strong> Real-time message status updates (sent, delivered, read, failed), error codes, timestamps, and conversation identifiers provided by Meta's WhatsApp Cloud API.</li>
      </ul>

      <h3>b) Administrative Account Data</h3>
      <ul>
        <li><strong>Platform Credentials:</strong> Authorized administrator usernames, securely hashed passwords, and session tokens.</li>
        <li><strong>System Configurations:</strong> WhatsApp Business Account (WABA) IDs, Phone Number IDs, Meta Cloud API access tokens, and webhook verification tokens.</li>
      </ul>

      <div class="callout-box">
        <p><strong>Strict Anti-Spam &amp; Zero Resale Guarantee:</strong> We do not sell, rent, monetize, or trade contact lists, phone numbers, or conversation histories with any third parties or data brokers. All communications are strictly restricted to authorized business interactions.</p>
      </div>

      <h2>3. How We Use Information</h2>
      <p>Information processed by our system is utilized solely for legitimate operational purposes:</p>
      <ul>
        <li>Dispatching authorized WhatsApp template notifications, service updates, and conversational broadcasts.</li>
        <li>Facilitating 2-way real-time customer support and live agent chat via official webhooks.</li>
        <li>Tracking deliverability metrics, read receipts, and account health compliance within Meta's quality rating tiers.</li>
        <li>Maintaining contact segmentation and opt-out preferences.</li>
        <li>Auditing system logs to ensure API uptime, security, and spam prevention.</li>
      </ul>

      <h2>4. Integration with Meta WhatsApp Cloud API</h2>
      <p>
        Our service functions on top of Meta Platforms, Inc.'s official WhatsApp Business Cloud API. When messages are transmitted through our infrastructure:
      </p>
      <ul>
        <li>Messages transit through Meta's encrypted network protocols according to Meta's Business Terms of Service.</li>
        <li>Meta processes message data as an independent processor in accordance with the <a href="https://www.whatsapp.com/legal/privacy-policy" target="_blank" rel="noopener">WhatsApp Privacy Policy</a> and <a href="https://www.facebook.com/legal/business-platform-terms" target="_blank" rel="noopener">Meta Business Terms</a>.</li>
        <li>We enforce strict 24-hour customer service window guidelines and template pre-approvals required by Meta platform policies.</li>
      </ul>

      <h2>5. Data Security &amp; Encryption</h2>
      <p>
        Security is fundamental to our architecture. We implement state-of-the-art organizational and technical safeguards:
      </p>
      <ul>
        <li><strong>Transport Encryption:</strong> All communications between clients, our backend APIs, and Meta servers utilize TLS 1.3 encryption.</li>
        <li><strong>Database Protection:</strong> Contact and message registries are housed in hardened cloud databases with encrypted storage at rest (AES-256).</li>
        <li><strong>Access Controls:</strong> Role-based authorization, JWT session verification, and IP isolation for administrative endpoints.</li>
        <li><strong>Continuous Health Monitoring:</strong> Real-time tracking of token expirations, webhook signatures, and system integrity.</li>
      </ul>

      <h2>6. User Rights &amp; Opt-Out Mechanism</h2>
      <p>Every recipient communicating with our platform possesses full control over their personal data:</p>
      <ul>
        <li><strong>Opt-Out / Stop:</strong> Recipients can stop receiving automated campaigns at any moment by sending standard stop keywords (e.g., "STOP", "UNSUBSCRIBE"). Upon receipt, our system immediately flags the contact to prevent automated dispatches.</li>
        <li><strong>Right of Access &amp; Rectification:</strong> Authorized users may inspect, update, or correct contact profiles via our contact management console.</li>
        <li><strong>Right of Erasure:</strong> Organizations and recipients may request the permanent deletion of contact records, media attachments, and message archives.</li>
      </ul>

      <h2>7. Data Retention &amp; Disposal</h2>
      <p>
        We retain operational message logs and contact lists only as long as required to deliver our messaging services or satisfy regulatory compliance. Historical campaign metrics are aggregated and purged periodically to minimize data exposure.
      </p>

      <h2>8. Policy Revisions</h2>
      <p>
        We may occasionally update this Privacy Policy to reflect enhancements in our architecture or changes in WhatsApp Business policies. Updates become effective immediately upon publication on this endpoint.
      </p>

      <h2>9. Contact &amp; Privacy Inquiries</h2>
      <p>
        For inquiries regarding this Privacy Policy, data processing agreements, or deletion requests, please contact our administrative team:
      </p>
      <div class="contact-card">
        <p><strong>WhatsApp Business Platform Administrator</strong></p>
        <p>🔒 Data Privacy &amp; API Compliance</p>
        <p>📧 Email: <a href="mailto:support@wpautomation.com">support@wpautomation.com</a></p>
        <p>🌐 Management Endpoint: <a href="/privacy">/privacy</a></p>
      </div>
    </div>
  </main>

  <footer>
    &copy; 2026 WhatsApp Business Automation Platform. All rights reserved.
  </footer>

</body>
</html>`;

router.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(PRIVACY_HTML);
});

module.exports = router;

