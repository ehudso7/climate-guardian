/**
 * Database Initialization
 * Supports both SQLite (local) and PostgreSQL (Vercel)
 */

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Detect environment
const IS_VERCEL = process.env.VERCEL === '1';
const USE_POSTGRES = IS_VERCEL || process.env.USE_POSTGRES === 'true';

let db = null;
let isInitialized = false;
let pgPool = null;

/**
 * Get database connection
 */
function getDatabase() {
    if (USE_POSTGRES) {
        return getPostgresClient();
    }
    return getSqliteDatabase();
}

/**
 * SQLite database for local development
 */
function getSqliteDatabase() {
    if (!db) {
        const Database = require('better-sqlite3');
        const DB_PATH = process.env.DATABASE_PATH || './database/climate_guardian.db';
        
        const dbDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        
        // Add wrapper methods for compatibility
        db.isPostgres = false;
        console.log('📦 Using SQLite database');
    }
    return db;
}

/**
 * PostgreSQL client for Vercel
 */
function getPostgresClient() {
    if (!pgPool) {
        const { Pool } = require('pg');
        
        // Use Vercel Postgres connection string
        pgPool = new Pool({
            connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        });
        
        pgPool.isPostgres = true;
        console.log('📦 Using PostgreSQL database');
    }
    return pgPool;
}

/**
 * Execute SQL query (abstraction layer)
 */
async function query(sql, params = []) {
    const database = getDatabase();
    
    if (database.isPostgres) {
        // PostgreSQL - convert ? placeholders to $1, $2, etc.
        let pgSql = sql;
        let paramIndex = 0;
        pgSql = pgSql.replace(/\?/g, () => `$${++paramIndex}`);
        
        const result = await database.query(pgSql, params);
        return result.rows;
    } else {
        // SQLite
        if (sql.trim().toUpperCase().startsWith('SELECT')) {
            return database.prepare(sql).all(...params);
        } else if (sql.trim().toUpperCase().startsWith('INSERT') || 
                   sql.trim().toUpperCase().startsWith('UPDATE') ||
                   sql.trim().toUpperCase().startsWith('DELETE')) {
            return database.prepare(sql).run(...params);
        } else {
            return database.exec(sql);
        }
    }
}

/**
 * Execute single row query
 */
async function queryOne(sql, params = []) {
    const database = getDatabase();
    
    if (database.isPostgres) {
        let pgSql = sql;
        let paramIndex = 0;
        pgSql = pgSql.replace(/\?/g, () => `$${++paramIndex}`);
        
        const result = await database.query(pgSql, params);
        return result.rows[0] || null;
    } else {
        return database.prepare(sql).get(...params);
    }
}

/**
 * Execute statement (INSERT, UPDATE, DELETE)
 */
async function execute(sql, params = []) {
    const database = getDatabase();
    
    if (database.isPostgres) {
        let pgSql = sql;
        let paramIndex = 0;
        pgSql = pgSql.replace(/\?/g, () => `$${++paramIndex}`);
        
        const result = await database.query(pgSql, params);
        return { changes: result.rowCount };
    } else {
        return database.prepare(sql).run(...params);
    }
}

/**
 * Initialize database schema
 */
async function initializeDatabase() {
    if (isInitialized) {
        return;
    }
    
    console.log('🔧 Initializing database...');
    
    if (USE_POSTGRES) {
        await initializePostgres();
    } else {
        await initializeSqlite();
    }
    
    isInitialized = true;
    console.log('✅ Database initialized');
}

/**
 * Initialize PostgreSQL schema
 */
