# CryptoPay Testing Guide

This document provides comprehensive information about the testing setup for the CryptoPay XRPL payment application.

## Overview

The CryptoPay application includes a comprehensive test suite covering:
- **Unit Tests**: Individual functions and components
- **Integration Tests**: API endpoints and database interactions
- **Component Tests**: React components and hooks
- **Service Tests**: Business logic and external API integrations
- **Docker Tests**: Containerized testing environments

## Test Structure

```
├── __tests__/                    # Test files
│   ├── services/                 # Service unit tests
│   ├── middleware/               # Middleware unit tests
│   ├── database/                 # Database DAL tests
│   ├── server/                   # Server endpoint tests
│   └── src/                      # Frontend tests
│       ├── components/           # React component tests
│       └── hooks/                # React hook tests
├── tests/                        # Test configuration
│   ├── setup.js                  # Jest setup
│   └── integration.test.js       # Integration tests
├── scripts/                      # Test scripts
│   └── test-all.sh              # Comprehensive test runner
├── jest.config.js               # Jest configuration
├── babel.config.js              # Babel configuration
├── Dockerfile.test              # Docker test configuration
└── docker-compose.test.yml      # Docker Compose test setup
```

## Prerequisites

### Required Software
- Node.js >= 16.0.0
- npm >= 8.0.0
- Docker (optional, for containerized testing)
- PostgreSQL (for integration tests)

### Required Dependencies
All testing dependencies are included in `package.json`:
- Jest (testing framework)
- Supertest (API testing)
- @testing-library/react (React component testing)
- @testing-library/jest-dom (DOM testing utilities)

## Running Tests

### Quick Start
```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Specific Test Categories
```bash
# Unit tests only
npm run test:unit

# Service tests
npm run test:services

# Middleware tests
npm run test:middleware

# Component tests
npm run test:components

# Hook tests
npm run test:hooks

# Server tests
npm run test:server

# API integration tests
npm run test:api
```

### Comprehensive Testing
```bash
# Run all tests with comprehensive reporting
npm run test:all

# This includes:
# - Unit tests
# - Coverage analysis
# - API tests
# - Docker tests (if available)
# - Linting
# - Report generation
```

## Docker Testing

### Prerequisites
- Docker installed and running
- Docker Compose available

### Running Docker Tests
```bash
# Unit tests in Docker
npm run test:docker

# Coverage tests in Docker
npm run test:docker-coverage

# Integration tests in Docker
npm run test:docker-integration

# Development testing in Docker
npm run test:docker-dev
```

### Docker Test Services
- **test-unit**: Runs unit tests in isolated container
- **test-coverage**: Generates coverage reports in container
- **test-integration**: Runs integration tests with database
- **test-dev**: Development environment with hot reload

## Test Configuration

### Jest Configuration
The `jest.config.js` file includes:
- Test environment setup
- Coverage thresholds (80% minimum)
- Module name mapping
- Transform configuration
- Test timeout settings

### Coverage Requirements
- **Branches**: 80%
- **Functions**: 80%
- **Lines**: 80%
- **Statements**: 80%

### Test Environment
- **Node Environment**: `test`
- **Database**: In-memory or test PostgreSQL
- **API Base URL**: `http://localhost:5001`
- **XRPL Network**: Testnet (mocked)

## Test Categories

### 1. Service Tests
Tests for business logic services:
- `tryRateScraperService.test.js` - XRP/TRY rate scraping
- `p2pMatchingService.test.js` - P2P order matching

**Key Test Areas:**
- Rate fetching from multiple sources
- P2P order creation and matching
- Error handling and edge cases
- Data validation and transformation

### 2. Middleware Tests
Tests for Express middleware:
- `rateLimit.test.js` - Rate limiting functionality
- `errorHandler.test.js` - Error handling middleware
- `security.test.js` - Security headers and validation

**Key Test Areas:**
- Rate limiting enforcement
- Error response formatting
- Security header validation
- Input sanitization

### 3. Server Tests
Tests for API endpoints:
- `server.test.js` - All API endpoint functionality

**Key Test Areas:**
- HTTP status codes
- Request/response validation
- Database interactions
- Error handling

