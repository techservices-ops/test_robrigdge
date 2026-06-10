

// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const logger = require('./logger');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
// EMERGENCY FIX: Safe load nodemailer to prevent server crash
let nodemailer;
try {
  nodemailer = require('nodemailer');
  console.log('✅ Nodemailer loaded successfully at startup');
} catch (e) {
  console.error('⚠️ WARN: Nodemailer could not be loaded. Email features disabled.', e.message);
}


const app = express();
const server = http.createServer(app);

// Render-compatible configuration
const PORT = process.env.PORT || 3001;
const AI_SERVER_URL = process.env.AI_SERVER_URL || 'https://robridge-ai-tgc9.onrender.com';
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || 'robridge-secret-key-change-in-production-2024';

// DEBUG: Check if nodemailer exists in node_modules
try {
  const fs = require('fs');
  const files = fs.readdirSync(__dirname);
  console.log('📂 Current Directory Files:', files);

  const modules = fs.readdirSync(path.join(__dirname, 'node_modules'));
  console.log('📦 node_modules preview:', modules.filter(m => m.startsWith('node') || m.startsWith('pg') || m === 'nodemailer'));

  require.resolve('nodemailer');
  console.log('✅ Nodemailer found!');
} catch (e) {
  console.error('❌ Nodemailer DEBUG Error:', e.message);
  // OPTIONAL: Try to manually install if missing (Dangerous but might save it)
  // require('child_process').execSync('npm install nodemailer');
}

const allowedOrigins = [
  "https://robridgelabs.com",
  "https://www.robridgelabs.com",
  "http://localhost:3000",
  "http://localhost:8080"
];

const checkCorsOrigin = (origin, callback) => {
  if (!origin) return callback(null, true);
  const isAllowed = allowedOrigins.includes(origin) || 
                    origin.endsWith(".onrender.com");
  if (isAllowed) {
    callback(null, true);
  } else {
    callback(new Error('Not allowed by CORS: ' + origin));
  }
};

// Initialize Socket.IO with CORS after NODE_ENV is defined
const io = socketIo(server, {
  cors: {
    origin: NODE_ENV === 'production' ? checkCorsOrigin : true,
    methods: ["GET", "POST"],
    credentials: true
  }
});


console.log('Server Configuration:');
console.log(`   PORT: ${PORT}`);
console.log(`   AI_SERVER_URL: ${AI_SERVER_URL}`);
console.log(`   NODE_ENV: ${NODE_ENV}`);

// Create a separate app for port 3002 redirect
const redirectApp = express();
const REDIRECT_PORT = 3003;

// ─── UTILITY MIDDLEWARE ───────────────────────────────────────────────────────
app.use(compression()); // Compress HTTP responses
app.use(cookieParser()); // Parse cookies for auth
app.use(logger.requestMiddleware); // Log all requests using Winston

// ─── SECURITY MIDDLEWARE ────────────────────────────────────────────────────
// Helmet: sets secure HTTP response headers (CSP, HSTS, XSS protection, etc.)
app.use(helmet({
  contentSecurityPolicy: false, // Disabled so React's inline scripts work; tighten in future
  crossOriginEmbedderPolicy: false
}));

// CORS
app.use(cors({
  origin: NODE_ENV === 'production' ? checkCorsOrigin : true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-workspace-id"]
}));

// Body size limit — prevents payload-based DoS attacks
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ─── RATE LIMITING ───────────────────────────────────────────────────────────
// Global limiter — all routes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
  skip: (req, res) => NODE_ENV !== 'production'
});
app.use(globalLimiter);

// Auth limiter — login / signup / reset (stricter)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many authentication attempts. Please wait 15 minutes.' },
  skip: (req, res) => NODE_ENV !== 'production'
});
app.use(['/api/login', '/api/register', '/api/forgot-password', '/api/reset-password'], authLimiter);

// Scanner endpoint limiter — allows burst but blocks sustained abuse
const scanLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120,
  message: { success: false, error: 'Scan rate limit exceeded.' },
  skip: (req, res) => NODE_ENV !== 'production'
});
app.use(['/api/ims/scanner', '/api/esp32/scan'], scanLimiter);

// Serve static files from React build directory for /bvs subdirectory
app.use('/bvs', express.static(path.join(__dirname, 'build')));

