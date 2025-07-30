# Troubleshooting Guide - ClientsVia AI Platform

## 🔍 Common Issues & Solutions

This guide provides solutions to frequently encountered issues in the ClientsVia AI platform.

## 🚨 Quick Diagnostic Commands

### System Status Check
```bash
# Check application health
curl -s http://localhost:3000/health | jq .

# Check process status
pm2 status

# Check system resources
htop
df -h
free -h

# Check logs
tail -f logs/combined.log
tail -f logs/error.log
```

### Service Connectivity
```bash
# Test MongoDB connection
mongosh "$MONGODB_URI" --eval "db.runCommand('ping')"

# Test Redis connection
redis-cli -u "$REDIS_URL" ping

# Test external APIs
curl -s "https://api.openai.com/v1/models" -H "Authorization: Bearer $OPENAI_API_KEY"
```

## 🔐 Authentication & Security Issues

### Issue: "Session Conflict Detected"
**Symptoms**: User cannot login, receives session conflict error

**Cause**: Single-session lockout system detecting concurrent sessions

**Solution**:
```bash
# Clear user sessions
redis-cli -u "$REDIS_URL" DEL "session:USER_ID"

# Or use emergency bypass
curl -X POST http://localhost:3000/auth/emergency-clear \
  -H "X-Emergency-Bypass: $EMERGENCY_BYPASS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"userId": "USER_ID"}'
```

**Prevention**:
- Ensure proper logout procedures
- Check for browser session persistence
- Verify device fingerprinting accuracy

### Issue: "Hardware ID Mismatch"
**Symptoms**: User logged out unexpectedly, cannot authenticate

**Cause**: Hardware fingerprint changed (new browser, cleared data, etc.)

**Solution**:
```bash
# Reset hardware ID for user
redis-cli -u "$REDIS_URL" DEL "hardware:USER_ID"

# Or disable hardware lock temporarily
export HARDWARE_LOCK_ENABLED=false
pm2 restart all
```

**Prevention**:
- Implement hardware ID grace period
- Allow multiple approved devices
- Better user education about browser data

### Issue: "Geographic Access Denied"
**Symptoms**: User blocked based on location

**Cause**: GeoIP service detecting disallowed country

**Solution**:
```bash
# Check user's detected location
curl -s "http://ip-api.com/json/USER_IP"

# Temporarily disable GeoIP
export GEOIP_ENABLED=false
pm2 restart all

# Add country to allowed list
export ALLOWED_COUNTRIES="$ALLOWED_COUNTRIES,NEW_COUNTRY"
pm2 restart all
```

**Prevention**:
- Regular review of allowed countries
- VPN detection and handling
- User location verification process

### Issue: "JWT Token Expired"
**Symptoms**: Frequent token expiration, user logged out

**Cause**: Short token lifetime, failed refresh mechanism

**Solution**:
```javascript
// Check token refresh mechanism
// In browser console:
localStorage.getItem('authToken');
// Should show valid token

// Manual token refresh
fetch('/auth/refresh', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${currentToken}`
  }
});
```

**Prevention**:
- Verify auto-refresh intervals
- Check network connectivity
- Implement better error handling

## 🤖 AI Engine Issues

### Issue: "AI Response Timeout"
**Symptoms**: Slow or failed AI responses

**Cause**: External API timeouts, high load, network issues

**Diagnostics**:
```bash
# Check OpenAI API status
curl -s "https://status.openai.com/api/v2/status.json" | jq .

# Check response times
grep "AI_RESPONSE_TIME" logs/combined.log | tail -20

# Monitor memory usage
ps aux | grep node
```

**Solutions**:
```javascript
// Increase timeout settings
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000, // Increase to 30 seconds
  maxRetries: 3
});

// Implement circuit breaker
if (failureCount > 5) {
  return fallbackResponse;
}
```

**Prevention**:
- Implement request queuing
- Add circuit breaker pattern
- Use response caching
- Monitor API quotas

### Issue: "Template Intelligence Not Working"
**Symptoms**: Poor response quality, template matching failures

**Cause**: Outdated templates, poor training data, configuration issues

**Diagnostics**:
```bash
# Check template configuration
curl -s "http://localhost:3000/ai-agent-logic/config/COMPANY_ID" | jq .templateIntelligence

