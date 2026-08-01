#!/bin/bash
# ==============================================================================
# CryptoPay Docker Build Script
# ==============================================================================
# This script provides various Docker build and deployment commands for
# the CryptoPay application.
# ==============================================================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="cryptopay"
VERSION=${VERSION:-"3.0.0"}
REGISTRY=${REGISTRY:-""}
TAG=${TAG:-"latest"}

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Help function
show_help() {
    cat << EOF
CryptoPay Docker Build Script

Usage: $0 [COMMAND] [OPTIONS]

Commands:
    build           Build the Docker image
    run             Run the container locally
    push            Push image to registry
    clean           Clean up Docker resources
    test            Run container tests
    dev             Start development environment
    prod            Start production environment
    logs            View container logs
    stop            Stop all containers
    restart         Restart all containers

Options:
    -v, --version   Set image version (default: 3.0.0)
    -t, --tag       Set image tag (default: latest)
    -r, --registry  Set registry URL
    --no-cache      Build without cache
    --help          Show this help message

Examples:
    $0 build --no-cache
    $0 run
    $0 push -r myregistry.com -v 1.0.0
    $0 prod
    $0 logs

EOF
}

# Build function
build_image() {
    local no_cache=""
    if [[ "$1" == "--no-cache" ]]; then
        no_cache="--no-cache"
    fi
    
    log_info "Building Docker image: ${IMAGE_NAME}:${TAG}"
    
    # Build arguments
    local build_args=""
    build_args+="--build-arg BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ') "
    build_args+="--build-arg VERSION=${VERSION} "
    build_args+="--build-arg VCS_REF=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
    
    # Build the image
    docker build ${no_cache} ${build_args} -t "${IMAGE_NAME}:${TAG}" .
    
    if [[ $? -eq 0 ]]; then
        log_success "Image built successfully: ${IMAGE_NAME}:${TAG}"
        
        # Show image info
        log_info "Image details:"
        docker images "${IMAGE_NAME}:${TAG}"
    else
        log_error "Failed to build image"
        exit 1
    fi
}

# Run function
run_container() {
    log_info "Starting container: ${IMAGE_NAME}:${TAG}"
    
    # Stop existing container if running
    docker stop cryptopay-app 2>/dev/null || true
    docker rm cryptopay-app 2>/dev/null || true
    
    # Run the container
    docker run -d \
        --name cryptopay-app \
        -p 5001:5001 \
        -e NODE_ENV=production \
        "${IMAGE_NAME}:${TAG}"
    
    if [[ $? -eq 0 ]]; then
        log_success "Container started successfully"
        log_info "Application available at: http://localhost:5001"
        log_info "Health check: http://localhost:5001/api/health"
    else
        log_error "Failed to start container"
        exit 1
    fi
}

# Push function
push_image() {
    local registry_url="$1"
    local full_image_name="${IMAGE_NAME}:${TAG}"
    
    if [[ -n "$registry_url" ]]; then
        full_image_name="${registry_url}/${IMAGE_NAME}:${TAG}"
        docker tag "${IMAGE_NAME}:${TAG}" "${full_image_name}"
    fi
    
    log_info "Pushing image: ${full_image_name}"
    
    docker push "${full_image_name}"
    
    if [[ $? -eq 0 ]]; then
        log_success "Image pushed successfully: ${full_image_name}"
    else
        log_error "Failed to push image"
        exit 1
    fi
}

# Clean function
clean_resources() {
    log_info "Cleaning up Docker resources..."
    
    # Stop and remove containers
    docker stop cryptopay-app 2>/dev/null || true
    docker rm cryptopay-app 2>/dev/null || true
    
    # Remove images
    docker rmi "${IMAGE_NAME}:${TAG}" 2>/dev/null || true
    
    # Clean up unused resources
    docker system prune -f
    
    log_success "Cleanup completed"
}

