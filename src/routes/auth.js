/**
 * Authentication Routes
 * Handles signup, login, logout, and token refresh
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { getDatabase, query, queryOne, execute, USE_POSTGRES } = require('../database/init');
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
    
    // Check if user already exists
    const existingUser = await queryOne('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existingUser) {
        return res.status(409).json({ error: 'Email already registered' });
    }
    
    // Check referral code if provided
    let referrerId = null;
    if (referralCode) {
        const referrer = await queryOne('SELECT id FROM users WHERE referral_code = ?', [referralCode]);
        if (referrer) {
            referrerId = referrer.id;
        }
    }
    
    // Also check cookie for referral
    if (!referrerId && req.cookies?.referral_code) {
        const referrer = await queryOne('SELECT id FROM users WHERE referral_code = ?', [req.cookies.referral_code]);
        if (referrer) {
            referrerId = referrer.id;
        }
        res.clearCookie('referral_code');
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Generate user ID and referral code
    const userId = generateId();
    const userReferralCode = generateReferralCode();
    
    // Create user
    await execute(
        `INSERT INTO users (id, email, password_hash, name, zip_code, referral_code, referred_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, email.toLowerCase(), passwordHash, name || null, zipCode || null, userReferralCode, referrerId]
    );
    
    // Initialize user progress
    await execute(
        `INSERT INTO user_progress (id, user_id) VALUES (?, ?)`,
        [generateId(), userId]
    );
    
    // Handle referral
    if (referrerId) {
        await execute(
            `INSERT INTO referrals (id, referrer_id, referred_id, status, created_at)
             VALUES (?, ?, ?, 'completed', ${USE_POSTGRES ? 'CURRENT_TIMESTAMP' : 'CURRENT_TIMESTAMP'})`,
            [generateId(), referrerId, userId]
        );
        
        await execute(
            `UPDATE user_progress SET trees_planted = trees_planted + 1 WHERE user_id = ?`,
            [referrerId]
        );
        
        // Award referral badge if first referral
        const referralCount = await queryOne(
            `SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ? AND status = 'completed'`,
            [referrerId]
        );
        
        if (parseInt(referralCount.count) === 1) {
            const treePlanterBadge = await queryOne(
                `SELECT id FROM badges WHERE requirement_type = ? AND requirement_value = 1`,
                ['referrals']
            );
            if (treePlanterBadge) {
                await execute(
                    `INSERT INTO user_badges (id, user_id, badge_id) VALUES (?, ?, ?)
                     ON CONFLICT (user_id, badge_id) DO NOTHING`,
                    [generateId(), referrerId, treePlanterBadge.id]
                );
            }
        }
    }
    
    // Award early adopter badge
    await execute(
        `INSERT INTO user_badges (id, user_id, badge_id) VALUES (?, ?, ?)
         ON CONFLICT (user_id, badge_id) DO NOTHING`,
        [generateId(), userId, 'b16']
    );
    
    // Assign first mission
    const randomMission = await queryOne(
        `SELECT id FROM missions WHERE is_active = 1 ORDER BY RANDOM() LIMIT 1`
    );
    if (randomMission) {
        await execute(
            `INSERT INTO user_missions (id, user_id, mission_id, assigned_date)
             VALUES (?, ?, ?, ?)`,
            [generateId(), userId, randomMission.id, getTodayDate()]
        );
    }
    
    // Generate tokens
    const token = generateToken(userId);
    const refreshToken = generateRefreshToken(userId);
    
    // Store refresh token in session
    const expiresAt = USE_POSTGRES 
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        : "datetime('now', '+30 days')";
    
    await execute(
        `INSERT INTO sessions (id, user_id, refresh_token, user_agent, ip_address, expires_at)
         VALUES (?, ?, ?, ?, ?, ${USE_POSTGRES ? '$6' : "datetime('now', '+30 days')"})`,
        USE_POSTGRES 
            ? [generateId(), userId, refreshToken, req.headers['user-agent'], req.ip, expiresAt]
            : [generateId(), userId, refreshToken, req.headers['user-agent'], req.ip]
    );
    
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
    
    // Get created user
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    
    res.status(201).json({
        message: 'Account created successfully',
        user: sanitizeUser(user),
        token,
        estimatedAnnualSavings: estimateAnnualSavings(zipCode),
    });
}));

/**
 * POST /api/auth/login
 */
