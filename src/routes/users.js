/**
 * User Routes
 * Profile and settings management
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { getDatabase } = require('../database/init');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { validate, rules, body } = require('../middleware/validate');
const { sanitizeUser } = require('../utils/helpers');

/**
 * GET /api/users/profile
 * Get user profile
 */
router.get('/profile', requireAuth, asyncHandler(async (req, res) => {
    const db = getDatabase();
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const progress = db.prepare('SELECT * FROM user_progress WHERE user_id = ?').get(req.user.id);
    
    // Get badge count
    const badgeCount = db.prepare('SELECT COUNT(*) as count FROM user_badges WHERE user_id = ?').get(req.user.id);
    
    // Get referral count
    const referralCount = db.prepare('SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ? AND status = ?').get(req.user.id, 'completed');
    
    res.json({
        user: sanitizeUser(user),
        progress: progress ? {
            totalCO2Saved: progress.total_co2_saved,
            totalMissionsCompleted: progress.total_missions_completed,
            totalMissionsSkipped: progress.total_missions_skipped,
            currentStreak: progress.current_streak,
            longestStreak: progress.longest_streak,
            level: progress.level,
            totalPoints: progress.total_points,
            treesPlanted: progress.trees_planted,
        } : null,
        stats: {
            badgesEarned: badgeCount.count,
            friendsReferred: referralCount.count,
        },
    });
}));

/**
 * PUT /api/users/profile
 * Update user profile
 */
router.put('/profile', requireAuth, [
    rules.name,
    rules.zipCode,
    body('country').optional().isLength({ min: 2, max: 2 }).withMessage('Country must be 2-letter code'),
    body('timezone').optional().isLength({ max: 50 }).withMessage('Invalid timezone'),
    validate,
], asyncHandler(async (req, res) => {
    const { name, zipCode, country, timezone } = req.body;
    const db = getDatabase();
    
    // Build update query dynamically
    const updates = [];
    const values = [];
    
    if (name !== undefined) {
        updates.push('name = ?');
        values.push(name);
    }
    if (zipCode !== undefined) {
        updates.push('zip_code = ?');
        values.push(zipCode);
    }
    if (country !== undefined) {
        updates.push('country = ?');
        values.push(country.toUpperCase());
    }
    if (timezone !== undefined) {
        updates.push('timezone = ?');
        values.push(timezone);
    }
    
    if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.user.id);
    
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    
    res.json({
        message: 'Profile updated',
        user: sanitizeUser(user),
    });
}));

/**
 * PUT /api/users/settings
 * Update user settings
 */
router.put('/settings', requireAuth, [
    rules.notificationEmail,
    rules.notificationPush,
    rules.notificationTime,
    rules.theme,
    rules.units,
    validate,
], asyncHandler(async (req, res) => {
    const { notificationEmail, notificationPush, notificationTime, theme, units } = req.body;
    const db = getDatabase();
    
    const updates = [];
    const values = [];
    
    if (notificationEmail !== undefined) {
        updates.push('notification_email = ?');
        values.push(notificationEmail ? 1 : 0);
    }
    if (notificationPush !== undefined) {
        updates.push('notification_push = ?');
        values.push(notificationPush ? 1 : 0);
    }
    if (notificationTime !== undefined) {
        updates.push('notification_time = ?');
        values.push(notificationTime);
    }
    if (theme !== undefined) {
        updates.push('theme = ?');
        values.push(theme);
    }
    if (units !== undefined) {
        updates.push('units = ?');
        values.push(units);
    }
    
    if (updates.length === 0) {
        return res.status(400).json({ error: 'No settings to update' });
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.user.id);
    
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    
    res.json({
        message: 'Settings updated',
        settings: sanitizeUser(user).settings,
    });
}));

/**
 * PUT /api/users/password
 * Change password
 */
router.put('/password', requireAuth, [
    body('currentPassword').notEmpty().withMessage('Current password required'),
    body('newPassword')
        .isLength({ min: 8 })
        .withMessage('New password must be at least 8 characters'),
    validate,
], asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const db = getDatabase();
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    
    if (!user.password_hash) {
        return res.status(400).json({ error: 'This account uses Google sign-in' });
    }
    
    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!validPassword) {
        return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(newPasswordHash, req.user.id);
    
    res.json({ message: 'Password updated successfully' });
}));

/**
 * DELETE /api/users/account
 * Delete user account
 */
router.delete('/account', requireAuth, [
    body('password').optional(),
    body('confirmDelete').equals('DELETE').withMessage('Please type DELETE to confirm'),
    validate,
], asyncHandler(async (req, res) => {
    const { password } = req.body;
    const db = getDatabase();
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    
    // Verify password if user has one
    if (user.password_hash) {
        if (!password) {
            return res.status(400).json({ error: 'Password required to delete account' });
        }
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Incorrect password' });
        }
    }
    
    // Delete user (cascades to related tables)
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    
    // Clear cookies
    res.clearCookie('token');
    res.clearCookie('refreshToken');
    
    res.json({ message: 'Account deleted successfully' });
}));

module.exports = router;
