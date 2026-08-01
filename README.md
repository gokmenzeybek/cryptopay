# CryptoPay P2P Exchange with Papara Integration

A peer-to-peer TRY-XRP exchange system with integrated Papara instant transfer capabilities.

## Features

- **P2P Trading**: Direct peer-to-peer trading of Turkish Lira (TRY) for XRP
- **Papara Integration**: Instant transfer payments via Papara API
- **Order Management**: Create, match, and manage buy/sell orders
- **Real-time Updates**: Live order book and market data
- **Dispute Resolution**: Built-in dispute handling system
- **Multi-payment Methods**: Support for various payment methods including Papara
- **Responsive UI**: Modern React-based frontend
- **Docker Support**: Easy deployment with Docker Compose

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Papara merchant account (for live payments)
- Node.js 16+ (for development)

### Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd cryptoPay
   ```

2. **Set up environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Deploy with Docker**:
   ```bash
   docker-compose up -d
   ```

4. **Access the application**:
   - Frontend: http://localhost:3000
   - API: http://localhost:3000/api

## Documentation

- [API Documentation](docs/PAPARA_API_DOCUMENTATION.md) - Complete API reference
- [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) - Production deployment instructions
- [Database Schema](database/schema.sql) - Database structure
- [Environment Variables](.env.example) - Configuration options

## API Endpoints

### Core P2P Endpoints

- `GET /api/p2p/orders` - List all orders
- `POST /api/p2p/orders` - Create new order
- `POST /api/p2p/confirm-payment` - Confirm TRY payment
- `POST /api/p2p/confirm-xrp` - Confirm XRP transfer
- `POST /api/p2p/cancel` - Cancel order
- `POST /api/p2p/dispute` - Raise dispute

### Papara Integration Endpoints

- `POST /api/p2p/validate-papara-account` - Validate Papara account
- `POST /api/p2p/initiate-papara-payment` - Initiate Papara payment
- `GET /api/p2p/papara-payment-status/:orderId` - Check payment status
- `GET /api/p2p/papara-balance` - Get account balance

## Development

### Local Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start database**:
   ```bash
   docker-compose up -d postgres
   ```

3. **Run migrations**:
   ```bash
   npm run db:migrate
   ```

4. **Start development server**:
   ```bash
   npm run dev
   ```

### Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm test -- services/__tests__/paparaService.test.js
npm test -- services/__tests__/paparaIntegration.test.js

# Run with coverage
npm run test:coverage
```

### Code Structure

```
cryptoPay/
├── src/                    # Frontend React components
├── services/               # Backend services
│   ├── paparaService.js    # Papara API integration
│   ├── p2pMatchingService.js # P2P order matching
│   └── __tests__/          # Test files
├── database/               # Database schema and migrations
├── docs/                   # Documentation
├── server.js               # Main server file
├── docker-compose.yml      # Docker configuration
└── Dockerfile             # Docker build instructions
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PAPARA_API_KEY` | Papara API key | Required |
| `PAPARA_ENVIRONMENT` | Environment (sandbox/production) | sandbox |
| `PAPARA_MERCHANT_ID` | Papara merchant ID | Required |
| `POSTGRES_PASSWORD` | Database password | cryptopay_password |
| `NODE_ENV` | Node environment | development |
| `PORT` | Server port | 3000 |

### Papara Configuration

1. **Sandbox Mode** (Development):
   ```bash
   PAPARA_ENVIRONMENT=sandbox
   PAPARA_API_KEY=your_sandbox_api_key
   ```

2. **Production Mode** (Live):
   ```bash
   PAPARA_ENVIRONMENT=production
   PAPARA_API_KEY=your_live_api_key
   ```

## Deployment

### Docker Deployment

```bash
# Development
docker-compose up -d

# Production
docker-compose -f docker-compose.prod.yml up -d
```

### Manual Deployment

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Build frontend**:
   ```bash
   npm run build
   ```

3. **Start server**:
   ```bash
   npm start
   ```

## Security

- API keys stored securely in environment variables
- Input validation on all endpoints
- Rate limiting to prevent abuse
- HTTPS enforced in production
- SQL injection prevention
- XSS protection

## Monitoring

### Health Checks

```bash
# Application health
curl http://localhost:3000/api/health

# Database health
docker-compose exec postgres pg_isready

# Papara API health
curl http://localhost:3000/api/p2p/papara-balance
```

### Logs

```bash
# Application logs
docker-compose logs -f cryptopay

# Database logs
docker-compose logs -f postgres
```

## Troubleshooting

### Common Issues

1. **Database Connection Failed**:
   - Check if PostgreSQL is running
   - Verify database credentials
   - Check network connectivity

2. **Papara API Errors**:
   - Verify API key is correct
   - Check environment configuration
   - Ensure API key has required permissions

3. **Payment Initiation Failed**:
   - Check account balance
   - Verify account number format
   - Check order status

### Debug Mode

```bash
# Enable debug logging
export DEBUG=papara:*

# Restart application
docker-compose restart cryptopay
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

- **Documentation**: Check the docs/ directory
- **Issues**: Create an issue on GitHub
- **API Support**: Refer to Papara documentation
- **Database Issues**: Check PostgreSQL documentation

## Changelog

### Version 1.0.0
- Initial release with Papara integration
- Complete P2P trading functionality
- Docker deployment support
- Comprehensive test coverage
- API documentation
- Production deployment guide