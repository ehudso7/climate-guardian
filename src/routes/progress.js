/**
 * Progress Routes
 * User progress, stats, and leaderboard
 */

const express = require('express');
const router = express.Router();

const { getDatabase } = require('../database/init');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { validate, rules, query } = require('../middleware/validate');
const { pointsForNextLevel, formatCO2 } = require('../utils/helpers');

/**
 * GET /api/progress
 * Get user's progress summary
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
    const db = getDatabase();
    
    const progress = db.prepare('SELECT * FROM user_progress WHERE user_id = ?').get(req.user.id);
    
    if (!progress) {
        return res.status(404).json({ error: 'Progress not found' });
    }
    
    const nextLevelPoints = pointsForNextLevel(progress.level);
    const currentLevelPoints = pointsForNextLevel(progress.level - 1);
    const pointsInCurrentLevel = progress.total_points - currentLevelPoints;
    const pointsNeededForLevel = nextLevelPoints - currentLevelPoints;
    
    res.json({
        progress: {
            totalCO2Saved: progress.total_co2_saved,
            totalCO2SavedFormatted: formatCO2(progress.total_co2_saved),
            totalMissionsCompleted: progress.total_missions_completed,
            totalMissionsSkipped: progress.total_missions_skipped,
            completionRate: progress.total_missions_completed + progress.total_missions_skipped > 0
                ? Math.round((progress.total_missions_completed / (progress.total_missions_completed + progress.total_missions_skipped)) * 100)
                : 0,
            currentStreak: progress.current_streak,
            longestStreak: progress.longest_streak,
            streakLastDate: progress.streak_last_date,
            level: progress.level,
            totalPoints: progress.total_points,
            treesPlanted: progress.trees_planted,
            levelProgress: {
                current: pointsInCurrentLevel,
                needed: pointsNeededForLevel,
                percentage: Math.round((pointsInCurrentLevel / pointsNeededForLevel) * 100),
                nextLevel: progress.level + 1,
            },
        },
    });
}));

/**
 * GET /api/progress/stats
 * Get detailed statistics
 */
router.get('/stats', requireAuth, [
    query('period').optional().isIn(['week', 'month', 'year', 'all']),
    validate,
], asyncHandler(async (req, res) => {
    const { period = 'month' } = req.query;
    const db = getDatabase();
    
    // Calculate date range
    let dateCondition = '';
    switch (period) {
        case 'week':
            dateCondition = "AND date >= date('now', '-7 days')";
            break;
        case 'month':
            dateCondition = "AND date >= date('now', '-30 days')";
            break;
        case 'year':
            dateCondition = "AND date >= date('now', '-365 days')";
            break;
        default:
            dateCondition = '';
    }
    
    // Get daily stats
    const dailyStats = db.prepare(`
        SELECT date, co2_saved, missions_completed, points_earned
        FROM progress_log
        WHERE user_id = ? ${dateCondition}
        ORDER BY date DESC
    `).all(req.user.id);
    
    // Get category breakdown
    const categoryStats = db.prepare(`
        SELECT m.category, 
            COUNT(*) as count,
            SUM(m.co2_impact) as co2_saved,
            SUM(m.points) as points
        FROM user_missions um
        JOIN missions m ON um.mission_id = m.id
        WHERE um.user_id = ? AND um.status = 'completed' ${dateCondition.replace('date', 'um.assigned_date')}
        GROUP BY m.category
        ORDER BY co2_saved DESC
    `).all(req.user.id);
    
    // Calculate totals for period
    const periodTotals = db.prepare(`
        SELECT 
            COALESCE(SUM(co2_saved), 0) as total_co2,
            COALESCE(SUM(missions_completed), 0) as total_missions,
            COALESCE(SUM(points_earned), 0) as total_points
        FROM progress_log
        WHERE user_id = ? ${dateCondition}
    `).get(req.user.id);
    
    // Get streaks info
    const progress = db.prepare('SELECT * FROM user_progress WHERE user_id = ?').get(req.user.id);
    
    // Calculate equivalents
    const co2Saved = periodTotals.total_co2;
    const equivalents = {
        treesAbsorbed: Math.round(co2Saved / 21), // Average tree absorbs 21kg CO2/year
        carMiles: Math.round(co2Saved / 0.411), // Average car emits 411g CO2/mile
        flightMiles: Math.round(co2Saved / 0.255), // Average flight emits 255g CO2/mile
        smartphoneCharges: Math.round(co2Saved / 0.008), // ~8g CO2 per charge
    };
    
    res.json({
        period,
        summary: {
            totalCO2Saved: periodTotals.total_co2,
            totalCO2SavedFormatted: formatCO2(periodTotals.total_co2),
            totalMissionsCompleted: periodTotals.total_missions,
            totalPointsEarned: periodTotals.total_points,
        },
        equivalents,
        dailyStats: dailyStats.map(d => ({
            date: d.date,
            co2Saved: d.co2_saved,
            missionsCompleted: d.missions_completed,
            pointsEarned: d.points_earned,
        })),
        categoryBreakdown: categoryStats.map(c => ({
            category: c.category,
            count: c.count,
            co2Saved: c.co2_saved,
            points: c.points,
        })),
        streaks: {
            current: progress.current_streak,
            longest: progress.longest_streak,
            lastDate: progress.streak_last_date,
        },
    });
}));

