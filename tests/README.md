# 🧪 ClientsVia Enterprise Testing Suite

This directory contains comprehensive tests for the ClientsVia Enterprise AI Agent Logic features. The test suite is designed for continuous integration, development validation, and production readiness verification.

## 📁 Directory Structure

```
tests/
├── README.md                          # This file
├── enterprise/                        # Enterprise feature tests
│   ├── analytics.test.js             # Analytics dashboard tests
│   ├── ab-testing.test.js             # A/B testing framework tests
│   ├── personalization.test.js       # Personalization engine tests
│   ├── flow-designer.test.js          # Flow designer tests
│   └── integration.test.js            # Full integration tests
├── scripts/                           # Test execution scripts
│   ├── run-all-tests.sh              # Execute complete test suite
│   ├── validate-production.sh        # Production readiness validation
│   ├── test-api-endpoints.sh          # API endpoint testing
│   └── test-frontend.sh              # Frontend functionality testing
└── config/                           # Test configuration
    ├── test.config.js                # Test configuration settings
    └── mock-data.js                  # Mock data for testing
```

## 🚀 Quick Start

### Run All Tests
```bash
# Make scripts executable
chmod +x tests/scripts/*.sh

# Run complete test suite
./tests/scripts/run-all-tests.sh

# Validate production readiness
./tests/scripts/validate-production.sh
```

### Run Individual Test Categories
```bash
# Test specific enterprise features
node tests/enterprise/analytics.test.js
node tests/enterprise/ab-testing.test.js
node tests/enterprise/personalization.test.js
node tests/enterprise/flow-designer.test.js

# Run integration tests
node tests/enterprise/integration.test.js
```

## 🎯 Test Categories

### 1. **Analytics Dashboard Tests**
- Real-time metrics validation
- Data structure verification
- Export functionality testing
- Performance benchmarking

### 2. **A/B Testing Framework Tests**
- Test creation and management
- Variant configuration validation
- Results calculation accuracy
- Statistical significance testing

### 3. **Personalization Engine Tests**
- Rule engine validation
- Customer segmentation testing
- AI recommendation accuracy
- Privacy compliance verification

### 4. **Flow Designer Tests**
- Flow creation and editing
- Node connection validation
- Flow execution testing
- Version control functionality

### 5. **Integration Tests**
- End-to-end feature testing
- API endpoint validation
- Frontend/backend integration
- Database operations testing

## 📊 Test Reporting

Tests generate detailed reports including:
- ✅ **Pass/Fail Status**: Individual test results
- 📈 **Performance Metrics**: Response times and throughput
- 🔍 **Coverage Reports**: Feature coverage analysis
- 📋 **Error Details**: Detailed failure information
- 🎯 **Production Readiness**: Overall system health

## 🔧 Configuration

### Environment Variables
```bash
# Test configuration
TEST_BASE_URL=http://localhost:3000
TEST_COMPANY_ID=507f1f77bcf86cd799439011
TEST_TIMEOUT=10000
TEST_RETRIES=3

# Test database (optional)
TEST_DB_URL=mongodb://localhost:27017/clientsvia_test
```

### Test Modes
- **Development Mode**: Uses test endpoints and mock data
- **Integration Mode**: Tests against real API with auth
- **Production Mode**: Validates production-ready deployment

## 🚨 Continuous Integration

### GitHub Actions Integration
```yaml
# .github/workflows/enterprise-tests.yml
name: Enterprise Feature Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: ./tests/scripts/run-all-tests.sh
```

### Pre-deployment Validation
```bash
# Run before any production deployment
./tests/scripts/validate-production.sh
```

## 📋 Test Maintenance

### Adding New Tests
1. Create test file in appropriate category directory
2. Follow existing test structure and naming conventions
3. Update test scripts to include new tests
4. Document new test scenarios

### Updating Test Data
- Update `tests/config/mock-data.js` for new test scenarios
- Ensure test data covers edge cases and error conditions
- Maintain data privacy and security standards

## 🎉 Success Criteria

### Production Readiness Checklist
- [ ] All unit tests passing (100%)
- [ ] Integration tests passing (100%)
- [ ] Performance benchmarks met
- [ ] Security validations completed
- [ ] Error handling verified
- [ ] Documentation updated

### Performance Benchmarks
- **API Response Time**: < 2 seconds
- **Frontend Load Time**: < 3 seconds
- **Database Query Time**: < 500ms
- **Test Suite Execution**: < 5 minutes

---

**Created:** August 3, 2025  
**Last Updated:** August 3, 2025  
**Version:** 1.0.0  
**Maintainer:** Enterprise Development Team