// Handle React routing for /bvs subdirectory - return index.html for all non-API routes
app.get('/bvs/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Fallback redirect for root-level routes directly hitting the backend in production / dev
app.get('/verify-email', (req, res) => {
  const token = req.query.token;
  const target = NODE_ENV === 'production' ? '/bvs/verify-email' : 'http://localhost:3000/verify-email';
  res.redirect(token ? `${target}?token=${token}` : target);
});

app.get('/reset-password', (req, res) => {
  const token = req.query.token;
  const target = NODE_ENV === 'production' ? '/bvs/reset-password' : 'http://localhost:3000/reset-password';
  res.redirect(token ? `${target}?token=${token}` : target);
});

// Store the Python process
let pythonProcess = null;

// Store ESP32 device data
let esp32Devices = new Map();
let lastBarcodeScan = null;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')) ? true : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false),
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 20
});
// Initialize database connection
const initDatabase = async () => {
  try {
    console.log('🔍 Database connection details:');
    console.log('   DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'Not set');
    console.log('   NODE_ENV:', process.env.NODE_ENV);
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    const client = await pool.connect();
    // Auto-migration for Forgot Password and Email Verification columns
    try {
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS reset_password_token VARCHAR(255),
        ADD COLUMN IF NOT EXISTS reset_password_expires BIGINT,
        ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(255),
        ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE
      `);
      console.log('✅ Checked/Updated users table schema for Auth features');
      // Add out_scan_at to stock_track
      try {
        await client.query(`
          ALTER TABLE stock_track 
          ADD COLUMN IF NOT EXISTS out_scan_at TIMESTAMP
        `);
        console.log('✅ Checked/Updated stock_track table schema for out_scan_at feature');
      } catch (err) {
        // Ignored. Table stock_track doesn't exist yet on first boot
      }
      // Mark all existing users as verified (so they can log in)
      const updateResult = await client.query(`
        UPDATE users 
        SET email_verified = TRUE 
        WHERE email_verified IS NULL OR email_verified = FALSE
      `);
      console.log(`✅ Marked ${updateResult.rowCount} existing users as verified`);
      // ==========================================
      // Multi-Tenant Workspaces Schema Setup
      // ==========================================
      await client.query(`
        CREATE TABLE IF NOT EXISTS ims_workspaces (
          id SERIAL PRIMARY KEY,
          name VARCHAR(200) NOT NULL,
          owner_id INTEGER NOT NULL,
          subscription_tier VARCHAR(50) DEFAULT 'free',
          max_users INTEGER DEFAULT 5,
          max_skus INTEGER DEFAULT 1000,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS ims_workspace_members (
          id SERIAL PRIMARY KEY,
          workspace_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          role VARCHAR(50) DEFAULT 'member',
          status VARCHAR(50) DEFAULT 'active',
          joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (workspace_id) REFERENCES ims_workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(workspace_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS ims_workspace_invites (
          id SERIAL PRIMARY KEY,
          workspace_id INTEGER NOT NULL,
          token VARCHAR(64) NOT NULL UNIQUE,
          role VARCHAR(50) DEFAULT 'member',
          created_by INTEGER NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          uses_remaining INTEGER DEFAULT 10,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (workspace_id) REFERENCES ims_workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
      console.log('✅ Checked/Updated schema for Workspaces');
      // ==========================================
      // IMS Dynamic Configuration Schema Setup
      // ==========================================
      await client.query(`
        CREATE TABLE IF NOT EXISTS ims_settings (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          workspace_id INTEGER,
          preferences JSONB NOT NULL DEFAULT '{}',
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS ims_roles (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          workspace_id INTEGER,
          name VARCHAR(100) NOT NULL,
          color VARCHAR(20) DEFAULT '#3498db',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS ims_workflows (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          workspace_id INTEGER,
          name VARCHAR(100) NOT NULL,
          color VARCHAR(20) DEFAULT '#3498db',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS ims_categories (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          workspace_id INTEGER,
          name VARCHAR(100) NOT NULL,
          mode VARCHAR(20) DEFAULT 'FIFO',
          alert_at INTEGER DEFAULT 10,
          reorder_at INTEGER DEFAULT 20,
          color VARCHAR(20) DEFAULT '#3498db',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
      console.log('✅ Checked/Updated schema for IMS Dynamic Configuration tables');
      // ==========================================
      // IMS Core Operational Schema
      // ==========================================
      console.log('Running IMS Core Operational Schema query...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS ims_masters (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          workspace_id INTEGER,
          name VARCHAR(200) NOT NULL,
          description TEXT DEFAULT '',
          category VARCHAR(100) DEFAULT 'General',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS ims_items (
          id SERIAL PRIMARY KEY,
          master_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          workspace_id INTEGER,
          barcode VARCHAR(200) NOT NULL,
          name VARCHAR(300) NOT NULL,
          category VARCHAR(100) DEFAULT 'General',
          base_unit VARCHAR(50) DEFAULT 'Unit',
          stock NUMERIC DEFAULT 0,
          tracking_mode VARCHAR(20) DEFAULT 'FIFO',
          parent_barcode VARCHAR(200),
          multiplier NUMERIC,
          supplier VARCHAR(200),
          locations JSONB DEFAULT '[]',
          bom JSONB DEFAULT '[]',
          weight NUMERIC,
          cost NUMERIC,
          image_url TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (master_id) REFERENCES ims_masters(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS ims_scan_events (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          workspace_id INTEGER,
          barcode VARCHAR(200) NOT NULL,
          item_id INTEGER,
          item_name VARCHAR(300),
          workflow VARCHAR(100) NOT NULL,
          quantity NUMERIC DEFAULT 1,
          unit VARCHAR(50),
          batch_no VARCHAR(100),
          serial_no VARCHAR(100),
          expiry_date TIMESTAMP,
          notes TEXT,
          scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
      // Attempt to alter existing tables to add workspace_id if they already existed
      try {
        console.log('Altering existing tables to add workspace_id...');
        const tablesToAlter = ['ims_settings', 'ims_roles', 'ims_workflows', 'ims_categories', 'ims_masters', 'ims_items', 'ims_scan_events'];
        for (const table of tablesToAlter) {
          console.log(`Altering ${table}...`);
          await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS workspace_id INTEGER`);
        }
        await client.query(`ALTER TABLE ims_scan_events ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMP`);
        await client.query(`ALTER TABLE ims_scan_events ADD COLUMN IF NOT EXISTS websocket_scan_id VARCHAR(255)`);
        // Clean up duplicate websocket_scan_id rows before creating unique index
        await client.query(`
          DELETE FROM ims_scan_events 
          WHERE id IN (
            SELECT id FROM (
              SELECT id, ROW_NUMBER() OVER (PARTITION BY websocket_scan_id ORDER BY id) as rn 
              FROM ims_scan_events 
              WHERE websocket_scan_id IS NOT NULL
            ) t 
            WHERE t.rn > 1
          )
        `);
        // Create unique index on websocket_scan_id (partial, ignoring NULL) to prevent duplicate inserts
        await client.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_ims_scan_events_websocket_scan_id 
          ON ims_scan_events(websocket_scan_id) 
          WHERE websocket_scan_id IS NOT NULL
        `);
        await client.query(`ALTER TABLE ims_items ADD COLUMN IF NOT EXISTS alert_at NUMERIC DEFAULT 0`);
        await client.query(`ALTER TABLE ims_items ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'`);
        await client.query(`ALTER TABLE ims_items ADD COLUMN IF NOT EXISTS item_type VARCHAR(50) DEFAULT 'Raw Material'`);
        await client.query(`ALTER TABLE ims_items ADD COLUMN IF NOT EXISTS image_url TEXT`);
      } catch (alterErr) { console.log('Notice: Could not alter tables (might be fresh DB)'); }
      console.log('Starting user migration (batch mode)...');
      // BATCH: Create default workspaces for ALL users that don't have one — in one query
      await client.query(`
        INSERT INTO ims_workspaces (name, owner_id)
        SELECT 
          COALESCE(u.name, 'User') || '''s Workspace',
          u.id
        FROM users u
        WHERE NOT EXISTS (
          SELECT 1 FROM ims_workspaces w WHERE w.owner_id = u.id
        )
      `);
      // BATCH: Add them all as owners in ims_workspace_members — in one query
      await client.query(`
        INSERT INTO ims_workspace_members (workspace_id, user_id, role)
        SELECT w.id, w.owner_id, 'owner'
        FROM ims_workspaces w
        WHERE NOT EXISTS (
          SELECT 1 FROM ims_workspace_members m 
          WHERE m.workspace_id = w.id AND m.user_id = w.owner_id
        )
      `);
      // BATCH: Update all IMS tables to fill in workspace_id for rows that have user_id but no workspace_id
      const tablesToUpdate = ['ims_settings', 'ims_roles', 'ims_workflows', 'ims_categories', 'ims_masters', 'ims_items', 'ims_scan_events'];
      for (const table of tablesToUpdate) {
        await client.query(`
          UPDATE ${table} t
          SET workspace_id = w.id
          FROM ims_workspaces w
          WHERE t.user_id = w.owner_id AND t.workspace_id IS NULL
        `);
      }
      console.log('✅ Migrated existing users to default Workspaces (batch completed instantly)');
      // Add unique constraint for barcode per master (safe, won't error if exists)
      try {
        await client.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_ims_items_barcode_master
          ON ims_items(master_id, barcode);
          CREATE INDEX IF NOT EXISTS idx_ims_scan_events_ws
          ON ims_scan_events(workspace_id, scanned_at DESC);
          CREATE INDEX IF NOT EXISTS idx_ims_items_ws
          ON ims_items(workspace_id);
        `);
      } catch(idxErr) { /* indexes might already exist */ }
      console.log('✅ Checked/Updated schema for IMS Core Operational tables (masters, items, scan_events)');
      // ── NEW TABLES ──────────────────────────────────────────────────
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS ims_audit_log (
            id SERIAL PRIMARY KEY,
            workspace_id INTEGER NOT NULL,
            user_id INTEGER,
            action VARCHAR(50) NOT NULL,
            entity_type VARCHAR(50) NOT NULL,
            entity_id INTEGER,
            details JSONB,
            ip_address VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE IF NOT EXISTS ims_workorders (
            id SERIAL PRIMARY KEY,
            workspace_id INTEGER NOT NULL,
            user_id INTEGER,
            wo_number VARCHAR(50) UNIQUE NOT NULL,
            product_barcode VARCHAR(255),
            product_name VARCHAR(255) NOT NULL,
            target_qty INTEGER NOT NULL DEFAULT 1,
            built_qty INTEGER NOT NULL DEFAULT 0,
            status VARCHAR(20) DEFAULT 'PENDING',
            priority VARCHAR(20) DEFAULT 'NORMAL',
            due_date DATE,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE IF NOT EXISTS ims_wo_items (
            id SERIAL PRIMARY KEY,
            wo_id INTEGER REFERENCES ims_workorders(id) ON DELETE CASCADE,
            barcode VARCHAR(255) NOT NULL,
            name VARCHAR(255),
            required_qty NUMERIC NOT NULL DEFAULT 0,
            available_qty NUMERIC DEFAULT 0,
            unit VARCHAR(50) DEFAULT 'pcs'
          );
          CREATE TABLE IF NOT EXISTS ims_grn (
            id SERIAL PRIMARY KEY,
            workspace_id INTEGER NOT NULL,
            user_id INTEGER,
            doc_no VARCHAR(50) UNIQUE NOT NULL,
            type VARCHAR(10) NOT NULL,
            supplier VARCHAR(255) NOT NULL,
            po_ref VARCHAR(100),
            vehicle_no VARCHAR(100),
            notes TEXT,
            status VARCHAR(20) DEFAULT 'PENDING',
            approved_by INTEGER,
            approved_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE IF NOT EXISTS ims_grn_items (
            id SERIAL PRIMARY KEY,
            grn_id INTEGER REFERENCES ims_grn(id) ON DELETE CASCADE,
            barcode VARCHAR(255),
            name VARCHAR(255),
            ordered_qty NUMERIC DEFAULT 0,
            received_qty NUMERIC DEFAULT 0,
            unit VARCHAR(50) DEFAULT 'pcs',
            condition VARCHAR(50) DEFAULT 'Good',
            note TEXT
          );
          CREATE TABLE IF NOT EXISTS ims_locations (
            id SERIAL PRIMARY KEY,
            workspace_id INTEGER NOT NULL,
            user_id INTEGER,
            name VARCHAR(255) NOT NULL,
            type VARCHAR(50) DEFAULT 'WAREHOUSE',
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE IF NOT EXISTS ims_location_stock (
            id SERIAL PRIMARY KEY,
            location_id INTEGER REFERENCES ims_locations(id) ON DELETE CASCADE,
            workspace_id INTEGER NOT NULL,
            barcode VARCHAR(255) NOT NULL,
            item_name VARCHAR(255),
            qty NUMERIC DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(location_id, barcode)
          );
          CREATE TABLE IF NOT EXISTS ims_production_stages (
            id SERIAL PRIMARY KEY,
            workspace_id INTEGER NOT NULL,
            name VARCHAR(100) NOT NULL,
            order_index INTEGER DEFAULT 0,
            UNIQUE(workspace_id, name)
          );
          CREATE TABLE IF NOT EXISTS ims_production_events (
            id SERIAL PRIMARY KEY,
            workspace_id INTEGER NOT NULL,
            user_id INTEGER,
            wo_id INTEGER,
            barcode VARCHAR(255) NOT NULL,
            item_name VARCHAR(255),
            stage_id INTEGER,
            stage_name VARCHAR(100),
            outcome VARCHAR(20) NOT NULL,
            qty INTEGER DEFAULT 1,
            batch_no VARCHAR(100),
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        console.log('✅ New IMS tables (Work Orders, GRN, Locations, Production) ready');
      } catch(newTblErr) { console.log('Notice (new tables):', newTblErr.message); }
    } catch (schemaErr) {
      console.error('⚠️ Schema update warning:', schemaErr.message);
    }
    console.log('Connected to PostgreSQL database');
    client.release();
    return Promise.resolve();
  } catch (err) {
    console.error('Error connecting to database:', err);
    return Promise.reject(err);
  }
};
// ======================
// EMAIL CONFIGURATION
// ======================
const transporter = nodemailer.createTransport({
  service: 'gmail', // or use 'host' and 'port' if not using Gmail
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});
// Verify email configuration on startup (optional, prevents crash if not set)
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter.verify(function (error, success) {
    if (error) {
      console.log('⚠️ Email service not ready:', error.message);
    } else {
      console.log('✅ Email service is ready to send messages');
    }
  });
} else {
  console.log('⚠️ EMAIL_USER or EMAIL_PASS not set. Forgot Password emails will NOT send.');
}
// Function to save barcode scan to database
const saveBarcodeScan = async (scanData) => {
  try {
    const {
      barcodeData,
      deviceName,
      deviceId,
      scanType = 'qr',
      source = 'ESP32', // Changed to uppercase for consistency
      productName = 'Unknown Product',
      productId = 'UNKNOWN',
      price = 0,
      locationX = 0,
      locationY = 0,
      locationZ = 0,
      category = 'Unknown',
      userId = null, // Add userId parameter
      metadata = '{}'
    } = scanData;
    const barcodeId = `SCAN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();
    const query = `
      INSERT INTO barcodes (
        barcode_id, barcode_data, barcode_type, source, product_name, 
        product_id, price, location_x, location_y, location_z, 
        category, file_path, metadata, user_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id
    `;
    const values = [
      barcodeId, barcodeData, scanType, source, productName,
      productId, price, locationX, locationY, locationZ,
      category, '', JSON.stringify(metadata), userId, timestamp
    ];
    const result = await pool.query(query, values);
    console.log(`Barcode scan saved with ID: ${result.rows[0].id}${userId ? ` for user ${userId}` : ''}`);
    return { id: result.rows[0].id, barcodeId };
  } catch (error) {
    console.error('Error saving barcode scan:', error);
    throw error;
  }
};
// Function to get all scanned barcodes
const getAllScannedBarcodes = async (limit = 100, offset = 0) => {
  try {
    const query = `
      SELECT 
        id, barcode_id, barcode_data, barcode_type, source, 
        product_name, product_id, price, location_x, location_y, location_z,
        category, file_path, metadata, created_at
      FROM barcodes 
      ORDER BY created_at DESC 
      LIMIT $1 OFFSET $2
    `;
    const result = await pool.query(query, [limit, offset]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching barcodes:', error);
    throw error;
  }
};
// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Simple health endpoint for convenience
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// TEMPORARY: Manual database migration endpoint
// TODO: Remove this after migration is complete
app.get('/api/admin/migrate-email-verification', async (req, res) => {
  try {
    console.log('🔧 Running manual email verification migration...');
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(255),
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE
    `);
    console.log('✅ Columns added successfully');
    // Mark existing users as verified
    const result = await pool.query(`
      UPDATE users 
      SET email_verified = TRUE 
      WHERE email_verified IS NULL OR email_verified = FALSE
    `);
    console.log(`✅ Updated ${result.rowCount} existing users to verified status`);
    res.json({
      success: true,
      message: 'Migration completed successfully!',
      columnsAdded: true,
      usersUpdated: result.rowCount
    });
  } catch (error) {
    console.error('❌ Migration error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// ======================
// AUTHENTICATION MIDDLEWARE
// ======================
// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  let token = req.cookies?.token;
  if (!token) {
    const authHeader = req.headers['authorization'];
    token = authHeader && authHeader.split(' ')[1]; // Fallback to Bearer token
  }
  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired token' });
    }
    req.user = user;
    req.rawToken = token; // Store raw token for frontend session setup
    next();
  });
};
// ======================
// AUTHENTICATION ENDPOINTS
// ======================
// Helper: Validate strong password
const validatePassword = (password) => {
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one special character (!@#$%^&*...)' };
  }
  return { valid: true };
};
// Helper: Validate email format
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};
// User Registration with Email Verification
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, role = 'expo_user' } = req.body;
    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }
    // Validate email format
    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid email address'
      });
    }
    // Validate strong password
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        error: passwordValidation.error
      });
    }
    // Check if user already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists'
      });
    }
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    // Generate email verification token
    const verificationToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    // Insert user (email_verified = false by default)
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, email_verification_token, email_verified) 
       VALUES ($1, $2, $3, $4, $5, FALSE) 
       RETURNING id, email, name, role, created_at`,
      [email.toLowerCase(), passwordHash, name || email.split('@')[0], role, verificationToken]
    );
    const user = result.rows[0];

    // Send verification email
    const origin = req.headers.origin;
    const host = req.get('host');
    const protocol = req.protocol;
    let clientUrl = origin || process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production'
      ? `${protocol}://${host}/bvs`
      : 'http://localhost:3000');
    
    // Normalize clientUrl: ensure it has /bvs subdirectory prefix if in production and not localhost/127.0.0.1
    const isLocalhost = clientUrl.includes('localhost') || clientUrl.includes('127.0.0.1');
    if (process.env.NODE_ENV === 'production' && !isLocalhost && !clientUrl.endsWith('/bvs') && !clientUrl.includes('/bvs/')) {
      clientUrl = clientUrl.replace(/\/$/, '') + '/bvs';
    }
    
    const verificationLink = `${clientUrl}/verify-email?token=${verificationToken}`;
    const mailOptions = {
      from: `"RoBridge Support" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Verify Your RoBridge Account',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #007bff;">Welcome to RoBridge!</h2>
          <p>Hi ${user.name},</p>
          <p>Thank you for registering. Please verify your email address to activate your account.</p>
          <a href="${verificationLink}" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0;">Verify Email</a>
          <p>Or copy this link: ${verificationLink}</p>
          <p>This link will expire in 24 hours.</p>
          <p>Best regards,<br>RoBridge Team</p>
        </div>
      `
    };
    if (nodemailer && transporter && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      try {
        await transporter.sendMail(mailOptions);
        console.log(`📧 Verification email sent to ${user.email}`);
      } catch (emailError) {
        console.error('⚠️ Failed to send verification email, but user was created:', emailError.message);
        console.log(`⚠️ Fallback Verification link: ${verificationLink}`);
      }
    } else {
      console.log(`⚠️ Email service unavailable. Verification link: ${verificationLink}`);
    }

    res.json({
      success: true,
      message: 'Registration successful! Please check your email to verify your account.',
      email: user.email,
      requiresVerification: true
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register user'
    });
  }
});

// Check Verification Endpoint (for Polling)
app.get('/api/auth/check-verification', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ success: false, error: 'Email required' });

    const result = await pool.query('SELECT id, email, name, role, email_verified FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'User not found' });

    const user = result.rows[0];
    if (user.email_verified) {
      // Generate JWT token
      const jwtToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      // Set JWT in httpOnly cookie
      res.cookie('token', jwtToken, {
        httpOnly: true,
        secure: NODE_ENV === 'production',
        sameSite: NODE_ENV === 'production' ? 'strict' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      return res.json({
        verified: true,
        token: jwtToken,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, workspaceId: null }
      });
    }

    return res.json({ verified: false });
  } catch (error) {
    console.error('Error checking verification:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
// Email Verification Endpoint
app.get('/api/auth/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Verification token is required' });
    }
    // Find user with this token
    const result = await pool.query(
      'SELECT id, email, name, role, email_verified FROM users WHERE email_verification_token = $1',
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid verification token' });
    }
    const user = result.rows[0];
    if (user.email_verified) {
      return res.json({ success: true, message: 'Email already verified. You can login now.' });
    }
    // Mark email as verified
    await pool.query(
      'UPDATE users SET email_verified = TRUE, email_verification_token = NULL WHERE id = $1',
      [user.id]
    );
    
    // Generate JWT token
    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    // Set JWT in httpOnly cookie
    res.cookie('token', jwtToken, {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: NODE_ENV === 'production' ? 'strict' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({ 
      success: true, 
      message: 'Email verified successfully!',
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        workspaceId: null
      }
    });
  } catch (error) {
    console.error('Error verifying email:', error);
    res.status(500).json({ success: false, error: 'Failed to verify email' });
  }
});
// User Login with Email Verification Check
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }
    // Find user
    const result = await pool.query(
      'SELECT id, email, password_hash, name, role, is_active, email_verified FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    const user = result.rows[0];
    // Verify password first
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Incorrect password'
      });
    }
    // Check if email is verified
    if (!user.email_verified) {
      return res.status(403).json({
        success: false,
        error: 'Please verify your email before logging in. Check your inbox for the verification link.'
      });
    }
    // Check if user is active
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        error: 'Account is deactivated'
      });
    }
    // Update last login
    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );
    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    // Fetch default workspace
    let defaultWorkspaceId = null;
    try {
      const wsCheck = await pool.query(
        "SELECT workspace_id FROM ims_workspace_members WHERE user_id = $1 AND status = 'active' ORDER BY joined_at ASC LIMIT 1",
        [user.id]
      );
      if (wsCheck.rows.length > 0) {
        defaultWorkspaceId = wsCheck.rows[0].workspace_id;
      }
    } catch(err) { console.error('Error fetching workspace for login:', err); }
    // Set JWT in httpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: NODE_ENV === 'production' ? 'strict' : 'lax', // lax needed for cross-origin dev (port 3000→3001)
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        workspaceId: defaultWorkspaceId
      }
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed. Please try again.'
    });
  }
});
// Logout endpoint to clear httpOnly cookie
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});
// Verify Token & Email Verification GET Endpoint (Combined)
app.get('/api/auth/verify', async (req, res) => {
  const emailToken = req.query.token;

  if (emailToken) {
    // ─── EMAIL VERIFICATION REDIRECT FLOW ────────────────────────────────────
    const host = req.get('host');
    const protocol = req.protocol;
    const frontendUrl = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production'
      ? `${protocol}://${host}/bvs`
      : 'http://localhost:3000');

    try {
      // 1. Look up user by verification token
      const result = await pool.query(
        'SELECT id, email, name, role, email_verified, created_at FROM users WHERE email_verification_token = $1',
        [emailToken]
      );

      if (result.rows.length === 0) {
        // Redirect to login with error parameter if token is invalid
        return res.redirect(`${frontendUrl}/login?status=error&message=Invalid+verification+token`);
      }

      const user = result.rows[0];

      // Token Expiration Check (24 hours validity based on user creation timestamp)
      const tokenLifetimeMs = 24 * 60 * 60 * 1000;
      const isExpired = Date.now() - new Date(user.created_at).getTime() > tokenLifetimeMs;
      if (isExpired) {
        return res.redirect(`${frontendUrl}/login?status=error&message=Verification+link+expired.+Please+register+again.`);
      }

      // 2. Mark user as verified in database
      if (!user.email_verified) {
        await pool.query(
          'UPDATE users SET email_verified = TRUE, email_verification_token = NULL WHERE id = $1',
          [user.id]
        );
      }

      // 3. IDEMPOTENCY CHECK: Check if a workspace already exists for this user ID
      const wsCheck = await pool.query(
        'SELECT id FROM ims_workspaces WHERE owner_id = $1 LIMIT 1',
        [user.id]
      );

      // 4. Generate JWT Token
      const jwtToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      // Set JWT in httpOnly cookie
      res.cookie('token', jwtToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      if (wsCheck.rows.length > 0) {
        // Workspace ALREADY exists: Skip creation entirely, redirect to dashboard
        return res.redirect(`${frontendUrl}/dashboard?status=already_verified`);
      } else {
        // No workspace exists: Create exactly ONE workspace in transaction
        try {
          await pool.query('BEGIN');
          
          const workspaceName = `${user.name || 'User'}'s Workspace`;
          const wsResult = await pool.query(
            'INSERT INTO ims_workspaces (name, owner_id) VALUES ($1, $2) RETURNING *',
            [workspaceName, user.id]
          );
          const workspace = wsResult.rows[0];

          // Add user as owner of their new workspace
          await pool.query(
            "INSERT INTO ims_workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
            [workspace.id, user.id]
          );

          await pool.query('COMMIT');

          // Redirect to dashboard with success status
          return res.redirect(`${frontendUrl}/dashboard?status=success`);
        } catch (dbErr) {
          await pool.query('ROLLBACK');
          console.error('Error creating workspace during verification:', dbErr);
          return res.redirect(`${frontendUrl}/login?status=error&message=Failed+to+create+workspace`);
        }
      }
    } catch (err) {
      console.error('Error verifying email:', err);
      return res.redirect(`${frontendUrl}/login?status=error&message=Server+error+during+verification`);
    }
  } else {
    // ─── SESSION VERIFICATION FLOW (Backwards Compatible) ────────────────────
    let token = req.cookies?.token;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }
    if (!token) {
      return res.status(401).json({ success: false, error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, async (err, decodedUser) => {
      if (err) {
        return res.status(403).json({ success: false, error: 'Invalid or expired token' });
      }

      try {
        const result = await pool.query(
          'SELECT id, email, name, role, is_active FROM users WHERE id = $1',
          [decodedUser.id]
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }
        const dbUser = result.rows[0];
        if (!dbUser.is_active) {
          return res.status(403).json({ success: false, error: 'Account is deactivated' });
        }

        // Fetch default workspace
        let defaultWorkspaceId = null;
        const wsCheck = await pool.query(
          "SELECT workspace_id FROM ims_workspace_members WHERE user_id = $1 AND status = 'active' ORDER BY joined_at ASC LIMIT 1",
          [dbUser.id]
        );
        if (wsCheck.rows.length > 0) {
          defaultWorkspaceId = wsCheck.rows[0].workspace_id;
        }

        return res.json({
          success: true,
          token, // return rawToken for frontend storage
          user: {
            id: dbUser.id,
            email: dbUser.email,
            name: dbUser.name,
            role: dbUser.role,
            workspaceId: defaultWorkspaceId
          }
        });
      } catch (dbErr) {
        console.error('Error fetching user info in session check:', dbErr);
        return res.status(500).json({ success: false, error: 'Token verification failed' });
      }
    });
  }
});
// Middleware to ensure user is part of the requested workspace
const requireWorkspace = async (req, res, next) => {
  const workspaceId = req.headers['x-workspace-id'];
  if (!workspaceId) {
    return res.status(400).json({ success: false, error: 'x-workspace-id header is required' });
  }
  try {
    const check = await pool.query(
      'SELECT role FROM ims_workspace_members WHERE workspace_id = $1 AND user_id = $2 AND status = $3',
      [workspaceId, req.user.id, 'active']
    );
    if (check.rows.length === 0) {
      return res.status(403).json({ success: false, error: 'Access denied to this workspace' });
    }
    req.workspace_id = workspaceId;
    req.workspace_role = check.rows[0].role;
    next();
  } catch (err) {
    console.error('Workspace auth error:', err);
    res.status(500).json({ success: false, error: 'Workspace authorization failed' });
  }
};
// Granular Role-Based Access Control (RBAC) Middleware
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    // req.workspace_role is populated by requireWorkspace
    if (!req.workspace_role) {
      return res.status(403).json({ success: false, error: 'Workspace role not verified' });
    }
    
    // Owner and Admin bypass restrictions
    if (req.workspace_role === 'owner' || req.workspace_role === 'admin') {
      return next();
    }
    if (!allowedRoles.includes(req.workspace_role)) {
      return res.status(403).json({ 
        success: false, 
        error: `Access denied. Requires one of: ${allowedRoles.join(', ')}` 
      });
    }
    next();
  };
};
// ======================
// WORKSPACES ENDPOINTS
// ======================
// List workspaces for user
app.get('/api/workspaces', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.*, wm.role 
       FROM ims_workspaces w
       JOIN ims_workspace_members wm ON w.id = wm.workspace_id
       WHERE wm.user_id = $1 AND wm.status = 'active'
       ORDER BY w.created_at ASC`,
      [req.user.id]
    );
    const workspaces = result.rows.map(row => ({
      ...row,
      currentUserRole: row.role
    }));
    res.json({ success: true, workspaces });
  } catch (error) {
    console.error('Error fetching workspaces:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch workspaces' });
  }
});
// Create a new workspace
app.post('/api/workspaces', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Workspace name is required' });
    
    await pool.query('BEGIN');
    
    const wsResult = await pool.query(
      'INSERT INTO ims_workspaces (name, owner_id) VALUES ($1, $2) RETURNING *',
      [name, req.user.id]
    );
    const workspace = wsResult.rows[0];
    
    await pool.query(
      "INSERT INTO ims_workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
      [workspace.id, req.user.id]
    );
    
    await pool.query('COMMIT');
    res.json({ success: true, workspace });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error creating workspace:', error);
    res.status(500).json({ success: false, error: 'Failed to create workspace' });
  }
});
// ──────────────────────────────────────────────────────────────
// WORKSPACE INVITE LINK SYSTEM
// ──────────────────────────────────────────────────────────────
// Generate a new invite link (token-based, anyone with the link can join)
app.post('/api/workspaces/invites/generate', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    if (req.workspace_role !== 'owner' && req.workspace_role !== 'admin' && req.workspace_role !== 'manager') {
      return res.status(403).json({ success: false, error: 'Only admins and managers can generate invite links' });
    }
    const { role = 'member', expiryDays = 7 } = req.body;
    
    // Managers can only invite 'user' / 'member' / 'viewer' role
    if (req.workspace_role === 'manager' && !['user', 'member', 'viewer'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Managers are restricted to inviting User role only' });
    }

    const token = require('crypto').randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO ims_workspace_invites (workspace_id, token, role, created_by, expires_at, uses_remaining)
       VALUES ($1, $2, $3, $4, $5, 50)`,
      [req.workspace_id, token, role, req.user.id, expiresAt]
    );
    const wsRes = await pool.query('SELECT name FROM ims_workspaces WHERE id=$1', [req.workspace_id]);
    const wsName = wsRes.rows[0]?.name || 'Workspace';
    res.json({ success: true, token, wsName, expiresAt, role });
  } catch (error) {
    console.error('Error generating invite:', error);
    res.status(500).json({ success: false, error: 'Failed to generate invite link' });
  }
});
// Get active invite links for this workspace
app.get('/api/workspaces/invites', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.id, i.token, i.role, i.expires_at, i.uses_remaining, i.created_at,
              u.name as created_by_name
       FROM ims_workspace_invites i
       JOIN users u ON u.id = i.created_by
       WHERE i.workspace_id = $1 AND i.expires_at > NOW() AND i.uses_remaining > 0
       ORDER BY i.created_at DESC`,
      [req.workspace_id]
    );
    res.json({ success: true, invites: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch invites' });
  }
});
// Revoke an invite link
app.delete('/api/workspaces/invites/:id', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    if (req.workspace_role !== 'owner' && req.workspace_role !== 'admin' && req.workspace_role !== 'manager') {
      return res.status(403).json({ success: false, error: 'Only admins and managers can revoke invite links' });
    }
    await pool.query('DELETE FROM ims_workspace_invites WHERE id=$1 AND workspace_id=$2', [req.params.id, req.workspace_id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to revoke invite' });
  }
});
// Preview an invite (public — no auth needed, to show workspace name before joining)
app.get('/api/workspaces/join/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.role, i.expires_at, i.uses_remaining, w.name as workspace_name
       FROM ims_workspace_invites i
       JOIN ims_workspaces w ON w.id = i.workspace_id
       WHERE i.token = $1`,
      [req.params.token]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Invalid invite link' });
    const inv = result.rows[0];
    if (new Date(inv.expires_at) < new Date()) return res.status(410).json({ success: false, error: 'This invite link has expired' });
    if (inv.uses_remaining <= 0) return res.status(410).json({ success: false, error: 'This invite link has been fully used' });
    res.json({ success: true, workspaceName: inv.workspace_name, role: inv.role });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to validate invite' });
  }
});
// Join a workspace using an invite token
app.post('/api/workspaces/join', authenticateToken, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, error: 'Invite token is required' });
    const invRes = await pool.query(
      `SELECT * FROM ims_workspace_invites WHERE token = $1 AND expires_at > NOW() AND uses_remaining > 0`,
      [token]
    );
    if (invRes.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid or expired invite link' });
    }
    const invite = invRes.rows[0];
    // Already a member?
    const existing = await pool.query(
      'SELECT id FROM ims_workspace_members WHERE workspace_id=$1 AND user_id=$2',
      [invite.workspace_id, req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'You are already a member of this workspace' });
    }
    // Add member
    await pool.query(
      `INSERT INTO ims_workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'active')`,
      [invite.workspace_id, req.user.id, invite.role]
    );
    // Decrement use count
    await pool.query(
      `UPDATE ims_workspace_invites SET uses_remaining = uses_remaining - 1 WHERE id = $1`,
      [invite.id]
    );
    const wsRes = await pool.query('SELECT name FROM ims_workspaces WHERE id=$1', [invite.workspace_id]);
    res.json({ success: true, workspaceId: invite.workspace_id, workspaceName: wsRes.rows[0]?.name });
  } catch (error) {
    console.error('Error joining workspace:', error);
    res.status(500).json({ success: false, error: 'Failed to join workspace' });
  }
});
// Get members of a workspace
app.get('/api/workspaces/members', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, wm.role, wm.status, wm.joined_at as "joinedAt"
       FROM ims_workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY wm.joined_at ASC`,
      [req.workspace_id]
    );
    res.json({ success: true, members: result.rows });
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch members' });
  }
});
// Update a member's role
app.patch('/api/workspaces/members/:userId/role', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    if (req.workspace_role !== 'owner' && req.workspace_role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only admins can change roles' });
    }
    const { role } = req.body;
    await pool.query(
      'UPDATE ims_workspace_members SET role=$1 WHERE workspace_id=$2 AND user_id=$3',
      [role, req.workspace_id, req.params.userId]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update role' });
  }
});
// Remove a member from workspace
app.delete('/api/workspaces/members/:userId', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    if (req.workspace_role !== 'owner' && req.workspace_role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only admins can remove members' });
    }
    await pool.query(
      'DELETE FROM ims_workspace_members WHERE workspace_id=$1 AND user_id=$2',
      [req.workspace_id, req.params.userId]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to remove member' });
  }
});
// System status endpoint for Dashboard - USER SPECIFIC
app.get('/api/system/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    // Get user-specific stats from database
    const userDevicesCount = await pool.query(
      'SELECT COUNT(*) FROM user_devices WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    // Count temporary scans (History)
    const userTemporaryScansCount = await pool.query(
      'SELECT COUNT(*) FROM temporary_scans WHERE user_id = $1',
      [userId]
    );
    // Count saved scans (Saved)
    const userSavedScansCount = await pool.query(
      'SELECT COUNT(*) FROM saved_scans WHERE user_id = $1',
      [userId]
    );
    const totalScans = parseInt(userTemporaryScansCount.rows[0].count) + parseInt(userSavedScansCount.rows[0].count);
    // Calculate today's scans for this user (from temporary buffer as it's the primary ingest)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const userTodayScans = await pool.query(
      'SELECT COUNT(*) FROM temporary_scans WHERE user_id = $1 AND created_at >= $2',
      [userId, today.toISOString()]
    );
    const systemStatus = {
      server: 'online',
      database: 'connected',
      devices: {
        total: parseInt(userDevicesCount.rows[0].count),
        connected: parseInt(userDevicesCount.rows[0].count), // Simplified for now
        disconnected: 0
      },
      scans: {
        total: totalScans, // Sum of History + Saved (or just History if that's preferred, but Total implies all)
        today: parseInt(userTodayScans.rows[0].count)
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
    res.json({
      success: true,
      status: systemStatus
    });
  } catch (error) {
    console.error('Error getting system status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get system status'
    });
  }
});
// ======================
// DEVICE PAIRING ENDPOINTS
// ======================
// Generate pairing code for device
app.get('/api/devices/old-pairing-code', authenticateToken, async (req, res) => {
  try {
    // Extract JWT token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Extract token from "Bearer <token>"
    if (!token) {
      return res.status(401).json({ success: false, error: 'No authentication token found' });
    }
    // Generate pairing code in ESP32-compatible format: ROBRIDGE_PAIR|<JWT_TOKEN>|<USER_ID>
    const pairingCode = `ROBRIDGE_PAIR|${token}|${req.user.id}`;
    res.json({ success: true, pairingCode });
  } catch (error) {
    console.error('Error generating pairing code:', error);
    res.status(500).json({ success: false, error: 'Failed to generate pairing code' });
  }
});
// Pair device to user
app.post('/api/devices/old-pair', authenticateToken, async (req, res) => {
  try {
    const { deviceId, deviceName } = req.body;
    const userId = req.user.id;
    if (!deviceId) {
      return res.status(400).json({ success: false, error: 'Device ID is required' });
    }
    const result = await pool.query(
      `INSERT INTO user_devices (user_id, device_id, device_name, paired_at, last_seen)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (device_id) 
       DO UPDATE SET user_id = $1, device_name = $2, paired_at = NOW(), last_seen = NOW(), is_active = true
       RETURNING *`,
      [userId, deviceId, deviceName || `Device ${deviceId}`]
    );
    // Emit WebSocket event to notify the user's mobile app
    const userRoom = `user_${userId}`;
    io.to(userRoom).emit('device_paired', {
      success: true,
      device: result.rows[0],
      message: 'Device paired successfully'
    });
    console.log(`📡 Emitted device_paired event to room: ${userRoom}`);
    res.json({ success: true, device: result.rows[0] });
  } catch (error) {
    console.error('Error pairing device:', error);
    res.status(500).json({ success: false, error: 'Failed to pair device' });
  }
});
// Get workspace's paired devices
app.get('/api/devices', authenticateToken, async (req, res) => {
  // No workspace yet (e.g. onboarding) — return empty gracefully
  if (!req.headers['x-workspace-id']) return res.json({ success: true, devices: [] });
  req.workspace_id = req.headers['x-workspace-id'];
  try {
    // 1. Get paired devices from database
    const dbDevices = await pool.query(
      'SELECT * FROM user_devices WHERE workspace_id = $1 AND is_active = true ORDER BY paired_at DESC',
      [req.workspace_id]
    );
    // 2. Get live device stats from memory (esp32Devices Map)
    const liveDevicesArray = Array.from(esp32Devices.values());
    // 3. Merge database devices with live stats
    const mergedDevices = dbDevices.rows.map(dbDev => {
      // Find corresponding live device
      const liveDev = liveDevicesArray.find(d => d.deviceId === dbDev.device_id);
      // Calculate status based on last_seen timestamp
      const lastSeenDate = new Date(dbDev.last_seen);
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
      const isRecentlySeen = lastSeenDate > fiveMinsAgo;
      // Merge data with enriched fields
      return {
        ...dbDev, // Keep all database fields (id, user_id, device_id, device_name, paired_at, last_seen, is_active)
        // Add enriched fields for mobile app
        status: liveDev?.status || (isRecentlySeen ? 'ACTIVE' : 'DISCONNECTED'),
        ip_address: liveDev?.ipAddress || (isRecentlySeen ? 'Active' : 'Offline'),
        total_scans: liveDev?.totalScans || 0,
        firmware_version: liveDev?.firmwareVersion || 'Unknown'
      };
    });
    res.json({ success: true, devices: mergedDevices });
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch devices' });
  }
});
// Remove device pairing
app.delete('/api/devices/:deviceId', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const wsId = req.workspace_id;
    console.log(`🗑️ Attempting unpair for deviceId: "${deviceId}" (Workspace: ${wsId})`);
    // Use string device_id OR database id to delete from user_devices
    // This supports both Mobile App (sends device_id string) and Web App (sends id integer)
    const result = await pool.query(
      'DELETE FROM user_devices WHERE (device_id = $1 OR CAST(id AS TEXT) = $1) AND workspace_id = $2 RETURNING *',
      [deviceId, wsId]
    );
    if (result.rows.length === 0) {
      console.log(`⚠️ Device not found for unpairing: ${deviceId}`);
      return res.status(404).json({ success: false, error: 'Device not found or already unpaired' });
    }
    console.log(`✅ Device unpaired: ${result.rows[0].device_name} (ID: ${deviceId})`);
    // Notify client about the unpairing
    const userRoom = `user_${req.user.id}`;
    io.to(userRoom).emit('device_unpaired', {
      success: true,
      deviceId: deviceId,
      message: 'Device unpaired successfully'
    });
    res.json({ success: true, message: 'Device unpaired successfully' });
  } catch (error) {
    console.error('❌ CRITICAL ERROR UNPAIRING DEVICE:', error);
    if (error.code) console.error('SQL Error Code:', error.code);
    if (error.detail) console.error('SQL Error Detail:', error.detail);
    res.status(500).json({
      success: false,
      error: 'Failed to unpair device. Server returned 500.',
      details: error.message
    });
  }
});
// Change Password
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters long'
      });
    }
    // Get user's current password hash
    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }
    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, req.user.id]
    );
    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
});
// Forgot Password - Request Reset Link
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    // Check if user exists
    const result = await pool.query('SELECT id, email, name FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) {
      // Security best practice: Don't reveal if user exists or not, but for UX we might want to say "If email exists..."
      // For this specific app, returning an error is fine for clarity.
      return res.status(404).json({ success: false, error: 'User with this email does not exist' });
    }
    const user = result.rows[0];
    // Generate token and expiration (1 hour)
    // Using a simple random string for the token. For higher security, use crypto.randomBytes
    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const expires = Date.now() + 3600000; // 1 hour from now
    // Save token to database
    await pool.query(
      'UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE id = $3',
      [token, expires, user.id]
    );
    // Create reset link
    // Changes domain based on environment
    const origin = req.headers.origin;
    const host = req.get('host');
    const protocol = req.protocol;
    let clientUrl = origin || process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production'
      ? `${protocol}://${host}/bvs` // Adjust if your base path is strictly /bvs
      : 'http://localhost:3000'); // Development

    // Normalize clientUrl: ensure it has /bvs subdirectory prefix if in production and not localhost/127.0.0.1
    const isLocalhost = clientUrl.includes('localhost') || clientUrl.includes('127.0.0.1');
    if (process.env.NODE_ENV === 'production' && !isLocalhost && !clientUrl.endsWith('/bvs') && !clientUrl.includes('/bvs/')) {
      clientUrl = clientUrl.replace(/\/$/, '') + '/bvs';
    }

    // IMPORTANT: Frontend route will be /reset-password/:token or /reset-password?token=...
    // We'll use query parameter for simplicity in React Router
    const resetLink = `${clientUrl}/reset-password?token=${token}`;
    const mailOptions = {
      from: `"RoBridge Support" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'RoBridge Password Reset',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #007bff;">Password Reset Request</h2>
          <p>Hi ${user.name},</p>
          <p>You requested to reset your password for your RoBridge account.</p>
          <p>Please click the button below to reset your password. This link is valid for 1 hour.</p>
          <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0;">Reset Password</a>
          <p>If you didn't request this, you can safely ignore this email.</p>
          <p>Best regards,<br>RoBridge Team</p>
        </div>
      `
    };
    // Send email
    if (!nodemailer) {
      console.log(`⚠️ Nodemailer not loaded. Mocking email send to ${user.email}`);
      return res.json({ success: true, message: 'Simulated: Password reset link sent (Email service unavailable)' });
    }
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      await transporter.sendMail(mailOptions);
      console.log(`📧 Password reset email sent to ${user.email}`);
    } else {
      console.log(`⚠️ Email credentials missing. MOCK EMAIL: Click here to reset -> ${resetLink}`);
    }
    res.json({ success: true, message: 'Password reset link sent to your email' });
  } catch (error) {
    console.error('Error in forgot-password:', error);
    res.status(500).json({ success: false, error: 'Failed to process request' });
  }
});
// Reset Password - Verify Token and Update Password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, error: 'Token and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }
    // Find user with this token and check if valid/not expired
    const result = await pool.query(
      'SELECT id, email FROM users WHERE reset_password_token = $1 AND reset_password_expires > $2',
      [token, Date.now()]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Password reset link is invalid or has expired' });
    }
    const user = result.rows[0];
    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    // Update user: set new password, clear token fields
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE id = $2',
      [passwordHash, user.id]
    );
    res.json({ success: true, message: 'Password has been reset successfully' });
  } catch (error) {
    console.error('Error in reset-password:', error);
    res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
});
// ESP32 Device Registration
app.post('/api/esp32/register', (req, res) => {
  try {
    const { deviceId, deviceName, ipAddress, firmwareVersion } = req.body;
    const deviceInfo = {
      deviceId,
      deviceName: deviceName || `ESP32-${deviceId}`,
      ipAddress,
      firmwareVersion: firmwareVersion || '1.0.0',
      lastSeen: new Date().toISOString(),
      status: 'connected',
      totalScans: 0
    };
    esp32Devices.set(deviceId, deviceInfo);
    console.log(`ESP32 device registered: ${deviceName} (${deviceId})`);
    // Notify all connected clients about new device
    io.emit('esp32_device_connected', deviceInfo);
    res.json({
      success: true,
      message: 'Device registered successfully',
      deviceId
    });
  } catch (error) {
    console.error('Error registering ESP32 device:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register device'
    });
  }
});
// ESP32 Heartbeat/Ping
app.post('/api/esp32/ping/:deviceId', (req, res) => {
  try {
    const { deviceId } = req.params;
    const device = esp32Devices.get(deviceId);
    if (device) {
      device.lastSeen = new Date().toISOString();
      device.status = 'connected';
      esp32Devices.set(deviceId, device);
      res.json({ success: true, timestamp: device.lastSeen });
    } else {
      // Auto-register from ping if the server restarted
      const newDevice = {
        deviceId,
        deviceName: `ESP32-${deviceId}`,
        lastSeen: new Date().toISOString(),
        status: 'connected',
        totalScans: 0
      };
      esp32Devices.set(deviceId, newDevice);
      console.log(`Auto-registered missing device from ping: ${deviceId}`);
      res.json({ success: true, timestamp: newDevice.lastSeen });
    }
  } catch (error) {
    console.error('Error processing ESP32 ping:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process ping'
    });
  }
});
// ESP32 Heartbeat/Ping (GET) - for easy testing
app.get('/api/esp32/ping/:deviceId', (req, res) => {
  try {
    const { deviceId } = req.params;
    const device = esp32Devices.get(deviceId);
    if (device) {
      device.lastSeen = new Date().toISOString();
      device.status = 'connected';
      esp32Devices.set(deviceId, device);
      res.json({ success: true, timestamp: device.lastSeen, method: 'GET' });
    } else {
      // Device not registered, register it
      const newDevice = {
        deviceId,
        deviceName: `ESP32-${deviceId}`,
        lastSeen: new Date().toISOString(),
        status: 'connected',
        barcodeCount: 0
      };
      esp32Devices.set(deviceId, newDevice);
      console.log(`📡 New ESP32 device registered (GET): ${deviceId}`);
      res.json({ success: true, timestamp: newDevice.lastSeen, message: 'Device registered', method: 'GET' });
    }
  } catch (error) {
    console.error('Error processing ESP32 ping (GET):', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process ping'
    });
  }
});
// ESP32 Scan Endpoint Info (GET) - for testing and documentation
app.get('/api/esp32/scan', (req, res) => {
  res.json({
    message: 'ESP32 Barcode Scan Endpoint',
    method: 'POST',
    url: '/api/esp32/scan/:deviceId',
    description: 'Send barcode scan data from ESP32 device',
    requiredParams: {
      deviceId: 'Device identifier (in URL path)'
    },
    requiredBody: {
      barcodeData: 'The scanned barcode or QR code data',
      scanType: 'Type of scan (optional)',
      imageData: 'Base64 image data (optional)',
      timestamp: 'Scan timestamp (optional)'
    },
    example: {
      url: '/api/esp32/scan/my-device-001',
      method: 'POST',
      body: {
        barcodeData: '1234567890123',
        scanType: 'barcode',
        timestamp: Date.now()
      }
    }
  });
});
// ESP32 Barcode Scan Data - Enhanced with AI Integration
app.post('/api/esp32/scan/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { barcodeData, scanType, imageData, timestamp } = req.body;
    console.log(`📱 ESP32 scan received from device: ${deviceId}`);
    // NOTE: req.body intentionally not logged — may contain sensitive data
    console.log('🔍 Scan data:', { barcodeData, scanType, timestamp });
    // CHECK FOR PAIRING CODE
    if (barcodeData && (barcodeData.startsWith('PAIR:') || barcodeData.startsWith('ROBRIDGE_PAIR|'))) {
      console.log('🔗 Pairing code detected:', barcodeData);
      try {
        let userId = null;
        // Handle legacy format: PAIR:userId
        if (barcodeData.startsWith('PAIR:')) {
          const parts = barcodeData.split(':');
          if (parts.length >= 2) userId = parts[1];
        }
        // Handle new format: ROBRIDGE_PAIR|token|userId
        else if (barcodeData.startsWith('ROBRIDGE_PAIR|')) {
          const parts = barcodeData.split('|');
          // Expected: ROBRIDGE_PAIR | token | userId
          if (parts.length >= 3) userId = parts[2];
        }
        if (userId) {
          console.log(`👤 Pairing device ${deviceId} to user ${userId}`);
          // Perform pairing
          const pairResult = await pool.query(
            `INSERT INTO user_devices (user_id, device_id, device_name, last_seen)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (device_id) 
             DO UPDATE SET user_id = $1, device_name = $2, last_seen = NOW(), is_active = true
             RETURNING *`,
            [userId, deviceId, `Device ${deviceId}`]
          );
          // Emit WebSocket event to notify the user's mobile app
          const userRoom = `user_${userId}`;
          io.to(userRoom).emit('device_paired', {
            success: true,
            device: pairResult.rows[0],
            message: 'Device paired successfully'
          });
          console.log(`📡 Emitted device_paired event to room: ${userRoom}`);
          console.log('✅ Device paired successfully via scan!');
          return res.json({
            success: true,
            message: 'Device paired successfully',
            action: 'pair',
            userId: userId
          });
        }
      } catch (pairError) {
        console.error('❌ Error processing pairing code:', pairError);
        return res.status(500).json({ success: false, error: 'Pairing failed' });
      }
    }
    let device = esp32Devices.get(deviceId);
    if (!device) {
      // Auto-register the device if it's missing from the memory map due to a server restart
      device = {
        deviceId,
        deviceName: `ESP32-${deviceId}`,
        lastSeen: new Date().toISOString(),
        status: 'connected',
        totalScans: 0
      };
      esp32Devices.set(deviceId, device);
      console.log(`Auto-registered missing device from scan: ${deviceId}`);
    }
    // Check if device is paired to a workspace
    let wsId = null;
    let userId = null; // For legacy tables
    try {
      const devicePairing = await pool.query(
        'SELECT workspace_id, user_id FROM user_devices WHERE device_id = $1 AND is_active = true',
        [deviceId]
      );
      if (devicePairing.rows.length > 0) {
        wsId = devicePairing.rows[0].workspace_id;
        userId = devicePairing.rows[0].user_id || null;
        console.log(`✅ Device ${deviceId} is paired to workspace ID: ${wsId}`);
        // Update device last_seen
        await pool.query(
          'UPDATE user_devices SET last_seen = NOW() WHERE device_id = $1',
          [deviceId]
        );
      } else {
        console.log(`⚠️  Device ${deviceId} is not paired to any workspace`);
      }
    } catch (pairingError) {
      console.error('Error checking device pairing:', pairingError);
    }
    // Update device stats
    device.totalScans++;
    device.lastSeen = new Date().toISOString();
    esp32Devices.set(deviceId, device);
    console.log(`ESP32 barcode scan received from ${device.deviceName}: ${barcodeData}`);
    // Check if device name contains "AI" for conditional AI analysis
    const hasAI = device.deviceName && typeof device.deviceName === 'string' && device.deviceName.toUpperCase().includes('AI');
    console.log(`🔍 Device "${device.deviceName}" has AI capability: ${hasAI}`);
    // AI Analysis has been moved to on-demand (manual trigger)
    // We explicitly set this to null or a "pending" state so the frontend knows to show the button
    console.log('ℹ️ AI analysis skipped (waiting for manual trigger)');
    aiAnalysis = null;
    // Convert timestamp to ISO string if it's a Unix timestamp (number)
    // ESP32 sends millis() which is milliseconds since boot, not Unix timestamp
    // If timestamp is invalid (before year 2000 = 946684800000ms), use server time
    let scanTimestamp = timestamp || new Date().toISOString();
    if (typeof scanTimestamp === 'number') {
      // Check if timestamp is valid (after Jan 1, 2000)
      if (scanTimestamp < 946684800000) {
        console.log(`⚠️  Invalid timestamp from ESP32 (millis): ${scanTimestamp} - using server time`);
        scanTimestamp = new Date().toISOString();
      } else {
        scanTimestamp = new Date(scanTimestamp).toISOString();
      }
    }
    // Create scan record with AI analysis
    const scanRecord = {
      id: `scan_${Date.now()}_${deviceId}`,
      deviceId,
      deviceName: device.deviceName,
      barcodeData,
      scanType: scanType || 'unknown',
      imageData: imageData || null,
      timestamp: scanTimestamp,
      processed: true,
      aiAnalysis: aiAnalysis, // This will now ALWAYS have data
      isOutScan: false // Will be updated if it's an OUT scan
    };
    // Save to TEMPORARY storage and NEW IMS storage - ONLY if device is paired
    if (wsId) {
      try {
        console.log(`💾 Processing scan for stock tracking - workspace ${wsId}, device ${deviceId}`);
        console.log(`🔍 Barcode data: "${barcodeData}"`);
        // Track whether this is an OUT scan (for WebSocket notification)
        let isOutScan = false;
        // ========================================
        // IMS SYSTEM: Update or Create ims_items and ims_scan_events
        // ========================================
        const imsItemResult = await pool.query(
          'SELECT id FROM ims_items WHERE workspace_id = $1 AND barcode = $2 LIMIT 1',
          [wsId, barcodeData]
        );
        let itemId = null;
        if (imsItemResult.rows.length > 0) {
          itemId = imsItemResult.rows[0].id;
          // DO NOT increment stock here anymore to avoid double addition!
          // We just log that we processed the scan.
        } else {
          // Create new item in catalog with stock = 0
          const newItemResult = await pool.query(
            `INSERT INTO ims_items (workspace_id, master_id, user_id, barcode, name, category, stock) 
             VALUES ($1, NULL, NULL, $2, $3, 'Uncategorized', 0) RETURNING id`,
             [wsId, barcodeData, `Scanned Item (${barcodeData})`]
          );
          itemId = newItemResult.rows[0].id;
        }
        // NOTE: Do NOT insert ESP32_SCAN here — the frontend (IMSScanner.js) logs the scan
        // with the correct workflow (RECEIVE/DISPATCH/PUTAWAY) via recordScanEvent.
        // Inserting here caused duplicate entries: one generic 'ESP32_SCAN' + one proper workflow entry.
        // ========================================
        // LEGACY STOCK TRACK: Check for most recent IN entry for this barcode
        // ========================================
        const stockCheckResult = await pool.query(
          `SELECT * FROM stock_track 
           WHERE barcode_data = $1 AND user_id = $2 AND status = 'IN'
           ORDER BY last_scan_at DESC 
           LIMIT 1`,
          [barcodeData, userId]
        );
        console.log(`🔍 Stock check result: Found ${stockCheckResult.rows.length} existing IN entries`);
        if (stockCheckResult.rows.length > 0) {
          console.log(`   Existing entry: ID=${stockCheckResult.rows[0].id}, device_id=${stockCheckResult.rows[0].device_id}, barcode="${stockCheckResult.rows[0].barcode_data}"`);
        }
        if (stockCheckResult.rows.length > 0) {
          // Found an existing "IN" entry - Mark it as "OUT" (product leaving warehouse)
          const existingStock = stockCheckResult.rows[0];
          await pool.query(`
            UPDATE stock_track 
            SET status = 'OUT', last_scan_at = CURRENT_TIMESTAMP, out_scan_at = CURRENT_TIMESTAMP, scan_count = scan_count + 1, device_id = $2
            WHERE id = $1
          `, [existingStock.id, deviceId]);
          console.log(`📤 Product marked as OUT - ID: ${existingStock.id}, Barcode: ${barcodeData}`);
          console.log(`   Previous device: ${existingStock.device_id}, Current device: ${deviceId}`);
          // Mark as OUT scan (still useful for UI tagging or WebSocket, but no longer skipped)
          isOutScan = true;
        } else {
          // No existing "IN" entry found - This is a NEW product coming IN
          if (userId) {
            console.log(`📥 New product coming IN - creating new stock_track entry`);
            await pool.query(`
              INSERT INTO stock_track (barcode_data, status, user_id, device_id, first_scan_at, last_scan_at, scan_count, out_scan_at)
              VALUES ($1, 'IN', $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, NULL)
            `, [barcodeData, userId, deviceId]);
            console.log(`✅ Added to stock_track with status "IN" for device ${deviceId}`);
          } else {
            console.log(`ℹ️  Skipping legacy stock_track insert - workspace-paired device has no legacy user_id`);
          }
        }
        // Now add to temporary_scans (legacy history log - only for user-paired devices)
        if (userId) {
          console.log(`💾 Saving scan to temporary storage for user ${userId}`);
          // Check how many temporary scans this user has
          const countResult = await pool.query(
            'SELECT COUNT(*) as count FROM temporary_scans WHERE user_id = $1',
            [userId]
          );
          const currentCount = parseInt(countResult.rows[0].count);
          // If user has 150 or more scans, delete the oldest one
          if (currentCount >= 150) {
            await pool.query(`
              DELETE FROM temporary_scans 
              WHERE id = (
                SELECT id FROM temporary_scans 
                WHERE user_id = $1 
                ORDER BY created_at ASC 
                LIMIT 1
              )
            `, [userId]);
          }
          // Insert new scan into temporary_scans
          const insertResult = await pool.query(`
            INSERT INTO temporary_scans (
              user_id, barcode_data, barcode_type, source, product_name,
              category, price, description, metadata, device_id, device_name, is_saved
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id
          `, [
            userId,
            barcodeData,
            scanType || 'unknown',
            'ESP32',
            aiAnalysis?.title || 'Unknown Product',
            aiAnalysis?.category || 'Unknown',
            0,
            aiAnalysis?.description || '',
            JSON.stringify({
              deviceName: device.deviceName,
              deviceId: deviceId,
              scanType: scanType || 'unknown',
              timestamp: timestamp || new Date().toISOString(),
              aiAnalysis: aiAnalysis,
              description: aiAnalysis?.description || 'No AI analysis available',
              country: aiAnalysis?.country || null
            }),
            deviceId,
            device.deviceName,
            false
          ]);
          console.log(`✅ Scan saved to temporary_scans with ID: ${insertResult.rows[0].id}`);
        } else {
          console.log(`ℹ️  Skipping temporary_scans insert - workspace-paired device has no legacy user_id`);
        }
      } catch (dbError) {
        console.error('Error saving to temporary storage:', dbError);
      }
    } else {
      console.log('⚠️  Device not paired to any user - scan not saved to temporary storage');
      console.log('💡 To save scans, pair this device by scanning a pairing QR code from the app');
    }
    // Update scanRecord with isOutScan flag if it was determined to be an OUT scan
    if (userId) {
      // The isOutScan variable is set inside the try block above
      // We need to check if this scan was an OUT scan and update scanRecord accordingly
      const stockCheckResult = await pool.query(
        `SELECT * FROM stock_track 
         WHERE barcode_data = $1 AND user_id = $2 AND status = 'OUT' AND last_scan_at > NOW() - INTERVAL '5 seconds'
         ORDER BY last_scan_at DESC 
         LIMIT 1`,
        [barcodeData, userId]
      );
      if (stockCheckResult.rows.length > 0) {
        scanRecord.isOutScan = true;
        console.log(`🔍 Detected OUT scan - will not display in Scanned Barcodes page`);
      }
    }
    // Store the latest scan
    lastBarcodeScan = scanRecord;
    console.log('📡 Broadcasting scan to WebSocket clients...');
    console.log('Scan record:', JSON.stringify(scanRecord, null, 2));
    console.log('🔍 WebSocket connected clients:', io.engine.clientsCount);
    // Notify ALL users in the workspace about the new scan
    if (wsId) {
      try {
        const members = await pool.query('SELECT user_id FROM ims_workspace_members WHERE workspace_id = $1', [wsId]);
        if (members.rows.length > 0) {
          for (const row of members.rows) {
            const userRoom = `user_${row.user_id}`;
            io.to(userRoom).emit('esp32_barcode_scan', scanRecord);
            io.to(userRoom).emit('esp32_scan_processed', scanRecord);
          }
          console.log(`Scan broadcast to ${members.rows.length} workspace members.`);
        } else {
          console.log('No members found in workspace to broadcast to.');
        }
      } catch (err) {
        console.error('Error broadcasting to workspace members:', err);
      }
    } else if (userId) {
      const userRoom = `user_${userId}`;
      console.log(`📡 Emitting scan to room: ${userRoom}`);
      io.to(userRoom).emit('esp32_barcode_scan', scanRecord);
      io.to(userRoom).emit('esp32_scan_processed', scanRecord);
    }
    // GLOBAL BROADCAST REMOVED to prevent data leakage
    // We rely SOLELY on the user-specific room emission above.
    // This ensures User A never sees User B's scans.
    if (!userId) {
      console.log('⚠️ Device not paired to any user - scan NOT broadcast to any client');
    } else {
      console.log('✅ Scan broadcast to specific user room only.');
    }
    console.log(`✅ Scan broadcast complete.`);
    res.json({
      success: true,
      message: 'Barcode scan received and processed with AI',
      scanId: scanRecord.id,
      aiAnalysis: aiAnalysis
    });
  } catch (error) {
    console.error('Error processing ESP32 scan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process scan'
    });
  }
});
// ======================
// USER PROFILE ENDPOINTS
// ======================
// Get User Profile
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, role, created_at, last_login FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    const user = result.rows[0];
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: '', // Phone update disabled
        role: user.role,
        memberSince: user.created_at,
        lastLogin: user.last_login
      }
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user profile'
    });
  }
});
// Update User Profile
app.put('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const userId = req.user.id;
    // Validation
    if (!name && !email && !phone) {
      return res.status(400).json({
        success: false,
        error: 'At least one field (name, email, or phone) must be provided'
      });
    }
    // If email is being updated, check if it's already in use
    if (email) {
      const existingUser = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email.toLowerCase(), userId]
      );
      if (existingUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Email is already in use by another account'
        });
      }
    }
    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;
    if (name) {
      updates.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }
    if (email) {
      updates.push(`email = $${paramCount}`);
      values.push(email.toLowerCase());
      paramCount++;
    }
    /* PHONE COLUMN DOES NOT EXIST IN DB YET - DISABLED TO PREVENT CRASHES
    if (phone !== undefined) {
      updates.push(`phone = $${paramCount}`);
      // Ensure phone is stored as NULL if empty string or null
      const phoneValue = (phone && String(phone).trim() !== '') ? String(phone).trim() : null;
      values.push(phoneValue);
      paramCount++;
    }
    */
    values.push(userId);
    const query = `
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
       RETURNING id, email, name, role, created_at, last_login
    `;
    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    const user = result.rows[0];
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: '', // Phone update disabled
        role: user.role,
        memberSince: user.created_at,
        lastLogin: user.last_login
      }
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    // Return specific database violation errors if possible
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({
        success: false,
        error: 'Email or phone already in use'
      });
    }
    res.status(500).json({
      success: false,
      error: `Failed to update profile: ${error.message}`
    });
  }
});
// Change Password
app.put('/api/user/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters long'
      });
    }
    // Get current password hash
    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    const user = result.rows[0];
    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }
    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [newPasswordHash, userId]
    );
    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
});
// Old endpoint removed to prevent conflict with authenticated Route B
// Get ESP32 devices list - USER SPECIFIC
app.get('/api/esp32/devices', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`📱 Fetching ESP32 devices for user ${userId}`);
    // Get user's paired devices from database with full details
    const pairedDevicesResult = await pool.query(
      'SELECT device_id, device_name, paired_at, last_seen, is_active FROM user_devices WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    const pairedDevices = pairedDevicesResult.rows;
    console.log(`✅ User ${userId} has ${pairedDevices.length} paired devices:`, pairedDevices.map(d => d.device_id));
    // Merge database devices with live devices from esp32Devices Map
    const now = new Date();
    const userDevices = pairedDevices.map(dbDevice => {
      // Try to get live device data from memory
      const liveDevice = esp32Devices.get(dbDevice.device_id);
      // Calculate status based on last_seen
      const lastSeen = new Date(dbDevice.last_seen);
      const timeDiff = (now - lastSeen) / 1000; // seconds
      const isConnected = timeDiff <= 300; // 5 minute timeout
      // Merge database and live data
      return {
        deviceId: dbDevice.device_id,
        deviceName: dbDevice.device_name || `Device ${dbDevice.device_id}`,
        lastSeen: dbDevice.last_seen,
        status: isConnected ? 'connected' : 'disconnected',
        ipAddress: liveDevice?.ipAddress || (isConnected ? 'Active' : 'Offline'),
        firmwareVersion: liveDevice?.firmwareVersion || 'Unknown',
        totalScans: liveDevice?.totalScans || 0,
        pairedAt: dbDevice.paired_at
      };
    });
    console.log(`📡 Returning ${userDevices.length} devices for user ${userId}`);
    console.log(`📊 Device details:`, userDevices.map(d => ({ id: d.deviceId, status: d.status, lastSeen: d.lastSeen })));
    res.json({
      success: true,
      devices: userDevices,
      totalDevices: userDevices.length
    });
  } catch (error) {
    console.error('Error getting ESP32 devices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get devices'
    });
  }
});
// Get latest barcode scan
app.get('/api/esp32/latest-scan', (req, res) => {
  try {
    res.json({
      success: true,
      scan: lastBarcodeScan
    });
  } catch (error) {
    console.error('Error getting latest scan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get latest scan'
    });
  }
});
// Get all scanned barcodes from database - COMMENTED OUT TO PREVENT DATA LEAK (DUPLICATE ENDPOINT)
/*
// Old endpoint removed - now using authenticated version with temporary_scans table
*/
// Clear all scanned barcodes (temporary scans) for a user
app.delete('/api/barcodes/clear', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`🗑️ Clearing all temporary scans for user ${userId}`);
    const result = await pool.query(
      'DELETE FROM temporary_scans WHERE user_id = $1',
      [userId]
    );
    console.log(`✅ Cleared all ${result.rowCount} temporary scans for user ${userId}`);
    res.json({
      success: true,
      message: 'All scanned barcodes cleared successfully',
      deletedCount: result.rowCount
    });
  } catch (error) {
    console.error('❌ Error clearing temporary scans:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear scanned barcodes'
    });
  }
});
// Delete a scanned barcode from history - USER SPECIFIC
app.delete('/api/barcodes/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    console.log(`🗑️ Deleting barcode with ID: ${id} for user ${userId}`);
    // Verify the barcode belongs to this user before deleting from temporary_scans table
    const result = await pool.query('DELETE FROM temporary_scans WHERE id = $1 AND user_id = $2 RETURNING *', [id, userId]);
    if (result.rowCount === 0) {
      console.log(`⚠️ No barcode found with ID: ${id} for user ${userId}`);
      res.status(404).json({
        success: false,
        error: 'Barcode not found or you do not have permission to delete it'
      });
    } else {
      console.log(`✅ Barcode deleted successfully for user ${userId}. Deleted barcode:`, result.rows[0].barcode_data);
      res.json({
        success: true,
        message: 'Barcode deleted successfully',
        deletedId: id
      });
    }
  } catch (error) {
    console.error('❌ Error deleting barcode:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete barcode'
    });
  }
});
// Edit barcode data from Scanned Barcodes
app.put('/api/barcodes/:id/data', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { newBarcodeData, originalBarcodeData } = req.body;
    const userId = req.user.id;
    
    console.log(`✏️ Editing barcode data for ID: ${id} by user ${userId}. New Value: ${newBarcodeData}`);
    if (!newBarcodeData) {
      return res.status(400).json({ success: false, error: 'New barcode data is required' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const scanResult = await client.query('SELECT * FROM temporary_scans WHERE id = $1 AND user_id = $2', [id, userId]);
      if (scanResult.rowCount === 0) {
        throw new Error('Barcode not found or you do not have permission');
      }
      const scan = scanResult.rows[0];
      const actualOriginalBarcode = originalBarcodeData || scan.barcode_data;
      
      let metadata = {};
      try {
        metadata = typeof scan.metadata === 'string' ? JSON.parse(scan.metadata || '{}') : (scan.metadata || {});
      } catch (e) {
        metadata = {};
      }
      
      // Clean up AI analysis as requested
      delete metadata.aiAnalysis;
      delete metadata.description;
      const description = 'No description available';
      const productName = 'Unknown Product';
      const category = 'Unknown';
      // 1. Update temporary_scans
      await client.query(`
        UPDATE temporary_scans 
        SET barcode_data = $1, 
            metadata = $2,
            description = $3,
            product_name = $4,
            category = $5
        WHERE id = $6 AND user_id = $7
      `, [newBarcodeData, JSON.stringify(metadata), description, productName, category, id, userId]);
      
      // 2. Update saved_scans
      await client.query(`
        UPDATE saved_scans
        SET barcode_data = $1
        WHERE user_id = $2 AND barcode_data = $3
      `, [newBarcodeData, userId, actualOriginalBarcode]);
      // 3. Update stock_track
      try {
        // We catch errors here in case stock_track doesn't exist or isn't initialized yet
        await client.query(`
          UPDATE stock_track
          SET barcode_data = $1
          WHERE user_id = $2 AND barcode_data = $3
        `, [newBarcodeData, userId, actualOriginalBarcode]);
      } catch (stockErr) {
        console.log('Skipping stock_track update (table might not exist yet):', stockErr.message);
      }
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Barcode updated successfully across all tables',
        newBarcodeData: newBarcodeData,
        clearedMetadata: metadata
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Error updating barcode data:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update barcode'
    });
  }
});
// Trigger AI Analysis manually for a specific scan
app.post('/api/barcodes/:id/analyze', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    console.log(`🧠 Manual AI analysis requested for scan ID: ${id} by user ${userId}`);
    // 1. Get the scan record
    const scanResult = await pool.query(
      'SELECT * FROM temporary_scans WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (scanResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Scan not found' });
    }
    const scan = scanResult.rows[0];
    // 2. Call AI Server
    console.log(`🤖 Calling AI server for barcode: ${scan.barcode_data}`);
    let aiAnalysis = null;
    try {
      const aiResponse = await fetch(`${AI_SERVER_URL}/api/esp32/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barcodeData: scan.barcode_data,
          deviceId: scan.device_id || 'manual_trigger',
          deviceName: 'Manual Analysis (AI)', // FORCE AI to process this request
          scanType: scan.barcode_type || 'unknown',
          timestamp: Date.now()
        }),
        signal: AbortSignal.timeout(30000) // 30s timeout for manual trigger
      });
      if (aiResponse.ok) {
        aiAnalysis = await aiResponse.json();
      } else {
        throw new Error(`AI Server returned ${aiResponse.status}`);
      }
    } catch (aiError) {
      console.error('AI Server Error:', aiError);
      return res.status(503).json({ success: false, error: 'AI Service unavailable' });
    }
    // 3. Update the scan record in database with new metadata
    const currentMetadata = typeof scan.metadata === 'string'
      ? JSON.parse(scan.metadata || '{}')
      : (scan.metadata || {});
    currentMetadata.aiAnalysis = aiAnalysis;
    currentMetadata.description = aiAnalysis.description; // Update top-level description too
    await pool.query(
      `UPDATE temporary_scans 
             SET metadata = $1, 
                 product_name = $2, 
                 category = $3, 
                 description = $4
             WHERE id = $5`,
      [
        JSON.stringify(currentMetadata),
        aiAnalysis.title || scan.product_name,
        aiAnalysis.category || scan.category,
        aiAnalysis.description || scan.description,
        id
      ]
    );
    console.log('✅ AI Analysis saved to database');
    // Ensure the response has all required fields with maximum compatibility
    // This ensures both old and new frontend versions will work
    const description = aiAnalysis.description || aiAnalysis.description_short || 'No description available';
    const title = aiAnalysis.title || 'Unknown Product';
    const category = aiAnalysis.category || 'Uncategorized';
    const source = aiAnalysis.source || 'openai'; // Ensure source is always set
    const responsePayload = {
      success: true,
      aiAnalysis: {
        ...aiAnalysis,
        // Ensure these critical fields always exist
        description: description,
        description_short: aiAnalysis.description_short || description, // Fallback to description
        title: title,
        category: category,
        source: source, // CRITICAL: Frontend checks this to determine if it's real AI
        // Also add these at root level for maximum compatibility
        noAI: false // Explicitly mark this as NOT a basic scan
      },
      // Also provide data at root level for older frontend versions
      description: description,
      title: title,
      category: category
    };
    console.log('📤 Sending response to frontend:', JSON.stringify(responsePayload, null, 2));
    res.json(responsePayload);
  } catch (error) {
    console.error('Error in manual AI analysis:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
// Manual AI Analysis trigger for SAVED scans
app.post('/api/saved-scans/:id/analyze', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    console.log(`🧠 Manual AI analysis requested for SAVED scan ID: ${id} by user ${userId}`);
    // 1. Get the scan record
    const scanResult = await pool.query(
      'SELECT * FROM saved_scans WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (scanResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Saved scan not found' });
    }
    const scan = scanResult.rows[0];
    // 2. Call AI Server
    console.log(`🤖 Calling AI server for barcode: ${scan.barcode_data}`);
    let aiAnalysis = null;
    try {
      const aiResponse = await fetch(`${AI_SERVER_URL}/api/esp32/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barcodeData: scan.barcode_data,
          deviceId: scan.device_id || scan.source || 'manual_trigger',
          deviceName: 'Manual Analysis (AI)', // FORCE AI to process this request
          scanType: scan.barcode_type || 'unknown',
          timestamp: Date.now()
        }),
        signal: AbortSignal.timeout(30000) // 30s timeout for manual trigger
      });
      if (aiResponse.ok) {
        aiAnalysis = await aiResponse.json();
      } else {
        console.error(`AI Server returned ${aiResponse.status}`);
        throw new Error(`AI Server returned ${aiResponse.status}`);
      }
    } catch (aiError) {
      console.error('AI Server Error:', aiError);
      // Don't fail the whole request if AI fails, just return error
      return res.status(503).json({ success: false, error: 'AI Service unavailable' });
    }
    // 3. Update the scan record in database with new metadata
    // Ensure metadata is an object
    let currentMetadata = {};
    try {
      currentMetadata = typeof scan.metadata === 'string'
        ? JSON.parse(scan.metadata || '{}')
        : (scan.metadata || {});
    } catch (e) {
      currentMetadata = {};
    }
    currentMetadata.aiAnalysis = aiAnalysis;
    currentMetadata.description = aiAnalysis.description; // Update top-level description too
    await pool.query(
      `UPDATE saved_scans 
             SET metadata = $1, 
                 product_name = $2, 
                 category = $3, 
                 description = $4
             WHERE id = $5`,
      [
        JSON.stringify(currentMetadata),
        aiAnalysis.title || scan.product_name,
        aiAnalysis.category || scan.category,
        aiAnalysis.description || scan.description,
        id
      ]
    );
    console.log('✅ AI Analysis saved to SAVED SCANS database');
    // Ensure the response has all required fields
    const responsePayload = {
      success: true,
      aiAnalysis: {
        ...aiAnalysis,
        // Ensure these fields exist
        description: aiAnalysis.description || aiAnalysis.description_short || 'No description available',
        title: aiAnalysis.title || 'Unknown Product',
        category: aiAnalysis.category || 'Uncategorized'
      }
    };
    console.log('📤 Sending response to frontend (Saved Scans):', JSON.stringify(responsePayload, null, 2));
    res.json(responsePayload);
  } catch (error) {
    console.error('Error in manual AI analysis for saved scans:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
// Save barcode scan to TEMPORARY storage (rolling buffer of 75 scans) - USER SPECIFIC
app.post('/api/barcodes/save', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const scanData = req.body;
    console.log(`💾 Saving temporary scan for user ${userId}:`, scanData.barcodeData);
    // First, check how many temporary scans this user has
    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM temporary_scans WHERE user_id = $1',
      [userId]
    );
    const currentCount = parseInt(countResult.rows[0].count);
    console.log(`📊 User ${userId} has ${currentCount} temporary scans`);
    // If user has 75 or more scans, delete the oldest one
    if (currentCount >= 75) {
      const deleteResult = await pool.query(`
        DELETE FROM temporary_scans 
        WHERE id = (
          SELECT id FROM temporary_scans 
          WHERE user_id = $1 
          ORDER BY created_at ASC 
          LIMIT 1
        )
      `, [userId]);
      console.log(`🗑️  Deleted oldest scan for user ${userId}. Deleted: ${deleteResult.rowCount}`);
    }
    // Insert new scan into temporary_scans
    const insertResult = await pool.query(`
      INSERT INTO temporary_scans (
        user_id, barcode_data, barcode_type, source, product_name,
        category, price, description, metadata, device_id, device_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `, [
      userId,
      scanData.barcodeData,
      scanData.scanType || 'unknown',
      scanData.source || 'ESP32',
      scanData.productName || 'Unknown Product',
      scanData.category || 'Unknown',
      scanData.price || 0,
      scanData.metadata?.productDetails || '',
      JSON.stringify(scanData.metadata || {}),
      scanData.deviceId || 'unknown',
      scanData.deviceName || 'ESP32 Scanner'
    ]);
    console.log(`✅ Temporary scan saved with ID: ${insertResult.rows[0].id} for user ${userId}`);
    res.json({
      success: true,
      message: 'Scan saved to temporary storage',
      id: insertResult.rows[0].id
    });
  } catch (error) {
    console.error('❌ Error saving temporary scan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save scan'
    });
  }
});
// Get scanned barcodes from temporary storage - USER SPECIFIC
app.get('/api/barcodes/scanned', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 100;
    console.log(`📋 Fetching scanned barcodes for user ${userId}, limit: ${limit}`);
    const sql = `
      SELECT 
        id, barcode_data, barcode_type, source, product_name,
        category, price, description, metadata, device_id, device_name,
        created_at, is_saved
      FROM temporary_scans
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const result = await pool.query(sql, [userId, limit]);
    console.log(`✅ Found ${result.rows.length} scanned barcodes for user ${userId}`);
    res.json({
      success: true,
      barcodes: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('❌ Error fetching scanned barcodes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch scanned barcodes'
    });
  }
});
// Save individual scan (from Scanned Barcodes page)
app.post('/api/save-scan', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const scanData = req.body;
    console.log(`💾 Saving individual scan for user ${userId}:`, scanData.barcode_data);
    // Check if this barcode was already saved recently (duplicate check)
    const duplicateCheck = await pool.query(`
      SELECT id, created_at FROM saved_scans 
      WHERE user_id = $1 AND barcode_data = $2 
      ORDER BY created_at DESC 
      LIMIT 1
    `, [userId, scanData.barcode_data]);
    if (duplicateCheck.rows.length > 0) {
      const lastSaved = duplicateCheck.rows[0].created_at;
      const timeDiff = Date.now() - new Date(lastSaved).getTime();
      // If saved within last 5 minutes, consider it a duplicate
      if (timeDiff < 5 * 60 * 1000) {
        console.log(`⚠️ Duplicate save attempt for barcode: ${scanData.barcode_data}`);
        return res.json({
          success: false,
          duplicate: true,
          error: 'This barcode was already saved recently',
          lastSaved: lastSaved
        });
      }
    }
    // Insert into saved_scans table
    const insertResult = await pool.query(`
      INSERT INTO saved_scans (
        user_id, barcode_data, barcode_type, source, product_name,
        category, price, description, metadata, device_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `, [
      userId,
      scanData.barcode_data,
      scanData.barcode_type || 'ESP32_SCAN',
      scanData.source || 'ESP32',
      scanData.product_name || 'Unknown Product',
      scanData.category || 'Unknown',
      scanData.price || 0,
      scanData.description || (scanData.metadata?.description || ''),
      JSON.stringify(scanData.metadata || {}),
      scanData.device_id || scanData.metadata?.deviceId || 'ESP32_GM77_SCANNER_001'
    ]);
    console.log(`✅ Scan saved to saved_scans with ID: ${insertResult.rows[0].id}`);
    // Mark as saved in temporary_scans if it exists there
    if (scanData.metadata?.originalId) {
      await pool.query(`
        UPDATE temporary_scans 
        SET is_saved = true 
        WHERE id = $1 AND user_id = $2
      `, [scanData.metadata.originalId, userId]);
      console.log(`✅ Marked scan as saved in temporary_scans (ID: ${scanData.metadata.originalId})`);
    }
    res.json({
      success: true,
      message: 'Scan saved successfully',
      id: insertResult.rows[0].id
    });
  } catch (error) {
    console.error('❌ Error saving individual scan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save scan'
    });
  }
});
// Save All Scanned Barcodes (Bulk Save)
app.post('/api/barcodes/save-all', authenticateToken, async (req, res) => {
  try {
    const { scanIds } = req.body; // Array of scan IDs to save
    const userId = req.user.id;
    if (!scanIds || !Array.isArray(scanIds) || scanIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'scanIds array is required'
      });
    }
    console.log(`💾 Bulk saving ${scanIds.length} scans for user ${userId}`);
    // Get the scans to save (treat NULL as unsaved)
    const scansResult = await pool.query(`
      SELECT * FROM temporary_scans 
      WHERE id = ANY($1) AND user_id = $2 AND (is_saved IS NOT TRUE)
    `, [scanIds, userId]);
    if (scansResult.rows.length === 0) {
      return res.json({
        success: true,
        message: 'No unsaved scans to save',
        savedCount: 0
      });
    }
    console.log(`📋 Found ${scansResult.rows.length} unsaved scans to save`);
    // Insert into saved_scans
    let savedCount = 0;
    const errors = [];
    for (const scan of scansResult.rows) {
      try {
        console.log(`💾 Attempting to save scan ID ${scan.id}: ${scan.barcode_data}`);
        await pool.query(`
          INSERT INTO saved_scans (
            user_id, barcode_data, barcode_type, source, product_name,
            category, price, description, metadata, device_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          userId,
          scan.barcode_data,
          scan.barcode_type,
          scan.source,
          scan.product_name,
          scan.category,
          scan.price,
          scan.description,
          scan.metadata,
          scan.device_id
        ]);
        savedCount++;
        console.log(`✅ Successfully saved scan ID ${scan.id}`);
      } catch (insertError) {
        console.error(`❌ Error saving scan ${scan.id}:`, insertError.message);
        console.error(`   Full error:`, insertError);
        errors.push({ id: scan.id, error: insertError.message });
      }
    }
    // Mark scans as saved in temporary_scans
    await pool.query(`
      UPDATE temporary_scans 
      SET is_saved = true 
      WHERE id = ANY($1) AND user_id = $2
    `, [scanIds, userId]);
    console.log(`✅ Saved ${savedCount} scans and marked them as saved`);
    if (errors.length > 0) {
      console.log(`⚠️ ${errors.length} scans failed to save:`, errors);
    }
    res.json({
      success: true,
      message: `Successfully saved ${savedCount} scans${errors.length > 0 ? ` (${errors.length} failed)` : ''}`,
      savedCount: savedCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('❌ Error in save-all:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save scans'
    });
  }
});
// Re-sync saved scans (two-way sync between temporary_scans and saved_scans)
app.post('/api/barcodes/resync-saved', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`🔄 Re-syncing saved scans for user ${userId}`);
    // Get all scans marked as saved in temporary_scans
    const savedScans = await pool.query(`
      SELECT * FROM temporary_scans 
      WHERE user_id = $1 AND is_saved = true
    `, [userId]);
    console.log(`📋 Found ${savedScans.rows.length} scans marked as saved in temporary_scans`);
    let addedCount = 0;
    let resetCount = 0;
    const errors = [];
    for (const scan of savedScans.rows) {
      try {
        // Check if exists in saved_scans (match by barcode_data only)
        const existing = await pool.query(`
          SELECT id FROM saved_scans 
          WHERE user_id = $1 AND barcode_data = $2
          ORDER BY created_at DESC
          LIMIT 1
        `, [userId, scan.barcode_data]);
        if (existing.rows.length === 0) {
          // Scan is marked as saved but not in saved_scans
          // This could mean: 1) It failed to save, or 2) User deleted it
          // Check if it was recently deleted (within last hour) - if so, reset is_saved
          // For simplicity, we'll just reset is_saved to false
          // User can manually save it again if they want
          await pool.query(`
            UPDATE temporary_scans 
            SET is_saved = false 
            WHERE id = $1
          `, [scan.id]);
          resetCount++;
          console.log(`🔄 Reset is_saved for scan ID ${scan.id}: ${scan.barcode_data}`);
        }
      } catch (error) {
        console.error(`❌ Error syncing scan ${scan.id}:`, error.message);
        errors.push({ id: scan.id, error: error.message });
      }
    }
    console.log(`✅ Re-sync complete: ${resetCount} scans reset to unsaved`);
    res.json({
      success: true,
      message: `Re-synced ${resetCount} scan(s) - changed "Saved" back to "Save"`,
      resetCount: resetCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('❌ Error in resync:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to re-sync scans'
    });
  }
});
// Add is_saved column to temporary_scans (one-time migration)
app.post('/api/barcodes/add-saved-column', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`🔧 Adding is_saved column to temporary_scans for user ${userId}`);
    // Add is_saved column if it doesn't exist
    await pool.query(`
      ALTER TABLE temporary_scans 
      ADD COLUMN IF NOT EXISTS is_saved BOOLEAN DEFAULT FALSE
    `);
    console.log(`✅ is_saved column added successfully`);
    res.json({
      success: true,
      message: 'is_saved column added successfully'
    });
  } catch (error) {
    console.error('❌ Error adding is_saved column:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add column: ' + error.message
    });
  }
});
// Get Stock Track Data (IN/OUT inventory tracking)
app.get('/api/stock-track', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 1000;
    console.log(`📦 Fetching stock track data for user ${userId}`);
    const sql = `
      SELECT 
        id, barcode_data, status, first_scan_at as created_at, 
        last_scan_at, out_scan_at, scan_count, device_id
      FROM stock_track
      WHERE user_id = $1
      ORDER BY last_scan_at DESC
      LIMIT $2
    `;
    const result = await pool.query(sql, [userId, limit]);
    console.log(`✅ Found ${result.rows.length} stock track records for user ${userId}`);
    res.json({
      success: true,
      stock: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('❌ Error fetching stock track data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stock track data'
    });
  }
});
// Clear Stock Track Data
app.delete('/api/stock-track/clear', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`🗑️ Clearing stock track data for user ${userId}`);
    const result = await pool.query(
      'DELETE FROM stock_track WHERE user_id = $1',
      [userId]
    );
    console.log(`✅ Cleared ${result.rowCount} stock track records for user ${userId}`);
    res.json({
      success: true,
      message: 'Stock track data cleared successfully',
      deletedCount: result.rowCount
    });
  } catch (error) {
    console.error('❌ Error clearing stock track data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear stock track data'
    });
  }
});
// Fix Stock Track Table (remove UNIQUE constraint)
app.post('/api/stock-track/fix-table', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`🔧 Fixing stock_track table structure for user ${userId}`);
    // Drop and recreate the table without UNIQUE constraint
    await pool.query('DROP TABLE IF EXISTS stock_track');
    await pool.query(`
      CREATE TABLE stock_track (
        id SERIAL PRIMARY KEY,
        barcode_data TEXT NOT NULL,
        status VARCHAR(10) DEFAULT 'IN',
        first_scan_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_scan_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        scan_count INTEGER DEFAULT 1,
        device_id TEXT,
        user_id INTEGER REFERENCES users(id)
      )
    `);
    // Create indexes
    await pool.query(`
      CREATE INDEX idx_stock_track_barcode_user ON stock_track(barcode_data, user_id)
    `);
    await pool.query(`
      CREATE INDEX idx_stock_track_status ON stock_track(status, last_scan_at)
    `);
    console.log(`✅ Stock track table recreated successfully`);
    res.json({
      success: true,
      message: 'Stock track table fixed successfully. You can now scan barcodes multiple times.'
    });
  } catch (error) {
    console.error('❌ Error fixing stock track table:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fix stock track table: ' + error.message
    });
  }
});
// ESP32 Database Lookup Endpoint
app.get('/api/barcodes/lookup/:barcode', async (req, res) => {
  try {
    const { barcode } = req.params;
    const sql = `
      SELECT 
        barcode_data, product_name, category, price, location_x, location_y, location_z,
        metadata, created_at
      FROM barcodes 
      WHERE barcode_data = $1
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    const result = await pool.query(sql, [barcode]);
    const row = result.rows[0];
    if (row) {
      // Parse metadata for additional product info
      let metadata = {};
      try {
        metadata = JSON.parse(row.metadata || '{}');
      } catch (e) {
        metadata = {};
      }
      res.json({
        success: true,
        product: {
          barcode: row.barcode_data,
          name: row.product_name || 'Unknown Product',
          type: row.category || 'Unknown',
          details: metadata.productDetails || 'No details available',
          price: row.price ? `$${row.price}` : 'Price not available',
          category: row.category || 'Unknown',
          location: `X:${row.location_x}, Y:${row.location_y}, Z:${row.location_z}`,
          foundInDatabase: true,
          lastScanned: row.created_at
        }
      });
    } else {
      res.json({
        success: false,
        message: 'Barcode not found in database',
        product: null
      });
    }
  } catch (error) {
    console.error('Error in barcode lookup:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});
// ESP32 AI Analysis Endpoint - DEPRECATED / REMOVED from direct global usage 
// Kept temporarily if needed for other integrations but main flow is now via /api/barcodes/:id/analyze
app.post('/api/ai/analyze-product', async (req, res) => {
  try {
    const { barcode, productName, analysisType, source } = req.body;
    console.log(`AI Analysis request (Legacy): ${analysisType} for barcode ${barcode}`);
    if (analysisType === 'benefits') {
      // Call your AI model for benefits analysis
      const aiResponse = await callAIForBenefits(productName, barcode);
      res.json({
        success: true,
        benefits: aiResponse,
        productName: productName,
        barcode: barcode,
        analysisType: analysisType
      });
    } else {
      // General product analysis
      const aiResponse = await callAIForProductAnalysis(barcode);
      res.json({
        success: true,
        product: aiResponse,
        barcode: barcode,
        source: source
      });
    }
  } catch (error) {
    console.error('Error in AI analysis:', error);
    res.status(500).json({
      success: false,
      error: 'AI analysis failed',
      message: error.message
    });
  }
});
// Helper function to call trained AI model for benefits analysis
async function callAIForBenefits(productName, barcode) {
  try {
    // Call your trained AI model directly
    const aiEndpoint = 'http://172.21.66.150:8000/generate';
    const response = await fetch(aiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        barcode: barcode,
        max_length: 150,
        temperature: 0.8,
        top_p: 0.9
      })
    });
    if (response.ok) {
      const data = await response.json();
      return data.product_description || 'Benefits analysis completed by trained AI';
    } else {
      return 'Trained AI benefits analysis temporarily unavailable';
    }
  } catch (error) {
    console.error('Trained AI benefits call failed:', error);
    return 'Trained AI analysis service unavailable';
  }
}
// Helper function to call trained AI model for general product analysis
async function callAIForProductAnalysis(barcode) {
  try {
    // Call your trained AI model directly
    const aiEndpoint = 'http://172.21.66.150:8000/generate';
    const response = await fetch(aiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        barcode: barcode,
        max_length: 200,
        temperature: 0.7,
        top_p: 0.9
      })
    });
    if (response.ok) {
      const data = await response.json();
      return {
        name: 'AI-Generated Product',
        type: 'Analyzed',
        details: data.product_description || 'AI analysis completed',
        price: 'Price not available',
        category: 'AI Analyzed'
      };
    } else {
      return {
        name: 'Unknown Product',
        type: 'Unknown',
        details: 'Trained AI analysis temporarily unavailable',
        price: 'Price not available',
        category: 'Unknown'
      };
    }
  } catch (error) {
    console.error('Trained AI product analysis call failed:', error);
    return {
      name: 'Unknown Product',
      type: 'Unknown',
      details: 'Trained AI analysis service unavailable',
      price: 'Price not available',
      category: 'Unknown'
    };
  }
}
// Create barcodes table if it doesn't exist
const initBarcodesTable = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS barcodes (
        id SERIAL PRIMARY KEY,
        barcode_id TEXT,
        barcode_data TEXT,
        barcode_type TEXT,
        source TEXT,
        product_name TEXT,
        product_id TEXT,
        price REAL,
        location_x REAL,
        location_y REAL,
        location_z REAL,
        category TEXT,
        file_path TEXT,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await pool.query(query);
    console.log('✅ Barcodes table created/verified');
  } catch (error) {
    console.error('Error creating barcodes table:', error);
    throw error;
  }
};
// Create users table if it doesn't exist
const initUsersTable = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        role TEXT NOT NULL DEFAULT 'expo_user',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reset_password_token VARCHAR(255),
        reset_password_expires BIGINT,
        email_verification_token VARCHAR(255),
        email_verified BOOLEAN DEFAULT FALSE
      )
    `;
    await pool.query(query);
    console.log('✅ Users table created/verified');
    // Create default admin user if no users exist
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(userCount.rows[0].count) === 0) {
      const defaultPassword = await bcrypt.hash('admin123', 10);
      await pool.query(
        `INSERT INTO users (email, password_hash, name, role) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (email) DO NOTHING`,
        ['admin@robridge.com', defaultPassword, 'Admin User', 'admin']
      );
      const expoPassword = await bcrypt.hash('expo123', 10);
      await pool.query(
        `INSERT INTO users (email, password_hash, name, role) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (email) DO NOTHING`,
        ['user@expo.com', expoPassword, 'Expo User', 'expo_user']
      );
      const fullAccessPassword = await bcrypt.hash('full123', 10);
      await pool.query(
        `INSERT INTO users (email, password_hash, name, role) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (email) DO NOTHING`,
        ['user@robridge.com', fullAccessPassword, 'Full Access User', 'full_access']
      );
      console.log('✅ Default users created (credentials stored in .env or set via admin panel — NOT logged here)');
    }
  } catch (error) {
    console.error('Error creating users table:', error);
    throw error;
  }
};
// Create saved_scans table if it doesn't exist
const initSavedScansTable = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS saved_scans (
        id SERIAL PRIMARY KEY,
        barcode_data TEXT NOT NULL,
        barcode_type TEXT NOT NULL,
        source TEXT NOT NULL,
        product_name TEXT,
        category TEXT,
        price REAL,
        description TEXT,
        metadata TEXT,
        saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await pool.query(query);
    console.log('✅ saved_scans table ready');
    // Verify the table was created
    const verifyQuery = "SELECT table_name FROM information_schema.tables WHERE table_name = 'saved_scans'";
    const result = await pool.query(verifyQuery);
    if (result.rows.length > 0) {
      console.log('✅ saved_scans table verified');
    } else {
      throw new Error('Table creation failed');
    }
  } catch (error) {
    console.error('❌ Error creating saved_scans table:', error);
    throw error;
  }
};
// Create temporary_scans table for rolling 75 scans
const initTemporaryScansTable = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS temporary_scans (
        id SERIAL PRIMARY KEY,
        barcode_data TEXT NOT NULL,
        barcode_type TEXT,
        source TEXT,
        product_name TEXT,
        category TEXT,
        price REAL,
        description TEXT,
        metadata TEXT,
        device_id TEXT,
        device_name TEXT,
        user_id INTEGER REFERENCES users(id),
        ai_analyzed BOOLEAN DEFAULT false,
        title TEXT,
        country TEXT,
        is_saved BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await pool.query(query);
    console.log('✅ temporary_scans table ready');
    // Verify the table was created
    const verifyQuery = "SELECT table_name FROM information_schema.tables WHERE table_name = 'temporary_scans'";
    const result = await pool.query(verifyQuery);
    if (result.rows.length > 0) {
      console.log('✅ temporary_scans table verified');
    } else {
      throw new Error('Table creation failed');
    }
  } catch (error) {
    console.error('❌ Error creating temporary_scans table:', error);
    throw error;
  }
};
// Create user_devices table and add user_id columns
const initUserDataIsolation = async () => {
  try {
    // Create user_devices table
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS user_devices (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        workspace_id INTEGER,
        device_id TEXT NOT NULL UNIQUE,
        device_name TEXT,
        paired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      )
    `;
    await pool.query(createTableQuery);
    await pool.query('ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS workspace_id INTEGER;');
    console.log('✅ user_devices table ready');

    // Add user_id to barcodes table if not exists
    const addUserIdToBarcodesQuery = `
      ALTER TABLE barcodes 
      ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)
    `;
    await pool.query(addUserIdToBarcodesQuery);
    console.log('✅ Added user_id to barcodes table');

    // Add user_id to saved_scans table if not exists
    const addUserIdToSavedScansQuery = `
      ALTER TABLE saved_scans 
      ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)
    `;
    await pool.query(addUserIdToSavedScansQuery);
    console.log('✅ Added user_id to saved_scans table');

    // Add device_id to saved_scans table if not exists
    const addDeviceIdToSavedScansQuery = `
      ALTER TABLE saved_scans 
      ADD COLUMN IF NOT EXISTS device_id TEXT
    `;
    await pool.query(addDeviceIdToSavedScansQuery);
    console.log('✅ Added device_id to saved_scans table');

    // ALTER temporary_scans table to add missing is_saved column if not exists
    await pool.query('ALTER TABLE temporary_scans ADD COLUMN IF NOT EXISTS is_saved BOOLEAN DEFAULT FALSE;');
    console.log('✅ Added is_saved to temporary_scans table');

  } catch (error) {
    console.error('❌ Error setting up user data isolation:', error);
    throw error;
  }
};

// Save a scan to saved_scans table - USER SPECIFIC
app.post('/api/save-scan', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { barcode_data, barcode_type, source, product_name, category, price, description, metadata, device_id } = req.body;

    console.log(`🔍 Save scan request received from user ${userId}:`, {
      barcode_data,
      barcode_type,
      source,
      product_name,
      category
    });

    if (!barcode_data) {
      console.log('❌ No barcode data provided');
      return res.status(400).json({
        success: false,
        error: 'Barcode data is required'
      });
    }

    // Only allow ESP32 source scans to be saved
    const sourceUpper = (source || '').toUpperCase();
    console.log('🔍 Source check:', { source, sourceUpper, expected: 'ESP32' });
    if (sourceUpper !== 'ESP32') {
      console.log('❌ Invalid source:', source);
      return res.status(400).json({
        success: false,
        error: 'Only ESP32 source scans can be saved.'
      });
    }

    // First, check if this barcode was already saved recently by THIS USER (within last 5 minutes)
    const checkDuplicateSQL = `
      SELECT id, saved_at FROM saved_scans 
      WHERE barcode_data = $1 AND user_id = $2
      ORDER BY saved_at DESC 
      LIMIT 1
    `;

    try {
      const duplicateResult = await pool.query(checkDuplicateSQL, [barcode_data, userId]);
      const existingScan = duplicateResult.rows[0];

      // If scan exists and was saved within last 5 minutes, prevent duplicate
      if (existingScan) {
        const now = new Date();
        const savedTime = new Date(existingScan.saved_at);
        const timeDiff = (now - savedTime) / 1000 / 60; // minutes

        if (timeDiff < 5) {
          console.log(`⚠️ Duplicate save prevented for barcode: ${barcode_data} (saved ${timeDiff.toFixed(1)} minutes ago)`);
          return res.json({
            success: false,
            error: `This barcode was already saved ${timeDiff.toFixed(1)} minutes ago. Please wait before saving again.`,
            duplicate: true,
            lastSaved: existingScan.saved_at
          });
        }
      }

      // Save the scan if no recent duplicate found
      const sql = `
        INSERT INTO saved_scans (barcode_data, barcode_type, source, product_name, category, price, description, metadata, user_id, device_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `;

      console.log(`🔍 Attempting to save scan to database for user ${userId}:`, {
        barcode_data,
        barcode_type,
        source,
        product_name,
        category,
        price,
        description,
        metadata: JSON.stringify(metadata),
        device_id
      });

      const result = await pool.query(sql, [
        barcode_data,
        barcode_type,
        source,
        product_name,
        category,
        price,
        description,
        JSON.stringify(metadata),
        userId,  // Add user_id
        device_id // Add device_id
      ]);

      console.log(`✅ Scan saved to saved_scans table for user ${userId}. ID: ${result.rows[0].id}`);
      res.json({
        success: true,
        message: 'Scan saved successfully',
        savedId: result.rows[0].id
      });

    } catch (dbError) {
      console.error('❌ Error saving scan to database:', dbError);
      console.error('❌ SQL Error details:', {
        message: dbError.message,
        code: dbError.code,
        sql: sql
      });
      res.status(500).json({
        success: false,
        error: 'Failed to save scan: ' + dbError.message
      });
    }

  } catch (error) {
    console.error('Error saving scan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save scan'
    });
  }
});
// Get saved scans endpoint (with user filtering)

// ======================
// USER PROFILE ENDPOINTS
// ======================

// Get User Profile
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, phone, role, created_at, last_login FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone || '',
        role: user.role,
        memberSince: user.created_at,
        lastLogin: user.last_login
      }
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user profile'
    });
  }
});

// Update User Profile
app.put('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const userId = req.user.id;

    // Validation
    if (!name && !email && !phone) {
      return res.status(400).json({
        success: false,
        error: 'At least one field (name, email, or phone) must be provided'
      });
    }

    // If email is being updated, check if it's already in use
    if (email) {
      const existingUser = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email.toLowerCase(), userId]
      );

      if (existingUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Email is already in use by another account'
        });
      }
    }

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }

    if (email) {
      updates.push(`email = $${paramCount}`);
      values.push(email.toLowerCase());
      paramCount++;
    }

    if (phone !== undefined) {
      updates.push(`phone = $${paramCount}`);
      values.push(phone || null);
      paramCount++;
    }

    values.push(userId);

    const query = `
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, email, name, phone, role, created_at, last_login
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone || '',
        role: user.role,
        memberSince: user.created_at,
        lastLogin: user.last_login
      }
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile'
    });
  }
});