# Test function
test_container() {
    log_info "Running container tests..."
    
    # Start container
    run_container
    
    # Wait for container to be ready
    log_info "Waiting for application to start..."
    sleep 10
    
    # Test health endpoint
    local health_url="http://localhost:5001/api/health"
    local max_attempts=30
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        if curl -f -s "$health_url" > /dev/null; then
            log_success "Health check passed"
            break
        else
            log_info "Attempt $attempt/$max_attempts: Waiting for application..."
            sleep 2
            ((attempt++))
        fi
    done
    
    if [[ $attempt -gt $max_attempts ]]; then
        log_error "Health check failed after $max_attempts attempts"
        docker logs cryptopay-app
        exit 1
    fi
    
    # Test API endpoints
    log_info "Testing API endpoints..."
    
    # Test wallets endpoint
    if curl -f -s "http://localhost:5001/api/wallets" > /dev/null; then
        log_success "Wallets API test passed"
    else
        log_warning "Wallets API test failed"
    fi
    
    # Test stats endpoint
    if curl -f -s "http://localhost:5001/api/stats" > /dev/null; then
        log_success "Stats API test passed"
    else
        log_warning "Stats API test failed"
    fi
    
    # Test P2P rate endpoint
    if curl -f -s "http://localhost:5001/api/p2p/rate" > /dev/null; then
        log_success "P2P Rate API test passed"
    else
        log_warning "P2P Rate API test failed"
    fi
    
    log_success "Container tests completed"
}

# Development function
start_dev() {
    log_info "Starting development environment..."
    
    # Check if docker-compose is available
    if ! command -v docker-compose &> /dev/null; then
        log_error "docker-compose is required for development environment"
        exit 1
    fi
    
    # Start development environment
    docker-compose up --build -d
    
    if [[ $? -eq 0 ]]; then
        log_success "Development environment started"
        log_info "Application available at: http://localhost:5001"
        log_info "View logs: docker-compose logs -f"
    else
        log_error "Failed to start development environment"
        exit 1
    fi
}

# Production function
start_prod() {
    log_info "Starting production environment..."
    
    # Check if docker-compose is available
    if ! command -v docker-compose &> /dev/null; then
        log_error "docker-compose is required for production environment"
        exit 1
    fi
    
    # Start production environment
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
    
    if [[ $? -eq 0 ]]; then
        log_success "Production environment started"
        log_info "Application available at: http://localhost:5001"
        log_info "View logs: docker-compose logs -f"
    else
        log_error "Failed to start production environment"
        exit 1
    fi
}

# Logs function
view_logs() {
    log_info "Viewing container logs..."
    
    if docker ps | grep -q cryptopay-app; then
        docker logs -f cryptopay-app
    else
        log_warning "Container cryptopay-app is not running"
        log_info "Available containers:"
        docker ps
    fi
}

# Stop function
stop_containers() {
    log_info "Stopping all containers..."
    
    # Stop docker-compose services
    if [[ -f "docker-compose.yml" ]]; then
        docker-compose down
    fi
    
    # Stop individual container
    docker stop cryptopay-app 2>/dev/null || true
    
    log_success "All containers stopped"
}

# Restart function
restart_containers() {
    log_info "Restarting containers..."
    
    stop_containers
    sleep 2
    
    if [[ -f "docker-compose.yml" ]]; then
        docker-compose up -d
    else
        run_container
    fi
    
    log_success "Containers restarted"
}

# Main script logic
main() {
    local command="$1"
    shift
    
    # Parse options
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--version)
                VERSION="$2"
                shift 2
                ;;
            -t|--tag)
                TAG="$2"
                shift 2
                ;;
            -r|--registry)
                REGISTRY="$2"
                shift 2
                ;;
            --no-cache)
                NO_CACHE="--no-cache"
                shift
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    # Execute command
    case $command in
        build)
            build_image $NO_CACHE
            ;;
        run)
            run_container
            ;;
        push)
            push_image $REGISTRY
            ;;
        clean)
            clean_resources
            ;;
        test)
            test_container
            ;;
        dev)
            start_dev
            ;;
        prod)
            start_prod
            ;;
        logs)
            view_logs
            ;;
        stop)
            stop_containers
            ;;
        restart)
            restart_containers
            ;;
        *)
            log_error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

# Run main function
main "$@"