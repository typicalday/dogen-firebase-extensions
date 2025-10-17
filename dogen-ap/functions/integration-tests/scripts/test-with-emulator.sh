#!/bin/bash

# Firebase Emulator Test Runner
# Orchestrates emulator lifecycle and test execution with improved reliability

set -eo pipefail

# Configuration
readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly INTEGRATION_TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly PROJECT_ID="demo-test"

# Emulator ports (centralized configuration)
readonly AUTH_PORT=5018
readonly FIRESTORE_PORT=5019
readonly STORAGE_PORT=5020

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Runtime variables
EMULATOR_PID=""
CLEANUP_DONE=false

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if emulators are running
check_emulators() {
    local ports_to_check=($AUTH_PORT $FIRESTORE_PORT $STORAGE_PORT)
    local running_count=0
    
    for port in "${ports_to_check[@]}"; do
        if lsof -Pi ":$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
            ((running_count++))
        fi
    done
    
    # Consider emulators ready if at least 2 of 3 services are running
    if [ $running_count -ge 2 ]; then
        return 0
    else
        return 1
    fi
}

# Function to check if emulators are healthy (can respond to requests)
check_emulator_health() {
    local max_attempts=5
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        # Test Firestore emulator health
        if curl -s "http://localhost:$FIRESTORE_PORT" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
        ((attempt++))
    done
    
    return 1
}

# Function to wait for emulators to be ready
wait_for_emulators() {
    local max_attempts=30
    local attempt=1
    
    print_status "Waiting for emulators to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        if check_emulators; then
            print_status "Ports are listening, checking emulator health..."
            if check_emulator_health; then
                print_success "Emulators are ready and healthy!"
                return 0
            else
                print_warning "Ports listening but emulators not responding yet..."
            fi
        fi
        
        if [ $((attempt % 5)) -eq 0 ]; then
            print_status "Attempt $attempt/$max_attempts - Still waiting..."
        fi
        
        sleep 2
        attempt=$((attempt + 1))
    done
    
    print_error "Emulators failed to start within timeout"
    return 1
}

# Function to stop emulators
stop_emulators() {
    if [ "$CLEANUP_DONE" = true ]; then
        return 0
    fi
    
    print_status "Stopping emulators..."
    
    # Kill the emulator process if we have its PID
    if [ ! -z "$EMULATOR_PID" ]; then
        kill $EMULATOR_PID 2>/dev/null || true
        wait $EMULATOR_PID 2>/dev/null || true
    fi
    
    # Kill processes using the ports
    for port in $AUTH_PORT $FIRESTORE_PORT $STORAGE_PORT; do
        lsof -ti ":$port" | xargs kill -9 2>/dev/null || true
    done
    
    # Kill any remaining firebase processes
    pkill -f "firebase.*emulators" 2>/dev/null || true
    pkill -f "java.*firestore" 2>/dev/null || true
    pkill -f "cloud_sql_proxy" 2>/dev/null || true
    
    sleep 2
    CLEANUP_DONE=true
}

# Function to start emulators in background
start_emulators() {
    print_status "Starting Firebase emulators..."
    cd "$INTEGRATION_TEST_DIR"
    
    # Start emulators in background with proper logging
    firebase emulators:start --only auth,firestore,storage --project="$PROJECT_ID" > emulator.log 2>&1 &
    EMULATOR_PID=$!
    
    # Wait for emulators to be ready
    if ! wait_for_emulators; then
        print_error "Failed to start emulators. Check emulator.log for details:"
        if [ -f "$INTEGRATION_TEST_DIR/emulator.log" ]; then
            tail -20 "$INTEGRATION_TEST_DIR/emulator.log" | sed 's/^/  /'
        fi
        kill $EMULATOR_PID 2>/dev/null || true
        return 1
    fi
    
    print_success "Emulators started successfully (PID: $EMULATOR_PID)"
}

# Function to run tests with improved reliability
run_tests() {
    local test_type="${1:-all}"
    local debug="${DEBUG:-false}"
    
    print_status "Building project..."
    cd "$PROJECT_ROOT"
    if ! npm run build; then
        print_error "Build failed"
        return 1
    fi
    
    # Set test environment variables
    export FIRESTORE_EMULATOR_HOST="localhost:$FIRESTORE_PORT"
    export FIREBASE_AUTH_EMULATOR_HOST="localhost:$AUTH_PORT"
    export FIREBASE_STORAGE_EMULATOR_HOST="localhost:$STORAGE_PORT"
    
    # Show test files if debug mode
    if [ "$debug" = "true" ]; then
        show_test_files "$test_type"
    fi
    
    # Get exact list of test files for the specified type
    local test_files_list
    case $test_type in
        "firestore")
            print_status "Running Firestore tests..."
            test_files_list=$(find integration-tests/tests/firestore -name "*.spec.ts" -type f | tr '\n' ' ')
            ;;
        "storage")
            print_status "Running Storage tests..."
            test_files_list=$(find integration-tests/tests/storage -name "*.spec.ts" -type f | tr '\n' ' ')
            ;;
        "authentication" | "auth")
            print_status "Running Authentication tests..."
            test_files_list=$(find integration-tests/tests/authentication -name "*.spec.ts" -type f | tr '\n' ' ')
            ;;
        "install")
            print_status "Running Installation/Setup tests..."
            test_files_list=$(find integration-tests/tests/install -name "*.spec.ts" -type f | tr '\n' ' ')
            ;;
        "job")
            print_status "Running Job orchestration tests..."
            test_files_list=$(find integration-tests/tests/job -name "*.spec.ts" -type f | tr '\n' ' ')
            ;;
        "ai")
            print_status "Running AI tests..."
            test_files_list=$(find integration-tests/tests/ai -name "*.spec.ts" -type f | tr '\n' ' ')
            ;;
        "all")
            print_status "Running all integration tests..."
            test_files_list=$(find integration-tests/tests -name "*.spec.ts" -type f | tr '\n' ' ')
            ;;
        *)
            print_error "Unknown test type: $test_type"
            print_status "Available: firestore, storage, authentication, install, job, all"
            return 1
            ;;
    esac
    
    if [ -z "$test_files_list" ]; then
        print_error "No test files found for type: $test_type"
        return 1
    fi
    
    # NOTE: --no-config is required because .mocharc.json has a global "spec" pattern 
    # that overrides command-line file arguments and forces all tests to run
    local mocha_cmd="TS_NODE_FILES=true npx mocha --require ts-node/register --require ./integration-tests/setup.ts --timeout 30000 --exit --no-config $test_files_list"
    
    # Run tests with proper error handling
    if eval "$mocha_cmd"; then
        print_success "Tests completed successfully"
        return 0
    else
        print_error "Tests failed"
        return 1
    fi
}

