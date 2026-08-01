#!/bin/bash
# ==============================================================================
# CryptoPay Docker Deployment Script
# ==============================================================================
# This script provides automated deployment options for the CryptoPay
# application in various environments.
# ==============================================================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="cryptopay"
IMAGE_NAME="cryptopay"
VERSION=${VERSION:-"3.0.0"}
ENVIRONMENT=${ENVIRONMENT:-"development"}
REGISTRY=${REGISTRY:-""}
NAMESPACE=${NAMESPACE:-"default"}

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
CryptoPay Docker Deployment Script

Usage: $0 [COMMAND] [OPTIONS]

Commands:
    deploy          Deploy the application
    rollback        Rollback to previous version
    status          Show deployment status
    logs            View application logs
    scale           Scale the application
    update          Update the application
    health          Check application health

Options:
    -e, --env       Set environment (dev, staging, prod)
    -v, --version   Set application version
    -r, --registry  Set registry URL
    -n, --namespace Set Kubernetes namespace
    --replicas      Set number of replicas
    --help          Show this help message

Examples:
    $0 deploy -e prod -v 1.0.0
    $0 scale --replicas 3
    $0 rollback
    $0 status
    $0 health

EOF
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed"
        exit 1
    fi
    
    # Check if .env file exists
    if [[ ! -f ".env" ]]; then
        log_warning ".env file not found, using .env.example"
        if [[ -f ".env.example" ]]; then
            cp .env.example .env
        else
            log_error ".env.example file not found"
            exit 1
        fi
    fi
    
    log_success "Prerequisites check passed"
}

# Deploy function
deploy_application() {
    local env="$1"
    local version="$2"
    
    log_info "Deploying CryptoPay application..."
    log_info "Environment: $env"
    log_info "Version: $version"
    
    # Check prerequisites
    check_prerequisites
    
    # Build image
    log_info "Building Docker image..."
    docker build -t "${IMAGE_NAME}:${version}" .
    
    if [[ $? -ne 0 ]]; then
        log_error "Failed to build Docker image"
        exit 1
    fi
    
    # Deploy based on environment
    case $env in
        dev|development)
            deploy_development
            ;;
        staging)
            deploy_staging
            ;;
        prod|production)
            deploy_production
            ;;
        *)
            log_error "Unknown environment: $env"
            exit 1
            ;;
    esac
    
    log_success "Deployment completed successfully"
}

# Deploy development environment
deploy_development() {
    log_info "Deploying to development environment..."
    
    # Stop existing containers
    docker-compose down 2>/dev/null || true
    
    # Start development environment
    docker-compose up --build -d
    
    # Wait for application to be ready
    wait_for_application "http://localhost:5001"
    
    log_success "Development deployment completed"
    log_info "Application URL: http://localhost:5001"
}

# Deploy staging environment
deploy_staging() {
    log_info "Deploying to staging environment..."
    
    # Use production compose with staging overrides
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
    
    # Wait for application to be ready
    wait_for_application "http://localhost:5001"
    
    log_success "Staging deployment completed"
    log_info "Application URL: http://localhost:5001"
}

# Deploy production environment
deploy_production() {
    log_info "Deploying to production environment..."
    
    # Validate production configuration
    validate_production_config
    
    # Deploy with production configuration
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
    
    # Wait for application to be ready
    wait_for_application "http://localhost:5001"
    
    # Run health checks
    run_health_checks
    
    log_success "Production deployment completed"
    log_info "Application URL: http://localhost:5001"
}

# Validate production configuration
validate_production_config() {
    log_info "Validating production configuration..."
    
    # Check required environment variables
    local required_vars=("POSTGRES_PASSWORD" "GRAFANA_PASSWORD")
    
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var}" ]]; then
            log_error "Required environment variable $var is not set"
            exit 1
        fi
    done
    
    # Check SSL certificates if using HTTPS
    if [[ -n "$NGINX_SSL_PORT" ]]; then
        if [[ ! -f "ssl/cert.pem" ]] || [[ ! -f "ssl/key.pem" ]]; then
            log_warning "SSL certificates not found, HTTPS will not be available"
        fi
    fi
    
    log_success "Production configuration validated"
}

# Wait for application to be ready
wait_for_application() {
    local url="$1"
    local max_attempts=60
    local attempt=1
    
    log_info "Waiting for application to be ready..."
    
    while [[ $attempt -le $max_attempts ]]; do
        if curl -f -s "$url/api/health" > /dev/null 2>&1; then
            log_success "Application is ready"
            return 0
        else
            log_info "Attempt $attempt/$max_attempts: Waiting for application..."
            sleep 5
            ((attempt++))
        fi
    done
    
    log_error "Application failed to start within expected time"
    log_info "Container logs:"
    docker-compose logs --tail=50
    exit 1
}

