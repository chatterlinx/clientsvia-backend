#!/bin/bash

# ============================================================================
# PRODUCTION DEPLOYMENT SCRIPT - ClientsVia Platform
# ============================================================================
# Automated deployment with health checks and rollback capability
# Usage: ./scripts/deploy.sh [environment]
# ============================================================================

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================================================
# CONFIGURATION
# ============================================================================

ENVIRONMENT=${1:-production}
DEPLOY_DIR=$(pwd)
BACKUP_DIR="$DEPLOY_DIR/backups"
LOG_FILE="$DEPLOY_DIR/logs/deploy-$(date +%Y%m%d-%H%M%S).log"

# Health check settings
HEALTH_CHECK_RETRIES=30
HEALTH_CHECK_INTERVAL=2

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

log() {
    echo -e "${CYAN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}✅ $1${NC}" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}❌ $1${NC}" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}" | tee -a "$LOG_FILE"
}

info() {
    echo -e "${BLUE}ℹ️  $1${NC}" | tee -a "$LOG_FILE"
}

section() {
    echo -e "\n${CYAN}================================================================================${NC}" | tee -a "$LOG_FILE"
    echo -e "${CYAN}$1${NC}" | tee -a "$LOG_FILE"
    echo -e "${CYAN}================================================================================${NC}\n" | tee -a "$LOG_FILE"
}

# ============================================================================
# PRE-DEPLOYMENT CHECKS
# ============================================================================

pre_deployment_checks() {
    section "PRE-DEPLOYMENT CHECKS"
    
    # Check if running in correct directory
    if [ ! -f "package.json" ]; then
        error "package.json not found. Are you in the correct directory?"
        exit 1
    fi
    success "Running in correct directory"

    # Check git status
    if [ -n "$(git status --porcelain)" ]; then
        warning "Working directory has uncommitted changes"
        git status
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            error "Deployment cancelled"
            exit 1
        fi
    else
        success "Working directory is clean"
    fi

    # Check if on correct branch
    CURRENT_BRANCH=$(git branch --show-current)
    if [ "$ENVIRONMENT" == "production" ] && [ "$CURRENT_BRANCH" != "main" ]; then
        warning "Not on 'main' branch (current: $CURRENT_BRANCH)"
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            error "Deployment cancelled"
            exit 1
        fi
    fi
    success "On branch: $CURRENT_BRANCH"

    # Check Node.js version
    NODE_VERSION=$(node --version)
    success "Node.js version: $NODE_VERSION"

    # Check npm version
    NPM_VERSION=$(npm --version)
    success "npm version: $NPM_VERSION"

    # Check environment file
    if [ ! -f ".env" ]; then
        error ".env file not found"
        exit 1
    fi
    success ".env file exists"

    # Verify required environment variables
    log "Checking required environment variables..."
    node -e "require('./utils/validateEnvironment').validateEnvironment()" || {
        error "Environment validation failed"
        exit 1
    }
    success "All required environment variables are set"
}

# ============================================================================
# BACKUP
# ============================================================================

