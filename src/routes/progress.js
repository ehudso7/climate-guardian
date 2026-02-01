/**
 * Progress Routes
 */

const express = require('express');
const router = express.Router();

const { query, queryOne, USE_POSTGRES } = require('../database/init');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { validate, rules } = require('../middleware/validate');
const { pointsForNextLevel, formatCO2 } = require('../utils/helpers');

/**
 * GET /api/progress
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
    const progress = await queryOne('SELECT * FROM user_progress WHERE user_id = ?', [req.user.id]);
    
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
 */
router.get('/stats', requireAuth, asyncHandler(async (req, res) => {
    const { period = 'month' } = req.query;
    
    let dateFilter;
    const now = new Date();
    switch (period) {
        case 'week':
            dateFilter = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            break;
        case 'month':
            dateFilter = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            break;
        case 'year':
            dateFilter = new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            break;
        default:
            dateFilter = null;
    }
    
    let dailyQuery = `
        SELECT date, co2_saved, missions_completed, points_earned
        FROM progress_log WHERE user_id = ?
    `;
    const dailyParams = [req.user.id];
    if (dateFilter) {
        dailyQuery += ' AND date >= ?';
        dailyParams.push(dateFilter);
    }
    dailyQuery += ' ORDER BY date DESC';
    
    const dailyStats = await query(dailyQuery, dailyParams);
    
    let categoryQuery = `
        SELECT m.category, 
            COUNT(*) as count,
            SUM(m.co2_impact) as co2_saved,
            SUM(m.points) as points
        FROM user_missions um
        JOIN missions m ON um.mission_id = m.id
        WHERE um.user_id = ? AND um.status = 'completed'
    `;
    const categoryParams = [req.user.id];
    if (dateFilter) {
        categoryQuery += ' AND um.assigned_date >= ?';
        categoryParams.push(dateFilter);
    }
    categoryQuery += ' GROUP BY m.category ORDER BY co2_saved DESC';
    
    const categoryStats = await query(categoryQuery, categoryParams);
    
    let totalsQuery = `
        SELECT 
            COALESCE(SUM(co2_saved), 0) as total_co2,
            COALESCE(SUM(missions_completed), 0) as total_missions,
            COALESCE(SUM(points_earned), 0) as total_points
        FROM progress_log WHERE user_id = ?
    `;
    const totalsParams = [req.user.id];
    if (dateFilter) {
        totalsQuery += ' AND date >= ?';
        totalsParams.push(dateFilter);
    }
    
    const periodTotals = await queryOne(totalsQuery, totalsParams);
    const progress = await queryOne('SELECT * FROM user_progress WHERE user_id = ?', [req.user.id]);
    
    const co2Saved = parseFloat(periodTotals.total_co2) || 0;
    const equivalents = {
        treesAbsorbed: Math.round(co2Saved / 21),
        carMiles: Math.round(co2Saved / 0.411),
        flightMiles: Math.round(co2Saved / 0.255),
        smartphoneCharges: Math.round(co2Saved / 0.008),
    };
    
    res.json({
        period,
        summary: {
            totalCO2Saved: co2Saved,
            totalCO2SavedFormatted: formatCO2(co2Saved),
            totalMissionsCompleted: parseInt(periodTotals.total_missions) || 0,
            totalPointsEarned: parseInt(periodTotals.total_points) || 0,
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
            count: parseInt(c.count),
            co2Saved: parseFloat(c.co2_saved) || 0,
            points: parseInt(c.points) || 0,
        })),
        streaks: {
            current: progress?.current_streak || 0,
            longest: progress?.longest_streak || 0,
            lastDate: progress?.streak_last_date,
        },
    });
}));

/**
 * GET /api/progress/leaderboard
 */
