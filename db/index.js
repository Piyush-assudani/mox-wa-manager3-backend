const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

// Ensure server data storage directory exists
const DATA_DIR = path.join(__dirname, "../data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.DB_PATH
  ? (path.isAbsolute(process.env.DB_PATH) ? process.env.DB_PATH : path.resolve(__dirname, "..", process.env.DB_PATH))
  : path.join(DATA_DIR, "morihix_data.db");

const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("❌ Failed to open server-local SQLite database:", err.message);
  } else {
    console.log(`📦 Server-local database connected at: ${DB_PATH}`);
  }
});

// Enable SQLite Write-Ahead Logging for high concurrency & foreign keys
db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA foreign_keys = ON;");

// Initialize core schema on server startup
const UUID_GEN = "(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))";

const initSchema = () => {
  db.serialize(() => {
    // 1. Users Table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY DEFAULT ${UUID_GEN},
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Seed initial users if not exist (or update passwords)
    const bcrypt = require("bcryptjs");
    const moxHash = bcrypt.hashSync("mox@123&rathore@123", 10);
    const piyushHash = bcrypt.hashSync("9413879444", 10);

    db.run(
      `INSERT INTO users (id, username, password, role)
       VALUES ('user-mox-0001', 'Mox_rathore', ?, 'admin')
       ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password`,
      [moxHash]
    );

    db.run(
      `INSERT INTO users (id, username, password, role)
       VALUES ('user-piyush-0002', 'Piyushassudani', ?, 'admin')
       ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password`,
      [piyushHash]
    );

    db.run(`
      INSERT INTO users (id, username, password, role)
      VALUES ('admin-uuid-0001', 'admin', 'Qwerty@123&123%', 'admin')
      ON CONFLICT (username) DO NOTHING;
    `);

    // 2. Contacts Table
    db.run(`
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY DEFAULT ${UUID_GEN},
        phone_number TEXT UNIQUE NOT NULL,
        name TEXT,
        city TEXT,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);

    // 3. Contact Lists Table
    db.run(`
      CREATE TABLE IF NOT EXISTS contact_lists (
        id TEXT PRIMARY KEY DEFAULT ${UUID_GEN},
        name TEXT NOT NULL,
        file_url TEXT,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);

    // 4. Contact List Members Table
    db.run(`
      CREATE TABLE IF NOT EXISTS contact_list_members (
        list_id TEXT NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        PRIMARY KEY (list_id, contact_id)
      );
    `);

    // 5. Campaigns Table
    db.run(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY DEFAULT ${UUID_GEN},
        name TEXT NOT NULL,
        template_name TEXT NOT NULL,
        contact_list_id TEXT REFERENCES contact_lists(id) ON DELETE SET NULL,
        media_id TEXT,
        media_type TEXT,
        media_url TEXT,
        total_sent INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);

    // 6. Messages Table
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY DEFAULT ${UUID_GEN},
        campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        direction TEXT NOT NULL,
        message_body TEXT,
        media_url TEXT,
        meta_message_id TEXT,
        status TEXT DEFAULT 'sent',
        error_message TEXT,
        timestamp TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);

    // 7. Media Assets Table
    db.run(`
      CREATE TABLE IF NOT EXISTS media_assets (
        id TEXT PRIMARY KEY DEFAULT ${UUID_GEN},
        original_name TEXT NOT NULL,
        media_url TEXT NOT NULL,
        meta_media_id TEXT,
        resource_type TEXT DEFAULT 'image',
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);

    // 8. Webhook Logs Table
    db.run(`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id TEXT PRIMARY KEY DEFAULT ${UUID_GEN},
        payload TEXT,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);

    // 9. Auto-sanitize all contacts and merge duplicates (e.g., 9194138794440 -> 919413879444)
    db.all(`SELECT id, phone_number FROM contacts`, [], (err, rows) => {
      if (!err && rows && rows.length > 0) {
        rows.forEach((row) => {
          let clean = String(row.phone_number || "").replace(/\D/g, "");
          if (clean.startsWith("0")) clean = clean.replace(/^0+/, "");
          if (clean.startsWith("91")) {
            clean = clean.slice(0, 12);
          } else if (clean.length >= 10) {
            clean = "91" + clean.slice(0, 10);
          }
          if (clean && clean !== row.phone_number) {
            db.get(
              `SELECT id FROM contacts WHERE phone_number = ? AND id != ?`,
              [clean, row.id],
              (err2, existing) => {
                if (existing) {
                  // Merge duplicate contact safely
                  db.run(
                    `UPDATE OR IGNORE contact_list_members SET contact_id = ? WHERE contact_id = ?`,
                    [existing.id, row.id],
                    () => {
                      db.run(`DELETE FROM contact_list_members WHERE contact_id = ?`, [row.id], () => {
                        db.run(
                          `UPDATE messages SET contact_id = ? WHERE contact_id = ?`,
                          [existing.id, row.id],
                          () => {
                            db.run(`DELETE FROM contacts WHERE id = ?`, [row.id]);
                          }
                        );
                      });
                    }
                  );
                } else {
                  db.run(`UPDATE contacts SET phone_number = ? WHERE id = ?`, [clean, row.id]);
                }
              }
            );
          }
        });
      }
    });

    // 10. Auto-migrate existing timestamps to standard ISO-8601 UTC (YYYY-MM-DDTHH:MM:SSZ)
    db.run(
      `UPDATE messages 
       SET timestamp = replace(timestamp, ' ', 'T') || 'Z'
       WHERE timestamp IS NOT NULL 
         AND timestamp NOT LIKE '%Z' 
         AND timestamp LIKE '____-__-__ __:__:__%'`
    );
    db.run(
      `UPDATE contacts 
       SET created_at = replace(created_at, ' ', 'T') || 'Z'
       WHERE created_at IS NOT NULL 
         AND created_at NOT LIKE '%Z' 
         AND created_at LIKE '____-__-__ __:__:__%'`
    );
  });
};

initSchema();

/**
 * Universal query runner matching the node-postgres pg.Pool query API
 * Supports $1, $2 parameter binding, RETURNING *, and standard SQL
 */
const query = (text, params = []) => {
  return new Promise((resolve, reject) => {
    let cleanText = text
      .replace(/\bNOW\(\)/gi, "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
      .replace(/\bILIKE\b/gi, "LIKE")
      .replace(/\$(\d+)/g, "?$1")
      .trim();

    // Remove any trailing semicolon inside wrapped queries
    const isSelect = /^\s*(SELECT|PRAGMA)/i.test(cleanText);
    const hasReturning = /\bRETURNING\b/i.test(cleanText);

    if (isSelect || hasReturning) {
      db.all(cleanText, params, (err, rows) => {
        if (err) {
          console.error("❌ SQL Query Error:", err.message, "in query:", cleanText.slice(0, 100));
          return reject(err);
        }
        resolve({
          rows: rows || [],
          rowCount: rows ? rows.length : 0,
        });
      });
    } else {
      db.run(cleanText, params, function (err) {
        if (err) {
          console.error("❌ SQL Exec Error:", err.message, "in query:", cleanText.slice(0, 100));
          return reject(err);
        }
        resolve({
          rows: [],
          rowCount: this.changes || 0,
          lastID: this.lastID,
        });
      });
    }
  });
};

const getClient = async () => ({
  query,
  release: () => {},
});

module.exports = {
  query,
  getClient,
  db,
};
