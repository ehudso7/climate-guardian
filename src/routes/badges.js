/**
 * Badge Routes
 */

const express = require('express');
const router = express.Router();

const { query, queryOne } = require('../database/init');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * GET /api/badges
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
    const badges = await query(`
        SELECT 
            b.*,
            ub.earned_at,
            CASE WHEN ub.id IS NOT NULL THEN 1 ELSE 0 END as earned
        FROM badges b
        LEFT JOIN user_badges ub ON b.id = ub.badge_id AND ub.user_id = ?
        WHERE b.is_active = 1
        ORDER BY b.category, b.requirement_value
    `, [req.user.id]);
    
    const progress = await queryOne('SELECT * FROM user_progress WHERE user_id = ?', [req.user.id]);
    const referralCount = await queryOne(
        `SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ? AND status = 'completed'`,
        [req.user.id]
    );
    
    const badgesWithProgress = badges.map(badge => {
        let currentProgress = 0;
        switch (badge.requirement_type) {
            case 'missions_completed': currentProgress = progress?.total_missions_completed || 0; break;
            case 'co2_saved': currentProgress = progress?.total_co2_saved || 0; break;
            case 'streak': currentProgress = progress?.longest_streak || 0; break;
            case 'referrals': currentProgress = parseInt(referralCount?.count) || 0; break;
            default: currentProgress = badge.earned ? badge.requirement_value : 0;
        }
        
        return {
            id: badge.id,
            name: badge.name,
            description: badge.description,
            icon: badge.icon,
            category: badge.category,
            points: badge.points,
            requirementType: badge.requirement_type,
            requirementValue: badge.requirement_value,
            earned: badge.earned === 1,
            earnedAt: badge.earned_at,
            progress: {
                current: currentProgress,
                target: badge.requirement_value,
                percentage: Math.min(100, Math.round((currentProgress / badge.requirement_value) * 100)),
            },
        };
    });
    
    const categories = {};
    for (const badge of badgesWithProgress) {
        if (!categories[badge.category]) categories[badge.category] = [];
        categories[badge.category].push(badge);
    }
    
    res.json({
        badges: badgesWithProgress,
        byCategory: categories,
        summary: {
            total: badges.length,
            earned: badges.filter(b => b.earned === 1).length,
            totalPoints: badges.filter(b => b.earned === 1).reduce((sum, b) => sum + b.points, 0),
        },
    });
}));

/**
 * GET /api/badges/earned
 */
router.get('/earned', requireAuth, asyncHandler(async (req, res) => {
    const earnedBadges = await query(`
        SELECT b.*, ub.earned_at
        FROM user_badges ub
        JOIN badges b ON ub.badge_id = b.id
        WHERE ub.user_id = ?
        ORDER BY ub.earned_at DESC
    `, [req.user.id]);
    
    res.json({
        badges: earnedBadges.map(b => ({
            id: b.id,
            name: b.name,
            description: b.description,
            icon: b.icon,
            category: b.category,
            points: b.points,
            earnedAt: b.earned_at,
        })),
        count: earnedBadges.length,
        totalPoints: earnedBadges.reduce((sum, b) => sum + b.points, 0),
    });
}));

/**
 * GET /api/badges/:id
 */
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const badge = await queryOne(`
        SELECT b.*, ub.earned_at, CASE WHEN ub.id IS NOT NULL THEN 1 ELSE 0 END as earned
        FROM badges b
        LEFT JOIN user_badges ub ON b.id = ub.badge_id AND ub.user_id = ?
        WHERE b.id = ?
    `, [req.user.id, id]);
    
    if (!badge) {
        return res.status(404).json({ error: 'Badge not found' });
    }
    
    const earnersCount = await queryOne('SELECT COUNT(*) as count FROM user_badges WHERE badge_id = ?', [id]);
    const totalUsers = await queryOne('SELECT COUNT(*) as count FROM users');
    
    res.json({
        badge: {
            id: badge.id,
            name: badge.name,
            description: badge.description,
            icon: badge.icon,
            category: badge.category,
            points: badge.points,
            requirementType: badge.requirement_type,
            requirementValue: badge.requirement_value,
            earned: badge.earned === 1,
            earnedAt: badge.earned_at,
        },
        rarity: {
            earnersCount: parseInt(earnersCount.count),
            totalUsers: parseInt(totalUsers.count),
            percentage: Math.round((earnersCount.count / totalUsers.count) * 100),
        },
    });
}));

/**
 * POST /api/badges/:id/share
 */
router.post('/:id/share', requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const userBadge = await queryOne('SELECT * FROM user_badges WHERE user_id = ? AND badge_id = ?', [req.user.id, id]);
    
    if (!userBadge) {
        return res.status(403).json({ error: 'You have not earned this badge' });
    }
    
    const badge = await queryOne('SELECT * FROM badges WHERE id = ?', [id]);
    
    res.json({
        success: true,
        shareData: {
            title: `I earned the "${badge.name}" badge!`,
            text: `${badge.icon} I just earned the "${badge.name}" badge on Climate Guardian! ${badge.description}`,
            url: `${process.env.FRONTEND_URL || 'https://climateguardian.ai'}/badges/${id}`,
        },
    });
}));

module.exports = router;