router.get('/leaderboard', requireAuth, asyncHandler(async (req, res) => {
    const { type = 'co2', limit = 20 } = req.query;
    
    let orderBy;
    switch (type) {
        case 'points': orderBy = 'p.total_points DESC'; break;
        case 'streak': orderBy = 'p.longest_streak DESC'; break;
        case 'missions': orderBy = 'p.total_missions_completed DESC'; break;
        default: orderBy = 'p.total_co2_saved DESC';
    }
    
    const leaderboard = await query(`
        SELECT 
            u.id,
            u.name,
            u.email,
            p.total_co2_saved,
            p.total_points,
            p.longest_streak,
            p.total_missions_completed,
            p.level
        FROM user_progress p
        JOIN users u ON p.user_id = u.id
        ORDER BY ${orderBy}
        LIMIT ?
    `, [parseInt(limit)]);
    
    const field = type === 'points' ? 'total_points' : type === 'streak' ? 'longest_streak' : type === 'missions' ? 'total_missions_completed' : 'total_co2_saved';
    const userProgress = await queryOne(`SELECT ${field} as value FROM user_progress WHERE user_id = ?`, [req.user.id]);
    const rankResult = await queryOne(`SELECT COUNT(*) + 1 as rank FROM user_progress WHERE ${field} > ?`, [userProgress?.value || 0]);
    const totalUsers = await queryOne('SELECT COUNT(*) as count FROM users');
    
    res.json({
        type,
        leaderboard: leaderboard.map((user, index) => ({
            rank: index + 1,
            name: user.name || 'Climate Hero',
            email: user.email.substring(0, 2) + '***' + user.email.substring(user.email.indexOf('@')),
            co2Saved: user.total_co2_saved,
            co2SavedFormatted: formatCO2(user.total_co2_saved),
            points: user.total_points,
            longestStreak: user.longest_streak,
            missionsCompleted: user.total_missions_completed,
            level: user.level,
            isCurrentUser: user.id === req.user.id,
        })),
        currentUser: {
            rank: parseInt(rankResult.rank),
            totalUsers: parseInt(totalUsers.count),
            percentile: Math.round((1 - (rankResult.rank / totalUsers.count)) * 100),
        },
    });
}));

/**
 * GET /api/progress/achievements
 */
router.get('/achievements', requireAuth, asyncHandler(async (req, res) => {
    const progress = await queryOne('SELECT * FROM user_progress WHERE user_id = ?', [req.user.id]);
    const earnedBadges = await query(`
        SELECT b.*, ub.earned_at
        FROM user_badges ub
        JOIN badges b ON ub.badge_id = b.id
        WHERE ub.user_id = ?
        ORDER BY ub.earned_at DESC
    `, [req.user.id]);
    
    const totalBadges = await queryOne('SELECT COUNT(*) as count FROM badges WHERE is_active = 1');
    
    const milestones = [
        { name: 'First Mission', target: 1, current: progress?.total_missions_completed || 0, type: 'missions', icon: '🌱' },
        { name: '10 Missions', target: 10, current: progress?.total_missions_completed || 0, type: 'missions', icon: '📋' },
        { name: '50 Missions', target: 50, current: progress?.total_missions_completed || 0, type: 'missions', icon: '🎯' },
        { name: '100 Missions', target: 100, current: progress?.total_missions_completed || 0, type: 'missions', icon: '⭐' },
        { name: '10kg CO2 Saved', target: 10, current: progress?.total_co2_saved || 0, type: 'co2', icon: '✂️' },
        { name: '100kg CO2 Saved', target: 100, current: progress?.total_co2_saved || 0, type: 'co2', icon: '🌳' },
        { name: '500kg CO2 Saved', target: 500, current: progress?.total_co2_saved || 0, type: 'co2', icon: '🏆' },
        { name: '7-Day Streak', target: 7, current: progress?.longest_streak || 0, type: 'streak', icon: '🔥' },
        { name: '30-Day Streak', target: 30, current: progress?.longest_streak || 0, type: 'streak', icon: '⚡' },
        { name: 'Level 5', target: 5, current: progress?.level || 1, type: 'level', icon: '🎖️' },
        { name: 'Level 10', target: 10, current: progress?.level || 1, type: 'level', icon: '👑' },
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
            total: parseInt(totalBadges.count),
            percentage: Math.round((earnedBadges.length / totalBadges.count) * 100),
        },
        milestones: milestones.map(m => ({
            ...m,
            completed: m.current >= m.target,
            progress: Math.min(100, Math.round((m.current / m.target) * 100)),
        })),
        level: {
            current: progress?.level || 1,
            points: progress?.total_points || 0,
            nextLevelAt: pointsForNextLevel(progress?.level || 1),
        },
    });
}));

module.exports = router;