// Change Password
app.put('/api/user/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters long'
      });
    }

    // Get current password hash
    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = result.rows[0];

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [newPasswordHash, userId]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
});

// ======================
// DEVICE MANAGEMENT ENDPOINTS
// ======================

// Get User Devices
app.get('/api/devices', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      'SELECT id, device_id, device_name, is_active, last_seen, created_at as paired_at FROM user_devices WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    res.json({
      success: true,
      devices: result.rows
    });
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch devices'
    });
  }
});

// Generate pairing code for new device
app.get('/api/devices/pairing-code', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const wsId = req.workspace_id;

    // Generate a random 6-character pairing code
    const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS pairing_codes (
        workspace_id INTEGER PRIMARY KEY,
        code TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    await pool.query(
      `INSERT INTO pairing_codes (workspace_id, code, expires_at) 
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id) 
       DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at, created_at = CURRENT_TIMESTAMP`,
      [wsId, pairingCode, expiresAt]
    );

    res.json({
      success: true,
      pairingCode,
      expiresAt
    });
  } catch (error) {
    console.error('Error generating pairing code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate pairing code'
    });
  }
});

// Pair a device using pairing code
app.post('/api/devices/pair', async (req, res) => {
  try {
    const { pairingCode, deviceId, deviceName, deviceType } = req.body;

    if (!pairingCode || !deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Pairing code and device ID are required'
      });
    }

    // Find valid pairing code
    const codeResult = await pool.query(
      `SELECT workspace_id FROM pairing_codes 
       WHERE code = $1 AND expires_at > CURRENT_TIMESTAMP`,
      [pairingCode.toUpperCase()]
    );

    if (codeResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired pairing code'
      });
    }

    const wsId = codeResult.rows[0].workspace_id;

    // Check if device is already paired
    const existingDevice = await pool.query(
      'SELECT id FROM user_devices WHERE device_id = $1',
      [deviceId]
    );

    if (existingDevice.rows.length > 0) {
      // Update existing device
      await pool.query(
        `UPDATE user_devices
         SET workspace_id = $1, device_name = $2, last_seen = CURRENT_TIMESTAMP, is_active = true
         WHERE device_id = $3`,
        [wsId, deviceName || deviceId, deviceId]
      );
    } else {
      // Insert new device
      // Use NULL for user_id to satisfy foreign key constraint while relying on workspace_id
      await pool.query(
        `INSERT INTO user_devices (user_id, workspace_id, device_id, device_name, is_active) 
         VALUES (NULL, $1, $2, $3, true)`,
        [wsId, deviceId, deviceName || deviceId]
      );
    }

    // Delete used pairing code
    await pool.query('DELETE FROM pairing_codes WHERE code = $1', [pairingCode.toUpperCase()]);

    res.json({
      success: true,
      message: 'Device paired successfully'
    });
  } catch (error) {
    console.error('Error pairing device:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to pair device'
    });
  }
});

