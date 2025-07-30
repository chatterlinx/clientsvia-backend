# Deployment Guide - ClientsVia AI Platform

## 🚀 Production Deployment

This guide covers deploying the ClientsVia AI platform to production environments with enterprise-grade security and scalability.

## 📋 Pre-Deployment Checklist

### Security Requirements
- [ ] **Environment Variables**: All secrets configured securely
- [ ] **HTTPS**: SSL/TLS certificates installed
- [ ] **Database Security**: MongoDB authentication enabled
- [ ] **Redis Security**: Redis authentication configured
- [ ] **Firewall**: Network security rules in place
- [ ] **Backup Strategy**: Automated backups configured

### Performance Requirements
- [ ] **Load Testing**: Application tested under expected load
- [ ] **Database Indexing**: All required indexes created
- [ ] **Caching**: Redis cache strategy implemented
- [ ] **CDN**: Static assets served via CDN
- [ ] **Monitoring**: Application monitoring configured

### Compliance Requirements
- [ ] **Audit Logging**: Security events logged
- [ ] **Data Protection**: GDPR/privacy compliance
- [ ] **Session Security**: Single-session lockout tested
- [ ] **Geographic Restrictions**: GeoIP validation active
- [ ] **Emergency Procedures**: Bypass system documented

## 🏗️ Infrastructure Architecture

### Recommended Production Setup

```
┌─────────────────────────────────────────────────────────────────┐
│                        Load Balancer                            │
│                    (Nginx/HAProxy)                             │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────────────┐
│                Application Servers                              │
│              (Node.js Cluster Mode)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   App 1     │  │   App 2     │  │   App 3     │            │
│  │ Port 3001   │  │ Port 3002   │  │ Port 3003   │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────┬───────────────────┬───────────────────────┘
                      │                   │
┌─────────────────────┴───────────────────┴───────────────────────┐
│                     Data Layer                                  │
│  ┌─────────────────┐    ┌─────────────────┐                   │
│  │    MongoDB      │    │     Redis       │                   │
│  │   (Replica Set) │    │   (Cluster)     │                   │
│  └─────────────────┘    └─────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

## 🖥️ Server Requirements

### Minimum Production Specs
- **CPU**: 4 cores (8 threads)
- **RAM**: 16GB
- **Storage**: 100GB SSD
- **Network**: 1Gbps connection
- **OS**: Ubuntu 20.04 LTS or CentOS 8

### Recommended Production Specs
- **CPU**: 8 cores (16 threads)
- **RAM**: 32GB
- **Storage**: 500GB NVMe SSD
- **Network**: 10Gbps connection
- **OS**: Ubuntu 22.04 LTS

### Database Servers
- **MongoDB**: 3-node replica set
- **Redis**: Master-slave with sentinel
- **Backup Storage**: Separate dedicated storage

## 🐋 Docker Deployment

### Dockerfile
```dockerfile
# Production Dockerfile
FROM node:18-alpine AS base

# Install security updates
RUN apk update && apk upgrade && \
    apk add --no-cache dumb-init

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S clientsvia -u 1001

# Set ownership
RUN chown -R clientsvia:nodejs /app
USER clientsvia

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

# Start application
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
```

### Docker Compose
```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - MONGODB_URI=mongodb://mongo:27017/clientsvia
      - REDIS_URL=redis://redis:6379
    depends_on:
      - mongo
      - redis
    restart: unless-stopped
    
  mongo:
    image: mongo:6.0
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD}
    volumes:
      - mongo_data:/data/db
    restart: unless-stopped
    
  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    restart: unless-stopped
    
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app
    restart: unless-stopped

volumes:
  mongo_data:
  redis_data:
```

### Build and Deploy
```bash
# Build production image
docker build -t clientsvia:latest .

# Deploy with compose
docker-compose -f docker-compose.prod.yml up -d