# Review template performance
grep "TEMPLATE_MATCH" logs/combined.log | tail -50
```

**Solutions**:
```javascript
// Reset template intelligence
await templateIntelligenceEngine.reset(companyId);

// Retrain with recent data
await templateIntelligenceEngine.trainWithRecentData(companyId);

// Manual template review
const templates = await templateIntelligenceEngine.getAllTemplates(companyId);
console.log(templates);
```

**Prevention**:
- Regular template performance review
- Automated template optimization
- User feedback integration
- A/B testing for templates

### Issue: "Knowledge Base Search Failing"
**Symptoms**: No relevant results, search errors

**Cause**: Missing indexes, corrupted data, search configuration

**Diagnostics**:
```bash
# Check MongoDB indexes
mongosh "$MONGODB_URI" --eval "db.knowledgeentries.getIndexes()"

# Test search manually
mongosh "$MONGODB_URI" --eval "db.knowledgeentries.find({\$text: {\$search: 'plumbing'}})"
```

**Solutions**:
```javascript
// Rebuild search indexes
await db.collection('knowledgeentries').dropIndexes();
await db.collection('knowledgeentries').createIndex({
  question: 'text',
  answer: 'text',
  tags: 'text'
});

// Clear and rebuild knowledge base
await knowledgeBaseService.rebuildIndex(companyId);
```

## 💾 Database Issues

### Issue: "MongoDB Connection Failed"
**Symptoms**: Database connection errors, application startup failure

**Cause**: Network issues, authentication problems, resource limits

**Diagnostics**:
```bash
# Test direct connection
mongosh "$MONGODB_URI"

# Check MongoDB logs
sudo tail -f /var/log/mongodb/mongod.log

# Check connection limits
mongosh --eval "db.serverStatus().connections"
```

**Solutions**:
```javascript
// Increase connection pool size
mongoose.connect(mongoUri, {
  maxPoolSize: 50,
  minPoolSize: 5,
  maxIdleTimeMS: 30000,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
});

// Implement connection retry
const connectWithRetry = () => {
  mongoose.connect(mongoUri).catch(() => {
    setTimeout(connectWithRetry, 5000);
  });
};
```

**Prevention**:
- Monitor connection pool usage
- Implement proper connection handling
- Regular database maintenance
- Connection limit alerts

### Issue: "Redis Connection Lost"
**Symptoms**: Session data lost, cache misses, connection errors

**Cause**: Redis server issues, network problems, memory limits

**Diagnostics**:
```bash
# Check Redis status
redis-cli -u "$REDIS_URL" ping

# Check Redis memory usage
redis-cli -u "$REDIS_URL" info memory

# Monitor Redis connections
redis-cli -u "$REDIS_URL" info clients
```

**Solutions**:
```javascript
// Implement Redis reconnection
const redis = require('redis');
const client = redis.createClient({
  url: process.env.REDIS_URL,
  retry_strategy: (options) => {
    if (options.attempt > 10) return undefined;
    return Math.min(options.attempt * 100, 3000);
  }
});

client.on('error', (err) => {
  console.error('Redis error:', err);
});

client.on('reconnecting', () => {
  console.log('Redis reconnecting...');
});
```

**Prevention**:
- Redis cluster setup
- Memory usage monitoring
- Connection pooling
- Persistence configuration

## 🌐 Network & Performance Issues

### Issue: "High Response Times"
**Symptoms**: Slow API responses, timeout errors

**Cause**: High CPU usage, memory leaks, inefficient queries

**Diagnostics**:
```bash
# Check system resources
top -p $(pgrep -f "node")

# Monitor response times
grep "REQUEST_DURATION" logs/combined.log | awk '{print $NF}' | sort -n

# Check database query performance
mongosh --eval "db.setProfilingLevel(2, {slowms: 100})"
```

**Solutions**:
```javascript
// Add request timeout middleware
app.use((req, res, next) => {
  req.setTimeout(30000, () => {
    res.status(408).json({ error: 'Request timeout' });
  });
  next();
});