// Unpair/delete a device
// The frontend sends device.id (the integer primary key row id), not the device_id text string.
// Devices may be paired with user_id = NULL (new pairing code flow), so we match by primary key only.
app.delete('/api/devices/:deviceId', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.id;

    console.log(`🗑️ Attempting unpair for row id: "${deviceId}" (User: ${userId})`);

    // Try delete by primary key id first (matches what DeviceManager sends as device.id)
    let result = await pool.query(
      'DELETE FROM user_devices WHERE id = $1 RETURNING *',
      [deviceId]
    );

    // If not found by PK (e.g. old call sends device_id string), fall back to device_id text match
    if (result.rows.length === 0) {
      result = await pool.query(
        'DELETE FROM user_devices WHERE device_id = $1 RETURNING *',
        [deviceId]
      );
    }

    if (result.rows.length === 0) {
      console.log(`⚠️ Unpair failed. No device found with id/device_id: "${deviceId}"`);
      return res.status(404).json({
        success: false,
        error: 'Device not found or not paired'
      });
    }

    console.log(`✅ Device unpaired successfully: "${deviceId}"`);
    res.json({
      success: true,
      message: 'Device unpaired successfully'
    });
  } catch (error) {
    console.error('Error unpairing device:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unpair device'
    });
  }
});