# Function to show test files for debugging
show_test_files() {
    local test_type="$1"
    print_status "Debug mode - showing test files:"

    case $test_type in
        "firestore")
            find integration-tests/tests/firestore -name "*.spec.ts" -type f 2>/dev/null | sort || echo "  No firestore tests found"
            ;;
        "storage")
            find integration-tests/tests/storage -name "*.spec.ts" -type f 2>/dev/null | sort || echo "  No storage tests found"
            ;;
        "authentication" | "auth")
            find integration-tests/tests/authentication -name "*.spec.ts" -type f 2>/dev/null | sort || echo "  No authentication tests found"
            ;;
        "install")
            find integration-tests/tests/install -name "*.spec.ts" -type f 2>/dev/null | sort || echo "  No install tests found"
            ;;
        "job")
            find integration-tests/tests/job -name "*.spec.ts" -type f 2>/dev/null | sort || echo "  No job tests found"
            ;;
        "ai")
            find integration-tests/tests/ai -name "*.spec.ts" -type f 2>/dev/null | sort || echo "  No ai tests found"
            ;;
        "all")
            find integration-tests/tests -name "*.spec.ts" -type f 2>/dev/null | sort || echo "  No test files found"
            ;;
    esac
    echo ""
}

# Function to cleanup on exit
cleanup() {
    if [ "$CLEANUP_DONE" = true ]; then
        return 0
    fi
    
    print_status "Cleaning up..."
    stop_emulators
    
    # Clean up log files
    if [ -f "$INTEGRATION_TEST_DIR/emulator.log" ]; then
        rm -f "$INTEGRATION_TEST_DIR/emulator.log"
    fi
}

# Set trap for cleanup
trap cleanup EXIT INT TERM

# Main script execution
main() {
    local test_type="${1:-all}"
    local start_emulators_flag="${2:-true}"
    
    print_status "🔥 Firebase Emulator Test Runner"
    print_status "Project: $PROJECT_ID"
    print_status "Test type: $test_type"
    print_status "Start emulators: $start_emulators_flag"
    
    # Validate test type early
    case $test_type in
        "firestore"|"storage"|"authentication"|"auth"|"install"|"job"|"ai"|"all")
            # Valid test types
            ;;
        *)
            print_error "Invalid test type: $test_type"
            print_status "Valid types: firestore, storage, authentication, install, job, ai, all"
            exit 1
            ;;
    esac
    
    # Handle emulator lifecycle
    if [ "$start_emulators_flag" = "true" ]; then
        print_status "Stopping any existing emulators..."
        stop_emulators
        
        print_status "Starting fresh emulators..."
        if ! start_emulators; then
            print_error "Failed to start emulators"
            exit 1
        fi
    else
        print_status "Using existing emulators"
        if ! check_emulators; then
            print_error "No emulators running. Start them first or remove --no-start"
            exit 1
        fi
        
        if ! check_emulator_health; then
            print_error "Emulators not healthy. Restart them or remove --no-start"
            exit 1
        fi
    fi
    
    # Run tests with proper error handling
    if run_tests "$test_type"; then
        print_success "✅ All tests passed!"
        return 0
    else
        print_error "❌ Tests failed!"
        return 1
    fi
}

# Show help
show_help() {
    cat << EOF
Firebase Emulator Test Runner

USAGE:
    $0 [OPTIONS] [TEST_TYPE]

TEST TYPES:
    firestore       Run Firestore tests only
    storage         Run Storage tests only
    authentication  Run Authentication tests only
    install         Run Installation/Setup tests only
    job             Run Job orchestration tests only
    ai              Run AI tests only
    all             Run all integration tests (default)

OPTIONS:
    --no-start      Use existing emulators (don't start new ones)
    --help, -h      Show this help message

ENVIRONMENT VARIABLES:
    DEBUG=true      Show test files before execution
    VERBOSE=true    Enable verbose output

EXAMPLES:
    $0                              # Run all tests with fresh emulators
    $0 firestore                    # Run only Firestore tests
    $0 authentication --no-start    # Run auth tests with existing emulators
    DEBUG=true $0 storage           # Run storage tests with debug info

PORTS:
    Auth:      $AUTH_PORT
    Firestore: $FIRESTORE_PORT  
    Storage:   $STORAGE_PORT

EOF
}

# Parse command line arguments with improved logic
parse_args() {
    local test_type="all"
    local start_emulators="true"
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --help|-h)
                show_help
                exit 0
                ;;
            --no-start)
                start_emulators="false"
                shift
                ;;
            firestore|storage|authentication|auth|install|job|ai|all)
                test_type="$1"
                shift
                ;;
            *)
                print_error "Unknown argument: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    main "$test_type" "$start_emulators"
}

# Execute with argument parsing
parse_args "$@"