// Implement query optimization
const optimizedQuery = Model.find(criteria)
  .lean()
  .limit(50)
  .select('essential fields only');

// Add response caching
const cache = require('./cache');
app.get('/api/expensive-endpoint', async (req, res) => {
  const cached = await cache.get(req.url);
  if (cached) return res.json(cached);
  
  const result = await expensiveOperation();
  await cache.set(req.url, result, 300); // 5 min cache
  res.json(result);
});
```

**Prevention**:
- Regular performance monitoring
- Database query optimization
- Response caching strategy
- Load testing

### Issue: "Memory Leaks"
**Symptoms**: Increasing memory usage, application crashes

**Cause**: Unclosed connections, retained references, large objects

**Diagnostics**:
```bash
# Monitor memory usage over time
ps -o pid,vsz,rss,comm -p $(pgrep -f "node") | watch -n 5

# Generate heap dump
kill -USR2 $(pgrep -f "node")

# Analyze with clinic.js
npm install -g clinic
clinic doctor -- node server.js
```

**Solutions**:
```javascript
// Proper connection cleanup
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  await redis.quit();
  process.exit(0);
});

// Monitor memory usage
setInterval(() => {
  const usage = process.memoryUsage();
  if (usage.rss > 1024 * 1024 * 1024) { // 1GB
    console.warn('High memory usage:', usage);
  }
}, 60000);

// Implement proper error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});
```

## 🔄 Deployment Issues

### Issue: "Application Won't Start"
**Symptoms**: PM2 errors, startup failures, dependency issues

**Cause**: Missing dependencies, environment variables, port conflicts

**Diagnostics**:
```bash
# Check PM2 logs
pm2 logs

# Check environment variables
env | grep -E "(NODE_ENV|MONGODB_URI|REDIS_URL)"

# Check port availability
netstat -tlnp | grep :3000

# Test manual startup
node server.js
```

**Solutions**:
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Reset PM2
pm2 delete all
pm2 start ecosystem.config.js

# Check file permissions
sudo chown -R $(whoami):$(whoami) .
chmod +x server.js
```

### Issue: "SSL Certificate Errors"
**Symptoms**: HTTPS errors, browser security warnings

**Cause**: Expired certificates, misconfiguration, chain issues

**Diagnostics**:
```bash
# Check certificate expiry
openssl x509 -in /etc/ssl/certs/clientsvia.crt -text -noout | grep "Not After"

# Test SSL configuration
openssl s_client -connect api.clientsvia.com:443 -servername api.clientsvia.com

# Check certificate chain
curl -I https://api.clientsvia.com
```

**Solutions**:
```bash
# Renew Let's Encrypt certificate
sudo certbot renew

# Restart nginx
sudo systemctl restart nginx

# Update certificate paths in config
sudo nano /etc/nginx/sites-available/clientsvia
```

## 🧪 Development Issues

### Issue: "Local Development Setup Fails"
**Symptoms**: Cannot start development server, dependency errors

**Cause**: Node version mismatch, missing services, configuration

**Solutions**:
```bash
# Check Node.js version
node --version
# Should be 18.0.0 or higher

# Install correct Node version with nvm
nvm install 18
nvm use 18

# Install dependencies
npm install

# Start required services
# MongoDB
brew services start mongodb/brew/mongodb-community
# or
sudo systemctl start mongod

# Redis
brew services start redis
# or
sudo systemctl start redis

# Copy environment file
cp .env.example .env
# Edit .env with local configuration

# Start development server
npm run dev
```

### Issue: "Tests Failing"
**Symptoms**: Unit or integration test failures

**Cause**: Database state, environment differences, async issues

**Solutions**:
```bash
# Clean test database
mongosh "mongodb://localhost:27017/clientsvia-test" --eval "db.dropDatabase()"

# Run tests with clean environment
NODE_ENV=test npm test

# Run specific test file
npm test -- tests/specific-test.js

# Run tests with coverage
npm test -- --coverage
```

