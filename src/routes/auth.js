/**
 * Authentication Routes
 * Handles signup, login, logout, and token refresh
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { getDatabase } = require('../database/init');
const { generateToken, generateRefreshToken, verifyRefreshToken, requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { validate, rules } = require('../middleware/validate');
const { generateId, generateReferralCode, sanitizeUser, getTodayDate, estimateAnnualSavings } = require('../utils/helpers');

/**
 * POST /api/auth/signup
 * Create a new user account
 */
router.post('/signup', [
    rules.email,
    rules.passwordSimple,
    rules.name,
    rules.zipCode,
    rules.referralCode,
    validate,
], asyncHandler(async (req, res) => {
    const { email, password, name, zipCode, referralCode } = req.body;
    const db = getDatabase();
    
    // Check if user already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existingUser) {
        return res.status(409).json({ error: 'Email already registered' });
    }
    
    // Check referral code if provided
    let referrerId = null;
    if (referralCode) {
        const referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(referralCode);
        if (referrer) {
            referrerId = referrer.id;
        }
    }
    
    // Also check cookie for referral
    if (!referrerId && req.cookies?.referral_code) {
        const referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(req.cookies.referral_code);
        if (referrer) {
            referrerId = referrer.id;
        }
        // Clear the cookie
        res.clearCookie('referral_code');
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Generate user ID and referral code
    const userId = generateId();
    const userReferralCode = generateReferralCode();
    
    // Create user
    const insertUser = db.prepare(`
        INSERT INTO users (id, email, password_hash, name, zip_code, referral_code, referred_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    insertUser.run(userId, email.toLowerCase(), passwordHash, name || null, zipCode || null, userReferralCode, referrerId);
    
    // Initialize user progress
    db.prepare(`
        INSERT INTO user_progress (id, user_id)
        VALUES (?, ?)
    `).run(generateId(), userId);
    
    // Handle referral
    if (referrerId) {
        // Create referral record
        db.prepare(`
            INSERT INTO referrals (id, referrer_id, referred_id, status, created_at)
            VALUES (?, ?, ?, 'completed', CURRENT_TIMESTAMP)
        `).run(generateId(), referrerId, userId);
        
        // Update referrer's tree count
        db.prepare(`
            UPDATE user_progress SET trees_planted = trees_planted + 1 WHERE user_id = ?
        `).run(referrerId);
        
        // Award referral badge if first referral
        const referralCount = db.prepare(`
            SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ? AND status = 'completed'
        `).get(referrerId);
        
        if (referralCount.count === 1) {
            const treePlanterBadge = db.prepare('SELECT id FROM badges WHERE requirement_type = ? AND requirement_value = 1').get('referrals');
            if (treePlanterBadge) {
                db.prepare(`
                    INSERT OR IGNORE INTO user_badges (id, user_id, badge_id)
                    VALUES (?, ?, ?)
                `).run(generateId(), referrerId, treePlanterBadge.id);
            }
        }
    }
    
    // Award early adopter badge
    const earlyAdopterBadge = db.prepare('SELECT id FROM badges WHERE id = ?').get('b16');
    if (earlyAdopterBadge) {
        db.prepare(`
            INSERT OR IGNORE INTO user_badges (id, user_id, badge_id)
            VALUES (?, ?, ?)
        `).run(generateId(), userId, earlyAdopterBadge.id);
    }
    
    // Assign first mission
    const randomMission = db.prepare('SELECT id FROM missions WHERE is_active = 1 ORDER BY RANDOM() LIMIT 1').get();
    if (randomMission) {
        db.prepare(`
            INSERT INTO user_missions (id, user_id, mission_id, assigned_date)
            VALUES (?, ?, ?, ?)
        `).run(generateId(), userId, randomMission.id, getTodayDate());
    }
    
    // Generate tokens
    const token = generateToken(userId);
    const refreshToken = generateRefreshToken(userId);
    
    // Store refresh token in session
    db.prepare(`
        INSERT INTO sessions (id, user_id, refresh_token, user_agent, ip_address, expires_at)
        VALUES (?, ?, ?, ?, ?, datetime('now', '+30 days'))
    `).run(generateId(), userId, refreshToken, req.headers['user-agent'], req.ip);
    
    // Set cookies
    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
    
    // Get created user
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    res.status(201).json({
        message: 'Account created successfully',
        user: sanitizeUser(user),
        token,
        estimatedAnnualSavings: estimateAnnualSavings(zipCode),
    });
}));

/**
 * POST /api/auth/login
 * Login to existing account
 */
router.post('/login', [
    rules.email,
    rules.passwordSimple,
    validate,
], asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const db = getDatabase();
    
    // Find user
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    
    if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Check if user has password (might be OAuth only)
    if (!user.password_hash) {
        return res.status(401).json({ 
            error: 'This account uses Google sign-in',
            code: 'OAUTH_ONLY',
        });
    }
    
    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Update last login
    db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    
    // Generate tokens
    const token = generateToken(user.id);
    const refreshToken = generateRefreshToken(user.id);
    
    // Store refresh token in session
    db.prepare(`
        INSERT INTO sessions (id, user_id, refresh_token, user_agent, ip_address, expires_at)
        VALUES (?, ?, ?, ?, ?, datetime('now', '+30 days'))
    `).run(generateId(), user.id, refreshToken, req.headers['user-agent'], req.ip);
    
    // Set cookies
    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    
    // Get user progress
    const progress = db.prepare('SELECT * FROM user_progress WHERE user_id = ?').get(user.id);
    
    res.json({
        message: 'Login successful',
        user: sanitizeUser(user),
        token,
        progress: progress ? {
            totalCO2Saved: progress.total_co2_saved,
            totalMissionsCompleted: progress.total_missions_completed,
            currentStreak: progress.current_streak,
            longestStreak: progress.longest_streak,
            level: progress.level,
            totalPoints: progress.total_points,
            treesPlanted: progress.trees_planted,
        } : null,
    });
}));

/**
 * POST /api/auth/logout
 * Logout and invalidate tokens
 */
router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
    const db = getDatabase();
    
    // Remove all sessions for user (or just current one based on refresh token)
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
        db.prepare('DELETE FROM sessions WHERE refresh_token = ?').run(refreshToken);
    }
    
    // Clear cookies
    res.clearCookie('token');
    res.clearCookie('refreshToken');
    
    res.json({ message: 'Logged out successfully' });
}));

/**
 * POST /api/auth/refresh
 * Refresh JWT token using refresh token
 */
router.post('/refresh', asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
    
    if (!refreshToken) {
        return res.status(401).json({ error: 'Refresh token required' });
    }
    
    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
        return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    const db = getDatabase();
    
    // Check if session exists
    const session = db.prepare('SELECT * FROM sessions WHERE refresh_token = ? AND expires_at > datetime("now")').get(refreshToken);
    if (!session) {
        return res.status(401).json({ error: 'Session expired' });
    }
    
    // Check if user exists
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
    if (!user) {
        return res.status(401).json({ error: 'User not found' });
    }
    
    // Generate new tokens
    const newToken = generateToken(user.id);
    const newRefreshToken = generateRefreshToken(user.id);
    
    // Update session with new refresh token
    db.prepare('UPDATE sessions SET refresh_token = ?, expires_at = datetime("now", "+30 days") WHERE id = ?')
        .run(newRefreshToken, session.id);
    
    // Set cookies
    res.cookie('token', newToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    
    res.cookie('refreshToken', newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    
    res.json({
        message: 'Token refreshed',
        token: newToken,
    });
}));

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
    const db = getDatabase();
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const progress = db.prepare('SELECT * FROM user_progress WHERE user_id = ?').get(req.user.id);
    
    res.json({
        user: sanitizeUser(user),
        progress: progress ? {
            totalCO2Saved: progress.total_co2_saved,
            totalMissionsCompleted: progress.total_missions_completed,
            currentStreak: progress.current_streak,
            longestStreak: progress.longest_streak,
            level: progress.level,
            totalPoints: progress.total_points,
            treesPlanted: progress.trees_planted,
        } : null,
    });
}));

/**
 * POST /api/auth/google
 * Google OAuth login/signup
 */
router.post('/google', asyncHandler(async (req, res) => {
    const { credential, referralCode } = req.body;
    
    // In production, verify the Google credential token
    // For now, we'll accept a mock payload
    // const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    // const payload = ticket.getPayload();
    
    // Mock: Extract data from credential (in production, this comes from verified Google token)
    // For demo purposes, accept name and email directly
    const { email, name, googleId, picture } = req.body;
    
    if (!email || !googleId) {
        return res.status(400).json({ error: 'Invalid Google credential' });
    }
    
    const db = getDatabase();
    
    // Check if user exists with this Google ID
    let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
    
    if (!user) {
        // Check if email is already registered
        user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
        
        if (user) {
            // Link Google account to existing user
            db.prepare('UPDATE users SET google_id = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?')
                .run(googleId, picture, user.id);
        } else {
            // Create new user
            const userId = generateId();
            const userReferralCode = generateReferralCode();
            
            // Check referral code
            let referrerId = null;
            if (referralCode) {
                const referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(referralCode);
                if (referrer) referrerId = referrer.id;
            }
            
            db.prepare(`
                INSERT INTO users (id, email, name, avatar_url, google_id, auth_provider, referral_code, referred_by, email_verified)
                VALUES (?, ?, ?, ?, ?, 'google', ?, ?, 1)
            `).run(userId, email.toLowerCase(), name, picture, googleId, userReferralCode, referrerId);
            
            // Initialize progress
            db.prepare('INSERT INTO user_progress (id, user_id) VALUES (?, ?)').run(generateId(), userId);
            
            // Handle referral
            if (referrerId) {
                db.prepare(`
                    INSERT INTO referrals (id, referrer_id, referred_id, status)
                    VALUES (?, ?, ?, 'completed')
                `).run(generateId(), referrerId, userId);
                
                db.prepare('UPDATE user_progress SET trees_planted = trees_planted + 1 WHERE user_id = ?').run(referrerId);
            }
            
            // Assign first mission
            const randomMission = db.prepare('SELECT id FROM missions WHERE is_active = 1 ORDER BY RANDOM() LIMIT 1').get();
            if (randomMission) {
                db.prepare(`
                    INSERT INTO user_missions (id, user_id, mission_id, assigned_date)
                    VALUES (?, ?, ?, ?)
                `).run(generateId(), userId, randomMission.id, getTodayDate());
            }
            
            user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        }
    }
    
    // Update last login
    db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    
    // Generate tokens
    const token = generateToken(user.id);
    const refreshToken = generateRefreshToken(user.id);
    
    // Store session
    db.prepare(`
        INSERT INTO sessions (id, user_id, refresh_token, user_agent, ip_address, expires_at)
        VALUES (?, ?, ?, ?, ?, datetime('now', '+30 days'))
    `).run(generateId(), user.id, refreshToken, req.headers['user-agent'], req.ip);
    
    // Set cookies
    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    
    res.json({
        message: 'Google login successful',
        user: sanitizeUser(user),
        token,
    });
}));

module.exports = router;
