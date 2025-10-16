# 🚀 Production Environment Setup Guide
**ClientsVia Platform - Multi-Tenant AI Agent SaaS**

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Server Setup](#server-setup)
3. [Environment Variables](#environment-variables)
4. [Database Configuration](#database-configuration)
5. [Redis Configuration](#redis-configuration)
6. [Security Hardening](#security-hardening)
7. [Process Management](#process-management)
8. [Monitoring & Logging](#monitoring--logging)
9. [Backup & Recovery](#backup--recovery)
10. [Deployment](#deployment)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements
- **OS**: Ubuntu 20.04 LTS or newer (recommended) or CentOS 8+
- **CPU**: 4+ cores (8+ recommended for production)
- **RAM**: 8GB minimum (16GB+ recommended)
- **Storage**: 100GB SSD minimum
- **Network**: Static IP with firewall configuration

### Required Software
- Node.js 18.x or 20.x LTS
- MongoDB 6.0+
- Redis 7.0+
- Nginx (for reverse proxy)
- PM2 (for process management)
- Git (for deployments)

---

## Server Setup

### 1. Update System

```bash
# Ubuntu/Debian
sudo apt update && sudo apt upgrade -y

# CentOS/RHEL
sudo yum update -y
```

### 2. Install Node.js

```bash
# Using NodeSource repository (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should be v20.x.x
npm --version
```

### 3. Install MongoDB

```bash
# Ubuntu 20.04/22.04
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt update
sudo apt install -y mongodb-org

# Start MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod

# Verify
sudo systemctl status mongod
```

### 4. Install Redis

```bash
# Ubuntu/Debian
sudo apt install -y redis-server

# Start Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Verify
redis-cli ping  # Should return "PONG"
```

### 5. Install PM2

```bash
npm install -g pm2

# Setup PM2 to start on boot
pm2 startup
# Follow the instructions output by the command
```

### 6. Install Nginx

```bash
# Ubuntu/Debian
sudo apt install -y nginx

# Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## Environment Variables

### 1. Create `.env` File

```bash
cd /path/to/clientsvia-backend
cp env.example .env
nano .env
```

### 2. Required Environment Variables

```bash
# ============================================================================
# CORE SECURITY (CRITICAL)
# ============================================================================
JWT_SECRET=your_super_secret_jwt_key_min_32_chars_production_use_random_string
SESSION_SECRET=your_session_secret_min_32_chars_production_use_random_string

# ============================================================================
# DATABASE
# ============================================================================
# Local MongoDB
MONGODB_URI=mongodb://localhost:27017/clientsvia

# OR MongoDB Atlas (recommended for production)
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/clientsvia?retryWrites=true&w=majority

# ============================================================================
# REDIS
# ============================================================================
# Local Redis
REDIS_URL=redis://localhost:6379

# OR Redis Cloud
REDIS_URL=redis://:password@your-redis-host:port

# Alternative Redis configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
REDIS_DB=0

# ============================================================================
# TWILIO (CRITICAL for call handling)
# ============================================================================
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WEBHOOK_BASE_URL=https://your-domain.com

# ============================================================================
# ELEVENLABS (AI Voice)
# ============================================================================
ELEVENLABS_API_KEY=your_elevenlabs_api_key

# ============================================================================
# EMAIL (SendGrid)
# ============================================================================
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SENDGRID_FROM_EMAIL=noreply@your-domain.com

# ============================================================================
# SENTRY (Error Monitoring)
# ============================================================================
SENTRY_DSN=https://xxxxx@sentry.io/xxxxx

# ============================================================================
# SERVER
# ============================================================================
NODE_ENV=production
PORT=3000

# ============================================================================
# SECURITY (CRITICAL)
# ============================================================================
# MUST be false in production - removes all auth bypasses
SKIP_AUTH=false

# CORS configuration
CORS_ORIGIN=https://your-frontend-domain.com

# Session security
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAME_SITE=strict
```

### 3. Generate Secure Secrets

```bash
# Generate JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate session secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 4. Set Proper Permissions

```bash
chmod 600 .env
```

---

## Database Configuration

### 1. MongoDB Security

```bash
# Connect to MongoDB
mongosh

# Create admin user
use admin
db.createUser({
  user: "admin",
  pwd: "your_secure_password",
  roles: ["root"]
})

# Create application user
use clientsvia
db.createUser({
  user: "clientsvia_app",
  pwd: "your_app_password",
  roles: [
    { role: "readWrite", db: "clientsvia" }
  ]
})
```

### 2. Update MongoDB Connection String

```bash
MONGODB_URI=mongodb://clientsvia_app:your_app_password@localhost:27017/clientsvia?authSource=clientsvia
```

### 3. Enable MongoDB Authentication

Edit `/etc/mongod.conf`:

```yaml
security:
  authorization: enabled
```

Restart MongoDB:

```bash
sudo systemctl restart mongod
```

### 4. Create Database Indexes

```bash
cd /path/to/clientsvia-backend
node scripts/verify-production-indexes.js
```

---

## Redis Configuration

### 1. Secure Redis

Edit `/etc/redis/redis.conf`:

```conf
# Bind to localhost only (if on same server)
bind 127.0.0.1

# Set a strong password
requirepass your_strong_redis_password

# Disable dangerous commands
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command CONFIG ""

# Enable persistence
save 900 1
save 300 10
save 60 10000

# Limit memory
maxmemory 2gb
maxmemory-policy allkeys-lru
```

### 2. Restart Redis

```bash
sudo systemctl restart redis-server
```

### 3. Update Environment

```bash
REDIS_URL=redis://:your_strong_redis_password@localhost:6379
```

---

## Security Hardening

### 1. Firewall Configuration

```bash
# Ubuntu (UFW)
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Check status
sudo ufw status
```

### 2. SSL/TLS Certificate (Let's Encrypt)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Auto-renewal is configured automatically
# Verify with:
sudo certbot renew --dry-run
```

### 3. Nginx Reverse Proxy

Create `/etc/nginx/sites-available/clientsvia`:

```nginx
# Rate limiting
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=twilio_limit:10m rate=50r/s;

# Upstream Node.js app
upstream nodejs_backend {
    server 127.0.0.1:3000;
    keepalive 64;
}

# HTTP -> HTTPS redirect
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name your-domain.com www.your-domain.com;

    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Logging
    access_log /var/log/nginx/clientsvia-access.log;
    error_log /var/log/nginx/clientsvia-error.log;

    # Max body size (for file uploads)
    client_max_body_size 10M;

    # Root location (API and static files)
    location / {
        proxy_pass http://nodejs_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Twilio webhooks (higher rate limit)
    location /twilio/ {
        limit_req zone=twilio_limit burst=20 nodelay;
        
        proxy_pass http://nodejs_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API endpoints (standard rate limit)
    location /api/ {
        limit_req zone=api_limit burst=5 nodelay;
        
        proxy_pass http://nodejs_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check (no rate limit)
    location /health {
        proxy_pass http://nodejs_backend;
        access_log off;
    }
}
```

Enable site and reload:

```bash
sudo ln -s /etc/nginx/sites-available/clientsvia /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Process Management

### 1. PM2 Configuration

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'clientsvia',
    script: './index.js',
    instances: 'max',  // Use all CPU cores
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
```

### 2. Start Application

```bash
# Install dependencies
npm ci --production

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup startup script
pm2 startup
```

### 3. PM2 Commands

```bash
# Status
pm2 status

# Logs
pm2 logs clientsvia

# Restart
pm2 restart clientsvia

# Stop
pm2 stop clientsvia

# Monitoring
pm2 monit
```

---

## Monitoring & Logging

### 1. Application Logs

```bash
# Create logs directory
mkdir -p /var/log/clientsvia

# Setup log rotation
sudo nano /etc/logrotate.d/clientsvia
```

Add:

```
/var/log/clientsvia/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
}
```

### 2. Sentry Configuration

Already included in `.env`:

```bash
SENTRY_DSN=https://xxxxx@sentry.io/xxxxx
```

### 3. Health Monitoring

Setup external monitoring (e.g., UptimeRobot, Pingdom):

- Monitor: `https://your-domain.com/health`
- Check interval: 5 minutes
- Alert on: HTTP 500, timeout, or downtime

---

## Backup & Recovery

### 1. MongoDB Backups

Create backup script `scripts/backup-mongodb.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/mongodb"
DATE=$(date +%Y%m%d-%H%M%S)
mkdir -p $BACKUP_DIR

mongodump --uri="mongodb://clientsvia_app:your_app_password@localhost:27017/clientsvia" --out="$BACKUP_DIR/backup-$DATE"

# Keep only last 7 days
find $BACKUP_DIR -type d -mtime +7 -exec rm -rf {} +
```

Setup cron job:

```bash
crontab -e

# Add daily backup at 2 AM
0 2 * * * /path/to/scripts/backup-mongodb.sh
```

### 2. Application Backups

Automated via deployment script (`scripts/deploy.sh`)

---

## Deployment

### 1. Initial Deployment

```bash
# Clone repository
git clone https://github.com/your-org/clientsvia-backend.git
cd clientsvia-backend

# Setup environment
cp env.example .env
nano .env  # Configure all variables

# Validate environment
node utils/validateEnvironment.js

# Install dependencies
npm ci --production

# Run database setup
node scripts/verify-production-indexes.js

# Start application
pm2 start ecosystem.config.js
pm2 save
```

### 2. Updates

```bash
# Use deployment script
./scripts/deploy.sh production
```

---

## Troubleshooting

### Common Issues

#### 1. Cannot connect to MongoDB
```bash
# Check if MongoDB is running
sudo systemctl status mongod

# Check logs
sudo tail -f /var/log/mongodb/mongod.log

# Verify connection
mongosh --host localhost --port 27017
```

#### 2. Cannot connect to Redis
```bash
# Check if Redis is running
sudo systemctl status redis-server

# Test connection
redis-cli ping

# Check logs
sudo tail -f /var/log/redis/redis-server.log
```

#### 3. PM2 process crashes
```bash
# Check logs
pm2 logs clientsvia --lines 100

# Check error logs
cat logs/pm2-error.log

# Restart with verbose logging
pm2 restart clientsvia
```

#### 4. High memory usage
```bash
# Check PM2 memory
pm2 list

# Restart to clear memory
pm2 restart clientsvia

# Check for memory leaks
node --inspect index.js
```

#### 5. Twilio webhooks failing
```bash
# Check Nginx logs
sudo tail -f /var/log/nginx/clientsvia-error.log

# Check application logs
pm2 logs clientsvia | grep -i twilio

# Test webhook locally
curl -X POST http://localhost:3000/twilio/voice \
  -d "CallSid=test123&From=+1234567890&To=+0987654321"
```

---

## Production Checklist

Before going live, verify:

- [ ] All environment variables configured
- [ ] MongoDB secured and backed up
- [ ] Redis secured with password
- [ ] SSL certificate installed and auto-renewing
- [ ] Firewall configured correctly
- [ ] PM2 startup configured
- [ ] Nginx reverse proxy working
- [ ] Sentry error tracking active
- [ ] External monitoring setup
- [ ] Backup automation configured
- [ ] Load testing completed
- [ ] Security audit passed
- [ ] Documentation updated

---

## Support

For production issues, contact:
- **Emergency**: [Your emergency contact]
- **Email**: [Your support email]
- **Documentation**: Check `/docs` directory

---

**Last Updated**: October 16, 2025

