/**
 * Utility Helper Functions
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Generate a unique ID
 */
function generateId() {
    return uuidv4();
}

/**
 * Generate a unique referral code
 */
function generateReferralCode() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let code = 'hero';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

/**
 * Get date string for a given date
 */
function getDateString(date) {
    return date.toISOString().split('T')[0];
}

/**
 * Calculate level from points
 * Level formula: level = floor(sqrt(points / 100)) + 1
 */
function calculateLevel(points) {
    return Math.floor(Math.sqrt(points / 100)) + 1;
}

/**
 * Calculate points needed for next level
 */
function pointsForNextLevel(currentLevel) {
    return Math.pow(currentLevel, 2) * 100;
}

/**
 * Check if two dates are consecutive
 */
function areConsecutiveDays(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = Math.abs(d2 - d1);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays === 1;
}

/**
 * Check if date is yesterday
 */
function isYesterday(dateString) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return getDateString(yesterday) === dateString;
}

/**
 * Check if date is today
 */
function isToday(dateString) {
    return getTodayDate() === dateString;
}

/**
 * Sanitize user object for response (remove sensitive fields)
 */
function sanitizeUser(user) {
    const { password_hash, google_id, ...safeUser } = user;
    return {
        id: safeUser.id,
        email: safeUser.email,
        name: safeUser.name,
        avatarUrl: safeUser.avatar_url,
        zipCode: safeUser.zip_code,
        country: safeUser.country,
        timezone: safeUser.timezone,
        isPremium: safeUser.is_premium === 1,
        premiumExpiresAt: safeUser.premium_expires_at,
        referralCode: safeUser.referral_code,
        emailVerified: safeUser.email_verified === 1,
        settings: {
            notificationEmail: safeUser.notification_email === 1,
            notificationPush: safeUser.notification_push === 1,
            notificationTime: safeUser.notification_time,
            theme: safeUser.theme,
            units: safeUser.units,
        },
        createdAt: safeUser.created_at,
    };
}

/**
 * Format CO2 value for display
 */
function formatCO2(kg) {
    if (kg >= 1000) {
        return `${(kg / 1000).toFixed(1)}t`;
    }
    return `${kg.toFixed(1)}kg`;
}

/**
 * Estimate annual CO2 savings based on zip code
 * This is a simplified estimation
 */
function estimateAnnualSavings(zipCode, country = 'US') {
    // Average daily mission saves ~2.5kg CO2
    // With 80% completion rate over a year
    const avgDailySaving = 2.5;
    const completionRate = 0.8;
    const daysPerYear = 365;
    
    // Adjust based on country (simplified)
    const countryMultiplier = {
        'US': 1.2,    // Higher emissions, more savings potential
        'CN': 1.1,
        'IN': 0.8,
        'DE': 1.0,
        'UK': 1.0,
        'FR': 0.9,
        'JP': 0.95,
    };
    
    const multiplier = countryMultiplier[country] || 1.0;
    const estimate = avgDailySaving * completionRate * daysPerYear * multiplier;
    
    // Add some variation based on zip
    const variation = (parseInt(zipCode?.slice(0, 2) || '50', 10) % 20 - 10) / 100;
    
    return Math.round(estimate * (1 + variation));
}

/**
 * Sleep helper for testing/delays
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    generateId,
    generateReferralCode,
    getTodayDate,
    getDateString,
    calculateLevel,
    pointsForNextLevel,
    areConsecutiveDays,
    isYesterday,
    isToday,
    sanitizeUser,
    formatCO2,
    estimateAnnualSavings,
    sleep,
};
