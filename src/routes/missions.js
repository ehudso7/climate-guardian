/**
 * Mission Routes
 * Daily missions and completion tracking
 */

const express = require('express');
const router = express.Router();

const { getDatabase } = require('../database/init');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { validate, rules, query } = require('../middleware/validate');
const { generateId, getTodayDate, isYesterday, isToday, calculateLevel } = require('../utils/helpers');

/**
 * GET /api/missions/today
 * Get today's mission for the user
 */
router.get('/today', requireAuth, asyncHandler(async (req, res) => {
    const db = getDatabase();
    const today = getTodayDate();
    
    // Check if user has a mission assigned for today
    let userMission = db.prepare(`
        SELECT um.*, m.*,
            um.id as user_mission_id,
            um.status as mission_status,
            um.completed_at,
            um.skipped_at
        FROM user_missions um
        JOIN missions m ON um.mission_id = m.id
        WHERE um.user_id = ? AND um.assigned_date = ?
    `).get(req.user.id, today);
    
    // If no mission for today, assign one
    if (!userMission) {
        // Get missions user hasn't done recently (last 7 days)
        const recentMissions = db.prepare(`
            SELECT mission_id FROM user_missions 
            WHERE user_id = ? AND assigned_date >= date('now', '-7 days')
        `).all(req.user.id).map(m => m.mission_id);
        
        // Get a random mission not in recent list
        let query = 'SELECT * FROM missions WHERE is_active = 1';
        if (recentMissions.length > 0) {
            query += ` AND id NOT IN (${recentMissions.map(() => '?').join(',')})`;
        }
        query += ' ORDER BY RANDOM() LIMIT 1';
        
        const newMission = db.prepare(query).get(...recentMissions);
        
        if (!newMission) {
            // If all missions were done recently, just pick a random one
            const anyMission = db.prepare('SELECT * FROM missions WHERE is_active = 1 ORDER BY RANDOM() LIMIT 1').get();
            if (!anyMission) {
                return res.status(404).json({ error: 'No missions available' });
            }
            
            db.prepare(`
                INSERT INTO user_missions (id, user_id, mission_id, assigned_date)
                VALUES (?, ?, ?, ?)
            `).run(generateId(), req.user.id, anyMission.id, today);
        } else {
            db.prepare(`
                INSERT INTO user_missions (id, user_id, mission_id, assigned_date)
                VALUES (?, ?, ?, ?)
            `).run(generateId(), req.user.id, newMission.id, today);
        }
        
        // Fetch the assigned mission
        userMission = db.prepare(`
            SELECT um.*, m.*,
                um.id as user_mission_id,
                um.status as mission_status,
                um.completed_at,
                um.skipped_at
            FROM user_missions um
            JOIN missions m ON um.mission_id = m.id
            WHERE um.user_id = ? AND um.assigned_date = ?
        `).get(req.user.id, today);
    }
    
    // Get user's current streak
    const progress = db.prepare('SELECT current_streak FROM user_progress WHERE user_id = ?').get(req.user.id);
    
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
 * Mark a mission as complete
 */
router.post('/:id/complete', requireAuth, [
    rules.missionId,
    validate,
], asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = getDatabase();
    const today = getTodayDate();
    
    // Get the user mission
    const userMission = db.prepare(`
        SELECT um.*, m.co2_impact, m.points
        FROM user_missions um
        JOIN missions m ON um.mission_id = m.id
        WHERE um.id = ? AND um.user_id = ?
    `).get(id, req.user.id);
    
    if (!userMission) {
        return res.status(404).json({ error: 'Mission not found' });
    }
    
    if (userMission.status === 'completed') {
        return res.status(400).json({ error: 'Mission already completed' });
    }
    
    // Update mission status
    db.prepare(`
        UPDATE user_missions 
        SET status = 'completed', completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(id);
    
    // Get current progress
    const progress = db.prepare('SELECT * FROM user_progress WHERE user_id = ?').get(req.user.id);
    
    // Calculate new streak
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
    
    // Update progress
    db.prepare(`
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
    `).run(
        userMission.co2_impact,
        newStreak,
        newLongestStreak,
        today,
        newTotalPoints,
        newLevel,
        req.user.id
    );
    
    // Update or create daily progress log
    db.prepare(`
        INSERT INTO progress_log (id, user_id, date, co2_saved, missions_completed, points_earned)
        VALUES (?, ?, ?, ?, 1, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET
            co2_saved = co2_saved + excluded.co2_saved,
            missions_completed = missions_completed + 1,
            points_earned = points_earned + excluded.points_earned
    `).run(generateId(), req.user.id, today, userMission.co2_impact, userMission.points);
    
    // Check for badge achievements
    const earnedBadges = checkBadges(db, req.user.id, {
        co2Saved: progress.total_co2_saved + userMission.co2_impact,
        missionsCompleted: progress.total_missions_completed + 1,
        streak: newStreak,
    });
    
    // Get updated progress
    const updatedProgress = db.prepare('SELECT * FROM user_progress WHERE user_id = ?').get(req.user.id);
    
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
 * Skip a mission
 */
router.post('/:id/skip', requireAuth, [
    rules.missionId,
    validate,
], asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = getDatabase();
    
    const userMission = db.prepare(`
        SELECT * FROM user_missions WHERE id = ? AND user_id = ?
    `).get(id, req.user.id);
    
    if (!userMission) {
        return res.status(404).json({ error: 'Mission not found' });
    }
    
    if (userMission.status !== 'pending') {
        return res.status(400).json({ error: 'Can only skip pending missions' });
    }
    
    // Update mission status
    db.prepare(`
        UPDATE user_missions 
        SET status = 'skipped', skipped_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(id);
    
    // Update progress (streak breaks)
    db.prepare(`
        UPDATE user_progress SET
            total_missions_skipped = total_missions_skipped + 1,
            current_streak = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
    `).run(req.user.id);
    
    res.json({
        message: 'Mission skipped. Your streak has been reset.',
        streakLost: true,
    });
}));

/**
 * GET /api/missions/history
 * Get mission history
 */
router.get('/history', requireAuth, [
    rules.page,
    rules.limit,
    query('status').optional().isIn(['completed', 'skipped', 'pending']),
    validate,
], asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;
    const db = getDatabase();
    
    let query = `
        SELECT um.*, m.title, m.description, m.category, m.icon, m.co2_impact, m.points
        FROM user_missions um
        JOIN missions m ON um.mission_id = m.id
        WHERE um.user_id = ?
    `;
    const params = [req.user.id];
    
    if (status) {
        query += ' AND um.status = ?';
        params.push(status);
    }
    
    query += ' ORDER BY um.assigned_date DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const missions = db.prepare(query).all(...params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM user_missions WHERE user_id = ?';
    const countParams = [req.user.id];
    if (status) {
        countQuery += ' AND status = ?';
        countParams.push(status);
    }
    const totalCount = db.prepare(countQuery).get(...countParams);
    
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
            page,
            limit,
            total: totalCount.total,
            pages: Math.ceil(totalCount.total / limit),
        },
    });
}));

/**
 * GET /api/missions/all
 * Get all available missions
 */
router.get('/all', requireAuth, asyncHandler(async (req, res) => {
    const db = getDatabase();
    
    const missions = db.prepare(`
        SELECT * FROM missions WHERE is_active = 1 ORDER BY category, difficulty
    `).all();
    
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
function checkBadges(db, userId, stats) {
    const earnedBadges = [];
    
    // Get user's current badges
    const existingBadges = db.prepare(`
        SELECT badge_id FROM user_badges WHERE user_id = ?
    `).all(userId).map(b => b.badge_id);
    
    // Get all badges
    const allBadges = db.prepare('SELECT * FROM badges WHERE is_active = 1').all();
    
    for (const badge of allBadges) {
        if (existingBadges.includes(badge.id)) continue;
        
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
            db.prepare(`
                INSERT INTO user_badges (id, user_id, badge_id)
                VALUES (?, ?, ?)
            `).run(generateId(), userId, badge.id);
            
            // Add badge points to user
            db.prepare(`
                UPDATE user_progress SET total_points = total_points + ? WHERE user_id = ?
            `).run(badge.points, userId);
            
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