async function initializePostgres() {
    const pool = getDatabase();
    
    // Create tables
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            name TEXT,
            avatar_url TEXT,
            zip_code TEXT,
            country TEXT DEFAULT 'US',
            timezone TEXT DEFAULT 'UTC',
            auth_provider TEXT DEFAULT 'email',
            google_id TEXT UNIQUE,
            email_verified INTEGER DEFAULT 0,
            is_premium INTEGER DEFAULT 0,
            premium_expires_at TEXT,
            referral_code TEXT UNIQUE NOT NULL,
            referred_by TEXT REFERENCES users(id),
            notification_email INTEGER DEFAULT 1,
            notification_push INTEGER DEFAULT 1,
            notification_time TEXT DEFAULT '09:00',
            theme TEXT DEFAULT 'system',
            units TEXT DEFAULT 'metric',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login_at TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            refresh_token TEXT NOT NULL,
            user_agent TEXT,
            ip_address TEXT,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS missions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            category TEXT NOT NULL,
            difficulty TEXT DEFAULT 'easy',
            co2_impact REAL NOT NULL,
            points INTEGER DEFAULT 10,
            icon TEXT,
            tips TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_missions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            mission_id TEXT NOT NULL REFERENCES missions(id),
            assigned_date DATE NOT NULL,
            status TEXT DEFAULT 'pending',
            completed_at TIMESTAMP,
            skipped_at TIMESTAMP,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, assigned_date)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_progress (
            id TEXT PRIMARY KEY,
            user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            total_co2_saved REAL DEFAULT 0,
            total_missions_completed INTEGER DEFAULT 0,
            total_missions_skipped INTEGER DEFAULT 0,
            current_streak INTEGER DEFAULT 0,
            longest_streak INTEGER DEFAULT 0,
            streak_last_date DATE,
            total_points INTEGER DEFAULT 0,
            level INTEGER DEFAULT 1,
            trees_planted INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS progress_log (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            co2_saved REAL DEFAULT 0,
            missions_completed INTEGER DEFAULT 0,
            points_earned INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, date)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS badges (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            icon TEXT NOT NULL,
            category TEXT NOT NULL,
            requirement_type TEXT NOT NULL,
            requirement_value INTEGER NOT NULL,
            points INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_badges (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            badge_id TEXT NOT NULL REFERENCES badges(id),
            earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, badge_id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS referrals (
            id TEXT PRIMARY KEY,
            referrer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            referred_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status TEXT DEFAULT 'pending',
            reward_given INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP,
            UNIQUE(referred_id)
        )
    `);

    // Create indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_referral ON users(referral_code)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_missions_user ON user_missions(user_id)`);
    
    console.log('📦 PostgreSQL schema created');
    
    // Seed data
    await seedPostgresData(pool);
}

/**
 * Initialize SQLite schema
 */
async function initializeSqlite() {
    const db = getDatabase();

    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            name TEXT,
            avatar_url TEXT,
            zip_code TEXT,
            country TEXT DEFAULT 'US',
            timezone TEXT DEFAULT 'UTC',
            auth_provider TEXT DEFAULT 'email',
            google_id TEXT UNIQUE,
            email_verified INTEGER DEFAULT 0,
            is_premium INTEGER DEFAULT 0,
            premium_expires_at TEXT,
            referral_code TEXT UNIQUE NOT NULL,
            referred_by TEXT,
            notification_email INTEGER DEFAULT 1,
            notification_push INTEGER DEFAULT 1,
            notification_time TEXT DEFAULT '09:00',
            theme TEXT DEFAULT 'system',
            units TEXT DEFAULT 'metric',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            last_login_at TEXT,
            FOREIGN KEY (referred_by) REFERENCES users(id)
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            user_agent TEXT,
            ip_address TEXT,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS missions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            category TEXT NOT NULL,
            difficulty TEXT DEFAULT 'easy',
            co2_impact REAL NOT NULL,
            points INTEGER DEFAULT 10,
            icon TEXT,
            tips TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS user_missions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            mission_id TEXT NOT NULL,
            assigned_date TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            completed_at TEXT,
            skipped_at TEXT,
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (mission_id) REFERENCES missions(id),
            UNIQUE(user_id, assigned_date)
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS user_progress (
            id TEXT PRIMARY KEY,
            user_id TEXT UNIQUE NOT NULL,
            total_co2_saved REAL DEFAULT 0,
            total_missions_completed INTEGER DEFAULT 0,
            total_missions_skipped INTEGER DEFAULT 0,
            current_streak INTEGER DEFAULT 0,
            longest_streak INTEGER DEFAULT 0,
            streak_last_date TEXT,
            total_points INTEGER DEFAULT 0,
            level INTEGER DEFAULT 1,
            trees_planted INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS progress_log (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            date TEXT NOT NULL,
            co2_saved REAL DEFAULT 0,
            missions_completed INTEGER DEFAULT 0,
            points_earned INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, date)
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS badges (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            icon TEXT NOT NULL,
            category TEXT NOT NULL,
            requirement_type TEXT NOT NULL,
            requirement_value INTEGER NOT NULL,
            points INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS user_badges (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            badge_id TEXT NOT NULL,
            earned_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (badge_id) REFERENCES badges(id),
            UNIQUE(user_id, badge_id)
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS referrals (
            id TEXT PRIMARY KEY,
            referrer_id TEXT NOT NULL,
            referred_id TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            reward_given INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT,
            FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (referred_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(referred_id)
        )
    `);

    // Create indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_missions_user ON user_missions(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_missions_date ON user_missions(assigned_date)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(refresh_token)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_progress_log_user_date ON progress_log(user_id, date)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id)`);

    console.log('📦 SQLite schema created');
    
    // Seed data
    await seedSqliteData(db);
}

/**
 * Seed PostgreSQL with default data
 */
async function seedPostgresData(pool) {
    // Check if missions exist
    const missionCheck = await pool.query('SELECT COUNT(*) as count FROM missions');
    
    if (parseInt(missionCheck.rows[0].count) === 0) {
        console.log('🌱 Seeding missions...');
        
        const missions = getMissions();
        for (const m of missions) {
            await pool.query(
                `INSERT INTO missions (id, title, description, category, difficulty, co2_impact, points, icon, tips) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (id) DO NOTHING`,
                [m.id, m.title, m.description, m.category, m.difficulty, m.co2_impact, m.points, m.icon, m.tips]
            );
        }
        console.log(`   ✅ Inserted ${missions.length} missions`);
    }

    // Check if badges exist
    const badgeCheck = await pool.query('SELECT COUNT(*) as count FROM badges');
    
    if (parseInt(badgeCheck.rows[0].count) === 0) {
        console.log('🏅 Seeding badges...');
        
        const badges = getBadges();
        for (const b of badges) {
            await pool.query(
                `INSERT INTO badges (id, name, description, icon, category, requirement_type, requirement_value, points)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (id) DO NOTHING`,
                [b.id, b.name, b.description, b.icon, b.category, b.requirement_type, b.requirement_value, b.points]
            );
        }
        console.log(`   ✅ Inserted ${badges.length} badges`);
    }
}

/**
 * Seed SQLite with default data
 */
async function seedSqliteData(db) {
    const missionCount = db.prepare('SELECT COUNT(*) as count FROM missions').get();
    
    if (missionCount.count === 0) {
        console.log('🌱 Seeding missions...');
        
        const missions = getMissions();
        const insertMission = db.prepare(`
            INSERT INTO missions (id, title, description, category, difficulty, co2_impact, points, icon, tips)
            VALUES (@id, @title, @description, @category, @difficulty, @co2_impact, @points, @icon, @tips)
        `);
        
        const insertMany = db.transaction((missions) => {
            for (const mission of missions) {
                insertMission.run(mission);
            }
        });
        
        insertMany(missions);
        console.log(`   ✅ Inserted ${missions.length} missions`);
    }

    const badgeCount = db.prepare('SELECT COUNT(*) as count FROM badges').get();
    
    if (badgeCount.count === 0) {
        console.log('🏅 Seeding badges...');
        
        const badges = getBadges();
        const insertBadge = db.prepare(`
            INSERT INTO badges (id, name, description, icon, category, requirement_type, requirement_value, points)
            VALUES (@id, @name, @description, @icon, @category, @requirement_type, @requirement_value, @points)
        `);
        
        const insertMany = db.transaction((badges) => {
            for (const badge of badges) {
                insertBadge.run(badge);
            }
        });
        
        insertMany(badges);
        console.log(`   ✅ Inserted ${badges.length} badges`);
    }
}

/**
 * Get default missions
 */
function getMissions() {
    return [
        { id: 'm1', title: 'Walk or Bike Today', description: 'Skip the car for at least one trip and walk or bike instead.', category: 'transportation', difficulty: 'easy', co2_impact: 2.5, points: 15, icon: '🚶', tips: 'Start with short trips to the grocery store or coffee shop.' },
        { id: 'm2', title: 'Carpool to Work', description: 'Share your commute with a colleague or neighbor.', category: 'transportation', difficulty: 'medium', co2_impact: 4.0, points: 20, icon: '🚗', tips: 'Use apps like Waze Carpool to find ride-sharing partners.' },
        { id: 'm3', title: 'Take Public Transit', description: 'Use public transportation for your daily commute.', category: 'transportation', difficulty: 'easy', co2_impact: 3.5, points: 15, icon: '🚌', tips: 'Check local transit apps for real-time schedules.' },
        { id: 'm4', title: 'Work From Home', description: 'Skip the commute entirely by working remotely today.', category: 'transportation', difficulty: 'easy', co2_impact: 5.0, points: 25, icon: '🏠', tips: 'Set up a dedicated workspace for productivity.' },
        { id: 'm5', title: 'Unplug Vampire Devices', description: 'Unplug electronics that drain power when not in use.', category: 'energy', difficulty: 'easy', co2_impact: 0.5, points: 10, icon: '🔌', tips: 'Use power strips to easily disconnect multiple devices.' },
        { id: 'm6', title: 'Air Dry Your Clothes', description: 'Skip the dryer and air dry your laundry.', category: 'energy', difficulty: 'easy', co2_impact: 1.5, points: 12, icon: '👕', tips: 'Hang clothes on a drying rack or clothesline.' },
        { id: 'm7', title: 'Thermostat Challenge', description: 'Adjust your thermostat 2°F closer to outdoor temp.', category: 'energy', difficulty: 'medium', co2_impact: 2.0, points: 15, icon: '🌡️', tips: 'Use a programmable thermostat for automatic adjustments.' },
        { id: 'm8', title: 'LED Light Swap', description: 'Replace one traditional bulb with an LED.', category: 'energy', difficulty: 'easy', co2_impact: 0.8, points: 10, icon: '💡', tips: 'LEDs use 75% less energy and last 25x longer.' },
        { id: 'm9', title: 'Meatless Meal', description: 'Enjoy a delicious plant-based meal for dinner.', category: 'food', difficulty: 'easy', co2_impact: 3.0, points: 15, icon: '🥗', tips: 'Try beans, lentils, or tofu as protein alternatives.' },
        { id: 'm10', title: 'Zero Food Waste Day', description: 'Plan meals to use up all ingredients with no waste.', category: 'food', difficulty: 'medium', co2_impact: 2.5, points: 20, icon: '🍽️', tips: 'Freeze leftovers and use vegetable scraps for stock.' },
        { id: 'm11', title: 'Buy Local Produce', description: 'Shop at a farmers market or buy local products.', category: 'food', difficulty: 'easy', co2_impact: 1.5, points: 12, icon: '🥕', tips: 'Local food travels less and supports your community.' },
        { id: 'm12', title: 'Cook From Scratch', description: 'Make a meal from whole ingredients, no processed foods.', category: 'food', difficulty: 'medium', co2_impact: 1.0, points: 15, icon: '👨‍🍳', tips: 'Batch cooking saves time and reduces packaging waste.' },
        { id: 'm13', title: 'Shorter Shower', description: 'Reduce your shower time by 2 minutes.', category: 'water', difficulty: 'easy', co2_impact: 0.8, points: 10, icon: '🚿', tips: 'Set a timer or play a short song to track time.' },
        { id: 'm14', title: 'Full Loads Only', description: 'Only run dishwasher/washer with full loads today.', category: 'water', difficulty: 'easy', co2_impact: 1.2, points: 10, icon: '🧺', tips: 'Wait until you have enough for a full load.' },
        { id: 'm15', title: 'Fix a Leak', description: 'Check for and fix any dripping faucets or leaks.', category: 'water', difficulty: 'medium', co2_impact: 2.0, points: 25, icon: '🔧', tips: 'A dripping faucet wastes 3,000 gallons per year.' },
        { id: 'm16', title: 'Refuse Single-Use Plastic', description: 'Say no to plastic bags, straws, and disposables.', category: 'consumption', difficulty: 'easy', co2_impact: 0.5, points: 10, icon: '♻️', tips: 'Carry reusable bags, bottles, and utensils.' },
        { id: 'm17', title: 'Buy Nothing Day', description: 'Go 24 hours without making any purchases.', category: 'consumption', difficulty: 'medium', co2_impact: 2.0, points: 20, icon: '🛒', tips: 'Use what you already have and appreciate it.' },
        { id: 'm18', title: 'Repair Instead of Replace', description: 'Fix something instead of buying new.', category: 'consumption', difficulty: 'hard', co2_impact: 5.0, points: 30, icon: '🔨', tips: 'YouTube has tutorials for almost any repair.' },
        { id: 'm19', title: 'Digital Declutter', description: 'Delete unused apps, emails, and cloud files.', category: 'consumption', difficulty: 'easy', co2_impact: 0.3, points: 8, icon: '📱', tips: 'Data centers use significant energy to store data.' },
        { id: 'm20', title: 'Secondhand Find', description: 'Buy something used instead of new.', category: 'consumption', difficulty: 'easy', co2_impact: 3.0, points: 15, icon: '🏪', tips: 'Check thrift stores, eBay, or Facebook Marketplace.' },
    ];
}

/**
 * Get default badges
 */
function getBadges() {
    return [
        { id: 'b1', name: 'First Step', description: 'Complete your first mission', icon: '🌱', category: 'milestone', requirement_type: 'missions_completed', requirement_value: 1, points: 10 },
        { id: 'b2', name: '7-Day Streak', description: 'Complete missions 7 days in a row', icon: '🔥', category: 'streak', requirement_type: 'streak', requirement_value: 7, points: 50 },
        { id: 'b3', name: '30-Day Warrior', description: 'Complete missions 30 days in a row', icon: '⚡', category: 'streak', requirement_type: 'streak', requirement_value: 30, points: 200 },
        { id: 'b4', name: 'Century Streak', description: 'Complete missions 100 days in a row', icon: '💯', category: 'streak', requirement_type: 'streak', requirement_value: 100, points: 500 },
        { id: 'b5', name: 'Carbon Cutter', description: 'Save 10kg of CO2', icon: '✂️', category: 'impact', requirement_type: 'co2_saved', requirement_value: 10, points: 25 },
        { id: 'b6', name: 'Eco Warrior L1', description: 'Save 50kg of CO2', icon: '🌿', category: 'impact', requirement_type: 'co2_saved', requirement_value: 50, points: 75 },
        { id: 'b7', name: 'Eco Warrior L2', description: 'Save 100kg of CO2', icon: '🌳', category: 'impact', requirement_type: 'co2_saved', requirement_value: 100, points: 150 },
        { id: 'b8', name: 'Climate Champion', description: 'Save 500kg of CO2', icon: '🏆', category: 'impact', requirement_type: 'co2_saved', requirement_value: 500, points: 500 },
        { id: 'b9', name: 'Planet Protector', description: 'Save 1000kg of CO2', icon: '🌍', category: 'impact', requirement_type: 'co2_saved', requirement_value: 1000, points: 1000 },
        { id: 'b10', name: 'Getting Started', description: 'Complete 10 missions', icon: '📋', category: 'milestone', requirement_type: 'missions_completed', requirement_value: 10, points: 30 },
        { id: 'b11', name: 'Mission Master', description: 'Complete 50 missions', icon: '🎯', category: 'milestone', requirement_type: 'missions_completed', requirement_value: 50, points: 100 },
        { id: 'b12', name: 'Mission Legend', description: 'Complete 100 missions', icon: '⭐', category: 'milestone', requirement_type: 'missions_completed', requirement_value: 100, points: 250 },
        { id: 'b13', name: 'Tree Planter', description: 'Refer your first friend', icon: '🌲', category: 'social', requirement_type: 'referrals', requirement_value: 1, points: 50 },
        { id: 'b14', name: 'Community Builder', description: 'Refer 5 friends', icon: '👥', category: 'social', requirement_type: 'referrals', requirement_value: 5, points: 150 },
        { id: 'b15', name: 'Influencer', description: 'Refer 10 friends', icon: '📣', category: 'social', requirement_type: 'referrals', requirement_value: 10, points: 300 },
        { id: 'b16', name: 'Early Adopter', description: 'Join in the first month', icon: '🚀', category: 'special', requirement_type: 'special', requirement_value: 1, points: 100 },
        { id: 'b17', name: 'Premium Hero', description: 'Subscribe to Premium', icon: '👑', category: 'special', requirement_type: 'premium', requirement_value: 1, points: 50 },
    ];
}

module.exports = { 
    initializeDatabase, 
    getDatabase,
    query,
    queryOne,
    execute,
    USE_POSTGRES
};
