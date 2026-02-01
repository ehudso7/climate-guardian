/**
 * Mission Routes
 */

const express = require('express');
const router = express.Router();

const { query, queryOne, execute } = require('../database/init');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { validate, rules } = require('../middleware/validate');
const { generateId, getTodayDate, isYesterday, isToday, calculateLevel } = require('../utils/helpers');

/**
 * GET /api/missions/today
 */
router.get('/today', requireAuth, asyncHandler(async (req, res) => {
    const today = getTodayDate();
    
    let userMission = await queryOne(`
        SELECT um.*, m.*,
            um.id as user_mission_id,
            um.status as mission_status,
            um.completed_at,
            um.skipped_at
        FROM user_missions um
        JOIN missions m ON um.mission_id = m.id
        WHERE um.user_id = ? AND um.assigned_date = ?
    `, [req.user.id, today]);
    
    if (!userMission) {
        const recentMissions = await query(`
            SELECT mission_id FROM user_missions 
            WHERE user_id = ? AND assigned_date >= ?
        `, [req.user.id, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]]);
        
        const recentIds = recentMissions.map(m => m.mission_id);
        
        let newMission;
        if (recentIds.length > 0) {
            const placeholders = recentIds.map(() => '?').join(',');
            newMission = await queryOne(
                `SELECT * FROM missions WHERE is_active = 1 AND id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`,
                recentIds
            );
        }
        
        if (!newMission) {
            newMission = await queryOne('SELECT * FROM missions WHERE is_active = 1 ORDER BY RANDOM() LIMIT 1');
        }
        
        if (!newMission) {
            return res.status(404).json({ error: 'No missions available' });
        }
        
        await execute(
            `INSERT INTO user_missions (id, user_id, mission_id, assigned_date) VALUES (?, ?, ?, ?)`,
            [generateId(), req.user.id, newMission.id, today]
        );
        
        userMission = await queryOne(`
            SELECT um.*, m.*,
                um.id as user_mission_id,
                um.status as mission_status,
                um.completed_at,
                um.skipped_at
            FROM user_missions um
            JOIN missions m ON um.mission_id = m.id
            WHERE um.user_id = ? AND um.assigned_date = ?
        `, [req.user.id, today]);
    }
    
    const progress = await queryOne('SELECT current_streak FROM user_progress WHERE user_id = ?', [req.user.id]);
    
    res.json({
        mission: {
            id: userMission.user_mission_id,
            missionId: userMission.mission_id,
            title: userMission.title,
            description: userMission.description,
            category: userMission.category,
            difficulty: userMission.difficulty,
            co2Impact: userMission.co2_impact,
            points: userMission.points,
            icon: userMission.icon,
            tips: userMission.tips,
            status: userMission.mission_status,
            completedAt: userMission.completed_at,
            skippedAt: userMission.skipped_at,
            assignedDate: userMission.assigned_date,
        },
        streak: progress?.current_streak || 0,
    });
}));

/**
 * POST /api/missions/:id/complete
 */
router.post('/:id/complete', requireAuth, [rules.missionId, validate], asyncHandler(async (req, res) => {
    const { id } = req.params;
    const today = getTodayDate();
    
    const userMission = await queryOne(`
        SELECT um.*, m.co2_impact, m.points
        FROM user_missions um
        JOIN missions m ON um.mission_id = m.id
        WHERE um.id = ? AND um.user_id = ?
    `, [id, req.user.id]);
    
    if (!userMission) {
        return res.status(404).json({ error: 'Mission not found' });
    }
    
    if (userMission.status === 'completed') {
        return res.status(400).json({ error: 'Mission already completed' });
    }
    
    await execute(
        `UPDATE user_missions SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id]
    );
    
    const progress = await queryOne('SELECT * FROM user_progress WHERE user_id = ?', [req.user.id]);
    
    let newStreak = 1;
    if (progress.streak_last_date) {
        if (isYesterday(progress.streak_last_date)) {
            newStreak = progress.current_streak + 1;
        } else if (isToday(progress.streak_last_date)) {
            newStreak = progress.current_streak;
        }
    }
    
    const newLongestStreak = Math.max(newStreak, progress.longest_streak);
    const newTotalPoints = progress.total_points + userMission.points;
    const newLevel = calculateLevel(newTotalPoints);
    
    await execute(`
        UPDATE user_progress SET
            total_co2_saved = total_co2_saved + ?,
            total_missions_completed = total_missions_completed + 1,
            current_streak = ?,
            longest_streak = ?,
            streak_last_date = ?,
            total_points = ?,
            level = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
    `, [userMission.co2_impact, newStreak, newLongestStreak, today, newTotalPoints, newLevel, req.user.id]);
    
    // Upsert progress log
    const existingLog = await queryOne(
        'SELECT id FROM progress_log WHERE user_id = ? AND date = ?',
        [req.user.id, today]
    );
    
    if (existingLog) {
        await execute(`
            UPDATE progress_log SET
                co2_saved = co2_saved + ?,
                missions_completed = missions_completed + 1,
                points_earned = points_earned + ?
            WHERE id = ?
        `, [userMission.co2_impact, userMission.points, existingLog.id]);
    } else {
        await execute(`
            INSERT INTO progress_log (id, user_id, date, co2_saved, missions_completed, points_earned)
            VALUES (?, ?, ?, ?, 1, ?)
        `, [generateId(), req.user.id, today, userMission.co2_impact, userMission.points]);
    }
    
    // Check badges
    const earnedBadges = await checkBadges(req.user.id, {
        co2Saved: progress.total_co2_saved + userMission.co2_impact,
        missionsCompleted: progress.total_missions_completed + 1,
        streak: newStreak,
    });
    
    const updatedProgress = await queryOne('SELECT * FROM user_progress WHERE user_id = ?', [req.user.id]);
    
    res.json({
        message: 'Mission completed! 🎉',
        co2Saved: userMission.co2_impact,
        pointsEarned: userMission.points,
        streak: newStreak,
        newBadges: earnedBadges,
        progress: {
            totalCO2Saved: updatedProgress.total_co2_saved,
            totalMissionsCompleted: updatedProgress.total_missions_completed,
            currentStreak: updatedProgress.current_streak,
            longestStreak: updatedProgress.longest_streak,
            level: updatedProgress.level,
            totalPoints: updatedProgress.total_points,
        },
    });
}));

/**
 * POST /api/missions/:id/skip
 */
router.post('/:id/skip', requireAuth, [rules.missionId, validate], asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const userMission = await queryOne(
        'SELECT * FROM user_missions WHERE id = ? AND user_id = ?',
        [id, req.user.id]
    );
    
    if (!userMission) {
        return res.status(404).json({ error: 'Mission not found' });
    }
    
    if (userMission.status !== 'pending') {
        return res.status(400).json({ error: 'Can only skip pending missions' });
    }
    
    await execute(
        `UPDATE user_missions SET status = 'skipped', skipped_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id]
    );
    
    await execute(`
        UPDATE user_progress SET
            total_missions_skipped = total_missions_skipped + 1,
            current_streak = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
    `, [req.user.id]);
    
    res.json({ message: 'Mission skipped. Your streak has been reset.', streakLost: true });
}));

