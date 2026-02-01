/**
 * Error Handling Middleware
 */

/**
 * 404 Not Found handler
 */
function notFound(req, res, next) {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    error.status = 404;
    next(error);
}

/**
 * Global error handler
 */
function errorHandler(err, req, res, next) {
    // Log error in development
    if (process.env.NODE_ENV === 'development') {
        console.error('Error:', err);
    }

    // Default to 500 if no status set
    const statusCode = err.status || err.statusCode || 500;
    
    // Build error response
    const response = {
        error: err.message || 'Internal Server Error',
        status: statusCode,
    };

    // Add stack trace in development
    if (process.env.NODE_ENV === 'development') {
        response.stack = err.stack;
    }

    // Add validation errors if present
    if (err.errors) {
        response.errors = err.errors;
    }

    // Add error code if present
    if (err.code) {
        response.code = err.code;
    }

    res.status(statusCode).json(response);
}

/**
 * Async handler wrapper
 * Catches errors in async route handlers
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Create custom error
 */
function createError(message, status = 500, code = null) {
    const error = new Error(message);
    error.status = status;
    if (code) error.code = code;
    return error;
}

module.exports = {
    notFound,
    errorHandler,
    asyncHandler,
    createError,
};
