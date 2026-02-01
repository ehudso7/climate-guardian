/**
 * Referral Routes
 */

const express = require('express');
const router = express.Router();

const { query, queryOne } = require('../database/init');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { validate, body } = require('../middleware/validate');

/**
 * GET /api/referrals
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
    const user = await queryOne('SELECT referral_code FROM users WHERE id = ?', [req.user.id]);
    const progress = await queryOne('SELECT trees_planted FROM user_progress WHERE user_id = ?', [req.user.id]);
    
    const referralStats = await queryOne(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
        FROM referrals WHERE referrer_id = ?
    `, [req.user.id]);
    
    const recentReferrals = await query(`
        SELECT r.id, r.status, r.created_at, r.completed_at, u.name, u.email
        FROM referrals r
        JOIN users u ON r.referred_id = u.id
        WHERE r.referrer_id = ?
        ORDER BY r.created_at DESC LIMIT 10
    `, [req.user.id]);
    
    const baseUrl = process.env.FRONTEND_URL || 'https://climateguardian.ai';
    
    res.json({
        referralCode: user.referral_code,
        referralLink: `${baseUrl}/join/${user.referral_code}`,
        stats: {
            totalReferrals: parseInt(referralStats.total) || 0,
            completedReferrals: parseInt(referralStats.completed) || 0,
            pendingReferrals: parseInt(referralStats.pending) || 0,
            treesPlanted: progress?.trees_planted || 0,
        },
        recentReferrals: recentReferrals.map(r => ({
            id: r.id,
            name: r.name || 'Climate Hero',
            email: r.email.substring(0, 2) + '***' + r.email.substring(r.email.indexOf('@')),
            status: r.status,
            createdAt: r.created_at,
            completedAt: r.completed_at,
        })),
        rewards: {
            perReferral: { trees: 1, description: 'Plant 1 tree for each friend who joins' },
            milestones: [
                { referrals: 1, reward: 'Tree Planter Badge', icon: '🌲' },
                { referrals: 5, reward: 'Community Builder Badge + 1 Month Premium', icon: '👥' },
                { referrals: 10, reward: 'Influencer Badge + 3 Months Premium', icon: '📣' },
                { referrals: 25, reward: 'Ambassador Status + 1 Year Premium', icon: '🌟' },
            ],
        },
    });
}));

/**
 * GET /api/referrals/stats
 */
router.get('/stats', requireAuth, asyncHandler(async (req, res) => {
    const monthlyStats = await query(`
        SELECT 
            ${process.env.USE_POSTGRES ? "TO_CHAR(created_at, 'YYYY-MM')" : "strftime('%Y-%m', created_at)"} as month,
            COUNT(*) as count
        FROM referrals
        WHERE referrer_id = ? AND created_at >= ${process.env.USE_POSTGRES ? "CURRENT_DATE - INTERVAL '12 months'" : "date('now', '-12 months')"}
        GROUP BY month ORDER BY month DESC
    `, [req.user.id]);
    
    const referredImpact = await queryOne(`
        SELECT 
            COALESCE(SUM(p.total_co2_saved), 0) as total_co2,
            COALESCE(SUM(p.total_missions_completed), 0) as total_missions
        FROM referrals r
        JOIN user_progress p ON r.referred_id = p.user_id
        WHERE r.referrer_id = ? AND r.status = 'completed'
    `, [req.user.id]);
    
    res.json({
        monthlyStats: monthlyStats.map(m => ({ month: m.month, count: parseInt(m.count) })),
        referredImpact: {
            totalCO2Saved: parseFloat(referredImpact.total_co2) || 0,
            totalMissionsCompleted: parseInt(referredImpact.total_missions) || 0,
        },
    });
}));

/**
 * POST /api/referrals/validate
 */
router.post('/validate', [
    body('code').trim().notEmpty(),
    validate,
], asyncHandler(async (req, res) => {
    const { code } = req.body;
    
    const referrer = await queryOne('SELECT id, name, referral_code FROM users WHERE referral_code = ?', [code]);
    
    if (!referrer) {
        return res.status(404).json({ valid: false, error: 'Invalid referral code' });
    }
    
    const stats = await queryOne('SELECT total_co2_saved, trees_planted FROM user_progress WHERE user_id = ?', [referrer.id]);
    
    res.json({
        valid: true,
        referrer: {
            name: referrer.name || 'Climate Hero',
            treesPlanted: stats?.trees_planted || 0,
            co2Saved: stats?.total_co2_saved || 0,
        },
        message: `Join ${referrer.name || 'your friend'} in saving the planet! A tree will be planted when you sign up.`,
    });
}));

/**
 * POST /api/referrals/share
 */
router.post('/share', requireAuth, [
    body('platform').isIn(['twitter', 'facebook', 'linkedin', 'whatsapp', 'email', 'copy']),
    validate,
], asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'Share tracked' });
}));

module.exports = router;
