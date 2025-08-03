#!/bin/bash

# ClientsVia Enterprise Test Suite - Save & Archive Script
# Creates a complete, portable archive of the beautiful test suite for future use

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get script directory and project paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$TEST_DIR")"

echo -e "${BLUE}🎯 ClientsVia Enterprise Test Suite - Save & Archive${NC}"
echo "=================================================="

# Function to print status
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Create timestamp for unique naming
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
VERSION="1.0.0"

# Define archive paths
ARCHIVE_DIR="$PROJECT_ROOT/archives"
ARCHIVE_NAME="clientsvia-enterprise-test-suite-v${VERSION}-${TIMESTAMP}"
ARCHIVE_PATH="$ARCHIVE_DIR/$ARCHIVE_NAME"

print_info "Creating archive: $ARCHIVE_NAME"

# Create archive directory
mkdir -p "$ARCHIVE_DIR"
mkdir -p "$ARCHIVE_PATH"

print_info "Preparing test suite for archival..."

# Copy entire test suite
cp -r "$TEST_DIR"/* "$ARCHIVE_PATH/"

# Clean up development artifacts
rm -rf "$ARCHIVE_PATH/node_modules" 2>/dev/null || true
rm -rf "$ARCHIVE_PATH/test-results" 2>/dev/null || true
rm -rf "$ARCHIVE_PATH/.git" 2>/dev/null || true
find "$ARCHIVE_PATH" -name "*.tmp" -delete 2>/dev/null || true
find "$ARCHIVE_PATH" -name ".DS_Store" -delete 2>/dev/null || true

print_status "Test suite cleaned and prepared"

# Create comprehensive installation guide
cat > "$ARCHIVE_PATH/INSTALLATION_GUIDE.md" << 'EOF'
# 🚀 ClientsVia Enterprise Test Suite - Installation Guide

This archive contains a complete, production-ready testing suite for ClientsVia Enterprise AI Agent Logic features.

## 📦 What's Included

- **Complete Test Suite**: All enterprise feature tests
- **Test Infrastructure**: Runners, utilities, and configuration
- **Documentation**: Comprehensive guides and references
- **Scripts**: Automation and maintenance tools
- **CI/CD Integration**: GitHub Actions and workflows
- **Mock Data**: Test fixtures and API responses

## 🛠️ Quick Installation

### 1. Extract Archive
```bash
# Extract to your project
tar -xzf clientsvia-enterprise-test-suite-v1.0.0-*.tar.gz
cd clientsvia-enterprise-test-suite-*/

# Or copy tests directory to existing project
cp -r tests/ /path/to/your/project/
```

### 2. Install Dependencies
```bash
cd tests/
npm install
```

### 3. Configure Environment
```bash
# Copy environment template
cp .env.example .env

# Edit configuration if needed
nano config/test.config.js
```

### 4. Run Tests
```bash
# Quick health check
npm run health

# Run all tests
npm run test:all

# Production validation
npm run validate
```

## 📋 Available Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Run master test suite |
| `npm run test:all` | Execute all tests with reporting |
| `npm run test:analytics` | Test analytics dashboard |
| `npm run test:ab` | Test A/B testing framework |
| `npm run test:personalization` | Test personalization engine |
| `npm run test:flow` | Test flow designer |
| `npm run test:integration` | Run integration tests |
| `npm run validate` | Production readiness check |
| `npm run maintain:full` | Complete maintenance |
| `npm run backup` | Create backup |
| `npm run health` | Health check |

## 🎯 Integration with Your Project

### Backend Integration
1. Ensure your project has the required API endpoints
2. Update `config/test.config.js` with your URLs
3. Configure authentication in test config
4. Run integration tests

### CI/CD Integration
```yaml
# Add to your .github/workflows/
name: Enterprise Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: cd tests && npm install
      - run: cd tests && npm run ci
