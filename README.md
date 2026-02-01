# AI Climate Guardian

Your Personal AI Climate Guardian - A production-ready, viral landing page for an AI-powered sustainable living application.

## Overview

This landing page promotes a free AI agent that helps users minimize their carbon footprint through personalized daily "micro-missions" (eco-recipes, commute swaps, sustainable shopping tips).

## Production Features

### Accessibility (WCAG 2.1 AA Compliant)
- Full keyboard navigation support
- ARIA labels and roles throughout
- Screen reader optimized
- Skip link for main content
- Focus trap in modals
- `prefers-reduced-motion` support
- High contrast color ratios

### Security
- Content Security Policy (CSP) meta tags
- Input sanitization (XSS prevention)
- Secure referrer policy
- HTTPS-only external resources

### Performance
- Preconnect/DNS prefetch for external resources
- Deferred script loading
- Optimized animations with `requestAnimationFrame`
- Debounced scroll handlers
- Lazy loading via Intersection Observer
- Service Worker for offline support

### SEO
- Schema.org structured data (SoftwareApplication, Organization)
- Complete Open Graph and Twitter Card meta tags
- Canonical URL
- XML Sitemap
- robots.txt
- Semantic HTML structure

### PWA Support
- Web App Manifest
- Service Worker with caching strategies
- Offline fallback page
- Push notification support (ready for backend)
- Add to home screen capability

### Analytics Ready
- Event tracking placeholders (Google Analytics 4 compatible)
- UTM parameter handling
- Conversion tracking hooks
- Web Vitals monitoring

### GDPR Compliance
- Cookie consent banner
- Privacy-first data collection
- User consent tracking

## File Structure

```
/
├── index.html          # Main landing page (production-ready)
├── manifest.json       # PWA manifest
├── sw.js              # Service worker
├── offline.html       # Offline fallback page
├── favicon.svg        # SVG favicon
├── browserconfig.xml  # Windows tile configuration
├── robots.txt         # Search engine directives
├── sitemap.xml        # XML sitemap
├── icons/             # PWA icons directory
│   └── icon-192x192.svg
└── README.md          # This file
```

## Deployment

### Prerequisites
- Web server with HTTPS support
- Domain configured (e.g., climateguardian.ai)

### Quick Deploy Options

#### Netlify (Recommended)
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod --dir=.
```

#### Vercel
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

#### GitHub Pages
1. Push to a `gh-pages` branch
2. Enable GitHub Pages in repository settings
3. Set custom domain if needed

#### AWS S3 + CloudFront
```bash
# Sync to S3 bucket
aws s3 sync . s3://your-bucket-name --exclude ".git/*"

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
```

### Server Configuration

#### Nginx
```nginx
server {
    listen 443 ssl http2;
    server_name climateguardian.ai;
    root /var/www/climateguardian;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://lottie.host https://www.google-analytics.com;" always;
    
    # Caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # Service worker
    location /sw.js {
        add_header Cache-Control "no-cache";
        expires 0;
    }
    
    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

#### Apache (.htaccess)
```apache
<IfModule mod_headers.c>
    Header set X-Frame-Options "SAMEORIGIN"
    Header set X-Content-Type-Options "nosniff"
    Header set X-XSS-Protection "1; mode=block"
    Header set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>

<IfModule mod_expires.c>
    ExpiresActive On
    ExpiresByType image/png "access plus 1 year"
    ExpiresByType image/svg+xml "access plus 1 year"
    ExpiresByType application/javascript "access plus 1 year"
    ExpiresByType text/css "access plus 1 year"
</IfModule>

<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule ^ index.html [L]
</IfModule>
```

## Customization

### Domain Configuration
Update these files with your domain:
- `index.html` - Update canonical URL and OG tags
- `sitemap.xml` - Update all URLs
- `manifest.json` - Update start_url if needed

### Analytics Integration

#### Google Analytics 4
Add to `<head>`:
```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

### Backend Integration

Replace placeholder API calls in the JavaScript:

```javascript
// Example: Real signup API
async function handleSignup(e) {
    e.preventDefault();
    const email = document.getElementById('emailInput').value;
    
    try {
        const response = await fetch('/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, referrer: sessionStorage.getItem('referrer') })
        });
        
        if (response.ok) {
            showSuccess();
        } else {
            showToast('Signup failed. Please try again.', 'error');
        }
    } catch (error) {
        showToast('Network error. Please try again.', 'error');
    }
}
```

### Colors & Branding
Edit CSS variables in `index.html`:
```css
:root {
    --color-primary: #10b981;      /* Main green */
    --color-primary-dark: #059669;  /* Dark green */
    --color-accent: #fbbf24;        /* Gold accent */
    /* ... other variables */
}
```

## Pre-Launch Checklist

### Required
- [ ] Update domain in all meta tags and URLs
- [ ] Generate PNG icons from SVG (72, 96, 128, 144, 152, 192, 384, 512px)
- [ ] Create Open Graph image (1200x630px)
- [ ] Create Twitter image (1200x600px)
- [ ] Set up SSL certificate
- [ ] Configure analytics (replace GA_MEASUREMENT_ID)
- [ ] Set up error monitoring (e.g., Sentry)
- [ ] Test on multiple browsers and devices
- [ ] Run Lighthouse audit (target 90+ all categories)
- [ ] Validate HTML (W3C Validator)
- [ ] Test accessibility (axe DevTools)

### Recommended
- [ ] Set up CDN (CloudFlare, Fastly)
- [ ] Configure rate limiting
- [ ] Set up uptime monitoring
- [ ] Create backup deployment
- [ ] Set up CI/CD pipeline
- [ ] Configure A/B testing tools
- [ ] Set up heatmap tracking (Hotjar, FullStory)

## Performance Targets

| Metric | Target | Tool |
|--------|--------|------|
| Lighthouse Performance | 90+ | Chrome DevTools |
| First Contentful Paint | <1.8s | WebPageTest |
| Largest Contentful Paint | <2.5s | WebPageTest |
| Cumulative Layout Shift | <0.1 | Chrome DevTools |
| Time to Interactive | <3.8s | Lighthouse |

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- iOS Safari 14+
- Chrome for Android 90+

## Security Considerations

1. **CSP**: Content Security Policy is configured to only allow trusted sources
2. **Input Validation**: All user inputs are sanitized before use
3. **HTTPS**: Always serve over HTTPS
4. **Rate Limiting**: Implement on the server for API endpoints
5. **CORS**: Configure properly for API endpoints

## Legal Pages Needed

Before launch, create these pages:
- `/privacy` - Privacy Policy
- `/terms` - Terms of Service  
- `/cookies` - Cookie Policy
- `/accessibility` - Accessibility Statement

## Support & Contributing

For issues or contributions, please open a GitHub issue or pull request.

## License

MIT License - See LICENSE file for details.

---

Built with ❤️ for a sustainable future.