/**
 * GET /api/missions/history
 */
router.get('/history', requireAuth, [rules.page, rules.limit, validate], asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;
    
    let sql = `
        SELECT um.*, m.title, m.description, m.category, m.icon, m.co2_impact, m.points
        FROM user_missions um
        JOIN missions m ON um.mission_id = m.id
        WHERE um.user_id = ?
    `;
    const params = [req.user.id];
    
    if (status) {
        sql += ' AND um.status = ?';
        params.push(status);
    }
    
    sql += ' ORDER BY um.assigned_date DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const missions = await query(sql, params);
    
    let countSql = 'SELECT COUNT(*) as total FROM user_missions WHERE user_id = ?';
    const countParams = [req.user.id];
    if (status) {
        countSql += ' AND status = ?';
        countParams.push(status);
    }
    const totalCount = await queryOne(countSql, countParams);
    
    res.json({
        missions: missions.map(m => ({
            id: m.id,
            title: m.title,
            description: m.description,
            category: m.category,
            icon: m.icon,
            co2Impact: m.co2_impact,
            points: m.points,
            status: m.status,
            assignedDate: m.assigned_date,
            completedAt: m.completed_at,
            skippedAt: m.skipped_at,
        })),
        pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(totalCount.total),
            pages: Math.ceil(totalCount.total / limit),
        },
    });
}));

/**
 * GET /api/missions/all
 */
router.get('/all', requireAuth, asyncHandler(async (req, res) => {
    const missions = await query('SELECT * FROM missions WHERE is_active = 1 ORDER BY category, difficulty');
    const categories = [...new Set(missions.map(m => m.category))];
    
    res.json({
        missions: missions.map(m => ({
            id: m.id,
            title: m.title,
            description: m.description,
            category: m.category,
            difficulty: m.difficulty,
            co2Impact: m.co2_impact,
            points: m.points,
            icon: m.icon,
            tips: m.tips,
        })),
        categories,
    });
}));

/**
 * Check and award badges
 */
async function checkBadges(userId, stats) {
    const earnedBadges = [];
    
    const existingBadges = await query('SELECT badge_id FROM user_badges WHERE user_id = ?', [userId]);
    const existingIds = existingBadges.map(b => b.badge_id);
    
    const allBadges = await query('SELECT * FROM badges WHERE is_active = 1');
    
    for (const badge of allBadges) {
        if (existingIds.includes(badge.id)) continue;
        
        let earned = false;
        switch (badge.requirement_type) {
            case 'missions_completed':
                earned = stats.missionsCompleted >= badge.requirement_value;
                break;
            case 'co2_saved':
                earned = stats.co2Saved >= badge.requirement_value;
                break;
            case 'streak':
                earned = stats.streak >= badge.requirement_value;
                break;
        }
        
        if (earned) {
            await execute(
                'INSERT INTO user_badges (id, user_id, badge_id) VALUES (?, ?, ?)',
                [generateId(), userId, badge.id]
            );
            await execute(
                'UPDATE user_progress SET total_points = total_points + ? WHERE user_id = ?',
                [badge.points, userId]
            );
            earnedBadges.push({
                id: badge.id,
                name: badge.name,
                description: badge.description,
                icon: badge.icon,
                points: badge.points,
            });
        }
    }
    
    return earnedBadges;
}

module.exports = router;