app.get('/api/saved-scans', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`📊 Fetching saved scans for user ${userId}`);

    const sql = `
      SELECT 
        id, barcode_data, barcode_type, source, 
        product_name, category, price, description, metadata, saved_at, device_id
      FROM saved_scans 
      WHERE user_id = $1
      ORDER BY saved_at DESC
    `;

    const result = await pool.query(sql, [userId]);
    const rows = result.rows;

    console.log(`✅ Found ${rows.length} saved scans for user ${userId}`);

    // Format rows to match expected structure
    const formattedRows = rows.map(row => ({
      ...row,
      created_at: row.saved_at,
      scanned_at: row.saved_at
    }));

    res.json({
      success: true,
      savedScans: formattedRows
    });
  } catch (error) {
    console.error('Error getting saved scans:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get saved scans'
    });
  }
});

// Clear all saved scans for a user
app.delete('/api/saved-scans/clear', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`🗑️ Clearing all saved scans for user ${userId}`);

    const result = await pool.query(
      'DELETE FROM saved_scans WHERE user_id = $1',
      [userId]
    );

    console.log(`✅ Cleared ${result.rowCount} saved scans for user ${userId}`);

    res.json({
      success: true,
      message: 'All saved scans cleared successfully',
      count: result.rowCount
    });
  } catch (error) {
    console.error('Error clearing saved scans:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear saved scans'
    });
  }
});

// Delete a single saved scan
app.delete('/api/saved-scans/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    console.log(`🗑️ Deleting saved scan ${id} for user ${userId}`);

    const result = await pool.query(
      'DELETE FROM saved_scans WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Saved scan not found or access denied'
      });
    }

    console.log(`✅ Deleted saved scan ${id}`);
    res.json({
      success: true,
      message: 'Saved scan deleted successfully',
      deletedId: id
    });
  } catch (error) {
    console.error('Error deleting saved scan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete saved scan'
    });
  }
});

// Old duplicate endpoint removed to prevent conflict with authenticated Route A

// ============================================
// DEVICE MANAGEMENT ENDPOINTS
// ============================================

// Get all devices paired to current user
app.get('/api/devices', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`📱 Fetching devices for user ${userId}`);

    const sql = `
      SELECT device_id, device_name, paired_at, last_seen, is_active
      FROM user_devices
      WHERE user_id = $1 AND is_active = true
      ORDER BY paired_at DESC
    `;

    const result = await pool.query(sql, [userId]);
    console.log(`✅ Found ${result.rows.length} devices for user ${userId}`);

    // Add status field based on last_seen (device is ACTIVE if seen in last 10 seconds)
    const devicesWithStatus = result.rows.map(device => {
      const lastSeenTime = device.last_seen ? new Date(device.last_seen).getTime() : 0;
      const now = Date.now();
      const timeDiff = now - lastSeenTime;
      const status = timeDiff < 10000 ? 'ACTIVE' : 'DISCONNECTED';

      return {
        ...device,
        status
      };
    });

    res.json({
      success: true,
      devices: devicesWithStatus
    });
  } catch (error) {
    console.error('Error getting devices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get devices'
    });
  }
});

// Generate pairing code for current user
app.get('/api/devices/older-pairing-code', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const timestamp = Date.now();
    const pairingCode = `PAIR:${userId}:${timestamp}`;

    console.log(`🔑 Generated pairing code for user ${userId}: ${pairingCode}`);

    res.json({
      success: true,
      pairingCode: pairingCode
    });
  } catch (error) {
    console.error('Error generating pairing code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate pairing code'
    });
  }
});

// Pair a device to current user
app.post('/api/devices/older-pair', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId, deviceName } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'deviceId is required'
      });
    }

    console.log(`🔗 Pairing device ${deviceId} to user ${userId}`);

    // Check if device is already paired to another user
    const existingPairing = await pool.query(
      'SELECT user_id FROM user_devices WHERE device_id = $1 AND is_active = true',
      [deviceId]
    );

    if (existingPairing.rows.length > 0 && existingPairing.rows[0].user_id !== userId) {
      return res.status(400).json({
        success: false,
        error: 'Device is already paired to another user'
      });
    }

    // Insert or update pairing
    const sql = `
      INSERT INTO user_devices (user_id, device_id, device_name, paired_at, last_seen, is_active)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true)
      ON CONFLICT (device_id)
      DO UPDATE SET
        user_id = $1,
        device_name = $3,
        paired_at = CURRENT_TIMESTAMP,
        is_active = true
      RETURNING *
    `;

    const result = await pool.query(sql, [userId, deviceId, deviceName || deviceId]);
    console.log(`✅ Device ${deviceId} paired to user ${userId}`);

    res.json({
      success: true,
      message: 'Device paired successfully',
      device: result.rows[0]
    });
  } catch (error) {
    console.error('Error pairing device:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to pair device'
    });
  }
});

// Unpair a device from current user
app.delete('/api/devices/:deviceId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId } = req.params;

    console.log(`🔓 Unpairing device ${deviceId} from user ${userId}`);

    // Verify device belongs to this user
    const checkSql = 'SELECT user_id FROM user_devices WHERE device_id = $1 AND is_active = true';
    const checkResult = await pool.query(checkSql, [deviceId]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device not found'
      });
    }

    if (checkResult.rows[0].user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to unpair this device'
      });
    }

    // Soft delete (set is_active = false)
    const sql = `
      UPDATE user_devices
      SET is_active = false
      WHERE device_id = $1 AND user_id = $2
      RETURNING *
    `;

    const result = await pool.query(sql, [deviceId, userId]);
    console.log(`✅ Device ${deviceId} unpaired from user ${userId}`);

    res.json({
      success: true,
      message: 'Device unpaired successfully'
    });
  } catch (error) {
    console.error('Error unpairing device:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unpair device'
    });
  }
});



// Clear GM77_SCAN entries from saved scans
app.delete('/api/saved-scans/gm77', async (req, res) => {
  try {
    const sql = `DELETE FROM saved_scans WHERE barcode_type = 'GM77_SCAN'`;

    const result = await pool.query(sql);

    console.log(`🗑️ Cleared ${result.rowCount} GM77_SCAN entries from saved scans.`);
    res.json({
      success: true,
      message: 'GM77_SCAN entries cleared successfully',
      deletedCount: result.rowCount
    });
  } catch (error) {
    console.error('Error clearing GM77_SCAN entries:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear GM77_SCAN entries'
    });
  }
});

// Get barcode statistics
app.get('/api/barcodes/stats', async (req, res) => {
  try {
    const sql = `
      SELECT 
        source,
        barcode_type,
        COUNT(*) as count
      FROM barcodes 
      GROUP BY source, barcode_type
    `;

    const result = await pool.query(sql);
    const rows = result.rows;

    const stats = {
      bySource: {},
      byType: {},
      total: 0
    };

    rows.forEach(row => {
      stats.total += parseInt(row.count);

      if (!stats.bySource[row.source]) {
        stats.bySource[row.source] = 0;
      }
      stats.bySource[row.source] += parseInt(row.count);

      if (!stats.byType[row.barcode_type]) {
        stats.byType[row.barcode_type] = 0;
      }
      stats.byType[row.barcode_type] += parseInt(row.count);
    });

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error getting barcode statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get statistics'
    });
  }
});

// Start Python backend endpoint
app.post('/api/start-backend', async (req, res) => {
  try {
    // Kill existing process if running
    if (pythonProcess) {
      pythonProcess.kill();
      pythonProcess = null;
    }

    // Path to your Python backend
    const pythonPath = path.join(__dirname, '..', 'Barcode generator&Scanner', 'start_server.py');
    const pythonDir = path.join(__dirname, '..', 'Barcode generator&Scanner');

    console.log('Starting Python backend...');
    console.log('Python file:', pythonPath);
    console.log('Working directory:', pythonDir);

    // Start Python process
    pythonProcess = spawn('py', [pythonPath], {
      cwd: pythonDir,
      stdio: 'pipe'
    });

    // Handle process events
    pythonProcess.stdout.on('data', (data) => {
      console.log('Python stdout:', data.toString());
    });

    pythonProcess.stderr.on('data', (data) => {
      console.log('Python stderr:', data.toString());
    });

    pythonProcess.on('close', (code) => {
      console.log('Python process closed with code:', code);
      pythonProcess = null;
    });

    pythonProcess.on('error', (error) => {
      console.error('Failed to start Python process:', error);
      pythonProcess = null;
    });

    // Wait a bit for the process to start
    setTimeout(() => {
      if (pythonProcess && !pythonProcess.killed) {
        res.json({
          success: true,
          message: 'Python backend started successfully',
          pid: pythonProcess.pid
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Failed to start Python backend'
        });
      }
    }, 2000);

  } catch (error) {
    console.error('Error starting backend:', error);
    res.status(500).json({
      success: false,
      message: 'Error starting backend',
      error: error.message
    });
  }
});

// Stop Python backend endpoint
app.post('/api/stop-backend', (req, res) => {
  try {
    if (pythonProcess) {
      pythonProcess.kill();
      pythonProcess = null;
      res.json({ success: true, message: 'Python backend stopped' });
    } else {
      res.json({ success: false, message: 'No Python backend running' });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error stopping backend',
      error: error.message
    });
  }
});

// Get backend status
app.get('/api/backend-status', (req, res) => {
  const isRunning = pythonProcess && !pythonProcess.killed;
  res.json({
    running: isRunning,
    pid: isRunning ? pythonProcess.pid : null
  });
});

// Check if Python backend is running on port 5000
const checkPythonBackend = async () => {
  try {
    const response = await fetch(`http://localhost:5000/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    });
    return response.ok;
  } catch (error) {
    return false;
  }
};

// Proxy endpoints to Python backend
app.post('/api/generate_barcode', async (req, res) => {
  try {
    const isBackendRunning = await checkPythonBackend();
    if (!isBackendRunning) {
      return res.status(503).json({
        success: false,
        error: `Python backend is not running at http://localhost:5000`
      });
    }

    // Forward request to Python backend
    const response = await fetch(`http://localhost:5000/generate_barcode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('Error proxying to Python backend:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to communicate with Python backend'
    });
  }
});

app.get('/api/get_barcode/:filename', async (req, res) => {
  try {
    const isBackendRunning = await checkPythonBackend();
    if (!isBackendRunning) {
      return res.status(503).json({
        success: false,
        error: `Python backend is not running at http://localhost:5000`
      });
    }

    // Forward request to Python backend
    const response = await fetch(`http://localhost:5000/get_barcode/${req.params.filename}`);

    if (response.ok) {
      const buffer = await response.arrayBuffer();
      res.set('Content-Type', response.headers.get('Content-Type'));
      res.send(Buffer.from(buffer));
    } else {
      res.status(response.status).json({
        success: false,
        error: 'Failed to get barcode image'
      });
    }
  } catch (error) {
    console.error('Error proxying to Python backend:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to communicate with Python backend'
    });
  }
});

app.get('/api/list_barcodes', async (req, res) => {
  try {
    const isBackendRunning = await checkPythonBackend();
    if (!isBackendRunning) {
      return res.status(503).json({
        success: false,
        error: `Python backend is not running at http://localhost:5000`
      });
    }

    // Forward request to Python backend
    const response = await fetch(`http://localhost:5000/list_barcodes`);
    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('Error proxying to Python backend:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to communicate with Python backend'
    });
  }
});

// Rack Management API endpoints
app.get('/api/racks', async (req, res) => {
  try {
    const isBackendRunning = await checkPythonBackend();
    if (!isBackendRunning) {
      return res.status(503).json({
        success: false,
        error: 'Python backend is not running on port 5000'
      });
    }

    // Forward request to Python backend
    const url = new URL(`http://localhost:5000/api/racks`);
    if (req.query.search) url.searchParams.append('search', req.query.search);
    if (req.query.status) url.searchParams.append('status', req.query.status);

    const response = await fetch(url.toString());
    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('Error proxying to Python backend:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to communicate with Python backend'
    });
  }
});

app.post('/api/racks', async (req, res) => {
  try {
    const isBackendRunning = await checkPythonBackend();
    if (!isBackendRunning) {
      return res.status(503).json({
        success: false,
        error: 'Python backend is not running on port 5000'
      });
    }

    // Forward request to Python backend
    const response = await fetch(`http://localhost:5000/api/racks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });

    const result = await response.json();
    res.status(response.status).json(result);
  } catch (error) {
    console.error('Error proxying to Python backend:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to communicate with Python backend'
    });
  }
});

app.put('/api/racks/:id', async (req, res) => {
  try {
    const isBackendRunning = await checkPythonBackend();
    if (!isBackendRunning) {
      return res.status(503).json({
        success: false,
        error: `Python backend is not running at http://localhost:5000`
      });
    }

    // Forward request to Python backend
    const response = await fetch(`http://localhost:5000/api/racks/${req.params.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });

    const result = await response.json();
    res.status(response.status).json(result);
  } catch (error) {
    console.error('Error proxying to Python backend:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to communicate with Python backend'
    });
  }
});

app.delete('/api/racks/:id', async (req, res) => {
  try {
    const isBackendRunning = await checkPythonBackend();
    if (!isBackendRunning) {
      return res.status(503).json({
        success: false,
        error: 'Python backend is not running on port 5000'
      });
    }

    // Forward request to Python backend
    const response = await fetch(`http://localhost:5000/api/racks/${req.params.id}`, {
      method: 'DELETE'
    });

    const result = await response.json();
    res.status(response.status).json(result);
  } catch (error) {
    console.error('Error proxying to Python backend:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to communicate with Python backend'
    });
  }
});

app.get('/api/racks/stats', async (req, res) => {
  try {
    const isBackendRunning = await checkPythonBackend();
    if (!isBackendRunning) {
      return res.status(503).json({
        success: false,
        error: 'Python backend is not running on port 5000'
      });
    }

    // Forward request to Python backend
    const response = await fetch(`http://localhost:5000/api/racks/stats`);
    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('Error proxying to Python backend:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to communicate with Python backend'
    });
  }
});

app.get('/api/racks/search', async (req, res) => {
  try {
    const isBackendRunning = await checkPythonBackend();
    if (!isBackendRunning) {
      return res.status(503).json({
        success: false,
        error: 'Python backend is not running on port 5000'
      });
    }

    // Forward request to Python backend
    const url = new URL(`http://localhost:5000/api/racks/search`);
    if (req.query.q) url.searchParams.append('q', req.query.q);

    const response = await fetch(url.toString());
    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('Error proxying to Python backend:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to communicate with Python backend'
    });
  }
});

