#!/bin/bash

# ClientsVia Enterprise Test Suite Maintenance Script
# Handles versioning, backup, and test suite maintenance

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$TEST_DIR")"

echo -e "${BLUE}🔧 ClientsVia Enterprise Test Suite Maintenance${NC}"
echo "=============================================="

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Function to backup test suite
backup_tests() {
    print_info "Creating backup of test suite..."
    
    local backup_dir="$PROJECT_ROOT/backups/test-suite"
    local timestamp=$(date +"%Y-%m-%d_%H-%M-%S")
    local backup_path="$backup_dir/test-suite-backup-$timestamp.tar.gz"
    
    mkdir -p "$backup_dir"
    
    cd "$PROJECT_ROOT"
    tar -czf "$backup_path" tests/ --exclude=tests/node_modules --exclude=tests/test-results
    
    print_status "Backup created: $backup_path"
}

# Function to update test dependencies
update_dependencies() {
    print_info "Updating test dependencies..."
    
    cd "$TEST_DIR"
    
    if [ -f "package.json" ]; then
        npm update
        print_status "Dependencies updated"
    else
        print_warning "No package.json found in tests directory"
    fi
}

# Function to clean test artifacts
clean_artifacts() {
    print_info "Cleaning test artifacts..."
    
    # Clean test results
    if [ -d "$TEST_DIR/test-results" ]; then
        find "$TEST_DIR/test-results" -name "*.json" -mtime +30 -delete
        find "$TEST_DIR/test-results" -name "*.txt" -mtime +30 -delete
        print_status "Cleaned old test results (older than 30 days)"
    fi
    
    # Clean node_modules if it exists
    if [ -d "$TEST_DIR/node_modules" ]; then
        rm -rf "$TEST_DIR/node_modules"
        print_status "Cleaned node_modules"
    fi
    
    # Clean any temporary files
    find "$TEST_DIR" -name "*.tmp" -delete 2>/dev/null || true
    find "$TEST_DIR" -name ".DS_Store" -delete 2>/dev/null || true
    
    print_status "Artifacts cleaned"
}

# Function to validate test suite integrity
validate_integrity() {
    print_info "Validating test suite integrity..."
    
    # Check required files
    local required_files=(
        "README.md"
        "package.json"
        "TestRunner.js"
        "config/test.config.js"
        "config/mock-data.js"
        "utils/TestUtils.js"
        "enterprise/analytics.test.js"
        "enterprise/ab-testing.test.js"
        "enterprise/personalization.test.js"
        "enterprise/flow-designer.test.js"
        "enterprise/integration.test.js"
        "scripts/run-all-tests.sh"
        "scripts/validate-production.sh"
    )
    
    local missing_files=()
    
    for file in "${required_files[@]}"; do
        if [ ! -f "$TEST_DIR/$file" ]; then
            missing_files+=("$file")
        fi
    done
    
    if [ ${#missing_files[@]} -eq 0 ]; then
        print_status "All required files present"
    else
        print_error "Missing files:"
        for file in "${missing_files[@]}"; do
            echo "  - $file"
        done
        return 1
    fi
    
    # Check script permissions
    local script_files=(
        "scripts/run-all-tests.sh"
        "scripts/validate-production.sh"
        "scripts/maintenance.sh"
    )
    
    for script in "${script_files[@]}"; do
        if [ -f "$TEST_DIR/$script" ] && [ ! -x "$TEST_DIR/$script" ]; then
            chmod +x "$TEST_DIR/$script"
            print_status "Fixed permissions for $script"
        fi
    done
    
    print_status "Test suite integrity validated"
}

# Function to run health check
health_check() {
    print_info "Running test suite health check..."
    
    cd "$TEST_DIR"
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    
    # Run a quick test
    if node TestRunner.js 2>/dev/null; then
        print_status "Health check passed"
    else
        print_warning "Health check detected issues - see full test run for details"
    fi
}

# Function to create release
create_release() {
    local version="$1"
    
    if [ -z "$version" ]; then
        print_error "Version number required for release"
        echo "Usage: $0 release <version>"
        exit 1
    fi
    
    print_info "Creating release v$version..."
    
    # Create release directory
    local release_dir="$PROJECT_ROOT/releases/test-suite"
    local release_path="$release_dir/v$version"
    
    mkdir -p "$release_path"
    
    # Copy test suite (excluding artifacts)
    cd "$PROJECT_ROOT"
    cp -r tests/ "$release_path/" 
    rm -rf "$release_path/tests/node_modules" 2>/dev/null || true
    rm -rf "$release_path/tests/test-results" 2>/dev/null || true
    
    # Create release notes
    cat > "$release_path/RELEASE_NOTES.md" << EOF
# Test Suite Release v$version

**Release Date:** $(date +"%Y-%m-%d")
**Release Time:** $(date +"%H:%M:%S UTC")

## Features
- Complete enterprise test suite for ClientsVia AI Agent Logic
- Analytics dashboard testing
- A/B testing framework validation
- Personalization engine tests
- Flow designer functionality tests
- Comprehensive integration testing

## Files Included
- All test files and configurations
- Test utilities and helpers
- Mock data and test fixtures
- Execution scripts and CI/CD integration
- Documentation and maintenance tools

## Installation
1. Extract to your project directory
2. Run: \`npm install\` in the tests directory
3. Configure environment variables
4. Execute: \`./scripts/run-all-tests.sh\`

## Support
- Documentation: tests/README.md
- Issues: Contact development team
- Version: $version
EOF
    
    # Create archive
    cd "$release_dir"
    tar -czf "clientsvia-test-suite-v$version.tar.gz" "v$version/"
    
    print_status "Release v$version created: $release_dir/clientsvia-test-suite-v$version.tar.gz"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  backup          Create backup of test suite"
    echo "  update          Update test dependencies"
    echo "  clean           Clean test artifacts and temporary files"
    echo "  validate        Validate test suite integrity"
    echo "  health          Run health check"
    echo "  release <ver>   Create versioned release"
    echo "  full            Run full maintenance (backup, update, clean, validate)"
    echo "  help            Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 backup"
    echo "  $0 full"
    echo "  $0 release 1.0.0"
}

# Main execution
case "${1:-help}" in
    backup)
        backup_tests
        ;;
    update)
        update_dependencies
        ;;
    clean)
        clean_artifacts
        ;;
    validate)
        validate_integrity
        ;;
    health)
        health_check
        ;;
    release)
        create_release "$2"
        ;;
    full)
        print_info "Running full maintenance..."
        backup_tests
        update_dependencies
        clean_artifacts
        validate_integrity
        health_check
        print_status "Full maintenance completed"
        ;;
    help|--help|-h)
        show_usage
        ;;
    *)
        print_error "Unknown command: $1"
        show_usage
        exit 1
        ;;
esac

print_info "Maintenance operation completed"