/**
 * GET /api/progress/leaderboard
 * Get global leaderboard
 */
router.get('/leaderboard', requireAuth, [
    query('type').optional().isIn(['co2', 'points', 'streak', 'missions']),
    query('period').optional().isIn(['week', 'month', 'all']),
    rules.limit,
    validate,
], asyncHandler(async (req, res) => {
    const { type = 'co2', period = 'all', limit = 20 } = req.query;
    const db = getDatabase();
    
    let orderBy;
    switch (type) {
        case 'points':
            orderBy = 'p.total_points DESC';
            break;
        case 'streak':
            orderBy = 'p.longest_streak DESC';
            break;
        case 'missions':
            orderBy = 'p.total_missions_completed DESC';
            break;
        default:
            orderBy = 'p.total_co2_saved DESC';
    }
    
    // Get top users
    const leaderboard = db.prepare(`
        SELECT 
            u.id,
            u.name,
            SUBSTR(u.email, 1, 1) || '***' || SUBSTR(u.email, INSTR(u.email, '@')) as email_masked,
            p.total_co2_saved,
            p.total_points,
            p.longest_streak,
            p.total_missions_completed,
            p.level
        FROM user_progress p
        JOIN users u ON p.user_id = u.id
        ORDER BY ${orderBy}
        LIMIT ?
    `).all(limit);
    
    // Get current user's rank
    const userRank = db.prepare(`
        SELECT COUNT(*) + 1 as rank
        FROM user_progress
        WHERE ${type === 'points' ? 'total_points' : type === 'streak' ? 'longest_streak' : type === 'missions' ? 'total_missions_completed' : 'total_co2_saved'} > (
            SELECT ${type === 'points' ? 'total_points' : type === 'streak' ? 'longest_streak' : type === 'missions' ? 'total_missions_completed' : 'total_co2_saved'}
            FROM user_progress WHERE user_id = ?
        )
    `).get(req.user.id);
    
    // Get total users
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
    
    res.json({
        type,
        period,
        leaderboard: leaderboard.map((user, index) => ({
            rank: index + 1,
            name: user.name || 'Climate Hero',
            email: user.email_masked,
            co2Saved: user.total_co2_saved,
            co2SavedFormatted: formatCO2(user.total_co2_saved),
            points: user.total_points,
            longestStreak: user.longest_streak,
            missionsCompleted: user.total_missions_completed,
            level: user.level,
            isCurrentUser: user.id === req.user.id,
        })),
        currentUser: {
            rank: userRank.rank,
            totalUsers: totalUsers.count,
            percentile: Math.round((1 - (userRank.rank / totalUsers.count)) * 100),
        },
    });
}));

/**
 * GET /api/progress/achievements
 * Get achievement summary
 */
router.get('/achievements', requireAuth, asyncHandler(async (req, res) => {
    const db = getDatabase();
    
    const progress = db.prepare('SELECT * FROM user_progress WHERE user_id = ?').get(req.user.id);
    const earnedBadges = db.prepare(`
        SELECT b.*, ub.earned_at
        FROM user_badges ub
        JOIN badges b ON ub.badge_id = b.id
        WHERE ub.user_id = ?
        ORDER BY ub.earned_at DESC
    `).all(req.user.id);
    
    const totalBadges = db.prepare('SELECT COUNT(*) as count FROM badges WHERE is_active = 1').get();
    
    // Calculate milestones
    const milestones = [
        { name: 'First Mission', target: 1, current: progress.total_missions_completed, type: 'missions', icon: '🌱' },
        { name: '10 Missions', target: 10, current: progress.total_missions_completed, type: 'missions', icon: '📋' },
        { name: '50 Missions', target: 50, current: progress.total_missions_completed, type: 'missions', icon: '🎯' },
        { name: '100 Missions', target: 100, current: progress.total_missions_completed, type: 'missions', icon: '⭐' },
        { name: '10kg CO2 Saved', target: 10, current: progress.total_co2_saved, type: 'co2', icon: '✂️' },
        { name: '100kg CO2 Saved', target: 100, current: progress.total_co2_saved, type: 'co2', icon: '🌳' },
        { name: '500kg CO2 Saved', target: 500, current: progress.total_co2_saved, type: 'co2', icon: '🏆' },
        { name: '7-Day Streak', target: 7, current: progress.longest_streak, type: 'streak', icon: '🔥' },
        { name: '30-Day Streak', target: 30, current: progress.longest_streak, type: 'streak', icon: '⚡' },
        { name: 'Level 5', target: 5, current: progress.level, type: 'level', icon: '🎖️' },
        { name: 'Level 10', target: 10, current: progress.level, type: 'level', icon: '👑' },
    ];
    
    res.json({
        badges: {
            earned: earnedBadges.map(b => ({
                id: b.id,
                name: b.name,
                description: b.description,
                icon: b.icon,
                category: b.category,
                points: b.points,
                earnedAt: b.earned_at,
            })),
            total: totalBadges.count,
            percentage: Math.round((earnedBadges.length / totalBadges.count) * 100),
        },
        milestones: milestones.map(m => ({
            ...m,
            completed: m.current >= m.target,
            progress: Math.min(100, Math.round((m.current / m.target) * 100)),
        })),
        level: {
            current: progress.level,
            points: progress.total_points,
            nextLevelAt: pointsForNextLevel(progress.level),
        },
    });
}));

module.exports = router;