router.post('/login', [
    rules.email,
    rules.passwordSimple,
    validate,
], asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    
    const user = await queryOne('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    
    if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    if (!user.password_hash) {
        return res.status(401).json({ 
            error: 'This account uses Google sign-in',
            code: 'OAUTH_ONLY',
        });
    }
    
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Update last login
    await execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    
    // Generate tokens
    const token = generateToken(user.id);
    const refreshToken = generateRefreshToken(user.id);
    
    // Store session
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await execute(
        `INSERT INTO sessions (id, user_id, refresh_token, user_agent, ip_address, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [generateId(), user.id, refreshToken, req.headers['user-agent'], req.ip, expiresAt]
    );
    
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
    
    const progress = await queryOne('SELECT * FROM user_progress WHERE user_id = ?', [user.id]);
    
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
 */
router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
        await execute('DELETE FROM sessions WHERE refresh_token = ?', [refreshToken]);
    }
    
    res.clearCookie('token');
    res.clearCookie('refreshToken');
    
    res.json({ message: 'Logged out successfully' });
}));

/**
 * POST /api/auth/refresh
 */
router.post('/refresh', asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
    
    if (!refreshToken) {
        return res.status(401).json({ error: 'Refresh token required' });
    }
    
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
        return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    const session = await queryOne(
        `SELECT * FROM sessions WHERE refresh_token = ? AND expires_at > ${USE_POSTGRES ? 'CURRENT_TIMESTAMP' : "datetime('now')"}`,
        [refreshToken]
    );
    if (!session) {
        return res.status(401).json({ error: 'Session expired' });
    }
    
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [decoded.userId]);
    if (!user) {
        return res.status(401).json({ error: 'User not found' });
    }
    
    const newToken = generateToken(user.id);
    const newRefreshToken = generateRefreshToken(user.id);
    
    const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await execute(
        `UPDATE sessions SET refresh_token = ?, expires_at = ? WHERE id = ?`,
        [newRefreshToken, newExpiry, session.id]
    );
    
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
    
    res.json({ message: 'Token refreshed', token: newToken });
}));

/**
 * GET /api/auth/me
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const progress = await queryOne('SELECT * FROM user_progress WHERE user_id = ?', [req.user.id]);
    
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
 */
router.post('/google', asyncHandler(async (req, res) => {
    const { email, name, googleId, picture, referralCode } = req.body;
    
    if (!email || !googleId) {
        return res.status(400).json({ error: 'Invalid Google credential' });
    }
    
    let user = await queryOne('SELECT * FROM users WHERE google_id = ?', [googleId]);
    
    if (!user) {
        user = await queryOne('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
        
        if (user) {
            await execute(
                'UPDATE users SET google_id = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?',
                [googleId, picture, user.id]
            );
        } else {
            const userId = generateId();
            const userReferralCode = generateReferralCode();
            
            let referrerId = null;
            if (referralCode) {
                const referrer = await queryOne('SELECT id FROM users WHERE referral_code = ?', [referralCode]);
                if (referrer) referrerId = referrer.id;
            }
            
            await execute(
                `INSERT INTO users (id, email, name, avatar_url, google_id, auth_provider, referral_code, referred_by, email_verified)
                 VALUES (?, ?, ?, ?, ?, 'google', ?, ?, 1)`,
                [userId, email.toLowerCase(), name, picture, googleId, userReferralCode, referrerId]
            );
            
            await execute('INSERT INTO user_progress (id, user_id) VALUES (?, ?)', [generateId(), userId]);
            
            if (referrerId) {
                await execute(
                    `INSERT INTO referrals (id, referrer_id, referred_id, status) VALUES (?, ?, ?, 'completed')`,
                    [generateId(), referrerId, userId]
                );
                await execute('UPDATE user_progress SET trees_planted = trees_planted + 1 WHERE user_id = ?', [referrerId]);
            }
            
            const randomMission = await queryOne('SELECT id FROM missions WHERE is_active = 1 ORDER BY RANDOM() LIMIT 1');
            if (randomMission) {
                await execute(
                    `INSERT INTO user_missions (id, user_id, mission_id, assigned_date) VALUES (?, ?, ?, ?)`,
                    [generateId(), userId, randomMission.id, getTodayDate()]
                );
            }
            
            user = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        }
    }
    
    await execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    
    const token = generateToken(user.id);
    const refreshToken = generateRefreshToken(user.id);
    
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await execute(
        `INSERT INTO sessions (id, user_id, refresh_token, user_agent, ip_address, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [generateId(), user.id, refreshToken, req.headers['user-agent'], req.ip, expiresAt]
    );
    
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