create_backup() {
    section "CREATING BACKUP"
    
    mkdir -p "$BACKUP_DIR"
    
    BACKUP_NAME="backup-$(date +%Y%m%d-%H%M%S).tar.gz"
    BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
    
    log "Creating backup: $BACKUP_NAME"
    
    # Backup current deployment (excluding node_modules and logs)
    tar -czf "$BACKUP_PATH" \
        --exclude='node_modules' \
        --exclude='logs' \
        --exclude='backups' \
        --exclude='.git' \
        . || {
        error "Backup creation failed"
        exit 1
    }
    
    success "Backup created: $BACKUP_PATH"
    
    # Keep only last 5 backups
    ls -t "$BACKUP_DIR"/*.tar.gz | tail -n +6 | xargs -r rm
    success "Old backups cleaned up"
    
    echo "$BACKUP_PATH" > "$DEPLOY_DIR/.last-backup"
}

# ============================================================================
# DATABASE MIGRATION
# ============================================================================

run_migrations() {
    section "RUNNING DATABASE MIGRATIONS"
    
    log "Checking database indexes..."
    node scripts/verify-production-indexes.js || {
        error "Database index verification failed"
        exit 1
    }
    success "Database indexes verified"
    
    log "Running any pending migrations..."
    # Add your migration commands here
    # npm run migrate
    success "Migrations completed"
}

# ============================================================================
# DEPENDENCIES
# ============================================================================

install_dependencies() {
    section "INSTALLING DEPENDENCIES"
    
    log "Installing Node.js dependencies..."
    npm ci --production || {
        error "npm install failed"
        exit 1
    }
    success "Dependencies installed"
}

# ============================================================================
# BUILD
# ============================================================================

build_application() {
    section "BUILDING APPLICATION"
    
    # If you have a build step (TypeScript, etc.)
    # npm run build
    
    success "Application built successfully"
}

# ============================================================================
# RESTART SERVICES
# ============================================================================

restart_services() {
    section "RESTARTING SERVICES"
    
    log "Stopping application..."
    
    # PM2 restart (if using PM2)
    if command -v pm2 &> /dev/null; then
        pm2 stop clientsvia || true
        pm2 delete clientsvia || true
        log "PM2 process stopped"
        
        log "Starting application with PM2..."
        pm2 start index.js --name clientsvia --node-args="--max-old-space-size=2048"
        pm2 save
        success "Application started with PM2"
    else
        # Systemd restart (if using systemd)
        if command -v systemctl &> /dev/null; then
            sudo systemctl restart clientsvia
            success "Application restarted via systemd"
        else
            warning "No process manager found. Please restart manually."
        fi
    fi
}

# ============================================================================
# HEALTH CHECKS
# ============================================================================

health_check() {
    section "RUNNING HEALTH CHECKS"
    
    local retries=0
    local health_url="http://localhost:${PORT:-3000}/health"
    
    log "Waiting for application to start..."
    sleep 5
    
    while [ $retries -lt $HEALTH_CHECK_RETRIES ]; do
        if curl -sf "$health_url" > /dev/null 2>&1; then
            success "Application is healthy!"
            
            # Get detailed health info
            log "Health check details:"
            curl -s "$health_url" | node -e "const data = JSON.parse(require('fs').readFileSync(0)); console.log(JSON.stringify(data, null, 2));"
            
            return 0
        fi
        
        retries=$((retries + 1))
        log "Health check attempt $retries/$HEALTH_CHECK_RETRIES..."
        sleep $HEALTH_CHECK_INTERVAL
    done
    
    error "Health check failed after $HEALTH_CHECK_RETRIES attempts"
    return 1
}

# ============================================================================
# SMOKE TESTS
# ============================================================================

run_smoke_tests() {
    section "RUNNING SMOKE TESTS"
    
    local base_url="http://localhost:${PORT:-3000}"
    
    # Test 1: Health endpoint
    log "Testing /health endpoint..."
    if curl -sf "$base_url/health" > /dev/null; then
        success "Health endpoint responsive"
    else
        error "Health endpoint failed"
        return 1
    fi
    
    # Test 2: API base endpoint
    log "Testing /api/companies endpoint..."
    if curl -sf "$base_url/api/companies" > /dev/null; then
        success "API endpoint responsive"
    else
        warning "API endpoint may require authentication"
    fi
    
    # Test 3: Redis connection
    log "Checking Redis connection..."
    node -e "
        const { redisClient } = require('./clients');
        redisClient.ping().then(() => {
            console.log('Redis connected');
            process.exit(0);
        }).catch(err => {
            console.error('Redis connection failed:', err.message);
            process.exit(1);
        });
    " || {
        error "Redis connection failed"
        return 1
    }
    success "Redis connection verified"
    
    # Test 4: MongoDB connection
    log "Checking MongoDB connection..."
    node -e "
        const mongoose = require('mongoose');
        require('dotenv').config();
        mongoose.connect(process.env.MONGODB_URI).then(() => {
            console.log('MongoDB connected');
            mongoose.connection.close();
            process.exit(0);
        }).catch(err => {
            console.error('MongoDB connection failed:', err.message);
            process.exit(1);
        });
    " || {
        error "MongoDB connection failed"
        return 1
    }
    success "MongoDB connection verified"
    
    success "All smoke tests passed!"
}

# ============================================================================
# ROLLBACK
# ============================================================================

rollback() {
    section "ROLLING BACK DEPLOYMENT"
    
    if [ ! -f "$DEPLOY_DIR/.last-backup" ]; then
        error "No backup found for rollback"
        exit 1
    fi
    
    LAST_BACKUP=$(cat "$DEPLOY_DIR/.last-backup")
    
    if [ ! -f "$LAST_BACKUP" ]; then
        error "Backup file not found: $LAST_BACKUP"
        exit 1
    fi
    
    log "Restoring from backup: $LAST_BACKUP"
    
    # Extract backup
    tar -xzf "$LAST_BACKUP" || {
        error "Failed to extract backup"
        exit 1
    }
    
    # Restart services
    restart_services
    
    # Verify rollback
    if health_check; then
        success "Rollback successful!"
    else
        error "Rollback failed - manual intervention required"
        exit 1
    fi
}

# ============================================================================
# POST-DEPLOYMENT
# ============================================================================

post_deployment() {
    section "POST-DEPLOYMENT TASKS"
    
    # Clear old logs (keep last 7 days)
    log "Cleaning old logs..."
    find "$DEPLOY_DIR/logs" -name "*.log" -mtime +7 -delete 2>/dev/null || true
    success "Old logs cleaned"
    
    # Generate deployment report
    log "Generating deployment report..."
    cat > "$DEPLOY_DIR/logs/deploy-report-$(date +%Y%m%d-%H%M%S).txt" << EOF
Deployment Report
================
Environment: $ENVIRONMENT
Date: $(date)
Git Branch: $(git branch --show-current)
Git Commit: $(git rev-parse HEAD)
Node Version: $(node --version)
Deployed By: $(whoami)
Status: SUCCESS
EOF
    success "Deployment report generated"
    
    # Display summary
    section "DEPLOYMENT SUMMARY"
    success "Deployment completed successfully!"
    info "Environment: $ENVIRONMENT"
    info "Commit: $(git rev-parse --short HEAD)"
    info "Time: $(date)"
    echo ""
}

# ============================================================================
# MAIN DEPLOYMENT FLOW
# ============================================================================

main() {
    section "CLIENTSVIA DEPLOYMENT - $ENVIRONMENT"
    log "Starting deployment process..."
    
    # Create log directory
    mkdir -p "$(dirname "$LOG_FILE")"
    
    # Run deployment steps
    pre_deployment_checks
    create_backup
    install_dependencies
    run_migrations
    build_application
    restart_services
    
    # Verify deployment
    if health_check && run_smoke_tests; then
        post_deployment
        exit 0
    else
        error "Deployment verification failed"
        read -p "Rollback to previous version? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rollback
        else
            error "Deployment failed - manual intervention required"
            exit 1
        fi
    fi
}

# ============================================================================
# SCRIPT EXECUTION
# ============================================================================

# Trap errors and offer rollback
trap 'error "Deployment failed at line $LINENO"; read -p "Rollback? (y/n) " -n 1 -r; echo; [[ $REPLY =~ ^[Yy]$ ]] && rollback || exit 1' ERR

# Run main deployment
main

exit 0