```

## 🔧 Customization

### Adding New Tests
1. Create test file in appropriate category
2. Follow existing patterns and structure
3. Update test runner configuration
4. Add to maintenance scripts

### Modifying Configuration
- **API URLs**: `config/test.config.js`
- **Test Data**: `config/mock-data.js`
- **Performance Benchmarks**: `config/test.config.js`
- **Feature Flags**: `config/test.config.js`

## 📊 Understanding Reports

Test reports are generated in `test-results/`:
- **JSON**: Machine-readable results
- **Text**: Human-readable summaries
- **Latest**: Always current results

### Key Metrics
- **Success Rate**: Percentage of passing tests
- **Performance**: Response time benchmarks
- **Coverage**: Feature coverage analysis
- **Readiness Score**: Production readiness (0-100)

## 🚨 Troubleshooting

### Common Issues
1. **Server not running**: Start your backend server
2. **Authentication errors**: Check auth configuration
3. **Missing dependencies**: Run `npm install`
4. **Permission errors**: `chmod +x scripts/*.sh`

### Getting Help
- Review `README.md` for detailed documentation
- Check `DOCUMENTATION_INDEX.md` for all resources
- Run `npm run health` for diagnostic information

## 🎉 Success Criteria

Your test suite is working when:
- [ ] All tests pass (100%)
- [ ] Performance benchmarks met
- [ ] Readiness score ≥ 90
- [ ] Reports generate successfully

---

**Archive Version**: 1.0.0
**Created**: $(date)
**Compatible**: ClientsVia Enterprise v1.0+

🎯 **Ready to enhance your project with enterprise-grade testing!**
EOF

# Create archive metadata
cat > "$ARCHIVE_PATH/ARCHIVE_METADATA.json" << EOF
{
  "name": "ClientsVia Enterprise Test Suite",
  "version": "$VERSION",
  "created": "$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")",
  "description": "Complete enterprise testing suite for ClientsVia AI Agent Logic features",
  "contents": {
    "tests": "All enterprise feature tests",
    "infrastructure": "Test runners, utilities, configuration",
    "documentation": "Complete guides and references",
    "scripts": "Automation and maintenance tools",
    "ci_cd": "GitHub Actions and workflow integration"
  },
  "features": {
    "analytics_testing": true,
    "ab_testing": true,
    "personalization": true,
    "flow_designer": true,
    "integration_tests": true,
    "performance_benchmarks": true,
    "production_validation": true
  },
  "requirements": {
    "node_version": ">=14.0.0",
    "npm_version": ">=6.0.0",
    "backend_required": true,
    "auth_supported": true
  },
  "structure": {
    "enterprise": "Feature-specific test files",
    "config": "Configuration and mock data",
    "scripts": "Automation scripts",
    "utils": "Common testing utilities",
    "docs": "Documentation and guides"
  },
  "usage": {
    "development": "npm run test:all",
    "ci_cd": "npm run ci",
    "production": "npm run validate",
    "maintenance": "npm run maintain:full"
  }
}
EOF

print_status "Documentation and metadata created"

# Make scripts executable
chmod +x "$ARCHIVE_PATH/scripts"/*.sh 2>/dev/null || true

print_status "Script permissions set"

# Create compressed archive
cd "$ARCHIVE_DIR"
tar -czf "${ARCHIVE_NAME}.tar.gz" "$ARCHIVE_NAME/"

# Create zip archive for cross-platform compatibility
zip -r "${ARCHIVE_NAME}.zip" "$ARCHIVE_NAME/" > /dev/null

print_status "Compressed archives created"

# Generate archive summary
ARCHIVE_SIZE_TAR=$(du -h "${ARCHIVE_NAME}.tar.gz" | cut -f1)
ARCHIVE_SIZE_ZIP=$(du -h "${ARCHIVE_NAME}.zip" | cut -f1)
FILE_COUNT=$(find "$ARCHIVE_NAME" -type f | wc -l)

cat > "${ARCHIVE_NAME}_SUMMARY.txt" << EOF
ClientsVia Enterprise Test Suite Archive Summary
==============================================

Archive: $ARCHIVE_NAME
Created: $(date)
Version: $VERSION

Contents:
- Files: $FILE_COUNT
- Size (tar.gz): $ARCHIVE_SIZE_TAR
- Size (zip): $ARCHIVE_SIZE_ZIP

Installation:
1. Extract archive to your project
2. cd tests/ && npm install
3. npm run health
4. npm run test:all

Features:
✅ Analytics Dashboard Testing
✅ A/B Testing Framework
✅ Personalization Engine Tests
✅ Flow Designer Validation
✅ Integration Testing Suite
✅ Performance Benchmarks
✅ Production Validation
✅ CI/CD Integration
✅ Comprehensive Documentation
✅ Maintenance Tools

Quick Start:
tar -xzf ${ARCHIVE_NAME}.tar.gz
cd ${ARCHIVE_NAME}/
npm install
npm run test:all

For detailed instructions, see INSTALLATION_GUIDE.md

🎯 Ready for enterprise deployment!
EOF

print_status "Archive summary generated"

# Clean up temporary directory
rm -rf "$ARCHIVE_NAME"

# Display results
echo
echo -e "${BLUE}📦 Archive Complete!${NC}"
echo "====================="
echo "Location: $ARCHIVE_DIR"
echo "Files created:"
echo "  - ${ARCHIVE_NAME}.tar.gz ($ARCHIVE_SIZE_TAR)"
echo "  - ${ARCHIVE_NAME}.zip ($ARCHIVE_SIZE_ZIP)"
echo "  - ${ARCHIVE_NAME}_SUMMARY.txt"
echo
echo -e "${GREEN}🎉 Your beautiful test suite is now saved for future use!${NC}"
echo
echo "To use this archive:"
echo "1. Extract to any project directory"
echo "2. Follow INSTALLATION_GUIDE.md"
echo "3. Run 'npm run test:all' to validate"
echo
echo -e "${YELLOW}💡 Keep this archive safe - it's your complete enterprise testing solution!${NC}"
