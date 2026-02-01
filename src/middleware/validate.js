/**
 * Request Validation Middleware
 */

const { validationResult, body, param, query } = require('express-validator');

/**
 * Validate request and return errors
 */
function validate(req, res, next) {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            errors: errors.array().map(err => ({
                field: err.path,
                message: err.msg,
            })),
        });
    }
    
    next();
}

/**
 * Common validation rules
 */
const rules = {
    // Auth validations
    email: body('email')
        .isEmail()
        .withMessage('Please provide a valid email address')
        .normalizeEmail()
        .isLength({ max: 254 })
        .withMessage('Email must be less than 254 characters'),
    
    password: body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters')
        .isLength({ max: 128 })
        .withMessage('Password must be less than 128 characters')
        .matches(/[a-z]/)
        .withMessage('Password must contain at least one lowercase letter')
        .matches(/[A-Z]/)
        .withMessage('Password must contain at least one uppercase letter')
        .matches(/[0-9]/)
        .withMessage('Password must contain at least one number'),
    
    passwordSimple: body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters')
        .isLength({ max: 128 })
        .withMessage('Password must be less than 128 characters'),
    
    name: body('name')
        .optional()
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('Name must be between 1 and 100 characters')
        .escape(),
    
    zipCode: body('zipCode')
        .optional()
        .trim()
        .isLength({ min: 3, max: 10 })
        .withMessage('Zip code must be between 3 and 10 characters')
        .matches(/^[A-Za-z0-9\s\-]+$/)
        .withMessage('Zip code contains invalid characters'),
    
    // Mission validations
    missionId: param('id')
        .isLength({ min: 1, max: 50 })
        .withMessage('Invalid mission ID'),
    
    // Pagination
    page: query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer')
        .toInt(),
    
    limit: query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100')
        .toInt(),
    
    // Referral
    referralCode: body('referralCode')
        .optional()
        .trim()
        .isLength({ min: 6, max: 20 })
        .withMessage('Invalid referral code')
        .matches(/^[a-zA-Z0-9]+$/)
        .withMessage('Referral code contains invalid characters'),
    
    // Settings
    notificationEmail: body('notificationEmail')
        .optional()
        .isBoolean()
        .withMessage('notificationEmail must be a boolean'),
    
    notificationPush: body('notificationPush')
        .optional()
        .isBoolean()
        .withMessage('notificationPush must be a boolean'),
    
    notificationTime: body('notificationTime')
        .optional()
        .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
        .withMessage('notificationTime must be in HH:MM format'),
    
    theme: body('theme')
        .optional()
        .isIn(['light', 'dark', 'system'])
        .withMessage('theme must be light, dark, or system'),
    
    units: body('units')
        .optional()
        .isIn(['metric', 'imperial'])
        .withMessage('units must be metric or imperial'),
};

module.exports = {
    validate,
    rules,
    body,
    param,
    query,
};