# Run health checks
run_health_checks() {
    log_info "Running health checks..."
    
    local base_url="http://localhost:5001"
    local checks=(
        "$base_url/api/health"
        "$base_url/api/wallets"
        "$base_url/api/stats"
        "$base_url/api/p2p/rate"
    )
    
    local failed_checks=0
    
    for check in "${checks[@]}"; do
        if curl -f -s "$check" > /dev/null 2>&1; then
            log_success "Health check passed: $check"
        else
            log_error "Health check failed: $check"
            ((failed_checks++))
        fi
    done
    
    if [[ $failed_checks -gt 0 ]]; then
        log_error "$failed_checks health checks failed"
        exit 1
    fi
    
    log_success "All health checks passed"
}

# Rollback function
rollback_application() {
    log_info "Rolling back application..."
    
    # Get current version
    local current_version=$(docker images --format "table {{.Tag}}" "${IMAGE_NAME}" | grep -v "TAG" | head -1)
    
    if [[ -z "$current_version" ]]; then
        log_error "No previous version found"
        exit 1
    fi
    
    log_info "Current version: $current_version"
    
    # Stop current containers
    docker-compose down
    
    # Start with previous version
    docker run -d \
        --name cryptopay-app \
        -p 5001:5001 \
        -e NODE_ENV=production \
        "${IMAGE_NAME}:${current_version}"
    
    log_success "Rollback completed"
}

# Status function
show_status() {
    log_info "Application Status:"
    
    # Docker Compose status
    if [[ -f "docker-compose.yml" ]]; then
        log_info "Docker Compose Services:"
        docker-compose ps
    fi
    
    # Container status
    log_info "Containers:"
    docker ps --filter "name=cryptopay" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    
    # Application health
    if curl -f -s "http://localhost:5001/api/health" > /dev/null 2>&1; then
        log_success "Application is healthy"
    else
        log_error "Application is not responding"
    fi
}

# Logs function
view_logs() {
    log_info "Viewing application logs..."
    
    if [[ -f "docker-compose.yml" ]]; then
        docker-compose logs -f
    else
        docker logs -f cryptopay-app
    fi
}

# Scale function
scale_application() {
    local replicas="$1"
    
    log_info "Scaling application to $replicas replicas..."
    
    if [[ -f "docker-compose.yml" ]]; then
        # Update docker-compose.yml with replicas
        sed -i "s/replicas: [0-9]*/replicas: $replicas/" docker-compose.yml
        
        # Restart services
        docker-compose up -d --scale cryptopay=$replicas
    else
        log_error "Scaling requires docker-compose.yml"
        exit 1
    fi
    
    log_success "Application scaled to $replicas replicas"
}

# Update function
update_application() {
    local version="$1"
    
    log_info "Updating application to version $version..."
    
    # Pull latest changes
    git pull origin main
    
    # Rebuild and restart
    docker-compose down
    docker-compose build --no-cache
    docker-compose up -d
    
    log_success "Application updated to version $version"
}

# Health function
check_health() {
    log_info "Checking application health..."
    
    local base_url="http://localhost:5001"
    local health_url="$base_url/api/health"
    
    # Basic health check
    if curl -f -s "$health_url" > /dev/null 2>&1; then
        log_success "Application is healthy"
        
        # Get detailed health info
        local health_info=$(curl -s "$health_url")
        echo "$health_info" | jq '.' 2>/dev/null || echo "$health_info"
    else
        log_error "Application is not healthy"
        exit 1
    fi
}

# Main script logic
main() {
    local command="$1"
    shift
    
    # Parse options
    while [[ $# -gt 0 ]]; do
        case $1 in
            -e|--env)
                ENVIRONMENT="$2"
                shift 2
                ;;
            -v|--version)
                VERSION="$2"
                shift 2
                ;;
            -r|--registry)
                REGISTRY="$2"
                shift 2
                ;;
            -n|--namespace)
                NAMESPACE="$2"
                shift 2
                ;;
            --replicas)
                REPLICAS="$2"
                shift 2
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
        deploy)
            deploy_application $ENVIRONMENT $VERSION
            ;;
        rollback)
            rollback_application
            ;;
        status)
            show_status
            ;;
        logs)
            view_logs
            ;;
        scale)
            scale_application $REPLICAS
            ;;
        update)
            update_application $VERSION
            ;;
        health)
            check_health
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