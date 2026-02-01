/**
 * Authentication Middleware
 * JWT verification and user extraction
 */

const jwt = require('jsonwebtoken');
const { getDatabase } = require('../database/init');

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';

/**
 * Required authentication middleware
 * Returns 401 if no valid token
 */
function requireAuth(req, res, next) {
    try {
        const token = extractToken(req);
        
        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Get user from database
        const db = getDatabase();
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
        
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        // Attach user to request
        req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            isPremium: user.is_premium === 1,
            referralCode: user.referral_code,
        };
        
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        console.error('Auth middleware error:', error);
        return res.status(500).json({ error: 'Authentication error' });
    }
}

/**
 * Optional authentication middleware
 * Attaches user if valid token, continues anyway if not
 */
function optionalAuth(req, res, next) {
    try {
        const token = extractToken(req);
        
        if (token) {
            const decoded = jwt.verify(token, JWT_SECRET);
            const db = getDatabase();
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
            
            if (user) {
                req.user = {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    isPremium: user.is_premium === 1,
                    referralCode: user.referral_code,
                };
            }
        }
    } catch (error) {
        // Ignore errors for optional auth
    }
    
    next();
}

/**
 * Premium-only middleware
 * Requires user to have premium subscription
 */
function requirePremium(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!req.user.isPremium) {
        return res.status(403).json({ 
            error: 'Premium subscription required',
            code: 'PREMIUM_REQUIRED',
        });
    }
    
    next();
}

/**
 * Extract JWT from request
 * Checks Authorization header and cookies
 */
function extractToken(req) {
    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }
    
    // Check cookie
    if (req.cookies && req.cookies.token) {
        return req.cookies.token;
    }
    
    return null;
}

/**
 * Generate JWT token
 */
function generateToken(userId, expiresIn = process.env.JWT_EXPIRES_IN || '7d') {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn });
}

/**
 * Generate refresh token
 */
function generateRefreshToken(userId) {
    return jwt.sign({ userId, type: 'refresh' }, JWT_SECRET, { expiresIn: '30d' });
}

/**
 * Verify refresh token
 */
function verifyRefreshToken(token) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type !== 'refresh') {
            return null;
        }
        return decoded;
    } catch (error) {
        return null;
    }
}

module.exports = {
    requireAuth,
    optionalAuth,
    requirePremium,
    extractToken,
    generateToken,
    generateRefreshToken,
    verifyRefreshToken,
};
