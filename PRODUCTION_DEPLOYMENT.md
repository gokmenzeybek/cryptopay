# 🚀 CryptoPay Production Deployment Guide

This guide provides comprehensive instructions for deploying CryptoPay in a production environment with enterprise-grade security, monitoring, and scalability.

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [Docker Deployment](#docker-deployment)
- [PM2 Process Management](#pm2-process-management)
- [Nginx Reverse Proxy](#nginx-reverse-proxy)
- [SSL/TLS Configuration](#ssltls-configuration)
- [Monitoring & Logging](#monitoring--logging)
- [Security Hardening](#security-hardening)
- [Backup & Recovery](#backup--recovery)
- [Scaling & Performance](#scaling--performance)
- [Troubleshooting](#troubleshooting)

## 🔧 Prerequisites

### System Requirements

- **OS**: Ubuntu 20.04+ / CentOS 8+ / RHEL 8+
- **RAM**: Minimum 4GB, Recommended 8GB+
- **CPU**: 2+ cores
- **Storage**: 50GB+ SSD
- **Network**: Stable internet connection

### Software Dependencies

```bash
# Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Docker & Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# PostgreSQL 14+
sudo apt-get install -y postgresql postgresql-contrib

# Nginx
sudo apt-get install -y nginx

# PM2 (for process management)
sudo npm install -g pm2

# Additional tools
sudo apt-get install -y git curl wget unzip
```

## 🚀 Quick Start

### 1. Clone and Setup

```bash
# Clone repository
git clone https://github.com/your-org/cryptopay.git
cd cryptopay

# Install dependencies
npm install

# Build frontend
npm run build
```

### 2. Environment Configuration

```bash
# Copy production environment file
cp .env.production .env

# Edit configuration
nano .env
```

### 3. Database Setup

```bash
# Create database and user
sudo -u postgres psql
CREATE DATABASE cryptopay_prod;
CREATE USER cryptopay_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE cryptopay_prod TO cryptopay_user;
\q

# Run migrations
npm run db:migrate
```

### 4. Deploy with Docker

```bash
# Make deployment script executable
chmod +x scripts/deploy.sh

# Run full deployment
./scripts/deploy.sh
```

## ⚙️ Environment Configuration

### Production Environment Variables

```bash
# Application
NODE_ENV=production
PORT=5001
HOST=0.0.0.0

# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=cryptopay_prod
POSTGRES_USER=cryptopay_user
POSTGRES_PASSWORD=your_secure_password

# Security
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
LOG_REQUESTS=true

# P2P Exchange
CONVERSION_FEE_PERCENT=1.5
RATE_CACHE_TTL_SECONDS=300
```

## 🗄️ Database Setup

### PostgreSQL Configuration

```bash
# Edit PostgreSQL configuration
sudo nano /etc/postgresql/14/main/postgresql.conf

# Key settings:
max_connections = 200
shared_buffers = 256MB
effective_cache_size = 1GB
maintenance_work_mem = 64MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100

# Restart PostgreSQL
sudo systemctl restart postgresql
```

### Database Optimization

```sql
-- Create indexes for better performance
CREATE INDEX CONCURRENTLY idx_transactions_created_at ON transactions(created_at);
CREATE INDEX CONCURRENTLY idx_transactions_from_address ON transactions(from_address);
CREATE INDEX CONCURRENTLY idx_transactions_to_address ON transactions(to_address);
CREATE INDEX CONCURRENTLY idx_p2p_orders_status ON p2p_orders(status);
CREATE INDEX CONCURRENTLY idx_p2p_orders_type ON p2p_orders(type);
CREATE INDEX CONCURRENTLY idx_p2p_orders_created_at ON p2p_orders(created_at);
```

## 🐳 Docker Deployment

### Docker Compose Production

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  app:
    build: .
    container_name: cryptopay-app
    restart: unless-stopped
    ports:
      - "5001:5001"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    depends_on:
      - db
    volumes:
      - ./logs:/app/logs
      - ./backups:/app/backups
    networks:
      - cryptopay-network

  db:
    image: postgres:14-alpine
    container_name: cryptopay-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: cryptopay_prod
      POSTGRES_USER: cryptopay_user
      POSTGRES_PASSWORD: your_secure_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
    networks:
      - cryptopay-network

  nginx:
    image: nginx:alpine
    container_name: cryptopay-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app
    networks:
      - cryptopay-network

volumes:
  postgres_data:

networks:
  cryptopay-network:
    driver: bridge
```

### Build and Deploy

```bash
# Build production image
docker build -t cryptopay:latest .

# Start services
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

## 🔄 PM2 Process Management

### PM2 Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'cryptopay',
    script: 'server.production.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 5001
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    max_memory_restart: '1G',
    watch: false,
    ignore_watch: ['node_modules', 'logs'],
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
```

### PM2 Commands

```bash
# Start application
pm2 start ecosystem.config.js

# Monitor
pm2 monit

# View logs
pm2 logs cryptopay

# Restart
pm2 restart cryptopay

# Stop
pm2 stop cryptopay

# Save PM2 configuration
pm2 save

# Setup PM2 startup
pm2 startup
```

## 🌐 Nginx Reverse Proxy

### Nginx Configuration

```nginx
# /etc/nginx/sites-available/cryptopay
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;
    
    # SSL Configuration
    ssl_certificate /etc/ssl/certs/yourdomain.crt;
    ssl_certificate_key /etc/ssl/private/yourdomain.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    
    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=general:10m rate=30r/s;
    
    # API Routes
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://localhost:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Main Application
    location / {
        limit_req zone=general burst=50 nodelay;
        proxy_pass http://localhost:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Enable Site

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/cryptopay /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

## 🔒 SSL/TLS Configuration

### Let's Encrypt (Recommended)

```bash
# Install Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

### Custom SSL Certificates

```bash
# Generate private key
openssl genrsa -out yourdomain.key 2048

# Generate certificate signing request
openssl req -new -key yourdomain.key -out yourdomain.csr

# Generate self-signed certificate (for testing)
openssl x509 -req -days 365 -in yourdomain.csr -signkey yourdomain.key -out yourdomain.crt

# Copy to Nginx directory
sudo cp yourdomain.crt /etc/ssl/certs/
sudo cp yourdomain.key /etc/ssl/private/
sudo chmod 600 /etc/ssl/private/yourdomain.key
```

## 📊 Monitoring & Logging

### Application Monitoring

```bash
# Install monitoring tools
npm install -g pm2-logrotate

# Configure log rotation
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```

### System Monitoring

```bash
# Install system monitoring
sudo apt-get install -y htop iotop nethogs

# Monitor resources
htop
iotop
nethogs
```

### Log Analysis

```bash
# View application logs
tail -f logs/combined.log
tail -f logs/error.log

# View Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# View system logs
sudo journalctl -u nginx -f
sudo journalctl -u postgresql -f
```

## 🛡️ Security Hardening

### Firewall Configuration

```bash
# Install UFW
sudo apt-get install -y ufw

# Configure firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### Database Security

```sql
-- Create read-only user for monitoring
CREATE USER cryptopay_readonly WITH PASSWORD 'readonly_password';
GRANT CONNECT ON DATABASE cryptopay_prod TO cryptopay_readonly;
GRANT USAGE ON SCHEMA public TO cryptopay_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cryptopay_readonly;
```

### Application Security

```bash
# Set proper file permissions
chmod 600 .env
chmod 700 logs/
chmod 700 backups/

# Disable unnecessary services
sudo systemctl disable apache2
sudo systemctl stop apache2
```

## 💾 Backup & Recovery

### Database Backup

```bash
# Create backup script
cat > backup_db.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/cryptopay"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/cryptopay_$DATE.sql"

mkdir -p $BACKUP_DIR

pg_dump -h localhost -U cryptopay_user cryptopay_prod > $BACKUP_FILE

# Compress backup
gzip $BACKUP_FILE

# Remove backups older than 30 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_FILE.gz"
EOF

chmod +x backup_db.sh

# Schedule daily backups
crontab -e
# Add: 0 2 * * * /path/to/backup_db.sh
```

### Application Backup

```bash
# Create application backup script
cat > backup_app.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/cryptopay"
DATE=$(date +%Y%m%d_%H%M%S)
APP_DIR="/var/www/cryptopay"

mkdir -p $BACKUP_DIR

tar -czf "$BACKUP_DIR/cryptopay_app_$DATE.tar.gz" \
    --exclude=node_modules \
    --exclude=logs \
    --exclude=backups \
    $APP_DIR

# Remove backups older than 7 days
find $BACKUP_DIR -name "cryptopay_app_*.tar.gz" -mtime +7 -delete

echo "Application backup completed: cryptopay_app_$DATE.tar.gz"
EOF

chmod +x backup_app.sh
```

## 📈 Scaling & Performance

### Horizontal Scaling

```yaml
# docker-compose.scale.yml
version: '3.8'

services:
  app:
    build: .
    deploy:
      replicas: 3
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    depends_on:
      - db
    networks:
      - cryptopay-network

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - app
    networks:
      - cryptopay-network
```

### Load Balancing

```nginx
# Nginx load balancer configuration
upstream cryptopay_backend {
    server app_1:5001;
    server app_2:5001;
    server app_3:5001;
    keepalive 32;
}
```

### Performance Optimization

```bash
# Enable Node.js clustering
export NODE_ENV=production
export UV_THREADPOOL_SIZE=16

# Optimize PostgreSQL
sudo nano /etc/postgresql/14/main/postgresql.conf
# Set: max_connections = 200
# Set: shared_buffers = 256MB
# Set: effective_cache_size = 1GB
```

## 🔧 Troubleshooting

### Common Issues

#### Application Won't Start

```bash
# Check logs
pm2 logs cryptopay
docker-compose logs app

# Check port availability
netstat -tulpn | grep :5001

# Check environment variables
printenv | grep POSTGRES
```

#### Database Connection Issues

```bash
# Test database connection
psql -h localhost -U cryptopay_user -d cryptopay_prod

# Check PostgreSQL status
sudo systemctl status postgresql

# Check database logs
sudo journalctl -u postgresql -f
```

#### Nginx Issues

```bash
# Test Nginx configuration
sudo nginx -t

# Check Nginx status
sudo systemctl status nginx

# Check Nginx logs
sudo tail -f /var/log/nginx/error.log
```

### Performance Issues

```bash
# Check system resources
htop
free -h
df -h

# Check database performance
sudo -u postgres psql -d cryptopay_prod -c "SELECT * FROM pg_stat_activity;"

# Check application performance
pm2 monit
```

### Security Issues

```bash
# Check for open ports
nmap localhost

# Check firewall status
sudo ufw status

# Check SSL certificate
openssl s_client -connect yourdomain.com:443 -servername yourdomain.com
```

## 📞 Support

For additional support and troubleshooting:

- **Documentation**: [GitHub Wiki](https://github.com/your-org/cryptopay/wiki)
- **Issues**: [GitHub Issues](https://github.com/your-org/cryptopay/issues)
- **Discord**: [Community Discord](https://discord.gg/cryptopay)
- **Email**: support@cryptopay.com

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**⚠️ Important Security Notes:**

1. Always use strong passwords for database and application
2. Keep all software updated to latest versions
3. Regularly backup your data
4. Monitor logs for suspicious activity
5. Use HTTPS in production
6. Implement proper firewall rules
7. Regular security audits recommended