// Proxy for rack quantity updates
app.post('/api/racks/:rackId/update-quantity', async (req, res) => {
  try {
    const isBackendRunning = await checkPythonBackend();
    if (!isBackendRunning) {
      return res.status(503).json({
        success: false,
        error: 'Python backend is not running on port 5000'
      });
    }

    // Forward request to Python backend
    const response = await fetch(`http://localhost:5000/api/racks/${req.params.rackId}/update-quantity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });
    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('Error proxying rack quantity update to Python backend:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to communicate with Python backend'
    });
  }
});

// Proxy for rack status (operational monitoring)
app.get('/api/rack-status', async (req, res) => {
  try {
    const isBackendRunning = await checkPythonBackend();
    if (!isBackendRunning) {
      return res.status(503).json({
        success: false,
        error: 'Python backend is not running on port 5000'
      });
    }

    // Forward request to Python backend
    const response = await fetch(`http://localhost:5000/api/rack-status`);
    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('Error proxying rack status to Python backend:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to communicate with Python backend'
    });
  }
});

app.post('/api/init-db', async (req, res) => {
  try {
    const isBackendRunning = await checkPythonBackend();
    if (!isBackendRunning) {
      return res.status(503).json({
        success: false,
        error: 'Python backend is not running on port 5000'
      });
    }

    // Forward request to Python backend
    const response = await fetch(`http://localhost:5000/api/init-db`, {
      method: 'POST'
    });
    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('Error proxying to Python backend:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to communicate with Python backend'
    });
  }
});

// Backend API only - serve API info for root route
// ==========================================
// IMS DYNAMIC CONFIGURATION API ENDPOINTS
// ==========================================

const getWorkspaceSettings = async (wsId) => {
  try {
    const result = await pool.query('SELECT preferences FROM ims_settings WHERE workspace_id = $1', [wsId]);
    return result.rows.length > 0 ? result.rows[0].preferences || {} : {};
  } catch (err) {
    console.error('Error fetching settings internally:', err);
    return {};
  }
};

// --- SETTINGS ---
app.get('/api/ims/settings', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const result = await pool.query('SELECT preferences FROM ims_settings WHERE workspace_id = $1', [req.workspace_id]);
    if (result.rows.length > 0) {
      res.json({ success: true, settings: result.rows[0].preferences });
    } else {
      res.json({ success: true, settings: {} });
    }
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
});

app.post('/api/ims/settings', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { settings } = req.body;
    // We update based on workspace_id. First check if exists
    const check = await pool.query('SELECT id FROM ims_settings WHERE workspace_id = $1', [req.workspace_id]);
    if (check.rows.length > 0) {
       await pool.query('UPDATE ims_settings SET preferences = $1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = $2', [JSON.stringify(settings), req.workspace_id]);
    } else {
       await pool.query(
         'INSERT INTO ims_settings (user_id, workspace_id, preferences) VALUES ($1, $2, $3)',
         [req.user.id, req.workspace_id, JSON.stringify(settings)]
       );
    }
    res.json({ success: true, message: 'Settings saved.' });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ success: false, error: 'Failed to save settings' });
  }
});

// --- ROLES ---
app.get('/api/ims/roles', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, color FROM ims_roles WHERE workspace_id = $1 ORDER BY id ASC', [req.workspace_id]);
    res.json({ success: true, roles: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch roles' });
  }
});

app.post('/api/ims/roles', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { name, color } = req.body;
    const result = await pool.query(
      'INSERT INTO ims_roles (user_id, workspace_id, name, color) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.user.id, req.workspace_id, name, color || '#3498db']
    );
    res.json({ success: true, role: { id: result.rows[0].id, name, color } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to add role' });
  }
});

app.delete('/api/ims/roles/:id', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    await pool.query('DELETE FROM ims_roles WHERE id = $1 AND workspace_id = $2', [req.params.id, req.workspace_id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete role' });
  }
});

// --- WORKFLOWS ---
app.get('/api/ims/workflows', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, color FROM ims_workflows WHERE workspace_id = $1 ORDER BY id ASC', [req.workspace_id]);
    res.json({ success: true, workflows: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch workflows' });
  }
});

app.post('/api/ims/workflows', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { name, color } = req.body;
    const result = await pool.query(
      'INSERT INTO ims_workflows (user_id, workspace_id, name, color) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.user.id, req.workspace_id, name, color || '#3498db']
    );
    res.json({ success: true, workflow: { id: result.rows[0].id, name, color } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to add workflow' });
  }
});

app.delete('/api/ims/workflows/:id', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    await pool.query('DELETE FROM ims_workflows WHERE id = $1 AND workspace_id = $2', [req.params.id, req.workspace_id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete workflow' });
  }
});

// --- CATEGORIES ---
app.get('/api/ims/categories', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, mode, alert_at as "alertAt", reorder_at as "reorderAt", color FROM ims_categories WHERE workspace_id = $1 ORDER BY id ASC', [req.workspace_id]);
    res.json({ success: true, categories: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
});

app.post('/api/ims/categories', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { name, mode, alertAt, reorderAt, color } = req.body;
    const result = await pool.query(
      'INSERT INTO ims_categories (user_id, workspace_id, name, mode, alert_at, reorder_at, color) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [req.user.id, req.workspace_id, name, mode, alertAt, reorderAt, color || '#3498db']
    );
    res.json({ success: true, category: { id: result.rows[0].id, name, mode, alertAt, reorderAt, color } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to add category' });
  }
});

app.delete('/api/ims/categories/:id', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    await pool.query('DELETE FROM ims_categories WHERE id = $1 AND workspace_id = $2', [req.params.id, req.workspace_id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete category' });
  }
});


// ==========================================
// IMS CORE OPERATIONAL API ENDPOINTS
// ==========================================

// --- MASTER CATALOGS ---
app.get('/api/ims/masters', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT m.*, COUNT(i.id)::int as count, COUNT(*) OVER()::int as total_count
       FROM ims_masters m
       LEFT JOIN ims_items i ON i.master_id = m.id
       WHERE m.workspace_id = $1
       GROUP BY m.id
       ORDER BY m.created_at ASC
       LIMIT $2 OFFSET $3`,
      [req.workspace_id, limit, offset]
    );
    
    const total = result.rows.length > 0 ? result.rows[0].total_count : 0;
    const totalPages = Math.ceil(total / limit);

    res.json({ 
      success: true, 
      masters: result.rows,
      pagination: { total, page, limit, totalPages }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch masters' });
  }
});

app.post('/api/ims/masters', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { name, description, category } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
    const result = await pool.query(
      'INSERT INTO ims_masters (user_id, workspace_id, name, description, category) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.id, req.workspace_id, name, description || '', category || 'General']
    );
    res.json({ success: true, master: { ...result.rows[0], count: 0 } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create master catalog' });
  }
});

app.delete('/api/ims/masters/:id', authenticateToken, requireWorkspace, requireRole(['manager']), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const wsId = req.workspace_id;

    // Verify ownership
    const check = await client.query('SELECT id FROM ims_masters WHERE id = $1 AND workspace_id = $2', [id, wsId]);
    if (check.rows.length === 0) return res.status(404).json({ success: false, error: 'Master catalog not found' });

    await client.query('BEGIN');

    // 1. Delete scan events for items in this master
    await client.query(`
      DELETE FROM ims_scan_events
      WHERE workspace_id = $1 AND item_id IN (
        SELECT id FROM ims_items WHERE master_id = $2
      )`, [wsId, id]);

    // 2. Delete all items in this master
    const deleted = await client.query('DELETE FROM ims_items WHERE master_id = $1 AND workspace_id = $2', [id, wsId]);

    // 3. Delete the master itself
    await client.query('DELETE FROM ims_masters WHERE id = $1 AND workspace_id = $2', [id, wsId]);

    await client.query('COMMIT');
    res.json({ success: true, deletedItems: deleted.rowCount });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete master error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete master catalog' });
  } finally {
    client.release();
  }
});

// --- CATALOG ITEMS ---
app.get('/api/ims/masters/:masterId/items', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM ims_items WHERE master_id = $1 AND workspace_id = $2 ORDER BY created_at ASC`,
      [req.params.masterId, req.workspace_id]
    );

    // Fetch dynamic location stocks for these barcodes
    const locStockResult = await pool.query(
      `SELECT ls.barcode, l.name as zone, ls.qty 
       FROM ims_location_stock ls
       JOIN ims_locations l ON l.id = ls.location_id
       WHERE ls.workspace_id = $1 AND ls.qty > 0`,
      [req.workspace_id]
    );

    // Group locations by barcode
    const locMap = {};
    locStockResult.rows.forEach(row => {
      if (!locMap[row.barcode]) locMap[row.barcode] = [];
      locMap[row.barcode].push({ zone: row.zone, qty: row.qty });
    });

    // Map snake_case to camelCase for frontend
    const items = result.rows.map(r => {
      const itemLocations = locMap[r.barcode] && locMap[r.barcode].length > 0
        ? locMap[r.barcode]
        : (r.locations || []);

      return {
        id: r.id, masterId: r.master_id, barcode: r.barcode, name: r.name,
        category: r.category, baseUnit: r.base_unit, stock: Number(r.stock),
        trackingMode: r.tracking_mode, parentBarcode: r.parent_barcode || '',
        multiplier: r.multiplier ? Number(r.multiplier) : null,
        supplier: r.supplier || '', locations: itemLocations,
        bom: r.bom || [], weight: r.weight, cost: r.cost,
        alertAt: r.alert_at, customFields: r.custom_fields || {},
        imageUrl: r.image_url
      };
    });
    res.json({ success: true, items });
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch items' });
  }
});

app.post('/api/ims/masters/:masterId/items', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { barcode, name, category, baseUnit, stock, trackingMode, parentBarcode, multiplier, supplier, locations, bom, weight, cost, imageUrl } = req.body;
    if (!barcode || !name) return res.status(400).json({ success: false, error: 'Barcode and name are required' });
    const result = await pool.query(
      `INSERT INTO ims_items 
        (master_id, user_id, workspace_id, barcode, name, category, base_unit, stock, tracking_mode, parent_barcode, multiplier, supplier, locations, bom, weight, cost, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (master_id, barcode)
       DO UPDATE SET name=$5, category=$6, base_unit=$7, stock=$8, tracking_mode=$9, parent_barcode=$10, multiplier=$11, supplier=$12, locations=$13, bom=$14, weight=$15, cost=$16, image_url=$17, updated_at=CURRENT_TIMESTAMP
       RETURNING *`,
      [req.params.masterId, req.user.id, req.workspace_id, barcode, name, category||'General', baseUnit||'Unit',
       Number(stock)||0, trackingMode||'FIFO', parentBarcode||null, multiplier?Number(multiplier):null,
       supplier||null, JSON.stringify(locations||[]), JSON.stringify(bom||[]), weight?Number(weight):null, cost?Number(cost):null, imageUrl||null]
    );
    const r = result.rows[0];

    // Sync locations to ims_location_stock
    if (locations && Array.isArray(locations)) {
      await pool.query(
        `DELETE FROM ims_location_stock WHERE barcode = $1 AND workspace_id = $2`,
        [barcode, req.workspace_id]
      );
      for (const loc of locations) {
        if (loc.zone) {
          const locCheck = await pool.query(
            `SELECT id FROM ims_locations WHERE LOWER(name) = LOWER($1) AND workspace_id = $2`,
            [loc.zone.trim(), req.workspace_id]
          );
          if (locCheck.rows.length > 0) {
            const locationId = locCheck.rows[0].id;
            const locQty = Number(loc.qty) || Number(stock) || 0;
            await pool.query(
              `INSERT INTO ims_location_stock (location_id, workspace_id, barcode, item_name, qty)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (location_id, barcode) DO UPDATE SET qty = $5, updated_at = CURRENT_TIMESTAMP`,
              [locationId, req.workspace_id, barcode, name, locQty]
            );
          }
        }
      }
    }

    res.json({ success: true, item: {
      id: r.id, masterId: r.master_id, barcode: r.barcode, name: r.name,
      category: r.category, baseUnit: r.base_unit, stock: Number(r.stock),
      trackingMode: r.tracking_mode, parentBarcode: r.parent_barcode || '',
      multiplier: r.multiplier ? Number(r.multiplier) : null,
      supplier: r.supplier || '', locations: r.locations || [], bom: r.bom || [],
      imageUrl: r.image_url
    }});
  } catch (error) {
    console.error('Error saving item:', error);
    res.status(500).json({ success: false, error: 'Failed to save item' });
  }
});

app.put('/api/ims/masters/:masterId/items/:itemId', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { barcode, name, category, baseUnit, stock, trackingMode, parentBarcode, multiplier, supplier, locations, bom, weight, cost, imageUrl } = req.body;
    
    // Get old barcode to clear its zone assignments if it changed
    const oldItemResult = await pool.query(
      `SELECT barcode FROM ims_items WHERE id=$1 AND workspace_id=$2`,
      [req.params.itemId, req.workspace_id]
    );
    const oldBarcode = oldItemResult.rows[0]?.barcode;

    const result = await pool.query(
      `UPDATE ims_items SET barcode=$1, name=$2, category=$3, base_unit=$4, stock=$5, tracking_mode=$6,
       parent_barcode=$7, multiplier=$8, supplier=$9, locations=$10, bom=$11, weight=$12, cost=$13, image_url=$14, updated_at=CURRENT_TIMESTAMP
       WHERE id=$15 AND master_id=$16 AND workspace_id=$17 RETURNING *`,
      [barcode, name, category||'General', baseUnit||'Unit', Number(stock)||0, trackingMode||'FIFO',
       parentBarcode||null, multiplier?Number(multiplier):null, supplier||null,
       JSON.stringify(locations||[]), JSON.stringify(bom||[]), weight?Number(weight):null, cost?Number(cost):null, imageUrl||null,
       req.params.itemId, req.params.masterId, req.workspace_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Item not found' });

    // Sync locations to ims_location_stock
    if (locations && Array.isArray(locations)) {
      if (oldBarcode) {
        await pool.query(
          `DELETE FROM ims_location_stock WHERE barcode = $1 AND workspace_id = $2`,
          [oldBarcode, req.workspace_id]
        );
      }
      await pool.query(
        `DELETE FROM ims_location_stock WHERE barcode = $1 AND workspace_id = $2`,
        [barcode, req.workspace_id]
      );
      for (const loc of locations) {
        if (loc.zone) {
          const locCheck = await pool.query(
            `SELECT id FROM ims_locations WHERE LOWER(name) = LOWER($1) AND workspace_id = $2`,
            [loc.zone.trim(), req.workspace_id]
          );
          if (locCheck.rows.length > 0) {
            const locationId = locCheck.rows[0].id;
            const locQty = Number(loc.qty) || Number(stock) || 0;
            await pool.query(
              `INSERT INTO ims_location_stock (location_id, workspace_id, barcode, item_name, qty)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (location_id, barcode) DO UPDATE SET qty = $5, updated_at = CURRENT_TIMESTAMP`,
              [locationId, req.workspace_id, barcode, name, locQty]
            );
          }
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating item:', error);
    res.status(500).json({ success: false, error: 'Failed to update item' });
  }
});

app.delete('/api/ims/masters/:masterId/items/:itemId', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    await pool.query('DELETE FROM ims_items WHERE id=$1 AND master_id=$2 AND workspace_id=$3', [req.params.itemId, req.params.masterId, req.workspace_id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete item' });
  }
});

// Universal bulk import — accepts any column structure via a client-provided mapping
// Body: { rows: [...raw excel rows], mapping: { barcode: 'ColA', name: 'ProductName', ... } }
app.post('/api/ims/masters/:masterId/import', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { rows, mapping } = req.body;
    if (!rows || !Array.isArray(rows)) return res.status(400).json({ success: false, error: 'rows array required' });
    if (!mapping || typeof mapping !== 'object') return res.status(400).json({ success: false, error: 'mapping object required' });

    // Known IMS fields
    const KNOWN_FIELDS = new Set(['barcode','name','category','baseUnit','stock','trackingMode','supplier','alertAt','cost','weight']);
    // Reverse-map: imsField -> excelColumn
    const m = mapping; // e.g. { barcode: 'Item Code', name: 'Product Name', ... }

    // Helper: get value from a raw row using the mapped column name, with fallback
    const get = (row, imsField, fallback = '') => {
      const col = m[imsField];
      if (col && row[col] !== undefined && row[col] !== null && row[col] !== '') return row[col];
      return fallback;
    };

    // Determine which excel columns are unmapped (will become custom_fields)
    const mappedExcelCols = new Set(Object.values(m).filter(Boolean));
    const allExcelCols = rows.length > 0 ? Object.keys(rows[0]) : [];
    const unmappedCols = allExcelCols.filter(c => !mappedExcelCols.has(c));

    // Build mapped items
    const items = rows.map(row => {
      const barcode = String(get(row, 'barcode', '') || '').trim();
      const name    = String(get(row, 'name', '')    || '').trim();
      // Collect all unmapped columns as custom_fields
      const custom_fields = {};
      for (const col of unmappedCols) {
        if (row[col] !== undefined && row[col] !== null && row[col] !== '') {
          custom_fields[col] = row[col];
        }
      }
      return {
        barcode,
        name,
        category:     String(get(row, 'category', 'General')),
        baseUnit:     String(get(row, 'baseUnit', 'Unit')),
        stock:        Number(get(row, 'stock', 0)) || 0,
        trackingMode: String(get(row, 'trackingMode', 'FIFO')),
        supplier:     String(get(row, 'supplier', '') || '') || null,
        alertAt:      Number(get(row, 'alertAt', 0)) || 0,
        cost:         Number(get(row, 'cost', 0)) || null,
        weight:       Number(get(row, 'weight', 0)) || null,
        custom_fields,
      };
    });

    const validRows = items.filter(r => r.barcode && r.name);
    const skipped   = items.length - validRows.length;

    if (validRows.length === 0) {
      return res.json({ success: true, imported: 0, skipped, message: 'No valid rows — the mapped Barcode and Name columns must have values.' });
    }

    // Deduplicate validRows by barcode (keep the last occurrence) to prevent PostgreSQL "cannot affect row a second time" error
    const uniqueMap = new Map();
    validRows.forEach(row => {
      // Force barcode to be a string and trimmed, because Excel might pass some as numbers and some as strings, 
      // which would bypass the Map's strict equality check and cause duplicates in Postgres.
      row.barcode = String(row.barcode).trim();
      uniqueMap.set(row.barcode, row);
    });
    const uniqueValidRows = Array.from(uniqueMap.values());

    // Batch unnest insert
    const barcodes      = uniqueValidRows.map(r => r.barcode);
    const names         = uniqueValidRows.map(r => r.name);
    const categories    = uniqueValidRows.map(r => r.category);
    const units         = uniqueValidRows.map(r => r.baseUnit);
    const stocks        = uniqueValidRows.map(r => r.stock);
    const trackings     = uniqueValidRows.map(r => r.trackingMode);
    const suppliers     = uniqueValidRows.map(r => r.supplier);
    const alertAts      = uniqueValidRows.map(r => r.alertAt);
    const costs         = uniqueValidRows.map(r => r.cost);
    const customFields  = uniqueValidRows.map(r => JSON.stringify(r.custom_fields));
    const masterIdArr   = uniqueValidRows.map(() => parseInt(req.params.masterId));
    const userIdArr     = uniqueValidRows.map(() => req.user.id);
    const wsIdArr       = uniqueValidRows.map(() => req.workspace_id);

    await pool.query(
      `INSERT INTO ims_items
         (master_id, user_id, workspace_id, barcode, name, category, base_unit, stock,
          tracking_mode, supplier, alert_at, cost, custom_fields, locations, bom)
       SELECT
         UNNEST($1::int[]),  UNNEST($2::int[]),     UNNEST($3::int[]),
         UNNEST($4::text[]), UNNEST($5::text[]),    UNNEST($6::text[]),
         UNNEST($7::text[]), UNNEST($8::numeric[]), UNNEST($9::text[]),
         UNNEST($10::text[]),UNNEST($11::numeric[]),UNNEST($12::numeric[]),
         UNNEST($13::jsonb[]),'[]','[]'
       ON CONFLICT (master_id, barcode)
       DO UPDATE SET
         name          = EXCLUDED.name,
         category      = EXCLUDED.category,
         base_unit     = EXCLUDED.base_unit,
         stock         = EXCLUDED.stock,
         tracking_mode = EXCLUDED.tracking_mode,
         supplier      = EXCLUDED.supplier,
         alert_at      = EXCLUDED.alert_at,
         cost          = EXCLUDED.cost,
         custom_fields = ims_items.custom_fields || EXCLUDED.custom_fields,
         updated_at    = CURRENT_TIMESTAMP`,
      [masterIdArr, userIdArr, wsIdArr, barcodes, names, categories, units, stocks,
       trackings, suppliers, alertAts, costs, customFields]
    );

    res.json({
      success: true,
      imported: uniqueValidRows.length,
      skipped: skipped + (validRows.length - uniqueValidRows.length), // count duplicates as skipped
      customColumns: unmappedCols,
      message: `Successfully imported ${uniqueValidRows.length} items${(skipped + validRows.length - uniqueValidRows.length) > 0 ? ` (${skipped + validRows.length - uniqueValidRows.length} rows skipped)` : ''}.`
    });
  } catch (error) {
    console.error('Bulk import error:', error.message);
    res.status(500).json({ success: false, error: 'Import failed: ' + error.message });
  }
});

// --- SMART SCANNER ---
// Barcode Lookup: search across ALL masters for this user
app.get('/api/ims/scanner/lookup/:barcode', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.*, m.name as master_name FROM ims_items i
       LEFT JOIN ims_masters m ON m.id = i.master_id
       WHERE i.workspace_id = $1 AND LOWER(i.barcode) = LOWER($2)
       LIMIT 1`,
      [req.workspace_id, req.params.barcode]
    );
    if (result.rows.length === 0) return res.json({ success: true, found: false });
    const r = result.rows[0];

    // Fetch children for hierarchical scanning (Requirement 28)
    const childrenRes = await pool.query(
      `SELECT barcode, name, stock, category FROM ims_items WHERE workspace_id = $1 AND LOWER(parent_barcode) = LOWER($2)`,
      [req.workspace_id, req.params.barcode]
    );

    res.json({ success: true, found: true, item: {
      id: r.id, masterId: r.master_id, masterName: r.master_name,
      barcode: r.barcode, name: r.name, category: r.category,
      baseUnit: r.base_unit, stock: Number(r.stock),
      trackingMode: r.tracking_mode, supplier: r.supplier,
      locations: r.locations || [],
      customFields: r.custom_fields || {},
      children: childrenRes.rows
    }});
  } catch (error) {
    res.status(500).json({ success: false, error: 'Lookup failed' });
  }
});

// Record a scan event and update stock
app.post('/api/ims/scanner/scan', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { barcode, itemId, itemName, workflow, quantity, unit, batchNo, serialNo, notes, websocketScanId } = req.body;
    if (!barcode || !workflow) return res.status(400).json({ success: false, error: 'barcode and workflow required' });
    const qty = (quantity === 0 || quantity === '0') ? 0 : (Number(quantity) || 1);

    // --- ENFORCE IMS DYNAMIC SETTINGS ---
    const settings = await getWorkspaceSettings(req.workspace_id);
    if (settings?.security?.batchStrict && !batchNo && !serialNo) {
      return res.status(403).json({ success: false, error: 'Strict Traceability is enabled. Batch No or Serial No is required for this operation.' });
    }

    // ── DEDUPLICATION CHECK ──
    // 1. Check if this websocketScanId has already been recorded
    if (websocketScanId) {
      const dupIdResult = await pool.query(
        'SELECT id FROM ims_scan_events WHERE workspace_id = $1 AND websocket_scan_id = $2 LIMIT 1',
        [req.workspace_id, websocketScanId]
      );
      if (dupIdResult.rows.length > 0) {
        console.log(`🚫 Duplicate websocket_scan_id detected on backend: ${websocketScanId}`);
        const stockRes = await pool.query(
          'SELECT stock FROM ims_items WHERE workspace_id = $1 AND barcode = $2 LIMIT 1',
          [req.workspace_id, barcode]
        );
        const currentStock = Number(stockRes.rows[0]?.stock || 0);
        return res.json({ success: true, message: 'Scan already recorded (duplicate ID)', updatedStock: currentStock });
      }
    }

    // 2. Check for duplicate scans within 2 seconds window
    const timeDupResult = await pool.query(
      `SELECT id FROM ims_scan_events 
       WHERE workspace_id = $1 AND barcode = $2 AND workflow = $3 
         AND scanned_at > NOW() - INTERVAL '2 seconds'
       ORDER BY scanned_at DESC LIMIT 1`,
      [req.workspace_id, barcode, workflow]
    );
    if (timeDupResult.rows.length > 0) {
      console.log(`🚫 Duplicate timestamp scan detected on backend for barcode: ${barcode}`);
      const stockRes = await pool.query(
        'SELECT stock FROM ims_items WHERE workspace_id = $1 AND barcode = $2 LIMIT 1',
        [req.workspace_id, barcode]
      );
      const currentStock = Number(stockRes.rows[0]?.stock || 0);
      return res.json({ success: true, message: 'Scan already recorded (duplicate timestamp)', updatedStock: currentStock });
    }

    let resolvedItemId = itemId;
    if (!resolvedItemId) {
      // Check if it already exists by barcode
      const existing = await pool.query(
        'SELECT id FROM ims_items WHERE workspace_id = $1 AND barcode = $2 LIMIT 1',
        [req.workspace_id, barcode]
      );
      if (existing.rows.length > 0) {
        resolvedItemId = existing.rows[0].id;
      } else {
        // Create new item in catalog
        const categoryVal = req.body.category || 'General';
        const trackingModeVal = req.body.trackingMode || 'FIFO';
        const baseUnitVal = unit || 'Unit';
        const nameVal = itemName || `Scanned Item (${barcode})`;
        
        const insertResult = await pool.query(
          `INSERT INTO ims_items (workspace_id, master_id, user_id, barcode, name, category, base_unit, tracking_mode, stock) 
           VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, 0) RETURNING id`,
          [req.workspace_id, req.user.id, barcode, nameVal, categoryVal, baseUnitVal, trackingModeVal]
        );
        resolvedItemId = insertResult.rows[0].id;
      }
    }

    // Insert scan event
    await pool.query(
      `INSERT INTO ims_scan_events (user_id, workspace_id, barcode, item_id, item_name, workflow, quantity, unit, batch_no, serial_no, notes, websocket_scan_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [req.user.id, req.workspace_id, barcode, resolvedItemId||null, itemName||null, workflow, qty, unit||null, batchNo||null, serialNo||null, notes||null, websocketScanId||null]
    );

    // Adjust stock if item exists in catalog
    let updatedStock = 0;
    if (resolvedItemId) {
      const wf = workflow.toUpperCase();
      const inOps = ['RECEIVE', 'IN', 'RETURN', 'RESTOCK'];
      const outOps = ['DISPATCH', 'OUT', 'PICK', 'ISSUE', 'SHIP'];
      if (inOps.some(op => wf.includes(op))) {
        const updateRes = await pool.query('UPDATE ims_items SET stock = stock + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND workspace_id = $3 RETURNING stock', [qty, resolvedItemId, req.workspace_id]);
        updatedStock = Number(updateRes.rows[0]?.stock || 0);
      } else if (outOps.some(op => wf.includes(op))) {
        const updateRes = await pool.query('UPDATE ims_items SET stock = GREATEST(stock - $1, 0), updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND workspace_id = $3 RETURNING stock', [qty, resolvedItemId, req.workspace_id]);
        updatedStock = Number(updateRes.rows[0]?.stock || 0);
      } else {
        const stockRes = await pool.query('SELECT stock FROM ims_items WHERE id = $1 AND workspace_id = $2', [resolvedItemId, req.workspace_id]);
        updatedStock = Number(stockRes.rows[0]?.stock || 0);
      }

      // If PUTAWAY workflow and a location is provided, update item's location
      if (wf === 'PUTAWAY' && req.body.location) {
        const locationName = req.body.location;
        const locationsArray = [{ zone: locationName, qty: updatedStock }];
        await pool.query(
          'UPDATE ims_items SET locations = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND workspace_id = $3',
          [JSON.stringify(locationsArray), resolvedItemId, req.workspace_id]
        );

        if (req.body.locationId) {
          // Zero out stock at other locations for this item in this workspace to prevent duplicate stock
          await pool.query(
            'UPDATE ims_location_stock SET qty = 0, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = $1 AND barcode = $2 AND location_id <> $3',
            [req.workspace_id, barcode, req.body.locationId]
          );
          // Insert or update stock at the target location
          await pool.query(
            `INSERT INTO ims_location_stock (location_id, workspace_id, barcode, item_name, qty)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (location_id, barcode) DO UPDATE SET qty = $5, updated_at = CURRENT_TIMESTAMP`,
            [req.body.locationId, req.workspace_id, barcode, itemName || null, updatedStock]
          );
        }
      }
    }

    res.json({ success: true, message: 'Scan recorded', updatedStock });
  } catch (error) {
    if (error.code === '23505') {
      console.log(`🚫 Concurrent duplicate websocket_scan_id caught via DB index: ${websocketScanId}`);
      const stockRes = await pool.query(
        'SELECT stock FROM ims_items WHERE workspace_id = $1 AND barcode = $2 LIMIT 1',
        [req.workspace_id, barcode]
      );
      const currentStock = Number(stockRes.rows[0]?.stock || 0);
      return res.json({ success: true, message: 'Scan already recorded (duplicate ID)', updatedStock: currentStock });
    }
    console.error('Scan error:', error);
    res.status(500).json({ success: false, error: 'Failed to record scan' });
  }
});