### 4. Component Tests
Tests for React components:
- `Wallet.test.js` - Wallet management component
- `Payment.test.js` - Payment sending component
- `Dashboard.test.js` - Statistics dashboard
- `QRScanner.test.js` - QR code scanning

**Key Test Areas:**
- User interactions
- State management
- API integration
- Error handling

### 5. Hook Tests
Tests for React hooks:
- `useXRPL.test.js` - XRPL integration hook

**Key Test Areas:**
- XRPL connection management
- Wallet operations
- Transaction handling
- State updates

### 6. Database Tests
Tests for database access layers:
- `dal.test.js` - Data Access Layer functions

**Key Test Areas:**
- CRUD operations
- Query validation
- Error handling
- Data transformation

## Mocking Strategy

### External Dependencies
- **XRPL Library**: Mocked for consistent testing
- **Axios**: Mocked for HTTP requests
- **Database**: Mocked or in-memory for unit tests
- **React Toastify**: Mocked for notifications

### Mock Configuration
All mocks are configured in `tests/setup.js`:
- Global mocks for external libraries
- Test utilities and helpers
- Environment variable setup

## Continuous Integration

### GitHub Actions (Recommended)
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test:ci
      - uses: codecov/codecov-action@v1
```

### Local CI Testing
```bash
# Run CI-style tests locally
npm run test:ci

# This includes:
# - All tests
# - Coverage reporting
# - No watch mode
# - Exit on failure
```

## Test Data Management

### Test Fixtures
Test data is managed through:
- Mock data in test files
- Factory functions for complex objects
- Database seeding for integration tests

### Database Testing
- **Unit Tests**: In-memory database or mocks
- **Integration Tests**: Test PostgreSQL instance
- **Docker Tests**: Containerized database

## Performance Testing

### Load Testing
```bash
# Run API load tests
npm run test:api

# This tests:
# - Rate limiting
# - Concurrent requests
# - Response times
# - Error handling under load
```

### Memory Testing
- Jest memory usage monitoring
- Docker container resource limits
- Database connection pooling

## Debugging Tests

### Running Individual Tests
```bash
# Run specific test file
npm test -- services/__tests__/tryRateScraperService.test.js

# Run tests matching pattern
npm test -- --testNamePattern="should fetch rate"

# Run tests in specific directory
npm test -- services/__tests__/
```

### Debug Mode
```bash
# Run tests with debug output
npm test -- --verbose

# Run tests with coverage and debug
npm run test:coverage -- --verbose
```

### Test Debugging
- Use `console.log` in tests (filtered in CI)
- Jest debug mode: `node --inspect-brk node_modules/.bin/jest`
- React Testing Library debug utilities

## Best Practices

### Test Writing
1. **Arrange-Act-Assert** pattern
2. **Descriptive test names**
3. **Single responsibility per test**
4. **Mock external dependencies**
5. **Test edge cases and errors**

### Test Organization
1. **Group related tests with `describe`**
2. **Use `beforeEach` for setup**
3. **Clean up after tests**
4. **Use meaningful assertions**

### Coverage
1. **Aim for 80%+ coverage**
2. **Focus on critical paths**
3. **Test error conditions**
4. **Avoid testing implementation details**

## Troubleshooting

### Common Issues

#### Tests Failing
1. Check test environment setup
2. Verify mock configurations
3. Ensure dependencies are installed
4. Check for async/await issues

#### Coverage Issues
1. Verify test files are in correct locations
2. Check Jest configuration
3. Ensure all code paths are tested
4. Review coverage thresholds

#### Docker Issues
1. Ensure Docker is running
2. Check Docker Compose configuration
3. Verify port availability
4. Check container logs

#### Database Issues
1. Verify PostgreSQL is running
2. Check connection strings
3. Ensure test database exists
4. Verify migrations are applied

### Getting Help
1. Check test output for specific errors
2. Review Jest documentation
3. Check React Testing Library docs
4. Review project test examples

## Contributing

### Adding New Tests
1. Create test file in appropriate `__tests__` directory
2. Follow existing naming conventions
3. Include comprehensive test cases
4. Update this documentation if needed

### Test Requirements
- All new code must include tests
- Tests must pass before merging
- Coverage must not decrease
- Follow existing patterns and conventions

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [Docker Testing Best Practices](https://docs.docker.com/develop/dev-best-practices/)