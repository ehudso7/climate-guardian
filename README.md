# AI Climate Guardian

A full-stack web application for sustainable living with AI-powered daily micro-missions.

## Overview

Climate Guardian helps users minimize their carbon footprint through personalized daily missions, gamification, and social features. Users earn points, badges, and plant real trees by completing missions and referring friends.

## Features

### Core Functionality
- **Daily Missions**: AI-assigned personalized eco-tasks
- **Progress Tracking**: CO₂ saved, streaks, levels
- **Gamification**: Badges, achievements, leaderboards
- **Referral System**: Invite friends, plant trees
- **Premium Tier**: Family accounts, advanced features

### Technical Stack
- **Backend**: Node.js + Express.js
- **Database**: SQLite with better-sqlite3
- **Authentication**: JWT with bcrypt password hashing
- **Frontend**: Vanilla JS SPA with modern CSS

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/climate-guardian.git
cd climate-guardian

# Install dependencies
npm install

# Set up environment
cp .env.example .env

# Start the server
npm start
```

The app will be available at `http://localhost:3000`

### Development

```bash
# Run in development mode
npm run dev

# Initialize database with seed data
npm run db:init
```

## Project Structure

```
climate-guardian/
├── server.js              # Express server entry point
├── package.json           # Dependencies and scripts
├── .env                   # Environment configuration
├── index.html             # Landing page
├── public/                # Frontend application
│   ├── app.html           # Authenticated app shell
│   ├── login.html         # Login page
│   └── signup.html        # Signup page
├── src/
│   ├── routes/            # API route handlers
│   │   ├── auth.js        # Authentication endpoints
│   │   ├── users.js       # User management
│   │   ├── missions.js    # Mission system
│   │   ├── progress.js    # Progress tracking
│   │   ├── referrals.js   # Referral system
│   │   └── badges.js      # Badge system
│   ├── middleware/        # Express middleware
│   │   ├── auth.js        # JWT authentication
│   │   ├── errorHandler.js # Error handling
│   │   └── validate.js    # Input validation
│   ├── database/          # Database setup
│   │   └── init.js        # Schema and seeds
│   └── utils/             # Helper functions
│       └── helpers.js     # Utilities
├── database/              # SQLite database files
├── manifest.json          # PWA manifest
├── sw.js                  # Service worker
└── icons/                 # App icons
```

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Create account |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Get current user |
| POST | `/api/auth/refresh` | Refresh token |
| POST | `/api/auth/google` | Google OAuth |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/profile` | Get profile |
| PUT | `/api/users/profile` | Update profile |
| PUT | `/api/users/settings` | Update settings |
| PUT | `/api/users/password` | Change password |
| DELETE | `/api/users/account` | Delete account |

### Missions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/missions/today` | Get today's mission |
| GET | `/api/missions/history` | Mission history |
| GET | `/api/missions/all` | All available missions |
| POST | `/api/missions/:id/complete` | Complete mission |
| POST | `/api/missions/:id/skip` | Skip mission |

### Progress
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/progress` | Get progress summary |
| GET | `/api/progress/stats` | Detailed statistics |
| GET | `/api/progress/leaderboard` | Global leaderboard |
| GET | `/api/progress/achievements` | Achievements |

### Referrals
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/referrals` | Get referral info |
| GET | `/api/referrals/stats` | Referral statistics |
| POST | `/api/referrals/validate` | Validate code |

### Badges
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/badges` | All badges |
| GET | `/api/badges/earned` | Earned badges |
| GET | `/api/badges/:id` | Badge details |

## Database Schema

### Users
- id, email, password_hash, name, referral_code
- Settings: notifications, theme, units
- Subscription: is_premium, premium_expires_at

### Missions
- 20 pre-seeded eco-missions
- Categories: transportation, energy, food, water, consumption
- Each with CO₂ impact and point values

### Progress
- Total CO₂ saved, missions completed
- Streak tracking (current, longest)
- Level and points system

### Badges
- 17 achievement badges
- Categories: streak, impact, milestone, social, special

## Security Features

- JWT authentication with refresh tokens
- Password hashing with bcrypt (12 rounds)
- Rate limiting (100 req/15min, 10 auth/15min)
- Input validation and sanitization
- CORS configuration
- Helmet security headers
- CSP policy

## Environment Variables

```env
# Server
NODE_ENV=development
PORT=3000
HOST=localhost

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# Database
DATABASE_PATH=./database/climate_guardian.db

# Frontend URL
FRONTEND_URL=http://localhost:3000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-secret
```

## Deployment

### Production Checklist
- [ ] Set strong JWT_SECRET
- [ ] Configure HTTPS
- [ ] Set NODE_ENV=production
- [ ] Set up database backups
- [ ] Configure rate limiting
- [ ] Set up monitoring
- [ ] Configure CDN

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Platform Deployment

**Render/Railway:**
```bash
# Set build command
npm install

# Set start command
npm start
```

**Vercel (serverless - requires adaptation):**
- Convert to serverless functions
- Use external database

## Testing

```bash
# Run tests
npm test

# API testing with curl
curl http://localhost:3000/api/health

# Create test user
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test1234!"}'
```

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Run tests
5. Submit PR

## License

MIT License

---

Built with 💚 for a sustainable future.