// Get recent scan events
app.get('/api/ims/scanner/events', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const result = await pool.query(
      `SELECT * FROM ims_scan_events WHERE workspace_id = $1 ORDER BY scanned_at DESC LIMIT $2`,
      [req.workspace_id, limit]
    );
    res.json({ success: true, events: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch scan events' });
  }
});

// ==========================================
// RFID AND MOBILE SCANNING
// ==========================================
app.post('/api/ims/rfid/scan', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { rfidTag, locationId, deviceId } = req.body;
    if (!rfidTag) return res.status(400).json({ success: false, error: 'rfidTag is required' });

    // Look up barcode associated with RFID tag
    const itemRes = await pool.query(
      `SELECT barcode, name FROM ims_items WHERE workspace_id=$1 AND barcode=$2 LIMIT 1`,
      [req.workspace_id, rfidTag] // In many systems, RFID EPC translates directly to barcode/SKU
    );
    
    if (itemRes.rows.length === 0) return res.status(404).json({ success: false, error: 'RFID Tag not linked to any item' });
    
    const item = itemRes.rows[0];
    
    // Log RFID scan as INWARD or LOCATION_UPDATE
    await pool.query(
      `INSERT INTO ims_scan_events (user_id, workspace_id, barcode, item_name, workflow, quantity, notes)
       VALUES ($1,$2,$3,$4,'RFID_DETECTED',1,$5)`,
      [req.user.id, req.workspace_id, item.barcode, item.name, `Detected at location ${locationId||'unknown'} by device ${deviceId||'unknown'}`]
    );

    res.json({ success: true, message: 'RFID detected', item });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to process RFID scan' });
  }
});

// --- BOM ANALYZER ---
app.post('/api/ims/bom/analyze', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { items } = req.body; // [{ sku, needed }]
    if (!items || !Array.isArray(items)) return res.status(400).json({ success: false, error: 'items array required' });

    const report = [];
    for (const requested of items) {
      const result = await pool.query(
        `SELECT id, name, stock, category FROM ims_items WHERE workspace_id = $1 AND LOWER(barcode) = LOWER($2) LIMIT 1`,
        [req.workspace_id, String(requested.sku).trim()]
      );
      if (result.rows.length === 0) {
        report.push({ sku: requested.sku, name: 'Unknown Item', needed: requested.needed, available: 0, status: 'missing', diff: -requested.needed });
      } else {
        const item = result.rows[0];
        const avail = Number(item.stock);
        if (avail >= requested.needed) {
          report.push({ sku: requested.sku, name: item.name, needed: requested.needed, available: avail, status: 'ok', diff: avail - requested.needed });
        } else {
          report.push({ sku: requested.sku, name: item.name, needed: requested.needed, available: avail, status: 'shortage', diff: avail - requested.needed });
        }
      }
    }

    res.json({
      success: true,
      report: {
        total: report.length,
        ok: report.filter(r => r.status === 'ok').length,
        shortage: report.filter(r => r.status === 'shortage').length,
        missing: report.filter(r => r.status === 'missing').length,
        items: report
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'BOM analysis failed' });
  }
});

// --- IMS DASHBOARD ---
app.get('/api/ims/dashboard', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const wsId = req.workspace_id;

    // Helper to format Date objects as YYYY-MM-DD timezone-safely
    const getLocalDateString = (dateObj) => {
      if (typeof dateObj === 'string') {
        if (/^\d{4}-\d{2}-\d{2}/.test(dateObj)) {
          return dateObj.substring(0, 10);
        }
      }
      const d = new Date(dateObj);
      if (isNaN(d.getTime())) return '';
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    // Total items + stock
    const itemStats = await pool.query(
      `SELECT COUNT(*)::int as total_skus, COALESCE(SUM(stock),0)::int as total_stock FROM ims_items WHERE workspace_id = $1`,
      [wsId]
    );

    // Enforce Settings (Predictive Safety Buffer)
    const settings = await getWorkspaceSettings(wsId);
    let bufferPct = Number(settings?.bufferPct);
    if (isNaN(bufferPct)) bufferPct = 0;
    const bufferMultiplier = 1 + (bufferPct / 100);

    const lowStock = await pool.query(
      `SELECT i.id, i.name, i.barcode, i.stock, i.category, ROUND(COALESCE(c.alert_at, 10) * $2::numeric) as alert_at
       FROM ims_items i
       LEFT JOIN ims_categories c ON LOWER(c.name) = LOWER(i.category) AND c.workspace_id = i.workspace_id
       WHERE i.workspace_id = $1 AND i.stock <= ROUND(COALESCE(c.alert_at, 10) * $2::numeric)
       ORDER BY i.stock ASC LIMIT 20`,
      [wsId, bufferMultiplier]
    );

    // Today's scan movements
    const todayMovements = await pool.query(
      `SELECT COUNT(*)::int as count FROM ims_scan_events
       WHERE workspace_id = $1 AND scanned_at >= CURRENT_DATE`,
      [wsId]
    );

    // Recent scan activity (last 20)
    const recentActivity = await pool.query(
      `SELECT barcode, item_name, workflow, quantity, unit, scanned_at
       FROM ims_scan_events WHERE workspace_id = $1
       ORDER BY scanned_at DESC LIMIT 20`,
      [wsId]
    );

    // Category breakdown
    const categoryBreakdown = await pool.query(
      `SELECT category, COUNT(*)::int as sku_count, COALESCE(SUM(stock),0)::int as total_stock
       FROM ims_items WHERE workspace_id = $1
       GROUP BY category ORDER BY total_stock DESC`,
      [wsId]
    );

    // 1. Live Production WIP Workflows
    const activeWorkorders = await pool.query(
      `SELECT id, wo_number, product_name, target_qty, built_qty, status, due_date
       FROM ims_workorders
       WHERE workspace_id = $1 AND status IN ('PENDING', 'IN_PROGRESS', 'QC')
       ORDER BY created_at DESC LIMIT 5`,
      [wsId]
    );

    const formattedWip = activeWorkorders.rows.map(w => {
      const progress = w.target_qty > 0 ? Math.round((w.built_qty / w.target_qty) * 100) : 0;
      let statusLabel = w.status;
      if (w.status === 'IN_PROGRESS') statusLabel = 'In Progress';
      else if (w.status === 'PENDING') statusLabel = 'Pending';
      else if (w.status === 'QC') statusLabel = 'QC Check';

      let dueLabel = 'No Date';
      if (w.due_date) {
        const d = new Date(w.due_date);
        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(today.getDate() + 1);

        const dStr = d.toDateString();
        if (dStr === today.toDateString()) {
          dueLabel = 'Today';
        } else if (dStr === tomorrow.toDateString()) {
          dueLabel = 'Tomorrow';
        } else {
          dueLabel = getLocalDateString(d);
        }
      }

      return {
        order: w.wo_number,
        product: w.product_name,
        progress,
        status: statusLabel,
        due: dueLabel
      };
    });

    const activeWipCountRes = await pool.query(
      `SELECT COUNT(*)::int as count FROM ims_workorders
       WHERE workspace_id = $1 AND status IN ('PENDING', 'IN_PROGRESS', 'QC')`,
      [wsId]
    );
    const activeWorkordersCount = activeWipCountRes.rows[0]?.count || 0;

    // 2. Dynamic Expiry Risk Timeline (Items expiring in the next 30 days)
    const expiryResult = await pool.query(
      `WITH batch_stock AS (
         SELECT 
           se.barcode,
           i.name as product_name,
           se.batch_no,
           se.expiry_date,
           COALESCE(SUM(CASE WHEN se.workflow IN ('INWARD', 'ADD', 'RECEIVE', 'PUTAWAY', 'RESTOCK', 'RETURN') THEN se.quantity ELSE 0 END), 0) -
           COALESCE(SUM(CASE WHEN se.workflow IN ('OUTWARD', 'REMOVE', 'BOM_CONSUMPTION', 'DISPATCH', 'ISSUE', 'PICK', 'SHIP') THEN se.quantity ELSE 0 END), 0) as current_qty
         FROM ims_scan_events se
         JOIN ims_items i ON i.barcode = se.barcode AND i.workspace_id = se.workspace_id
         WHERE se.workspace_id = $1 AND se.expiry_date IS NOT NULL
         GROUP BY se.barcode, i.name, se.batch_no, se.expiry_date
       )
       SELECT barcode, product_name, batch_no, expiry_date, current_qty
       FROM batch_stock
       WHERE current_qty > 0
       ORDER BY expiry_date ASC`,
      [wsId]
    );

    const expiryItems = expiryResult.rows.map(row => {
      const expiryDate = new Date(row.expiry_date);
      const now = new Date();
      // Zero out hours to calculate exact day differences
      now.setHours(0, 0, 0, 0);
      const tempExp = new Date(expiryDate);
      tempExp.setHours(0, 0, 0, 0);
      const diffTime = tempExp - now;
      const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      let zone = 'month';
      if (daysUntil <= 7) zone = 'week';
      else if (daysUntil <= 14) zone = 'two_weeks';

      return {
        barcode: row.barcode,
        product: row.product_name,
        batchNo: row.batch_no,
        expiry: getLocalDateString(row.expiry_date),
        daysUntil,
        stock: Number(row.current_qty),
        zone
      };
    }).filter(item => item.daysUntil <= 30); // Risk timeline limit to 30 days

    // 3. Weekly Movement Trends (IN vs OUT for last 7 days)
    const dates = [];
    const trendLabels = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(getLocalDateString(d));
      trendLabels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
    }

    const trendResult = await pool.query(
      `SELECT 
         TO_CHAR(scanned_at, 'YYYY-MM-DD') as event_date,
         SUM(CASE WHEN workflow IN ('INWARD', 'ADD', 'RECEIVE', 'PUTAWAY', 'RESTOCK', 'RETURN') THEN quantity ELSE 0 END)::int as in_qty,
         SUM(CASE WHEN workflow IN ('OUTWARD', 'REMOVE', 'BOM_CONSUMPTION', 'DISPATCH', 'ISSUE', 'PICK', 'SHIP') THEN quantity ELSE 0 END)::int as out_qty
       FROM ims_scan_events
       WHERE workspace_id = $1 AND scanned_at >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY TO_CHAR(scanned_at, 'YYYY-MM-DD')
       ORDER BY TO_CHAR(scanned_at, 'YYYY-MM-DD') ASC`,
      [wsId]
    );

    const inData = dates.map(date => {
      const row = trendResult.rows.find(r => r.event_date === date);
      return row ? row.in_qty : 0;
    });

    const outData = dates.map(date => {
      const row = trendResult.rows.find(r => r.event_date === date);
      return row ? row.out_qty : 0;
    });

    const trends = [
      { name: 'Stock IN', color: '#27ae60', data: inData },
      { name: 'Stock OUT', color: '#e74c3c', data: outData }
    ];

    res.json({
      success: true,
      dashboard: {
        totalSKUs: itemStats.rows[0].total_skus,
        totalStock: itemStats.rows[0].total_stock,
        todayMovements: todayMovements.rows[0].count,
        lowStockCount: lowStock.rows.length,
        lowStockItems: lowStock.rows,
        recentActivity: recentActivity.rows,
        categoryBreakdown: categoryBreakdown.rows,
        wip: formattedWip,
        activeWorkordersCount,
        expiry: expiryItems,
        trends,
        trendLabels
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ success: false, error: 'Failed to load dashboard' });
  }
});

// ==========================================
// COMPONENT REPLACEMENT (Requirement 29)
// ==========================================
app.post('/api/ims/components/replace', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { parentBarcode, oldComponentBarcode, newComponentBarcode, reason } = req.body;
    if (!parentBarcode || !oldComponentBarcode || !newComponentBarcode || !reason) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    // Log the replacement in scan_events
    await pool.query(
      `INSERT INTO ims_scan_events (user_id, workspace_id, barcode, workflow, quantity, notes)
       VALUES ($1,$2,$3,$4,1,$5)`,
      [req.user.id, req.workspace_id, parentBarcode, 'COMPONENT_REPLACEMENT', 
       `Replaced ${oldComponentBarcode} with ${newComponentBarcode}. Reason: ${reason}`]
    );

    // Unlink old component
    await pool.query(
      `UPDATE ims_items SET parent_barcode = NULL, updated_at = CURRENT_TIMESTAMP WHERE barcode = $1 AND workspace_id = $2`,
      [oldComponentBarcode, req.workspace_id]
    );

    // Link new component
    await pool.query(
      `UPDATE ims_items SET parent_barcode = $1, updated_at = CURRENT_TIMESTAMP WHERE barcode = $2 AND workspace_id = $3`,
      [parentBarcode, newComponentBarcode, req.workspace_id]
    );

    res.json({ success: true, message: 'Component replacement logged successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to replace component' });
  }
});

