# AI Climate Guardian

Your Personal AI Climate Guardian - A viral landing page for an AI-powered sustainable living app.

## Overview

This landing page promotes a free AI agent that optimizes users' daily lives to minimize carbon footprints through personalized daily "micro-missions" (eco-recipes, commute swaps, sustainable shopping tips).

## Features

### Design & UX
- **Modern Minimalist Design**: Mobile-first, clean aesthetic with green/earth tones
- **Animated Hero**: Lottie animation with live CO2 savings counter
- **Glassmorphism Effects**: Modern blur and transparency effects
- **Smooth Animations**: Scroll-triggered animations and micro-interactions
- **Fully Responsive**: Works on all devices (mobile, tablet, desktop)

### Viral & Growth Mechanics
- **Shareable Win Cards**: One-click sharing via Web Share API
- **Referral System**: Unique referral links with "plant a tree" incentive
- **Badge Sharing**: Share achievements to social media
- **Social Proof**: Dynamic testimonials with impact metrics
- **Gamification**: Streaks, badges, and progress tracking

### Conversion Optimization
- **Single Primary CTA**: "Get My Guardian Now" throughout
- **Modal Signup Flow**: Email + Google sign-in options
- **Personalized Impact Preview**: AI-generated savings estimate
- **Freemium Upsell**: Premium tier at $4.99/month

### Technical
- **Single HTML File**: Easy deployment, no build step required
- **No Dependencies**: Only Lottie CDN for animations + Google Fonts
- **SEO Optimized**: Meta tags for search and social sharing
- **Fast Loading**: Optimized for <2 second load times

## Deployment

This is a static HTML file that can be deployed to any hosting platform:

### GitHub Pages
1. Push to a `gh-pages` branch
2. Enable GitHub Pages in repository settings

### Netlify
1. Drag and drop the `index.html` file
2. Or connect your GitHub repository

### Vercel
1. Import from GitHub
2. Deploy automatically

### Any Web Server
Simply serve the `index.html` file from any web server (Apache, Nginx, etc.)

## Customization

### Lottie Animation
Replace the Lottie animation URL in the `<lottie-player>` tag:
```html
<lottie-player 
    src="YOUR_LOTTIE_JSON_URL" 
    background="transparent" 
    speed="1" 
    loop 
    autoplay>
</lottie-player>
```

### Colors
Edit CSS variables at the top of the `<style>` section:
```css
:root {
    --primary-green: #10b981;
    --primary-dark: #059669;
    --accent-gold: #fbbf24;
    /* ... */
}
```

### Backend Integration
Replace the placeholder signup functions with real API calls:
```javascript
function handleSignup(e) {
    e.preventDefault();
    const email = document.getElementById('emailInput').value;
    // Replace with your API call
    fetch('/api/signup', {
        method: 'POST',
        body: JSON.stringify({ email })
    });
}
```

## File Structure

```
/
├── index.html    # Complete landing page (HTML + CSS + JS)
└── README.md     # Documentation
```

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers (iOS Safari, Chrome for Android)

## License

MIT License - Feel free to use and modify for your projects.

---

Built with sustainability in mind.
