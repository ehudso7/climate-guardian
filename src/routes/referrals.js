/**
 * Referral Routes
 * Referral system and tracking
 */

const express = require('express');
const router = express.Router();

const { getDatabase } = require('../database/init');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { validate, body } = require('../middleware/validate');

/**
 * GET /api/referrals
 * Get user's referral info
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
    const db = getDatabase();
    
    const user = db.prepare('SELECT referral_code FROM users WHERE id = ?').get(req.user.id);
    const progress = db.prepare('SELECT trees_planted FROM user_progress WHERE user_id = ?').get(req.user.id);
    
    // Get referral stats
    const referralStats = db.prepare(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
        FROM referrals
        WHERE referrer_id = ?
    `).get(req.user.id);
    
    // Get recent referrals
    const recentReferrals = db.prepare(`
        SELECT 
            r.id,
            r.status,
            r.created_at,
            r.completed_at,
            u.name,
            SUBSTR(u.email, 1, 2) || '***' || SUBSTR(u.email, INSTR(u.email, '@')) as email_masked
        FROM referrals r
        JOIN users u ON r.referred_id = u.id
        WHERE r.referrer_id = ?
        ORDER BY r.created_at DESC
        LIMIT 10
    `).all(req.user.id);
    
    const baseUrl = process.env.FRONTEND_URL || 'https://climateguardian.ai';
    
    res.json({
        referralCode: user.referral_code,
        referralLink: `${baseUrl}/join/${user.referral_code}`,
        stats: {
            totalReferrals: referralStats.total || 0,
            completedReferrals: referralStats.completed || 0,
            pendingReferrals: referralStats.pending || 0,
            treesPlanted: progress?.trees_planted || 0,
        },
        recentReferrals: recentReferrals.map(r => ({
            id: r.id,
            name: r.name || 'Climate Hero',
            email: r.email_masked,
            status: r.status,
            createdAt: r.created_at,
            completedAt: r.completed_at,
        })),
        rewards: {
            perReferral: {
                trees: 1,
                description: 'Plant 1 tree for each friend who joins',
            },
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
 * Get detailed referral statistics
 */
router.get('/stats', requireAuth, asyncHandler(async (req, res) => {
    const db = getDatabase();
    
    // Get monthly referral data
    const monthlyStats = db.prepare(`
        SELECT 
            strftime('%Y-%m', created_at) as month,
            COUNT(*) as count
        FROM referrals
        WHERE referrer_id = ? AND created_at >= date('now', '-12 months')
        GROUP BY strftime('%Y-%m', created_at)
        ORDER BY month DESC
    `).all(req.user.id);
    
    // Get referred users' combined impact
    const referredImpact = db.prepare(`
        SELECT 
            COALESCE(SUM(p.total_co2_saved), 0) as total_co2,
            COALESCE(SUM(p.total_missions_completed), 0) as total_missions
        FROM referrals r
        JOIN user_progress p ON r.referred_id = p.user_id
        WHERE r.referrer_id = ? AND r.status = 'completed'
    `).get(req.user.id);
    
    res.json({
        monthlyStats: monthlyStats.map(m => ({
            month: m.month,
            count: m.count,
        })),
        referredImpact: {
            totalCO2Saved: referredImpact.total_co2,
            totalMissionsCompleted: referredImpact.total_missions,
        },
    });
}));

/**
 * POST /api/referrals/validate
 * Validate a referral code
 */
router.post('/validate', [
    body('code').trim().notEmpty().withMessage('Referral code required'),
    validate,
], asyncHandler(async (req, res) => {
    const { code } = req.body;
    const db = getDatabase();
    
    const referrer = db.prepare(`
        SELECT id, name, referral_code FROM users WHERE referral_code = ?
    `).get(code);
    
    if (!referrer) {
        return res.status(404).json({ 
            valid: false,
            error: 'Invalid referral code',
        });
    }
    
    // Get referrer's stats
    const stats = db.prepare(`
        SELECT total_co2_saved, trees_planted FROM user_progress WHERE user_id = ?
    `).get(referrer.id);
    
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
 * Track referral share event
 */
router.post('/share', requireAuth, [
    body('platform').isIn(['twitter', 'facebook', 'linkedin', 'whatsapp', 'email', 'copy']),
    validate,
], asyncHandler(async (req, res) => {
    const { platform } = req.body;
    
    // In production, you'd log this to analytics
    console.log(`Referral share: user=${req.user.id}, platform=${platform}`);
    
    res.json({ 
        success: true,
        message: 'Share tracked',
    });
}));

module.exports = router;