# Scale application
docker-compose -f docker-compose.prod.yml up -d --scale app=3
```

## ☁️ Cloud Platform Deployments

### AWS Deployment

#### Using ECS with Fargate
```yaml
# ecs-task-definition.json
{
  "family": "clientsvia-app",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::account:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::account:role/ecsTaskRole",
  "containerDefinitions": [
    {
      "name": "clientsvia-app",
      "image": "your-registry/clientsvia:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "secrets": [
        {
          "name": "MONGODB_URI",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:mongodb-uri"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/clientsvia",
          "awslogs-region": "us-west-2",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

#### Infrastructure as Code (Terraform)
```hcl
# main.tf
provider "aws" {
  region = var.aws_region
}

# VPC
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  
  tags = {
    Name = "clientsvia-vpc"
  }
}

# ECS Cluster
resource "aws_ecs_cluster" "main" {
  name = "clientsvia-cluster"
  
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# Application Load Balancer
resource "aws_lb" "main" {
  name               = "clientsvia-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets           = aws_subnet.public[*].id
  
  enable_deletion_protection = true
}

# DocumentDB (MongoDB compatible)
resource "aws_docdb_cluster" "main" {
  cluster_identifier      = "clientsvia-docdb"
  engine                 = "docdb"
  master_username        = var.docdb_username
  master_password        = var.docdb_password
  backup_retention_period = 30
  preferred_backup_window = "07:00-09:00"
  skip_final_snapshot    = false
  
  vpc_security_group_ids = [aws_security_group.docdb.id]
  db_subnet_group_name   = aws_docdb_subnet_group.main.name
  
  enabled_cloudwatch_logs_exports = ["audit", "profiler"]
}

# ElastiCache (Redis)
resource "aws_elasticache_replication_group" "main" {
  description          = "ClientsVia Redis cluster"
  replication_group_id = "clientsvia-redis"
  node_type           = "cache.r6g.large"
  port                = 6379
  parameter_group_name = "default.redis7"
  
  num_cache_clusters = 2
  
  automatic_failover_enabled = true
  multi_az_enabled          = true
  
  subnet_group_name = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]
  
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                = var.redis_auth_token
}
```

### Google Cloud Deployment

#### Using Cloud Run
```yaml
# cloudbuild.yaml
steps:
  # Build container image
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/clientsvia:$COMMIT_SHA', '.']
  
  # Push to Container Registry
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/clientsvia:$COMMIT_SHA']
  
  # Deploy to Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
    - 'run'
    - 'deploy'
    - 'clientsvia-app'
    - '--image'
    - 'gcr.io/$PROJECT_ID/clientsvia:$COMMIT_SHA'
    - '--region'
    - 'us-central1'
    - '--platform'
    - 'managed'
    - '--allow-unauthenticated'
```

### Digital Ocean Deployment

#### App Platform Configuration
```yaml
# .do/app.yaml
name: clientsvia-platform
services:
- name: api
  source_dir: /
  github:
    repo: your-username/clientsvia-backend
    branch: main
  run_command: npm start
  environment_slug: node-js
  instance_count: 2
  instance_size_slug: professional-xs
  
  envs:
  - key: NODE_ENV
    value: production
  - key: MONGODB_URI
    value: ${db.DATABASE_URL}
  - key: REDIS_URL
    value: ${redis.REDIS_URL}
  
  health_check:
    http_path: /health
    
databases:
- name: db
  engine: MONGODB
  version: "5"
  size: db-s-1vcpu-1gb
  
- name: redis
  engine: REDIS
  version: "7"
  size: db-s-1vcpu-1gb
```

## 🔧 Production Configuration

### Environment Variables
```bash
# Production .env
NODE_ENV=production
PORT=3000

# Database
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/clientsvia
REDIS_URL=redis://username:password@host:6379

# Security
JWT_SECRET=ultra-secure-production-jwt-secret-key
SESSION_SECRET=ultra-secure-production-session-secret
EMERGENCY_BYPASS_KEY=ultra-secure-emergency-key-2025

# Security Features
HARDWARE_LOCK_ENABLED=true
GEOIP_ENABLED=true
ALLOWED_COUNTRIES=US,CA,GB,AU,DE,FR

# Rate Limiting
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=100

# External Services
OPENAI_API_KEY=sk-production-openai-key
SENDGRID_API_KEY=SG.production-sendgrid-key
TWILIO_ACCOUNT_SID=production-twilio-sid
TWILIO_AUTH_TOKEN=production-twilio-token

# Monitoring
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project
LOG_LEVEL=info

# GeoIP Service
GEOIP_API_KEY=your-geoip-api-key
```

### Nginx Configuration
```nginx
# /etc/nginx/sites-available/clientsvia
upstream clientsvia_backend {
    least_conn;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    server 127.0.0.1:3003;
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name api.clientsvia.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS Configuration
server {
    listen 443 ssl http2;
    server_name api.clientsvia.com;
    
    # SSL Configuration
    ssl_certificate /etc/ssl/certs/clientsvia.crt;
    ssl_certificate_key /etc/ssl/private/clientsvia.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;
    
    # Proxy Configuration
    location / {
        proxy_pass http://clientsvia_backend;
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
    
    # Health Check
    location /health {
        proxy_pass http://clientsvia_backend;
        access_log off;
    }
    
    # Static Files
    location /static/ {
        alias /var/www/clientsvia/static/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### PM2 Configuration
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'clientsvia-api',
    script: 'server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    log_date_format: 'YYYY-MM-DD HH:mm Z',
    error_file: '/var/log/clientsvia/error.log',
    out_file: '/var/log/clientsvia/out.log',
    log_file: '/var/log/clientsvia/combined.log',
    max_memory_restart: '1G',
    watch: false,
    ignore_watch: ['node_modules', 'logs'],
    restart_delay: 4000,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
```

## 📊 Monitoring & Observability

### Application Monitoring
```javascript
// services/monitoring.js
const Sentry = require('@sentry/node');
const { ProfilingIntegration } = require('@sentry/profiling-node');

// Initialize Sentry
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  integrations: [
    new ProfilingIntegration()
  ],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0
});

// Custom metrics
const customMetrics = {
  requestCount: 0,
  errorCount: 0,
  responseTime: [],
  
  recordRequest(duration) {
    this.requestCount++;
    this.responseTime.push(duration);
  },
  
  recordError() {
    this.errorCount++;
  },
  
  getMetrics() {
    const avgResponseTime = this.responseTime.length > 0
      ? this.responseTime.reduce((a, b) => a + b) / this.responseTime.length
      : 0;
    
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      errorRate: this.requestCount > 0 ? this.errorCount / this.requestCount : 0,
      avgResponseTime
    };
  }
};

module.exports = { customMetrics };
```

### Health Check Endpoint
```javascript
// healthcheck.js
const http = require('http');

const options = {
  hostname: 'localhost',
  port: process.env.PORT || 3000,
  path: '/health',
  method: 'GET',
  timeout: 2000
};

const request = http.request(options, (res) => {
  if (res.statusCode === 200) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});

request.on('error', () => {
  process.exit(1);
});

request.on('timeout', () => {
  request.destroy();
  process.exit(1);
});

request.end();
```

### Log Management
```javascript
// services/productionLogger.js
const winston = require('winston');
const { ElasticsearchTransport } = require('winston-elasticsearch');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { 
    service: 'clientsvia-platform',
    environment: process.env.NODE_ENV
  },
  transports: [
    // File logging
    new winston.transports.File({ 
      filename: '/var/log/clientsvia/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: '/var/log/clientsvia/combined.log' 
    }),
    
    // Elasticsearch for log aggregation
    new ElasticsearchTransport({
      level: 'info',
      clientOpts: {
        node: process.env.ELASTICSEARCH_URL
      },
      index: 'clientsvia-logs'
    })
  ]
});

module.exports = logger;
```

## 🔒 Production Security

### SSL/TLS Certificate Setup
```bash
# Using Let's Encrypt with Certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d api.clientsvia.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

### Database Security
```javascript
// MongoDB connection with authentication
const mongoOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  authSource: 'admin',
  ssl: true,
  sslValidate: true,
  sslCA: fs.readFileSync('/etc/ssl/certs/mongodb-ca.pem'),
  retryWrites: true,
  w: 'majority'
};

mongoose.connect(process.env.MONGODB_URI, mongoOptions);
```

### Firewall Configuration
```bash
# UFW Firewall Setup
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH
sudo ufw allow ssh

# Allow HTTP/HTTPS
sudo ufw allow 80
sudo ufw allow 443

# Allow specific application ports (if needed)
sudo ufw allow 3000

# Enable firewall
sudo ufw enable
```

## 📈 Performance Optimization

### Database Optimization
```javascript
// MongoDB indexes for performance
const indexes = [
  // Company queries
  { companyId: 1, status: 1 },
  { companyId: 1, createdAt: -1 },
  
  // User authentication
  { username: 1 },
  { email: 1 },
  
  // Session management
  { userId: 1, deviceId: 1 },
  { expiresAt: 1 },
  
  // Knowledge base
  { companyId: 1, category: 1 },
  { companyId: 1, tags: 1 },
  
  // Text search
  {
    question: 'text',
    answer: 'text',
    tags: 'text'
  }
];

// Create indexes
indexes.forEach(index => {
  db.collection.createIndex(index);
});
```

### Caching Strategy
```javascript
// Redis caching implementation
const redis = require('redis');
const client = redis.createClient(process.env.REDIS_URL);

class CacheService {
  async get(key) {
    try {
      const value = await client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }
  
  async set(key, value, ttl = 3600) {
    try {
      await client.setex(key, ttl, JSON.stringify(value));
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }
  
  async del(key) {
    try {
      await client.del(key);
    } catch (error) {
      console.error('Cache delete error:', error);
    }
  }
}

module.exports = new CacheService();
```

## 🔄 Backup & Recovery

### Database Backup Script
```bash
#!/bin/bash
# backup-script.sh

# Configuration
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/mongodb"
RETENTION_DAYS=30

# Create backup directory
mkdir -p $BACKUP_DIR

# Perform backup
mongodump --uri="$MONGODB_URI" --out="$BACKUP_DIR/backup_$DATE"

# Compress backup
tar -czf "$BACKUP_DIR/backup_$DATE.tar.gz" -C "$BACKUP_DIR" "backup_$DATE"
rm -rf "$BACKUP_DIR/backup_$DATE"

# Upload to cloud storage (example with AWS S3)
aws s3 cp "$BACKUP_DIR/backup_$DATE.tar.gz" "s3://clientsvia-backups/mongodb/"

# Cleanup old backups
find $BACKUP_DIR -name "backup_*.tar.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: backup_$DATE.tar.gz"
```

### Automated Backup Cron Job
```bash
# Add to crontab (crontab -e)
# Daily backup at 2 AM
0 2 * * * /usr/local/bin/backup-script.sh >> /var/log/backup.log 2>&1

# Weekly full backup at 3 AM on Sundays
0 3 * * 0 /usr/local/bin/full-backup-script.sh >> /var/log/backup.log 2>&1
```

## 🚨 Disaster Recovery

### Recovery Procedures
```bash
# MongoDB Recovery
# 1. Stop the application
pm2 stop all

# 2. Download backup from S3
aws s3 cp "s3://clientsvia-backups/mongodb/backup_20250127_020000.tar.gz" /tmp/

# 3. Extract backup
cd /tmp
tar -xzf backup_20250127_020000.tar.gz

# 4. Restore database
mongorestore --uri="$MONGODB_URI" --drop backup_20250127_020000/

# 5. Restart application
pm2 restart all

# 6. Verify recovery
curl -s http://localhost:3000/health | jq .
```

### Emergency Procedures
```bash
# Emergency system restart
sudo systemctl restart nginx
pm2 restart all

# Emergency database connection reset
pm2 restart all

# Emergency cache clear
redis-cli FLUSHALL

# Emergency log rotation
sudo logrotate -f /etc/logrotate.d/clientsvia
```

## 📞 Support & Maintenance

### Deployment Checklist
- [ ] **Code**: Latest version deployed
- [ ] **Database**: Migrations run successfully
- [ ] **Environment**: All variables configured
- [ ] **SSL**: Certificates valid and current
- [ ] **Monitoring**: All services reporting healthy
- [ ] **Backup**: Latest backup verified
- [ ] **Security**: All security features enabled
- [ ] **Performance**: Load testing passed
- [ ] **Documentation**: Deployment documented

### Maintenance Windows
- **Scheduled**: Sundays 2-4 AM UTC
- **Emergency**: As needed with 15-minute notice
- **Updates**: Monthly security patches
- **Backups**: Daily automated, weekly verified

### Emergency Contacts
- **Platform Admin**: admin@clientsvia.com
- **Security Team**: security@clientsvia.com
- **Emergency Bypass**: Use emergency bypass key
- **Hosting Provider**: [Contact details]

---

**Deployment Support**: deploy@clientsvia.com  
**Emergency Line**: +1-555-EMERGENCY  
**Status Page**: https://status.clientsvia.com