**Debugging Tests**:
```javascript
// Add debugging to tests
describe('API Tests', () => {
  beforeEach(async () => {
    console.log('Setting up test data...');
    // Setup code
  });
  
  afterEach(async () => {
    console.log('Cleaning up test data...');
    // Cleanup code
  });
  
  test('should work', async () => {
    console.log('Starting test...');
    // Test code with console.log for debugging
  });
});
```

## 📊 Monitoring & Alerts

### Setting Up Monitoring Alerts

#### Memory Usage Alert
```bash
# Add to crontab
*/5 * * * * /usr/local/bin/check-memory.sh

# check-memory.sh
#!/bin/bash
MEMORY_USAGE=$(free | grep '^Mem:' | awk '{print ($3/$2) * 100.0}')
if (( $(echo "$MEMORY_USAGE > 80" | bc -l) )); then
  echo "High memory usage: $MEMORY_USAGE%" | mail -s "Memory Alert" admin@clientsvia.com
fi
```

#### Disk Space Alert
```bash
# check-disk.sh
#!/bin/bash
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
if [ $DISK_USAGE -gt 85 ]; then
  echo "High disk usage: $DISK_USAGE%" | mail -s "Disk Space Alert" admin@clientsvia.com
fi
```

#### Application Health Check
```bash
# check-health.sh
#!/bin/bash
HEALTH=$(curl -s http://localhost:3000/health | jq -r '.status')
if [ "$HEALTH" != "healthy" ]; then
  echo "Application unhealthy" | mail -s "Health Check Failed" admin@clientsvia.com
fi
```

## 🆘 Emergency Procedures

### Complete System Restart
```bash
# Stop all services
pm2 stop all
sudo systemctl stop nginx
sudo systemctl stop redis
sudo systemctl stop mongod

# Start services in order
sudo systemctl start mongod
sudo systemctl start redis
pm2 start all
sudo systemctl start nginx

# Verify system health
curl -s http://localhost:3000/health
```

### Emergency Data Recovery
```bash
# Restore from latest backup
aws s3 cp s3://clientsvia-backups/latest.tar.gz /tmp/
cd /tmp
tar -xzf latest.tar.gz
mongorestore --drop backup/

# Clear cache
redis-cli FLUSHALL

# Restart application
pm2 restart all
```

### Emergency Access
```bash
# Use emergency bypass for authentication
curl -X POST http://localhost:3000/auth/emergency-login \
  -H "X-Emergency-Bypass: $EMERGENCY_BYPASS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"reason": "System recovery"}'
```

## 📞 Getting Help

### Log Analysis
```bash
# Search for specific errors
grep -i "error" logs/combined.log | tail -20

# Search by time range
grep "2025-01-27 10:" logs/combined.log

# Count error types
grep "ERROR" logs/combined.log | awk '{print $4}' | sort | uniq -c
```

### Performance Analysis
```bash
# Response time analysis
grep "REQUEST_DURATION" logs/combined.log | \
  awk '{print $NF}' | \
  awk 'BEGIN{sum=0; count=0; max=0} 
       {sum+=$1; count++; if($1>max) max=$1} 
       END{print "Avg:", sum/count, "Max:", max}'

# Error rate calculation
total=$(grep "REQUEST" logs/combined.log | wc -l)
errors=$(grep "ERROR" logs/combined.log | wc -l)
echo "Error rate: $(echo "scale=2; $errors * 100 / $total" | bc)%"
```

### Support Contacts
- **Technical Support**: support@clientsvia.com
- **Emergency Line**: +1-555-EMERGENCY
- **Security Issues**: security@clientsvia.com
- **Performance Issues**: performance@clientsvia.com

### Escalation Process
1. **Level 1**: Check this troubleshooting guide
2. **Level 2**: Review logs and system metrics
3. **Level 3**: Contact technical support with diagnostic info
4. **Level 4**: Emergency escalation for critical issues

---

**Remember**: Always create backups before making significant changes!

**Documentation**: Keep this guide updated with new issues and solutions.

**Emergency Contact**: emergency@clientsvia.com | +1-555-EMERGENCY
