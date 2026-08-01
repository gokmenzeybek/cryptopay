 # 🐳 CryptoPay Docker Deployment Guide

This guide provides comprehensive instructions for deploying the CryptoPay XRPL payment application using Docker containers.

## 📋 Table of Contents

- [Quick Start](#-quick-start)
- [Prerequisites](#-prerequisites)
- [Configuration](#-configuration)
- [Deployment Options](#-deployment-options)
- [Production Deployment](#-production-deployment)
- [Monitoring & Logging](#-monitoring--logging)
- [Troubleshooting](#-troubleshooting)
- [Security Considerations](#-security-considerations)

## 🚀 Quick Start

### Basic Deployment

```bash
# Clone the repository
git clone <repository-url>
cd cryptopay

# Build and start the application
docker-compose up --build -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f cryptopay
```

### Access the Application

- **Application**: http://localhost:5001
- **API Health**: http://localhost:5001/api/health
- **Dashboard**: http://localhost:5001/shared_dashboard.html

## 📋 Prerequisites

### System Requirements

- **Docker**: Version 20.10+ 
- **Docker Compose**: Version 2.0+
- **Memory**: Minimum 2GB RAM
- **Storage**: Minimum 5GB free space
- **Network**: Port 5001 available

### Installation

#### Ubuntu/Debian
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

#### macOS
```bash
# Install Docker Desktop
brew install --cask docker

# Or download from: https://www.docker.com/products/docker-desktop
```

#### Windows
Download Docker Desktop from: https://www.docker.com/products/docker-desktop

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# Copy the example file
cp .env.example .env
```

#### Core Configuration
```env
# Application
NODE_ENV=production
PORT=5001
EXTERNAL_PORT=5001

# P2P Exchange
CONVERSION_FEE_PERCENT=1.5
RATE_CACHE_TTL_SECONDS=300

# Rate Limiting
RATE_LIMIT_EXCHANGE_RATES=60
RATE_LIMIT_PAYMENT_INTENT=10
RATE_LIMIT_CONVERSION=20

# XRPL
XRPL_NETWORK=testnet

# Logging
LOG_LEVEL=info
LOG_REQUESTS=false

# Security
VERIFY_WEBHOOK_SIGNATURES=false
CORS_ORIGINS=*

# Feature Flags
AUTO_PROCESS_CONVERSIONS=false
ENABLE_REFUNDS=true
TRACK_CONVERSION_STATS=true
```

#### Production Configuration
```env
# Database (if using PostgreSQL)
POSTGRES_DB=cryptopay
POSTGRES_USER=cryptopay
POSTGRES_PASSWORD=your_secure_password

# Redis (if using Redis)
REDIS_PORT=6379

# Nginx (if using reverse proxy)
NGINX_PORT=80
NGINX_SSL_PORT=443
DOMAIN=your-domain.com

# Monitoring
GRAFANA_PASSWORD=your_grafana_password
```

## 🚀 Deployment Options

### 1. Basic Deployment (Default)

```bash
# Start with default configuration
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### 2. Development Mode

```bash
# Start with development overrides
docker-compose up -d

# The override file automatically enables:
# - Hot reloading
# - Debug logging
# - Development ports
```

### 3. Production Deployment

```bash
# Start with production configuration
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# This includes:
# - PostgreSQL database
# - Redis cache
# - Nginx reverse proxy
# - Resource limits
# - Production optimizations
```

### 4. With Monitoring

```bash
# Start with monitoring stack
docker-compose -f docker-compose.yml -f docker-compose.prod.yml --profile monitoring up -d

# Access monitoring:
# - Grafana: http://localhost:3000 (admin/admin)
# - Prometheus: http://localhost:9090
```

## 🏭 Production Deployment

### Step 1: Prepare Environment

```bash
# Create production directory
mkdir -p /opt/cryptopay
cd /opt/cryptopay

# Clone repository
git clone <repository-url> .

# Create production environment file
cp .env.example .env
nano .env  # Edit with production values
```

### Step 2: Configure SSL (Optional)

```bash
# Create SSL directory
mkdir -p ssl

# Copy your SSL certificates
cp your-cert.pem ssl/cert.pem
cp your-key.pem ssl/key.pem
```

### Step 3: Deploy

```bash
# Build and start production stack
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Verify deployment
docker-compose ps
curl http://localhost:5001/api/health
```

### Step 4: Configure Reverse Proxy (Nginx)

Create `nginx.conf`:

```nginx
events {
    worker_connections 1024;
}

http {
    upstream cryptopay {
        server cryptopay:5001;
    }

    server {
        listen 80;
        server_name your-domain.com;
        
        location / {
            proxy_pass http://cryptopay;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

## 📊 Monitoring & Logging

### Application Logs

```bash
# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f cryptopay

# View logs with timestamps
docker-compose logs -f -t cryptopay
```

### Container Health

```bash
# Check container status
docker-compose ps

# Check health status
docker inspect cryptopay-app | grep -A 10 "Health"

# View resource usage
docker stats cryptopay-app
```

### Monitoring Stack

When using the monitoring profile:

```bash
# Start with monitoring
docker-compose -f docker-compose.yml -f docker-compose.prod.yml --profile monitoring up -d

# Access Grafana
open http://localhost:3000
# Username: admin
# Password: (from GRAFANA_PASSWORD env var)

# Access Prometheus
open http://localhost:9090
```

## 🔧 Troubleshooting

### Common Issues

#### 1. Port Already in Use

```bash
# Check what's using port 5001
sudo lsof -i :5001

# Kill the process or change port in .env
EXTERNAL_PORT=5002
```

#### 2. Container Won't Start

```bash
# Check logs
docker-compose logs cryptopay

# Check container status
docker-compose ps

# Restart container
docker-compose restart cryptopay
```

#### 3. Build Failures

```bash
# Clean build
docker-compose down
docker system prune -f
docker-compose build --no-cache
docker-compose up -d
```

#### 4. Permission Issues

```bash
# Fix file permissions
sudo chown -R $USER:$USER .

# Fix Docker permissions (Linux)
sudo usermod -aG docker $USER
# Log out and back in
```

### Debug Mode

```bash
# Start with debug logging
LOG_LEVEL=debug docker-compose up

# Access container shell
docker-compose exec cryptopay sh

# Check application files
docker-compose exec cryptopay ls -la /app
```

### Performance Issues

```bash
# Check resource usage
docker stats

# Increase memory limits in docker-compose.prod.yml
deploy:
  resources:
    limits:
      memory: 2G
```

## 🔒 Security Considerations

### 1. Environment Variables

- Never commit `.env` files to version control
- Use strong passwords for database and services
- Rotate secrets regularly

### 2. Network Security

```bash
# Use custom network
docker network create cryptopay-network

# Restrict port exposure
ports:
  - "127.0.0.1:5001:5001"  # Only localhost access
```

### 3. Container Security

- Run as non-root user (already configured)
- Use specific image tags, not `latest`
- Regularly update base images
- Scan images for vulnerabilities

### 4. SSL/TLS

```bash
# Use Let's Encrypt for free SSL
# Install certbot
sudo apt install certbot

# Generate certificate
sudo certbot certonly --standalone -d your-domain.com

# Update nginx.conf with SSL configuration
```

### 5. Firewall Configuration

```bash
# UFW (Ubuntu)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# iptables (CentOS/RHEL)
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

## 📈 Scaling

### Horizontal Scaling

```yaml
# docker-compose.scale.yml
version: '3.8'
services:
  cryptopay:
    deploy:
      replicas: 3
    # Use load balancer (nginx, traefik, etc.)
```

### Vertical Scaling

```yaml
# Increase resource limits
deploy:
  resources:
    limits:
      cpus: '4.0'
      memory: 4G
```

## 🔄 Updates & Maintenance

### Application Updates

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Database Backups

```bash
# Backup PostgreSQL
docker-compose exec postgres pg_dump -U cryptopay cryptopay > backup.sql

# Restore PostgreSQL
docker-compose exec -T postgres psql -U cryptopay cryptopay < backup.sql
```

### Log Rotation

```bash
# Configure logrotate
sudo nano /etc/logrotate.d/cryptopay

# Add:
/var/lib/docker/containers/*/cryptopay-app-*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 644 root root
}
```

## 📞 Support

### Getting Help

1. Check the logs: `docker-compose logs -f`
2. Verify configuration: `docker-compose config`
3. Check container health: `docker-compose ps`
4. Review this documentation
5. Check GitHub issues

### Useful Commands

```bash
# Quick health check
curl -f http://localhost:5001/api/health || echo "Service down"

# View all containers
docker ps -a

# Clean up unused resources
docker system prune -f

# View disk usage
docker system df
```

---

## 🎉 Success!

Your CryptoPay application should now be running in Docker! 

- **Application**: http://localhost:5001
- **API Documentation**: http://localhost:5001/api
- **Health Check**: http://localhost:5001/api/health

For more information, see the main [README.md](README.md) and [P2P_TRY_API_GUIDE.md](P2P_TRY_API_GUIDE.md).