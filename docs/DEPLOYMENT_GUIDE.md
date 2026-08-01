# Papara Integration Deployment Guide

## Overview

This guide provides step-by-step instructions for deploying the Papara-integrated P2P TRY-XRP exchange system. The deployment supports both development and production environments using Docker.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Database Configuration](#database-configuration)
4. [Papara Configuration](#papara-configuration)
5. [Docker Deployment](#docker-deployment)
6. [Production Deployment](#production-deployment)
7. [Monitoring and Maintenance](#monitoring-and-maintenance)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

- **Operating System**: Linux, macOS, or Windows with WSL2
- **Docker**: Version 20.10 or higher
- **Docker Compose**: Version 2.0 or higher
- **Memory**: Minimum 4GB RAM
- **Storage**: Minimum 10GB free space
- **Network**: Internet connection for API calls

### Required Accounts

1. **Papara Merchant Account**
   - Register at [Papara Merchant Portal](https://merchant.papara.com)
   - Obtain API credentials (API Key, Merchant ID)
   - Complete verification process

2. **Domain and SSL Certificate** (Production only)
   - Domain name for your application
   - SSL certificate for HTTPS

## Environment Setup

### 1. Clone Repository

```bash
git clone <repository-url>
cd cryptoPay
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Configuration

Create environment files:

```bash
# Copy template
cp .env.example .env

# Edit configuration
nano .env
```

**Required Environment Variables**:

```bash
# Papara Configuration
PAPARA_API_KEY=your_papara_api_key_here
PAPARA_ENVIRONMENT=sandbox  # or 'production'
PAPARA_MERCHANT_ID=your_merchant_id

# Database Configuration
POSTGRES_PASSWORD=cryptopay_password
POSTGRES_DB=cryptopay
POSTGRES_USER=cryptopay

# Application Configuration
NODE_ENV=development  # or 'production'
PORT=3000
```

## Database Configuration

### 1. Run Database Migrations

```bash
# Start database
docker-compose up -d postgres

# Wait for database to be ready
sleep 10

# Run migrations
npm run db:migrate
```

### 2. Verify Database Schema

The migration adds the following Papara-specific columns to `p2p_orders`:

```sql
-- Papara-specific fields
ALTER TABLE p2p_orders ADD COLUMN papara_account_number VARCHAR(50);
ALTER TABLE p2p_orders ADD COLUMN counterparty_papara_account VARCHAR(50);
ALTER TABLE p2p_orders ADD COLUMN papara_transaction_id VARCHAR(255);
ALTER TABLE p2p_orders ADD COLUMN papara_payment_status VARCHAR(50);
ALTER TABLE p2p_orders ADD COLUMN papara_verified_at TIMESTAMP WITH TIME ZONE;

-- Index for performance
CREATE INDEX idx_p2p_orders_papara_transaction ON p2p_orders(papara_transaction_id);
```

## Papara Configuration

### 1. Sandbox Testing

For development and testing:

```bash
PAPARA_ENVIRONMENT=sandbox
PAPARA_API_KEY=your_sandbox_api_key
```

**Sandbox Features**:
- Mock responses for all API calls
- No real money transactions
- Test account validation
- Simulated payment flows

### 2. Production Setup

For live deployment:

```bash
PAPARA_ENVIRONMENT=production
PAPARA_API_KEY=your_live_api_key
```

**Production Requirements**:
- Verified merchant account
- Live API credentials
- SSL certificate
- Rate limiting
- Monitoring

## Docker Deployment

### 1. Development Deployment

```bash
# Build and start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f cryptopay
```

### 2. Service Verification

```bash
# Check application health
curl http://localhost:3000/api/health

# Test Papara endpoints
curl -X POST http://localhost:3000/api/p2p/validate-papara-account \
  -H "Content-Type: application/json" \
  -d '{"accountNumber": "1234567890"}'
```

### 3. Database Access

```bash
# Connect to database
docker-compose exec postgres psql -U cryptopay -d cryptopay

# Check tables
\dt

# Verify Papara columns
\d p2p_orders
```

## Production Deployment

### 1. Production Environment File

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  cryptopay:
    build: .
    ports:
      - "80:3000"
      - "443:3000"
    environment:
      - NODE_ENV=production
      - PAPARA_ENVIRONMENT=production
      - PAPARA_API_KEY=${PAPARA_API_KEY}
      - PAPARA_MERCHANT_ID=${PAPARA_MERCHANT_ID}
    volumes:
      - ./ssl:/app/ssl:ro
    restart: unless-stopped
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=cryptopay
      - POSTGRES_USER=cryptopay
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/schema.sql:/docker-entrypoint-initdb.d/schema.sql
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    restart: unless-stopped
    depends_on:
      - cryptopay

volumes:
  postgres_data:
```

### 2. Nginx Configuration

Create `nginx.conf`:

```nginx
events {
    worker_connections 1024;
}

http {
    upstream cryptopay {
        server cryptopay:3000;
    }

    server {
        listen 80;
        server_name your-domain.com;
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl;
        server_name your-domain.com;

        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;

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

### 3. SSL Certificate Setup

```bash
# Create SSL directory
mkdir ssl

# Generate self-signed certificate (for testing)
openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem -days 365 -nodes

# Or use Let's Encrypt (recommended for production)
certbot certonly --standalone -d your-domain.com
```

### 4. Deploy Production

```bash
# Set production environment
export PAPARA_ENVIRONMENT=production
export PAPARA_API_KEY=your_live_api_key

# Deploy
docker-compose -f docker-compose.prod.yml up -d

# Verify deployment
docker-compose -f docker-compose.prod.yml ps
```

## Monitoring and Maintenance

### 1. Health Checks

```bash
# Application health
curl https://your-domain.com/api/health

# Database health
docker-compose exec postgres pg_isready -U cryptopay

# Papara API health
curl -X GET https://your-domain.com/api/p2p/papara-balance
```

### 2. Log Monitoring

```bash
# Application logs
docker-compose logs -f cryptopay

# Database logs
docker-compose logs -f postgres

# Nginx logs
docker-compose logs -f nginx
```

### 3. Log Rotation

The application writes structured logs to `logs/combined.log` and `logs/error.log`
using Winston. **These files are not rotated by the application itself.** In a
production deployment you must configure rotation so the container/host disk
does not fill up.

Recommended options (choose one):

1. **PM2 logrotate module** (when running under PM2):
   ```bash
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 100M
   pm2 set pm2-logrotate:retain 10
   ```

2. **Host-level logrotate** (when bind-mounting `logs/`):
   Create `/etc/logrotate.d/cryptopay`:
   ```
   /var/lib/cryptopay/logs/*.log {
       daily
       rotate 14
       compress
       delaycompress
       missingok
       notifempty
       copytruncate
   }
   ```

3. **Container runtime/driver rotation** (Docker):
   Configure the Docker daemon or compose logging driver with `max-size` and
   `max-file` options so `docker-compose logs` output is also bounded.

> Note: `winston-daily-rotate-file` is not bundled in this release. Adding it
> requires a new dependency and must be approved per project policy.

```bash
# Container resource usage
docker stats

# Database performance
docker-compose exec postgres psql -U cryptopay -d cryptopay -c "
SELECT schemaname,tablename,attname,n_distinct,correlation 
FROM pg_stats 
WHERE tablename = 'p2p_orders';"
```

### 4. Backup Strategy

```bash
# Database backup
docker-compose exec postgres pg_dump -U cryptopay cryptopay > backup_$(date +%Y%m%d).sql

# Restore from backup
docker-compose exec -T postgres psql -U cryptopay cryptopay < backup_20240115.sql
```

## Troubleshooting

### Common Issues

#### 1. Database Connection Failed

**Symptoms**: Application fails to start, database connection errors

**Solutions**:
```bash
# Check database status
docker-compose ps postgres

# Restart database
docker-compose restart postgres

# Check logs
docker-compose logs postgres

# Verify credentials
docker-compose exec postgres psql -U cryptopay -d cryptopay -c "SELECT 1;"
```

#### 2. Papara API Errors

**Symptoms**: API calls failing, authentication errors

**Solutions**:
```bash
# Verify API key
echo $PAPARA_API_KEY

# Check environment
docker-compose exec cryptopay env | grep PAPARA

# Test API connection
curl -X POST http://localhost:3000/api/p2p/validate-papara-account \
  -H "Content-Type: application/json" \
  -d '{"accountNumber": "1234567890"}'
```

#### 3. Payment Initiation Failed

**Symptoms**: Orders stuck in "matched" status, payment errors

**Solutions**:
```bash
# Check order status
docker-compose exec postgres psql -U cryptopay -d cryptopay -c "
SELECT order_id, status, papara_transaction_id 
FROM p2p_orders 
WHERE status = 'matched';"

# Check Papara balance
curl -X GET http://localhost:3000/api/p2p/papara-balance

# Verify account validation
curl -X POST http://localhost:3000/api/p2p/validate-papara-account \
  -H "Content-Type: application/json" \
  -d '{"accountNumber": "1234567890"}'
```

#### 4. High Memory Usage

**Symptoms**: Slow performance, out of memory errors

**Solutions**:
```bash
# Check memory usage
docker stats

# Restart services
docker-compose restart

# Optimize database
docker-compose exec postgres psql -U cryptopay -d cryptopay -c "VACUUM ANALYZE;"
```

### Debug Mode

Enable detailed logging:

```bash
# Set debug environment
export DEBUG=papara:*

# Restart application
docker-compose restart cryptopay

# Check debug logs
docker-compose logs -f cryptopay
```

### Performance Optimization

1. **Database Optimization**:
   ```sql
   -- Add indexes for frequently queried columns
   CREATE INDEX idx_p2p_orders_status ON p2p_orders(status);
   CREATE INDEX idx_p2p_orders_created_at ON p2p_orders(created_at);
   ```

2. **Application Optimization**:
   ```bash
   # Enable compression
   export COMPRESSION=true
   
   # Set connection pool size
   export DB_POOL_SIZE=20
   ```

3. **Caching**:
   ```bash
   # Enable Redis caching
   export REDIS_ENABLED=true
   export REDIS_URL=redis://redis:6379
   ```

## Security Checklist

### Production Security

- [ ] SSL certificate installed and configured
- [ ] API keys stored securely (not in code)
- [ ] Database credentials secured
- [ ] Rate limiting enabled
- [ ] Input validation implemented
- [ ] Error messages don't expose sensitive data
- [ ] Regular security updates applied
- [ ] Monitoring and alerting configured
- [ ] Backup strategy implemented
- [ ] Access logs enabled

### API Security

- [ ] HTTPS enforced for all API calls
- [ ] CORS configured properly
- [ ] Request size limits set
- [ ] SQL injection prevention
- [ ] XSS protection enabled
- [ ] CSRF protection implemented

## Support and Maintenance

### Regular Maintenance Tasks

1. **Daily**:
   - Check application logs
   - Monitor API rate limits
   - Verify database connectivity

2. **Weekly**:
   - Review error logs
   - Check disk space usage
   - Update dependencies

3. **Monthly**:
   - Security updates
   - Performance review
   - Backup verification

### Contact Information

- **Technical Support**: Check logs and documentation first
- **Papara Support**: Contact Papara for API-related issues
- **Database Issues**: Check PostgreSQL documentation
- **Docker Issues**: Check Docker documentation

## Conclusion

This deployment guide provides comprehensive instructions for deploying the Papara-integrated P2P exchange system. Follow the steps carefully, test in sandbox mode first, and ensure all security measures are in place before going live.

For additional support or questions, refer to the API documentation or contact the development team.
