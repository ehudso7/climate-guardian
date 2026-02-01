/**
 * AI Climate Guardian - Main Server
 * Express.js application with SQLite database
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Import routes
const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const missionRoutes = require('./src/routes/missions');
const progressRoutes = require('./src/routes/progress');
const referralRoutes = require('./src/routes/referrals');
const badgeRoutes = require('./src/routes/badges');

// Import middleware
const { errorHandler, notFound } = require('./src/middleware/errorHandler');
const { optionalAuth } = require('./src/middleware/auth');

// Import database initialization
const { initializeDatabase } = require('./src/database/init');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

// ===========================================
// Security Middleware
// ===========================================

// Helmet for security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://www.googletagmanager.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://lottie.host", "https://www.google-analytics.com"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// Stricter rate limit for auth routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per window
    message: { error: 'Too many authentication attempts, please try again later.' },
});
app.use('/api/auth/', authLimiter);

// ===========================================
// Body Parsing & Cookies
// ===========================================

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// ===========================================
// Static Files
// ===========================================

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve root static files (favicon, manifest, etc.)
app.use(express.static(__dirname, {
    index: false,
    extensions: ['html'],
}));

// ===========================================
// API Routes
// ===========================================

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/missions', missionRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/badges', badgeRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
    });
});

// API documentation endpoint
app.get('/api', (req, res) => {
    res.json({
        name: 'Climate Guardian API',
        version: '1.0.0',
        endpoints: {
            auth: {
                'POST /api/auth/signup': 'Create new account',
                'POST /api/auth/login': 'Login to account',
                'POST /api/auth/logout': 'Logout from account',
                'GET /api/auth/me': 'Get current user',
                'POST /api/auth/refresh': 'Refresh JWT token',
            },
            users: {
                'GET /api/users/profile': 'Get user profile',
                'PUT /api/users/profile': 'Update user profile',
                'PUT /api/users/settings': 'Update user settings',
                'DELETE /api/users/account': 'Delete account',
            },
            missions: {
                'GET /api/missions/today': 'Get today\'s mission',
                'GET /api/missions/history': 'Get mission history',
                'POST /api/missions/:id/complete': 'Mark mission complete',
                'POST /api/missions/:id/skip': 'Skip a mission',
            },
            progress: {
                'GET /api/progress': 'Get user progress',
                'GET /api/progress/stats': 'Get detailed statistics',
                'GET /api/progress/leaderboard': 'Get leaderboard',
            },
            referrals: {
                'GET /api/referrals': 'Get referral info',
                'GET /api/referrals/stats': 'Get referral stats',
                'POST /api/referrals/validate': 'Validate referral code',
            },
            badges: {
                'GET /api/badges': 'Get all badges',
                'GET /api/badges/earned': 'Get earned badges',
            },
        },
    });
});

// ===========================================
// Frontend Routes (SPA)
// ===========================================

// Auth pages (public)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

// Dashboard and app routes (require auth)
const appRoutes = [
    '/dashboard',
    '/profile',
    '/settings',
    '/missions',
    '/progress',
    '/referrals',
    '/badges',
    '/premium',
];

appRoutes.forEach(route => {
    app.get(route, optionalAuth, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'app.html'));
    });
});

// Serve landing page for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle referral links
app.get('/join/:code', (req, res) => {
    // Store referral code in cookie and redirect to signup
    res.cookie('referral_code', req.params.code, {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: 'lax',
    });
    res.redirect('/signup');
});

// ===========================================
// Error Handling
// ===========================================

app.use(notFound);
app.use(errorHandler);

// ===========================================
// Server Startup
// ===========================================

async function startServer() {
    try {
        // Initialize database
        await initializeDatabase();
        console.log('✅ Database initialized');

        // Start server
        app.listen(PORT, HOST, () => {
            console.log(`
🌍 Climate Guardian Server Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 Server: http://${HOST}:${PORT}
🔧 Environment: ${process.env.NODE_ENV || 'development'}
📊 API Docs: http://${HOST}:${PORT}/api
💚 Health: http://${HOST}:${PORT}/api/health
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            `);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    process.exit(0);
});

// Start server only if not in serverless environment
if (process.env.VERCEL !== '1') {
    startServer();
} else {
    // Initialize database for serverless
    initializeDatabase().catch(console.error);
}

// Export for Vercel serverless
module.exports = app;