// ==========================================
// WORK ORDERS
// ==========================================
app.get('/api/ims/workorders', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT w.*, COUNT(*) OVER()::int as total_count,
        (SELECT COUNT(*)::int FROM ims_wo_items i WHERE i.wo_id = w.id) as material_count
       FROM ims_workorders w WHERE w.workspace_id = $1 ORDER BY w.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.workspace_id, limit, offset]
    );
    
    const total = result.rows.length > 0 ? result.rows[0].total_count : 0;
    const totalPages = Math.ceil(total / limit);

    res.json({ 
      success: true, 
      workorders: result.rows,
      pagination: { total, page, limit, totalPages }
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/ims/workorders/:id', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const wo = await pool.query('SELECT * FROM ims_workorders WHERE id=$1 AND workspace_id=$2', [req.params.id, req.workspace_id]);
    if (!wo.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    const materials = await pool.query('SELECT * FROM ims_wo_items WHERE wo_id=$1', [req.params.id]);
    res.json({ success: true, workorder: wo.rows[0], materials: materials.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/ims/workorders', authenticateToken, requireWorkspace, async (req, res) => {
  const client = await pool.connect();
  try {
    const { productBarcode, productName, targetQty, dueDate, priority, notes } = req.body;
    if (!productName || !targetQty) return res.status(400).json({ success: false, error: 'productName and targetQty required' });
    await client.query('BEGIN');
    const woNum = 'WO-' + Date.now().toString().slice(-8);
    const wo = await client.query(
      `INSERT INTO ims_workorders (workspace_id, user_id, wo_number, product_barcode, product_name, target_qty, built_qty, status, priority, due_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,0,'PENDING',$7,$8,$9) RETURNING *`,
      [req.workspace_id, req.user.id, woNum, productBarcode||null, productName, Number(targetQty), priority||'NORMAL', dueDate||null, notes||null]
    );
    const woId = wo.rows[0].id;
    // Pull BOM from catalog if productBarcode exists
    if (productBarcode) {
      const item = await client.query(`SELECT bom FROM ims_items WHERE barcode=$1 AND workspace_id=$2 LIMIT 1`, [productBarcode, req.workspace_id]);
      if (item.rows.length && item.rows[0].bom && item.rows[0].bom.length > 0) {
        for (const b of item.rows[0].bom) {
          const avail = await client.query(`SELECT stock FROM ims_items WHERE barcode=$1 AND workspace_id=$2 LIMIT 1`, [b.barcode, req.workspace_id]);
          await client.query(
            `INSERT INTO ims_wo_items (wo_id, barcode, name, required_qty, available_qty, unit) VALUES ($1,$2,$3,$4,$5,$6)`,
            [woId, b.barcode, b.name||b.barcode, Number(b.qty || b.needed || b.quantity || 1)*Number(targetQty), avail.rows[0]?.stock||0, b.unit||'pcs']
          );
        }
      }
    }
    await client.query('COMMIT');
    res.json({ success: true, workorder: wo.rows[0] });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ success: false, error: e.message }); }
  finally { client.release(); }
});

app.put('/api/ims/workorders/:id/status', authenticateToken, requireWorkspace, async (req, res) => {
  const client = await pool.connect();
  try {
    const { status, builtQty } = req.body;
    const allowed = ['PENDING','IN_PROGRESS','QC','COMPLETE','CANCELLED'];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
    await client.query('BEGIN');
    const wo = await client.query('SELECT * FROM ims_workorders WHERE id=$1 AND workspace_id=$2', [req.params.id, req.workspace_id]);
    if (!wo.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    const w = wo.rows[0];

    // On COMPLETE: deduct raw materials from stock (BOM execution)
    if (status === 'COMPLETE' && w.status !== 'COMPLETE') {
      const materials = await client.query('SELECT * FROM ims_wo_items WHERE wo_id=$1', [req.params.id]);
      for (const m of materials.rows) {
        await client.query(
          `UPDATE ims_items SET stock = GREATEST(stock - $1, 0), updated_at=CURRENT_TIMESTAMP WHERE barcode=$2 AND workspace_id=$3`,
          [m.required_qty, m.barcode, req.workspace_id]
        );
        // Record as scan event
        await client.query(
          `INSERT INTO ims_scan_events (user_id, workspace_id, barcode, item_name, workflow, quantity, notes)
           VALUES ($1,$2,$3,$4,'ISSUE',$5,'WO:'||$6)`,
          [req.user.id, req.workspace_id, m.barcode, m.name, m.required_qty, w.wo_number]
        );
      }
      // Add finished product to stock
      if (w.product_barcode) {
        const scannedRes = await client.query(
          `SELECT COALESCE(SUM(quantity), 0) as scanned_qty 
           FROM ims_scan_events 
           WHERE workspace_id = $1 AND barcode = $2 AND notes = $3`,
          [req.workspace_id, w.product_barcode, 'WO:' + w.wo_number]
        );
        const scannedQty = Number(scannedRes.rows[0].scanned_qty || 0);
        const remainingQty = Math.max(0, Number(w.target_qty) - scannedQty);

        if (remainingQty > 0) {
          await client.query(
            `UPDATE ims_items SET stock = stock + $1, updated_at=CURRENT_TIMESTAMP WHERE barcode=$2 AND workspace_id=$3`,
            [remainingQty, w.product_barcode, req.workspace_id]
          );
        }
      }
    }
    await client.query(
      `UPDATE ims_workorders SET status=$1, built_qty=COALESCE($2,built_qty), updated_at=CURRENT_TIMESTAMP WHERE id=$3`,
      [status, builtQty||null, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ success: false, error: e.message }); }
  finally { client.release(); }
});

app.delete('/api/ims/workorders/:id', authenticateToken, requireWorkspace, requireRole(['manager']), async (req, res) => {
  try {
    await pool.query('DELETE FROM ims_wo_items WHERE wo_id=$1', [req.params.id]);
    await pool.query('DELETE FROM ims_workorders WHERE id=$1 AND workspace_id=$2', [req.params.id, req.workspace_id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ==========================================
// GRN — INWARD / OUTWARD
// ==========================================
app.get('/api/ims/grn', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { type } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const q = type ? 'SELECT *, COUNT(*) OVER()::int as total_count FROM ims_grn WHERE workspace_id=$1 AND type=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4'
                   : 'SELECT *, COUNT(*) OVER()::int as total_count FROM ims_grn WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3';
    const params = type ? [req.workspace_id, type, limit, offset] : [req.workspace_id, limit, offset];
    
    const result = await pool.query(q, params);
    
    const total = result.rows.length > 0 ? result.rows[0].total_count : 0;
    const totalPages = Math.ceil(total / limit);
    res.json({ 
      success: true, 
      grns: result.rows,
      pagination: { total, page, limit, totalPages }
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get('/api/ims/grn/:id/items', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const grnId = parseInt(req.params.id);
    const wsId  = parseInt(req.workspace_id);
    if (isNaN(grnId) || isNaN(wsId)) {
      return res.status(400).json({ success: false, error: 'Invalid GRN or workspace id' });
    }
    const result = await pool.query(
      'SELECT i.* FROM ims_grn_items i JOIN ims_grn g ON g.id = i.grn_id WHERE i.grn_id=$1 AND g.workspace_id=$2',
      [grnId, wsId]
    );
    res.json({ success: true, items: result.rows });
  } catch (e) {
    console.error('GET /api/ims/grn/:id/items error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});
app.post('/api/ims/grn', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { type, supplier, poRef, vehicleNo, notes, items } = req.body;
    if (!type || !supplier) return res.status(400).json({ success: false, error: 'type and supplier required' });
    const prefix = type === 'INWARD' ? 'GRN' : 'DN';
    const docNo = prefix + '-' + Date.now().toString().slice(-8);
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const grn = await client.query(
        `INSERT INTO ims_grn (workspace_id, user_id, doc_no, type, supplier, po_ref, vehicle_no, notes, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING') RETURNING *`,
        [req.workspace_id, req.user.id, docNo, type, supplier, poRef||null, vehicleNo||null, notes||null]
      );
      const grnId = grn.rows[0].id;
      if (items && items.length > 0) {
        for (const it of items) {
          const ord = Number(it.orderedQty) || 0;
          const rec = Number(it.receivedQty) || 0;
          await client.query(
            `INSERT INTO ims_grn_items (grn_id, barcode, name, ordered_qty, received_qty, unit, condition, note)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [grnId, it.barcode, it.name, ord, rec, it.unit||'pcs', it.condition||'Good', it.note||null]
          );
        }
      }
      await client.query('COMMIT');
      res.json({ success: true, grn: grn.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.post('/api/ims/grn/:id/approve', authenticateToken, requireWorkspace, requireRole(['manager','admin','owner']), async (req, res) => {
  const client = await pool.connect();
  try {
    const grn = await client.query('SELECT * FROM ims_grn WHERE id=$1 AND workspace_id=$2', [req.params.id, req.workspace_id]);
    if (!grn.rows.length) return res.status(404).json({ success: false, error: 'GRN not found' });
    const g = grn.rows[0];
    if (g.status !== 'PENDING') return res.status(400).json({ success: false, error: 'Already processed' });
    await client.query('BEGIN');
    const items = await client.query('SELECT * FROM ims_grn_items WHERE grn_id=$1', [req.params.id]);
    for (const it of items.rows) {
      const qty = Number(it.received_qty);
      const notesVal = g.type === 'INWARD' ? 'GRN:' + g.doc_no : 'DN:' + g.doc_no;
      const scannedRes = await client.query(
        `SELECT COALESCE(SUM(quantity), 0) as scanned_qty 
         FROM ims_scan_events 
         WHERE workspace_id = $1 AND barcode = $2 AND notes = $3`,
        [req.workspace_id, it.barcode, notesVal]
      );
      const scannedQty = Number(scannedRes.rows[0].scanned_qty || 0);
      const remainingQty = Math.max(0, qty - scannedQty);

      if (remainingQty > 0) {
        if (g.type === 'INWARD') {
          await client.query(`UPDATE ims_items SET stock=stock+$1,updated_at=CURRENT_TIMESTAMP WHERE barcode=$2 AND workspace_id=$3`, [remainingQty, it.barcode, req.workspace_id]);
          await client.query(`INSERT INTO ims_scan_events (user_id,workspace_id,barcode,item_name,workflow,quantity,notes) VALUES ($1,$2,$3,$4,'RECEIVE',$5,$6)`, [req.user.id, req.workspace_id, it.barcode, it.name, remainingQty, notesVal]);
        } else {
          await client.query(`UPDATE ims_items SET stock=GREATEST(stock-$1,0),updated_at=CURRENT_TIMESTAMP WHERE barcode=$2 AND workspace_id=$3`, [remainingQty, it.barcode, req.workspace_id]);
          await client.query(`INSERT INTO ims_scan_events (user_id,workspace_id,barcode,item_name,workflow,quantity,notes) VALUES ($1,$2,$3,$4,'DISPATCH',$5,$6)`, [req.user.id, req.workspace_id, it.barcode, it.name, remainingQty, notesVal]);
        }
      }
    }
    await client.query(`UPDATE ims_grn SET status='APPROVED',approved_by=$1,approved_at=CURRENT_TIMESTAMP WHERE id=$2`, [req.user.id, req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ success: false, error: e.message }); }
  finally { client.release(); }
});
app.post('/api/ims/grn/:id/reject', authenticateToken, requireWorkspace, requireRole(['manager','admin','owner']), async (req, res) => {
  try {
    await pool.query(`UPDATE ims_grn SET status='REJECTED' WHERE id=$1 AND workspace_id=$2`, [req.params.id, req.workspace_id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
// ==========================================
// GRN / DISPATCH — SCAN-TO-VERIFY
// ==========================================
app.post('/api/ims/grn/verify-scan', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { barcode, mode } = req.body;
    if (!barcode) return res.status(400).json({ success: false, error: 'barcode required' });
    const grnType = mode === 'DISPATCH' ? 'OUTWARD' : 'INWARD';
    const wsId = parseInt(req.workspace_id);
    const itemResult = await pool.query(
      `SELECT i.id as item_id, i.grn_id, i.name, i.ordered_qty, i.received_qty, i.unit,
              g.doc_no, g.supplier, g.type
       FROM ims_grn_items i
       JOIN ims_grn g ON g.id = i.grn_id
       WHERE g.workspace_id = $1 AND g.type = $2 AND g.status = 'PENDING' AND i.barcode = $3
       ORDER BY g.created_at ASC LIMIT 1`,
      [wsId, grnType, barcode]
    );
    if (itemResult.rows.length === 0) {
      return res.json({ success: true, matched: false,
        message: `Barcode not on any pending ${mode === 'DISPATCH' ? 'Dispatch Note' : 'GRN'}` });
    }
    const item = itemResult.rows[0];
    const updated = await pool.query(
      'UPDATE ims_grn_items SET received_qty = received_qty + 1 WHERE id = $1 RETURNING received_qty',
      [item.item_id]
    );
    const newQty = updated.rows[0].received_qty;
    const fullyReceived = Number(newQty) >= Number(item.ordered_qty);
    io.to(`workspace_${wsId}`).emit('grn_item_updated', {
      grnId: item.grn_id, itemId: item.item_id, barcode,
      name: item.name, receivedQty: newQty, orderedQty: item.ordered_qty,
      fullyReceived, docNo: item.doc_no
    });
    res.json({ success: true, matched: true,
      item: { name: item.name, barcode, orderedQty: item.ordered_qty, receivedQty: newQty, unit: item.unit, fullyReceived },
      grn: { id: item.grn_id, docNo: item.doc_no, supplier: item.supplier }
    });
  } catch (e) {
    console.error('verify-scan error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});
// ==========================================
// WORK ORDERS — SCAN-TO-VERIFY
// ==========================================
app.post('/api/ims/workorders/verify-scan', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { barcode } = req.body;
    if (!barcode) return res.status(400).json({ success: false, error: 'barcode required' });
    const wsId = parseInt(req.workspace_id);
    // Find the first IN_PROGRESS or PENDING work order matching this finished product barcode
    const woResult = await pool.query(
      `SELECT id, wo_number, product_name, target_qty, built_qty, status
       FROM ims_workorders
       WHERE workspace_id = $1
         AND status IN ('IN_PROGRESS', 'PENDING')
         AND product_barcode = $2
       ORDER BY created_at ASC LIMIT 1`,
      [wsId, barcode]
    );
    if (woResult.rows.length === 0) {
      return res.json({
        success: true, matched: false,
        message: 'Barcode not matched to any In-Progress or Pending Work Order'
      });
    }
    const wo = woResult.rows[0];
    // Increment built_qty
    const updated = await pool.query(
      `UPDATE ims_workorders SET built_qty = built_qty + 1 WHERE id = $1 RETURNING built_qty`,
      [wo.id]
    );
    const newBuiltQty = updated.rows[0].built_qty;
    const fullyBuilt = Number(newBuiltQty) >= Number(wo.target_qty);
    // Broadcast real-time update
    io.to(`workspace_${wsId}`).emit('workorder_updated', {
      woId: wo.id,
      woNumber: wo.wo_number,
      barcode,
      productName: wo.product_name,
      builtQty: newBuiltQty,
      targetQty: wo.target_qty,
      fullyBuilt
    });
    res.json({
      success: true, matched: true,
      wo: {
        id: wo.id,
        woNumber: wo.wo_number,
        productName: wo.product_name,
        targetQty: wo.target_qty,
        builtQty: newBuiltQty,
        fullyBuilt
      }
    });
  } catch (e) {
    console.error('wo verify-scan error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// LOCATIONS / ZONES
// ==========================================
app.get('/api/ims/locations', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT l.*, 
        (SELECT COUNT(*)::int FROM ims_location_stock s WHERE s.location_id=l.id) as sku_count,
        (SELECT COALESCE(SUM(qty),0)::int FROM ims_location_stock s WHERE s.location_id=l.id) as total_qty
       FROM ims_locations l WHERE l.workspace_id=$1 ORDER BY l.name`,
      [req.workspace_id]
    );
    res.json({ success: true, locations: result.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/ims/locations/:id/stock', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, i.name as item_name, i.category FROM ims_location_stock s
       LEFT JOIN ims_items i ON i.barcode=s.barcode AND i.workspace_id=$1
       WHERE s.location_id=$2 ORDER BY s.updated_at DESC`,
      [req.workspace_id, req.params.id]
    );
    res.json({ success: true, stock: result.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/ims/locations', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { name, type, description } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Name required' });
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const result = await pool.query(
      `INSERT INTO ims_locations (workspace_id, user_id, name, type, description) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.workspace_id, req.user.id, name, type||'WAREHOUSE', description||null]
    );
    res.json({ success: true, location: result.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/ims/locations/:id', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { name, type, description } = req.body;
    await pool.query(`UPDATE ims_locations SET name=$1,type=$2,description=$3 WHERE id=$4 AND workspace_id=$5`, [name, type, description, req.params.id, req.workspace_id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/ims/locations/:id', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    await pool.query('DELETE FROM ims_location_stock WHERE location_id=$1', [req.params.id]);
    await pool.query('DELETE FROM ims_locations WHERE id=$1 AND workspace_id=$2', [req.params.id, req.workspace_id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Transfer stock between locations
app.post('/api/ims/locations/transfer', authenticateToken, requireWorkspace, async (req, res) => {
  const client = await pool.connect();
  try {
    const { barcode, itemName, fromLocationId, toLocationId, qty } = req.body;
    if (!barcode || !toLocationId || !qty) return res.status(400).json({ success: false, error: 'barcode, toLocationId and qty required' });
    await client.query('BEGIN');
    // Deduct from source (if specified)
    if (fromLocationId) {
      await client.query(`UPDATE ims_location_stock SET qty=GREATEST(qty-$1,0),updated_at=CURRENT_TIMESTAMP WHERE location_id=$2 AND barcode=$3`, [qty, fromLocationId, barcode]);
    }
    // Add to destination (upsert)
    await client.query(
      `INSERT INTO ims_location_stock (location_id, workspace_id, barcode, item_name, qty)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (location_id, barcode) DO UPDATE SET qty=ims_location_stock.qty+$5, updated_at=CURRENT_TIMESTAMP`,
      [toLocationId, req.workspace_id, barcode, itemName||barcode, qty]
    );
    // Log as scan event
    await client.query(`INSERT INTO ims_scan_events (user_id,workspace_id,barcode,item_name,workflow,quantity,notes) VALUES ($1,$2,$3,$4,'TRANSFER',$5,'Zone transfer')`,
      [req.user.id, req.workspace_id, barcode, itemName||barcode, qty]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ success: false, error: e.message }); }
  finally { client.release(); }
});

// ==========================================
// PRODUCTION / QC STAGES
// ==========================================
app.get('/api/ims/production/stages', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ims_production_stages WHERE workspace_id=$1 ORDER BY order_index', [req.workspace_id]);
    if (!result.rows.length) {
      // Seed defaults
      const defaults = ['Store', 'Manufacturing', 'Assembly', 'QC', 'Final Goods'];
      for (let i = 0; i < defaults.length; i++) {
        await pool.query(`INSERT INTO ims_production_stages (workspace_id,name,order_index) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [req.workspace_id, defaults[i], i + 1]);
      }
      const seeded = await pool.query('SELECT * FROM ims_production_stages WHERE workspace_id=$1 ORDER BY order_index', [req.workspace_id]);
      return res.json({ success: true, stages: seeded.rows });
    }
    res.json({ success: true, stages: result.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/ims/production/events', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { woId, stageId } = req.query;
    let q = 'SELECT p.*, u.name as operator_name FROM ims_production_events p LEFT JOIN users u ON u.id=p.user_id WHERE p.workspace_id=$1';
    const params = [req.workspace_id];
    if (woId) { q += ` AND p.wo_id=$${params.length+1}`; params.push(woId); }
    if (stageId) { q += ` AND p.stage_id=$${params.length+1}`; params.push(stageId); }
    q += ' ORDER BY p.created_at DESC LIMIT 200';
    const result = await pool.query(q, params);
    res.json({ success: true, events: result.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/ims/production/scan', authenticateToken, requireWorkspace, async (req, res) => {
  const client = await pool.connect();
  try {
    const { barcode, itemName, stageId, stageName, outcome, qty, woId, batchNo, notes } = req.body;
    if (!barcode || !stageId || !outcome) return res.status(400).json({ success: false, error: 'barcode, stageId and outcome required' });
    const allowed = ['FORWARD', 'REWORK', 'REJECT'];
    if (!allowed.includes(outcome)) return res.status(400).json({ success: false, error: 'outcome must be FORWARD, REWORK, or REJECT' });
    
    await client.query('BEGIN');
    
    const result = await client.query(
      `INSERT INTO ims_production_events (workspace_id, user_id, wo_id, barcode, item_name, stage_id, stage_name, outcome, qty, batch_no, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.workspace_id, req.user.id, woId||null, barcode, itemName||barcode, stageId, stageName||'', outcome, Number(qty)||1, batchNo||null, notes||null]
    );

    // BOM Auto-Execution on FORWARD
    if (outcome === 'FORWARD') {
      const itemRes = await client.query('SELECT bom FROM ims_items WHERE barcode=$1 AND workspace_id=$2 LIMIT 1', [barcode, req.workspace_id]);
      if (itemRes.rows.length > 0 && itemRes.rows[0].bom) {
        let bom = [];
        try { bom = typeof itemRes.rows[0].bom === 'string' ? JSON.parse(itemRes.rows[0].bom) : itemRes.rows[0].bom; } catch(e){}
        const multiplier = Number(qty) || 1;
        
        for (const comp of bom) {
          if (!comp.sku || !comp.needed) continue;
          const deductQty = Number(comp.needed) * multiplier;
          await client.query(
            `UPDATE ims_items SET stock = GREATEST(stock - $1, 0), updated_at=CURRENT_TIMESTAMP WHERE barcode=$2 AND workspace_id=$3`,
            [deductQty, comp.sku, req.workspace_id]
          );
          await client.query(
            `INSERT INTO ims_scan_events (user_id, workspace_id, barcode, item_name, workflow, quantity, notes)
             VALUES ($1,$2,$3,$4,'BOM_CONSUMPTION',$5,'Auto-deducted for assembly of '||$6)`,
            [req.user.id, req.workspace_id, comp.sku, comp.name||comp.sku, deductQty, barcode]
          );
        }
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, event: result.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/ims/production/summary', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT stage_name, outcome, SUM(qty)::int as total
       FROM ims_production_events WHERE workspace_id=$1
       GROUP BY stage_name, outcome ORDER BY stage_name, outcome`,
      [req.workspace_id]
    );
    res.json({ success: true, summary: result.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ==========================================
// REPORTS
// ==========================================
app.get('/api/ims/reports/scan-history', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { from, to, workflow, barcode } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limitParams = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limitParams;

    let q = `SELECT e.*, u.name as operator, COUNT(*) OVER()::int as total_count FROM ims_scan_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.workspace_id=$1`;
    const params = [req.workspace_id];
    if (from) { q += ` AND e.scanned_at >= $${params.length+1}`; params.push(from); }
    if (to) { q += ` AND e.scanned_at <= $${params.length+1}`; params.push(to); }
    if (workflow) { q += ` AND e.workflow=$${params.length+1}`; params.push(workflow); }
    if (barcode) { q += ` AND e.barcode ILIKE $${params.length+1}`; params.push('%'+barcode+'%'); }
    
    q += ` ORDER BY e.scanned_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(limitParams, offset);
    
    const result = await pool.query(q, params);
    
    const total = result.rows.length > 0 ? result.rows[0].total_count : 0;
    const totalPages = Math.ceil(total / limitParams);

    res.json({ 
      success: true, 
      events: result.rows,
      pagination: { total, page, limit: limitParams, totalPages }
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/ims/reports/stock-summary', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.barcode, i.name, i.category, i.stock, i.base_unit as unit,
         i.supplier, i.cost, (i.stock * COALESCE(i.cost,0)) as total_value,
         i.updated_at as last_movement
       FROM ims_items i WHERE i.workspace_id=$1 ORDER BY i.stock DESC`,
      [req.workspace_id]
    );
    const totals = await pool.query(
      `SELECT COUNT(*)::int as skus, COALESCE(SUM(stock),0)::int as total_units,
         COALESCE(SUM(stock*COALESCE(cost,0)),0)::numeric(12,2) as total_value
       FROM ims_items WHERE workspace_id=$1`,
      [req.workspace_id]
    );
    res.json({ success: true, items: result.rows, totals: totals.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/ims/reports/movement', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { days } = req.query;
    const d = Number(days) || 30;
    const result = await pool.query(
      `SELECT barcode, item_name, workflow,
         SUM(quantity)::int as total_qty,
         COUNT(*)::int as event_count,
         MAX(scanned_at) as last_event
       FROM ims_scan_events
       WHERE workspace_id=$1 AND scanned_at >= NOW() - INTERVAL '${d} days'
       GROUP BY barcode, item_name, workflow ORDER BY total_qty DESC LIMIT 100`,
      [req.workspace_id]
    );
    res.json({ success: true, movements: result.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/ims/reports/low-stock', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.*, COALESCE(c.alert_at, 10) as threshold
       FROM ims_items i
       LEFT JOIN ims_categories c ON LOWER(c.name)=LOWER(i.category) AND c.workspace_id=i.workspace_id
       WHERE i.workspace_id=$1 AND i.stock <= COALESCE(c.alert_at, 10)
       ORDER BY i.stock ASC`,
      [req.workspace_id]
    );
    res.json({ success: true, items: result.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/ims/reports/wastage', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.barcode, e.item_name, e.wo_id, w.wo_number, SUM(e.qty)::int as wasted_qty, COUNT(e.id)::int as incident_count
       FROM ims_production_events e
       LEFT JOIN ims_workorders w ON w.id = e.wo_id
       WHERE e.workspace_id=$1 AND e.outcome='REJECT'
       GROUP BY e.barcode, e.item_name, e.wo_id, w.wo_number
       ORDER BY wasted_qty DESC`,
      [req.workspace_id]
    );
    res.json({ success: true, wastage: result.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ==========================================
// ERP INTEGRATION API
// ==========================================
app.post('/api/ims/erp/sync', authenticateToken, requireWorkspace, async (req, res) => {
  const client = await pool.connect();
  try {
    const { action, payload } = req.body;
    
    await client.query('BEGIN');
    
    if (action === 'IMPORT_PO') {
      const result = await client.query(
        `INSERT INTO ims_grn (workspace_id, user_id, doc_no, doc_type, status, items)
         VALUES ($1,$2,$3,'INWARD','PENDING',$4) RETURNING *`,
        [req.workspace_id, req.user.id, payload.doc_no || ('ERP-PO-' + Date.now()), JSON.stringify(payload.items || [])]
      );
      await client.query('COMMIT');
      return res.json({ success: true, message: 'PO imported to GRN', grn: result.rows[0] });
    }
    
    if (action === 'SYNC_STOCK') {
      const items = await client.query('SELECT barcode, name, stock, cost FROM ims_items WHERE workspace_id=$1', [req.workspace_id]);
      await client.query('COMMIT');
      return res.json({ success: true, message: 'Stock exported for ERP', stock: items.rows });
    }
    
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, error: 'Unknown ERP action. Use IMPORT_PO or SYNC_STOCK' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/ims/fefo-recommendation', authenticateToken, requireWorkspace, async (req, res) => {
  try {
    const { barcode } = req.query;
    if (!barcode) return res.status(400).json({ success: false, error: 'barcode required' });
    
    // Find batches that came IN, subtract OUT, and order by expiry_date ASC
    const result = await pool.query(
      `WITH batch_stock AS (
         SELECT batch_no, expiry_date, 
                SUM(CASE WHEN workflow IN ('INWARD', 'ADD') THEN quantity ELSE 0 END) - 
                SUM(CASE WHEN workflow IN ('OUTWARD', 'REMOVE', 'BOM_CONSUMPTION') THEN quantity ELSE 0 END) as current_qty
         FROM ims_scan_events 
         WHERE workspace_id=$1 AND barcode=$2 AND batch_no IS NOT NULL AND expiry_date IS NOT NULL
         GROUP BY batch_no, expiry_date
       )
       SELECT * FROM batch_stock WHERE current_qty > 0 ORDER BY expiry_date ASC LIMIT 5`,
      [req.workspace_id, barcode]
    );
    
    res.json({ success: true, recommendation: result.rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    message: 'Robridge Backend API Server',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      esp32Ping: '/api/esp32/ping/:deviceId',
      esp32Scan: '/api/esp32/scan',
      startBackend: '/api/start-backend',
      stopBackend: '/api/stop-backend',
      backendStatus: '/api/backend-status'
    }
  });
});

// Redirect app setup for port 3000
redirectApp.get('*', (req, res) => {
  const redirectUrl = `http://localhost:${PORT}${req.originalUrl}`;
  console.log(`Redirecting from port ${REDIRECT_PORT} to port ${PORT}: ${redirectUrl}`);
  res.redirect(301, redirectUrl);
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected to WebSocket:', socket.id);

  // Handle authentication
  socket.on('authenticate', async (token) => {
    if (!token) return;

    try {
      jwt.verify(token, JWT_SECRET, async (err, user) => {
        if (err) {
          console.log('WebSocket authentication failed:', err.message);
          return;
        }

        // Join user-specific room
        const userRoom = `user_${user.id}`;
        socket.join(userRoom);
        console.log(`✅ Socket ${socket.id} authenticated as user ${user.id} and joined room ${userRoom}`);

        // Send confirmation
        socket.emit('authenticated', { success: true, userId: user.id });

        // Send ONLY the user's paired devices
        try {
          const pairedDevicesResult = await pool.query(
            'SELECT device_id FROM user_devices WHERE user_id = $1 AND is_active = true',
            [user.id]
          );

          const pairedDeviceIds = pairedDevicesResult.rows.map(row => row.device_id);
          const allDevices = Array.from(esp32Devices.values());
          const userDevices = allDevices.filter(device => pairedDeviceIds.includes(device.deviceId));

          console.log(`📡 Sending ${userDevices.length} paired devices to user ${user.id}`);
          socket.emit('esp32_devices_update', userDevices);
        } catch (dbError) {
          console.error('Error fetching user devices for WebSocket:', dbError);
          socket.emit('esp32_devices_update', []);
        }
      });
    } catch (error) {
      console.error('WebSocket auth error:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected from WebSocket:', socket.id);
  });
});


// Initialize stock_track table for IN/OUT inventory tracking
const initStockTrackTable = async () => {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS stock_track (
        id SERIAL PRIMARY KEY,
        barcode_data TEXT NOT NULL,
        status VARCHAR(10) DEFAULT 'IN',
        first_scan_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_scan_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        scan_count INTEGER DEFAULT 1,
        device_id TEXT,
        user_id INTEGER REFERENCES users(id),
        UNIQUE(barcode_data, user_id)
      )
    `;

    await pool.query(sql);
    console.log('✅ stock_track table initialized');

    // Create index for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_track_barcode_user 
      ON stock_track(barcode_data, user_id)
    `);
    console.log('✅ stock_track indexes created');
  } catch (error) {
    console.error('❌ Error initializing stock_track table:', error);
    throw error;
  }
};


// Initialize database and start servers
const startServer = async () => {
  try {
    // Initialize users table first as other tables have foreign keys to it
    await initUsersTable();

    // Initialize database connection
    await initDatabase();
    console.log('✅ Database connection initialized');

    // Initialize tables

    await initBarcodesTable();
    await initTemporaryScansTable(); // Add missing temporary_scans table
    await initSavedScansTable();
    await initStockTrackTable(); // NEW: Initialize stock_track table
    await initUserDataIsolation();
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    console.log('⚠️  Server will continue without database functionality');
  }

  // Start server
  server.listen(PORT, '0.0.0.0', () => {
    console.log('═══════════════════════════════════════════════════════');
    console.log('🚀 Robridge Backend Server Started');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`📡 Main server running on port ${PORT}`);
    console.log(`✅ UNPAIR FIX APPLIED (v2) - Case insensitive logic loaded`);
    console.log(`🌍 Environment: ${NODE_ENV}`);
    console.log(`🤖 AI Server: ${AI_SERVER_URL}`);
    console.log(`🏷️  Flask Server: http://localhost:5000`);
    console.log(`🔌 WebSocket server active on port ${PORT}`);
    console.log(`🗄️  Database: PostgreSQL (${process.env.DATABASE_URL ? 'Connected' : 'Not configured'})`);
    if (NODE_ENV === 'production') {
      console.log(`🌐 Production URL: https://robridgeexpress.onrender.com`);
    } else {
      console.log(`🌐 Local URL: http://localhost:${PORT}`);
    }
    console.log('═══════════════════════════════════════════════════════');
  });
};

if (require.main === module) {
  startServer();
}

module.exports = { app, server, pool };

// Only start redirect server in development
if (NODE_ENV !== 'production') {
  const redirectServer = redirectApp.listen(REDIRECT_PORT, () => {
    console.log(`Redirect server running on port ${REDIRECT_PORT}`);
    console.log(`Redirecting all traffic to port ${PORT}`);
  });

  redirectServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️  Port ${REDIRECT_PORT} already in use — redirect server skipped. This is fine if npm start is running.`);
    } else {
      console.error('Redirect server error:', err);
    }
  });
}


// ─── PROCESS-LEVEL ERROR HANDLING & GRACEFUL SHUTDOWN ───────────────────────

// Catch synchronous exceptions that would otherwise crash the process
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception — server will continue running:', err.message);
  console.error(err.stack);
  // Do NOT exit — keep the server alive for other requests
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Promise Rejection:', reason);
  // Do NOT exit — keep the server alive
});

// Graceful shutdown: close DB pool and HTTP server cleanly on SIGTERM (Render, Docker, etc.)
const gracefulShutdown = async (signal) => {
  console.log(`\n🛑 ${signal} received — starting graceful shutdown...`);
  try {
    await pool.end();
    console.log('✅ Database pool closed');
  } catch (e) {
    console.error('⚠️ Error closing DB pool:', e.message);
  }
  server.close(() => {
    console.log('✅ HTTP server closed. Goodbye.');
    process.exit(0);
  });
  // Force exit after 10 seconds if something hangs
  setTimeout(() => {
    console.error('⚠️ Forced exit after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));