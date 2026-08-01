// CryptoPay - XRPL Payment Application
// Based on XRPL Dev Portal tutorials and examples

class CryptoPayApp {
    constructor() {
        this.client = null;
        this.wallet = null;
        this.isConnected = false;
        this.transactionHistory = [];
        this.paymentRequests = [];
        this.db = null;
        this.currentPaymentRequest = null;
        this.paymentMonitorInterval = null;
        this.authToken = null;
        this.user = null;
        
        // XRPL Testnet URL
        this.SERVER_URL = "wss://s.altnet.rippletest.net:51233";
        
        // Dynamic API base URL detection
        this.API_BASE_URL = this.getApiBaseUrl();
        
        // Initialize asynchronously to avoid DOM access issues
        this.init().catch(error => {
            console.error('CryptoPayApp constructor init failed:', error);
        });
    }

    /**
     * Dynamically determine the API base URL based on how the frontend is accessed
     * This allows the app to work both locally and across devices on the same network
     */
    getApiBaseUrl() {
        const hostname = window.location.hostname;
        const port = '3169';
        
        // If accessing via localhost/127.0.0.1, use localhost for API
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            const apiUrl = `http://127.0.0.1:${port}`;
            console.log('🔧 Using localhost API URL:', apiUrl);
            return apiUrl;
        }
        
        // Otherwise, use the same hostname as the frontend (for network access)
        const apiUrl = `http://${hostname}:${port}`;
        console.log('🌐 Using network API URL:', apiUrl);
        console.log('📱 Frontend hostname:', hostname);
        return apiUrl;
    }

    async init() {
        try {
            await this.initDatabase();
            await this.connectToXRPL();
            this.checkLibraries();
            // Don't show status here as DOM might not be ready
            console.log('CryptoPayApp initialized successfully');
        } catch (error) {
            console.error('CryptoPayApp initialization failed:', error);
            // Don't show status here as DOM might not be ready
        }
    }

    checkLibraries() {
        if (typeof QRCode === 'undefined') {
            console.warn('QRCode library not loaded - QR code generation will use fallback');
        }
        if (typeof initSqlJs === 'undefined') {
            console.warn('SQL.js library not loaded - will use localStorage fallback');
        }
    }

    async initDatabase() {
        try {
            // Initialize SQL.js
            const SQL = await initSqlJs({
                locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.8.0/dist/${file}`
            });
            
            // Create database
            this.db = new SQL.Database();
            
            // Check if shared API server is available
            this.sharedApiAvailable = await this.checkSharedApi();
            if (this.sharedApiAvailable) {
                console.log('Shared API server detected - enabling data sync');
            }
            
            // Create comprehensive tables
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS wallets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    address TEXT UNIQUE NOT NULL,
                    seed TEXT NOT NULL,
                    public_key TEXT NOT NULL,
                    private_key TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
                    is_active BOOLEAN DEFAULT 1
                );
                
                CREATE TABLE IF NOT EXISTS transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    hash TEXT UNIQUE NOT NULL,
                    from_address TEXT NOT NULL,
                    to_address TEXT NOT NULL,
                    amount REAL NOT NULL,
                    memo TEXT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    status TEXT DEFAULT 'pending',
                    block_number INTEGER,
                    fee REAL,
                    raw_transaction TEXT
                );
                
                CREATE TABLE IF NOT EXISTS payment_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_id TEXT UNIQUE NOT NULL,
                    amount REAL NOT NULL,
                    recipient TEXT NOT NULL,
                    memo TEXT,
                    status TEXT DEFAULT 'pending',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    completed_at DATETIME,
                    expires_at DATETIME,
                    qr_data TEXT
                );
                
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
            `);
            
            // Create indexes for better performance
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_transactions_hash ON transactions(hash);
                CREATE INDEX IF NOT EXISTS idx_transactions_from ON transactions(from_address);
                CREATE INDEX IF NOT EXISTS idx_transactions_to ON transactions(to_address);
                CREATE INDEX IF NOT EXISTS idx_payment_requests_id ON payment_requests(request_id);
                CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);
                CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(address);
            `);
            
            console.log('Database initialized successfully with enhanced schema');
            
            // Migrate data from localStorage if needed
            await this.migrateFromLocalStorage();
            
        } catch (error) {
            console.error('Database initialization failed:', error);
            // Fallback to localStorage if SQLite fails
            this.useLocalStorage = true;
            console.log('Using localStorage fallback');
        }
    }

    async checkSharedApi() {
        try {
            const response = await fetch(`${this.API_BASE_URL}/api/health`);
            const data = await response.json();
            return data.success;
        } catch (error) {
            return false;
        }
    }

    async login(username, password) {
        try {
            const response = await fetch(`${this.API_BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            if (data.success) {
                this.authToken = data.token;
                this.user = data.user;
                localStorage.setItem('cryptoPayAuth', JSON.stringify({ token: this.authToken, user: this.user }));
                return true;
            }
            return false;
        } catch (error) {
            console.error('Login failed:', error);
            return false;
        }
    }

    async register(username, email, password) {
        try {
            const response = await fetch(`${this.API_BASE_URL}/api/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, email, password })
            });
            
            const data = await response.json();
            if (data.success) {
                this.authToken = data.token;
                this.user = data.user;
                localStorage.setItem('cryptoPayAuth', JSON.stringify({ token: this.authToken, user: this.user }));
                return true;
            }
            return false;
        } catch (error) {
            console.error('Registration failed:', error);
            return false;
        }
    }

    logout() {
        this.authToken = null;
        this.user = null;
        localStorage.removeItem('cryptoPayAuth');
    }

    isAuthenticated() {
        return this.authToken !== null && this.user !== null;
    }

    getAuthHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.authToken}`
        };
    }

    async syncToSharedApi(data, endpoint) {
        if (!this.sharedApiAvailable || !this.isAuthenticated()) return;
        
        try {
            const response = await fetch(`${this.API_BASE_URL}/api/${endpoint}`, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify(data)
            });
            
            if (response.ok) {
                console.log(`Data synced to shared API: ${endpoint}`);
            }
        } catch (error) {
            console.warn('Failed to sync to shared API:', error);
        }
    }

    async migrateFromLocalStorage() {
        try {
            // Migrate wallet data
            const savedWallet = localStorage.getItem('cryptoPayWallet');
            if (savedWallet && this.db) {
                const walletData = JSON.parse(savedWallet);
                
                // Check if wallet already exists in database
                const existingWallet = this.db.exec(`
                    SELECT id FROM wallets WHERE address = ?
                `, [walletData.address]);
                
                if (existingWallet.length === 0) {
                    // Insert wallet into database
                    this.db.run(`
                        INSERT INTO wallets (address, seed, public_key, private_key, created_at, last_used, is_active)
                        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 1)
                    `, [walletData.address, walletData.seed, walletData.publicKey, walletData.privateKey]);
                    
                    console.log('Wallet migrated from localStorage to database');
                    
                    // Sync to shared API
                    await this.syncToSharedApi({
                        address: walletData.address,
                        public_key: walletData.publicKey,
                        created_at: new Date().toISOString(),
                        last_used: new Date().toISOString(),
                        is_active: true
                    }, 'wallets');
                }
            }
            
            // Migrate transaction history
            const savedTransactions = localStorage.getItem('cryptoPayTransactions');
            if (savedTransactions && this.db) {
                const transactions = JSON.parse(savedTransactions);
                
                for (const tx of transactions) {
                    try {
                        this.db.run(`
                            INSERT OR IGNORE INTO transactions (hash, from_address, to_address, amount, memo, timestamp, status)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `, [tx.hash, tx.from, tx.to, tx.amount, tx.memo, tx.timestamp, 'completed']);
                        
                        // Sync to shared API
                        await this.syncToSharedApi({
                            hash: tx.hash,
                            from_address: tx.from,
                            to_address: tx.to,
                            amount: tx.amount,
                            memo: tx.memo,
                            timestamp: tx.timestamp,
                            status: 'completed'
                        }, 'transactions');
                    } catch (error) {
                        console.warn('Failed to migrate transaction:', tx.hash, error);
                    }
                }
                
                console.log(`Migrated ${transactions.length} transactions from localStorage`);
            }
            
        } catch (error) {
            console.error('Migration from localStorage failed:', error);
        }
    }

    async connectToXRPL() {
        try {
            this.client = new xrpl.Client(this.SERVER_URL);
            await this.client.connect();
            this.isConnected = true;
            console.log('Connected to XRPL Testnet');
        } catch (error) {
            console.error('Failed to connect to XRPL:', error);
            throw error;
        }
    }

    async createWallet() {
        try {
            this.showLoading(true);
            this.showStatus('Creating new wallet...', 'info');

            if (!this.isConnected) {
                await this.connectToXRPL();
            }

            // Generate a new wallet with proper seed length
            this.wallet = xrpl.Wallet.generate();
            console.log('Generated wallet seed length:', this.wallet.seed.length);
            
            // Fund the wallet with testnet XRP
            const fundResult = await this.client.fundWallet(this.wallet);
            
            // Update UI
            document.getElementById('walletAddress').textContent = this.wallet.address;
            document.getElementById('walletBalance').textContent = `${fundResult.balance} XRP`;
            
            // Validate seed length before storing
            if (this.wallet.seed.length < 29) {
                throw new Error(`Invalid seed length: ${this.wallet.seed.length}. Expected >= 29 characters.`);
            }
            
            // Store wallet in database
            await this.saveWalletToDatabase(this.wallet);
            
            // Also store in localStorage as backup
            const walletData = {
                address: this.wallet.address,
                seed: this.wallet.seed,
                publicKey: this.wallet.publicKey,
                privateKey: this.wallet.privateKey
            };
            localStorage.setItem('cryptoPayWallet', JSON.stringify(walletData));
            console.log('Wallet saved to database and localStorage:', walletData);
            console.log('Seed length verified:', this.wallet.seed.length, 'characters');

            this.showStatus(`Wallet created successfully! Address: ${this.wallet.address}`, 'success');
            
            // Refresh balance
            await this.refreshBalance();
            
        } catch (error) {
            console.error('Error creating wallet:', error);
            this.showStatus(`Error creating wallet: ${error.message}`, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async saveWalletToDatabase(wallet) {
        try {
            if (!this.db) {
                console.warn('Database not available, skipping wallet save');
                return;
            }
            
            // Check if wallet already exists
            const existingWallet = this.db.exec(`
                SELECT id FROM wallets WHERE address = ?
            `, [wallet.address]);
            
            if (existingWallet.length > 0) {
                // Update existing wallet
                this.db.run(`
                    UPDATE wallets 
                    SET seed = ?, public_key = ?, private_key = ?, last_used = datetime('now'), is_active = 1
                    WHERE address = ?
                `, [wallet.seed, wallet.publicKey, wallet.privateKey, wallet.address]);
                console.log('Wallet updated in database');
            } else {
                // Insert new wallet
                this.db.run(`
                    INSERT INTO wallets (address, seed, public_key, private_key, created_at, last_used, is_active)
                    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 1)
                `, [wallet.address, wallet.seed, wallet.publicKey, wallet.privateKey]);
                console.log('Wallet saved to database');
            }
        } catch (error) {
            console.error('Failed to save wallet to database:', error);
            throw error;
        }
    }

    async loadExistingWallet() {
        try {
            // Try to load from database first
            if (this.db) {
                const walletResult = this.db.exec(`
                    SELECT address, seed, public_key, private_key 
                    FROM wallets 
                    WHERE is_active = 1 
                    ORDER BY last_used DESC 
                    LIMIT 1
                `);
                
                if (walletResult.length > 0 && walletResult[0].values.length > 0) {
                    const walletData = walletResult[0].values[0];
                    const wallet = {
                        address: walletData[0],
                        seed: walletData[1],
                        publicKey: walletData[2],
                        privateKey: walletData[3]
                    };
                    
                    // Validate wallet data
                    if (this.validateWalletData(wallet)) {
                        this.wallet = new xrpl.Wallet(wallet.seed);
                        document.getElementById('walletAddress').textContent = this.wallet.address;
                        console.log('Wallet loaded from database:', this.wallet.address);
                        
                        // Update last used timestamp
                        this.db.run(`
                            UPDATE wallets SET last_used = datetime('now') WHERE address = ?
                        `, [this.wallet.address]);
                        
                        await this.refreshBalance();
                        this.showStatus('Existing wallet loaded from database', 'success');
                        return true;
                    }
                }
            }
            
            // Fallback to localStorage
            const savedWallet = localStorage.getItem('cryptoPayWallet');
            if (savedWallet) {
                const walletData = JSON.parse(savedWallet);
                console.log('Loading wallet from localStorage:', walletData);
                
                if (this.validateWalletData(walletData)) {
                    this.wallet = new xrpl.Wallet(walletData.seed);
                    document.getElementById('walletAddress').textContent = this.wallet.address;
                    console.log('Wallet loaded from localStorage:', this.wallet.address);
                    
                    // Save to database for future use
                    if (this.db) {
                        await this.saveWalletToDatabase(this.wallet);
                    }
                    
                    await this.refreshBalance();
                    this.showStatus('Existing wallet loaded from localStorage', 'success');
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            console.error('Error loading existing wallet:', error);
            this.showStatus(`Error loading wallet: ${error.message}`, 'error');
            // Clear corrupted wallet data
            localStorage.removeItem('cryptoPayWallet');
            return false;
        }
    }

    validateWalletData(walletData) {
        // Validate wallet data structure
        if (!walletData.seed || typeof walletData.seed !== 'string' || walletData.seed.length < 10) {
            console.error('Invalid wallet data: missing or invalid seed');
            return false;
        }
        
        // Additional validation for XRPL seed format
        if (!walletData.seed.startsWith('s') || walletData.seed.length < 29) {
            console.error('Invalid XRPL seed format:', walletData.seed);
            return false;
        }
        
        return true;
    }

    async refreshBalance() {
        try {
            if (!this.wallet) {
                const walletLoaded = await this.loadExistingWallet();
                if (!walletLoaded) {
                    this.showStatus('No wallet found. Please create a new wallet.', 'error');
                    return;
                }
            }

            if (!this.isConnected) {
                await this.connectToXRPL();
            }

            const balance = await this.client.getXrpBalance(this.wallet.address);
            document.getElementById('walletBalance').textContent = `${balance} XRP`;
            
            this.showStatus('Balance updated', 'success');
        } catch (error) {
            console.error('Error refreshing balance:', error);
            this.showStatus(`Error refreshing balance: ${error.message}`, 'error');
        }
    }

    async waitForValidation(txHash, { maxAttempts = 15, delayMs = 1000 } = {}) {
        for (let i = 0; i < maxAttempts; i++) {
            const tx = await this.client.request({ command: 'tx', transaction: txHash });
            if (tx.result && tx.result.validated) return tx.result;
            await new Promise(r => setTimeout(r, delayMs));
        }
        throw new Error('Transaction not validated in time');
    }

    async sendPayment() {
        try {
            const recipientAddress = document.getElementById('recipientAddress').value.trim();
            const amount = parseFloat(document.getElementById('amount').value);
            const memo = document.getElementById('memo').value.trim();

            // Validation
            if (!recipientAddress) {
                this.showStatus('Please enter recipient address', 'error');
                return;
            }

            if (!amount || amount <= 0) {
                this.showStatus('Please enter a valid amount', 'error');
                return;
            }

            if (!this.wallet) {
                const walletLoaded = await this.loadExistingWallet();
                if (!walletLoaded) {
                    this.showStatus('No wallet found. Please create a new wallet.', 'error');
                    return;
                }
            }

            this.showLoading(true);
            this.showStatus('Preparing transaction...', 'info');

            if (!this.isConnected) {
                await this.connectToXRPL();
            }

            // Check if recipient address is valid
            try {
                await this.client.request({
                    command: "account_info",
                    account: recipientAddress,
                    ledger_index: "validated"
                });
            } catch (error) {
                this.showStatus('Invalid recipient address', 'error');
                this.showLoading(false);
                return;
            }

            // Prepare transaction
            const paymentTransaction = {
                TransactionType: "Payment",
                Account: this.wallet.address,
                Amount: xrpl.xrpToDrops(amount.toString()),
                Destination: recipientAddress
            };

            // Add memo if provided
            if (memo) {
                paymentTransaction.Memos = [{
                    Memo: {
                        MemoData: xrpl.convertStringToHex(memo)
                    }
                }];
            }

            // Autofill transaction
            const preparedTx = await this.client.autofill(paymentTransaction);
            
            this.showStatus('Signing transaction...', 'info');

            // Sign transaction
            const signedTx = this.wallet.sign(preparedTx);
            
            this.showStatus('Submitting transaction...', 'info');

            // Reliable submit + validation
            const prelim = await this.client.submit(signedTx.tx_blob);
            if (prelim.result.engine_result !== 'tesSUCCESS') {
                this.showStatus(`Prelim submit failed: ${prelim.result.engine_result}`, 'error');
                this.showLoading(false);
                return;
            }
            const validated = await this.waitForValidation(signedTx.hash);
            if (validated.meta?.TransactionResult === 'tesSUCCESS') {
                this.showStatus(`Payment successful! Transaction Hash: ${signedTx.hash}`, 'success');
                
                // Add to transaction history
                this.addToTransactionHistory({
                    hash: signedTx.hash,
                    type: 'Payment',
                    amount: amount,
                    recipient: recipientAddress,
                    memo: memo,
                    timestamp: new Date().toISOString()
                });

                // Clear form
                document.getElementById('recipientAddress').value = '';
                document.getElementById('amount').value = '';
                document.getElementById('memo').value = '';

                // Refresh balance
                await this.refreshBalance();
            } else {
                this.showStatus(`Transaction failed: ${validated.meta?.TransactionResult || 'unknown'}`, 'error');
            }

        } catch (error) {
            console.error('Error sending payment:', error);
            this.showStatus(`Error sending payment: ${error.message}`, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async addToTransactionHistory(transaction) {
        try {
            // Save to database
            if (this.db) {
                this.db.run(`
                    INSERT OR REPLACE INTO transactions 
                    (hash, from_address, to_address, amount, memo, timestamp, status, block_number, fee, raw_transaction)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    transaction.hash,
                    transaction.from || this.wallet?.address,
                    transaction.to || transaction.recipient,
                    transaction.amount,
                    transaction.memo || null,
                    transaction.timestamp,
                    'completed',
                    transaction.blockNumber || null,
                    transaction.fee || null,
                    transaction.rawTransaction || null
                ]);
                console.log('Transaction saved to database');
            }
            
            // Also save to localStorage as backup
            this.saveTransactionToLocalStorage(transaction);
            this.loadTransactionHistory();
        } catch (error) {
            console.error('Error saving transaction:', error);
            // Fallback to localStorage only
            this.saveTransactionToLocalStorage(transaction);
            this.loadTransactionHistory();
        }
    }

    saveTransactionToLocalStorage(transaction) {
        const transactions = JSON.parse(localStorage.getItem('cryptoPayTransactions') || '[]');
        transactions.unshift(transaction);
        localStorage.setItem('cryptoPayTransactions', JSON.stringify(transactions));
    }

    loadTransactionHistory() {
        let transactions = [];
        
        if (this.db) {
            try {
                const result = this.db.exec(`
                    SELECT hash, from_address, to_address, amount, memo, timestamp, status, block_number, fee
                    FROM transactions 
                    ORDER BY timestamp DESC
                    LIMIT 50
                `);
                
                if (result.length > 0) {
                    transactions = result[0].values.map(row => ({
                        hash: row[0],
                        from: row[1],
                        to: row[2],
                        amount: row[3],
                        memo: row[4],
                        timestamp: row[5],
                        status: row[6],
                        blockNumber: row[7],
                        fee: row[8]
                    }));
                }
                console.log(`Loaded ${transactions.length} transactions from database`);
            } catch (error) {
                console.error('Database query failed:', error);
                transactions = JSON.parse(localStorage.getItem('cryptoPayTransactions') || '[]');
            }
        } else {
            transactions = JSON.parse(localStorage.getItem('cryptoPayTransactions') || '[]');
        }

        this.updateTransactionHistoryUI(transactions);
    }

    updateTransactionHistoryUI(transactions) {
        const historyContainer = document.getElementById('transactionHistory');
        
        if (transactions.length === 0) {
            historyContainer.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No transactions yet</p>';
            return;
        }

        const historyHTML = transactions.map(tx => `
            <div class="transaction-item">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <div class="transaction-amount">-${tx.amount} XRP</div>
                    <div style="font-size: 0.9rem; color: #666;">${new Date(tx.timestamp).toLocaleString()}</div>
                </div>
                <div style="margin-bottom: 5px;">
                    <strong>To:</strong> ${tx.recipient}
                </div>
                ${tx.memo ? `<div style="margin-bottom: 5px;"><strong>Memo:</strong> ${tx.memo}</div>` : ''}
                <div class="transaction-hash">
                    <strong>Hash:</strong> ${tx.hash}
                </div>
            </div>
        `).join('');

        historyContainer.innerHTML = historyHTML;
    }

    exportWallet() {
        if (!this.wallet) {
            this.showStatus('No wallet to export', 'error');
            return;
        }

        const walletData = {
            address: this.wallet.address,
            seed: this.wallet.seed,
            publicKey: this.wallet.publicKey,
            privateKey: this.wallet.privateKey
        };

        const dataStr = JSON.stringify(walletData, null, 2);
        const dataBlob = new Blob([dataStr], {type: 'application/json'});
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `cryptoPay-wallet-${this.wallet.address}.json`;
        link.click();

        this.showStatus('Wallet exported successfully', 'success');
    }

    showStatus(message, type) {
        const statusDiv = document.getElementById('status');
        if (statusDiv) {
            statusDiv.innerHTML = `<div class="status ${type}">${message}</div>`;
            
            // Auto-hide success and info messages after 5 seconds
            if (type === 'success' || type === 'info') {
                setTimeout(() => {
                    if (statusDiv) {
                        statusDiv.innerHTML = '';
                    }
                }, 5000);
            }
        } else {
            // Fallback to console if DOM not ready
            console.log(`Status [${type}]: ${message}`);
        }
    }

    showLoading(show) {
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) {
            loadingDiv.style.display = show ? 'block' : 'none';
        }
    }

    async generatePaymentRequest() {
        try {
            const amount = parseFloat(document.getElementById('requestAmount').value);
            const memo = document.getElementById('requestMemo').value.trim();

            // Validation
            if (!amount || amount <= 0) {
                this.showStatus('Please enter a valid amount', 'error');
                return;
            }

            if (!this.wallet) {
                const walletLoaded = await this.loadExistingWallet();
                if (!walletLoaded) {
                    this.showStatus('No wallet found. Please create a new wallet.', 'error');
                    return;
                }
            }

            // Generate unique request ID
            const requestId = this.generateRequestId();
            
            // Create payment request data
            const paymentRequest = {
                requestId: requestId,
                amount: amount,
                memo: memo,
                recipient: this.wallet.address,
                timestamp: new Date().toISOString(),
                status: 'pending'
            };

            // Save to database
            this.savePaymentRequest(paymentRequest);

            // Ask server to sign minimal payload
            let signature = null;
            try {
                const res = await fetch(`${this.API_BASE_URL}/api/payment_requests/sign`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        requestId: paymentRequest.requestId,
                        amount: paymentRequest.amount,
                        recipient: paymentRequest.recipient,
                        memo: paymentRequest.memo || ''
                    })
                });
                const sdata = await res.json();
                if (sdata.success) signature = sdata.signature;
            } catch (_) {}

            // Generate QR code data (embed signature if present)
            const qrData = JSON.stringify({
                type: 'xrpl_payment_request',
                version: '1.0',
                requestId: paymentRequest.requestId,
                amount: paymentRequest.amount,
                recipient: paymentRequest.recipient,
                memo: paymentRequest.memo,
                timestamp: paymentRequest.timestamp,
                sig: signature
            });

            // Display QR code
            this.displayQRCode(qrData, paymentRequest);

            // Start monitoring for payments
            this.startPaymentMonitoring(requestId);

            this.showStatus('Payment request generated successfully', 'success');

        } catch (error) {
            console.error('Error generating payment request:', error);
            this.showStatus(`Error generating payment request: ${error.message}`, 'error');
        }
    }

    generateRequestId() {
        return 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    generateQRData(paymentRequest) {
        return JSON.stringify({
            type: 'xrpl_payment_request',
            version: '1.0',
            requestId: paymentRequest.requestId,
            amount: paymentRequest.amount,
            recipient: paymentRequest.recipient,
            memo: paymentRequest.memo,
            timestamp: paymentRequest.timestamp
        });
    }

    displayQRCode(qrData, paymentRequest) {
        const qrContainer = document.getElementById('qrCodeContainer');
        const qrCodeDiv = document.getElementById('qrCode');
        const qrAmount = document.getElementById('qrAmount');
        const qrAddress = document.getElementById('qrAddress');
        const qrStatus = document.getElementById('qrStatus');

        // Clear previous QR code
        qrCodeDiv.innerHTML = '';

        // Update display first
        qrAmount.textContent = paymentRequest.amount;
        qrAddress.textContent = paymentRequest.recipient;
        qrStatus.textContent = 'Pending';
        qrStatus.className = 'status-pending';

        // Show container
        qrContainer.style.display = 'block';
        this.currentPaymentRequest = paymentRequest;

        // Generate QR code with multiple fallback methods
        this.generateQRCode(qrData, qrCodeDiv);
    }

    generateQRCode(data, container) {
        // Method 1: Try qrcode-generator library
        if (typeof qrcode !== 'undefined') {
            try {
                const qr = qrcode(0, 'M');
                qr.addData(data);
                qr.make();
                
                const qrHTML = qr.createImgTag(4, 8);
                container.innerHTML = qrHTML;
                console.log('QR code generated with qrcode-generator');
                return;
            } catch (error) {
                console.warn('qrcode-generator failed:', error);
            }
        }

        // Method 2: Try QRCode library (original)
        if (typeof QRCode !== 'undefined') {
            try {
                QRCode.toCanvas(container, data, {
                    width: 256,
                    height: 256,
                    margin: 2,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    }
                }, (error) => {
                    if (error) {
                        console.warn('QRCode library failed:', error);
                        this.generateFallbackQR(data, container);
                    }
                });
                console.log('QR code generated with QRCode library');
                return;
            } catch (error) {
                console.warn('QRCode library failed:', error);
            }
        }

        // Method 3: Generate using online QR API
        this.generateOnlineQR(data, container);
    }

    generateOnlineQR(data, container) {
        const encodedData = encodeURIComponent(data);
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodedData}`;
        
        container.innerHTML = `
            <img src="${qrUrl}" 
                 alt="QR Code" 
                 style="border: 2px solid #e9ecef; border-radius: 10px; padding: 10px; background: white;"
                 onerror="this.parentNode.innerHTML='<div style=\'padding: 20px; text-align: center; color: #666;\'>QR Code generation failed. Please try again.</div>'">
        `;
        
        console.log('QR code generated using online API');
    }

    generateFallbackQR(data, container) {
        // Create a simple text-based QR representation
        const lines = [];
        const maxLength = 40;
        
        // Split data into lines
        for (let i = 0; i < data.length; i += maxLength) {
            lines.push(data.substring(i, i + maxLength));
        }
        
        container.innerHTML = `
            <div style="border: 2px solid #e9ecef; border-radius: 10px; padding: 20px; background: white; text-align: center;">
                <div style="font-size: 18px; font-weight: bold; margin-bottom: 15px; color: #333;">📱 Payment Request</div>
                <div style="font-family: monospace; font-size: 12px; line-height: 1.4; background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 10px 0; text-align: left; word-break: break-all;">
                    ${lines.join('<br>')}
                </div>
                <div style="font-size: 14px; color: #666; margin-top: 10px;">
                    Scan this with any QR code reader or copy the data above
                </div>
            </div>
        `;
        
        console.log('Fallback QR display generated');
    }


    savePaymentRequest(paymentRequest) {
        if (this.db && !this.useLocalStorage) {
            try {
                const stmt = this.db.prepare(`
                    INSERT INTO payment_requests (request_id, amount, memo, status, created_at)
                    VALUES (?, ?, ?, ?, ?)
                `);
                stmt.run([
                    paymentRequest.requestId,
                    paymentRequest.amount,
                    paymentRequest.memo,
                    paymentRequest.status,
                    paymentRequest.timestamp
                ]);
                stmt.free();
            } catch (error) {
                console.error('Database save failed:', error);
                this.savePaymentRequestToLocalStorage(paymentRequest);
            }
        } else {
            this.savePaymentRequestToLocalStorage(paymentRequest);
        }
    }

    savePaymentRequestToLocalStorage(paymentRequest) {
        const requests = JSON.parse(localStorage.getItem('cryptoPayPaymentRequests') || '[]');
        requests.push(paymentRequest);
        localStorage.setItem('cryptoPayPaymentRequests', JSON.stringify(requests));
    }

    startPaymentMonitoring(requestId) {
        // Clear existing interval
        if (this.paymentMonitorInterval) {
            clearInterval(this.paymentMonitorInterval);
        }

        // Check for payments every 10 seconds
        this.paymentMonitorInterval = setInterval(async () => {
            await this.checkForIncomingPayments(requestId);
        }, 10000);
    }

    async checkForIncomingPayments(requestId) {
        try {
            if (!this.wallet || !this.isConnected) {
                return;
            }

            // Get account transactions
            const response = await this.client.request({
                command: "account_tx",
                account: this.wallet.address,
                limit: 20
            });

            const transactions = response.result.transactions || [];
            
            for (const tx of transactions) {
                const txData = tx.tx;
                if (txData.TransactionType === 'Payment' && 
                    txData.Destination === this.wallet.address &&
                    tx.meta.TransactionResult === 'tesSUCCESS') {
                    
                    // Check if this payment matches our request
                    const amount = parseFloat(xrpl.dropsToXrp(txData.Amount));
                    const memo = txData.Memos ? 
                        xrpl.convertHexToString(txData.Memos[0].Memo.MemoData) : '';
                    
                    if (this.matchesPaymentRequest(requestId, amount, memo)) {
                        await this.completePaymentRequest(requestId, txData.hash, amount);
                        return;
                    }
                }
            }
        } catch (error) {
            console.error('Error checking for payments:', error);
        }
    }

    matchesPaymentRequest(requestId, amount, memo) {
        if (!this.currentPaymentRequest) return false;
        
        return this.currentPaymentRequest.requestId === requestId &&
               Math.abs(this.currentPaymentRequest.amount - amount) < 0.000001 &&
               this.currentPaymentRequest.memo === memo;
    }

    async completePaymentRequest(requestId, transactionHash, amount) {
        try {
            // Update database
            if (this.db && !this.useLocalStorage) {
                const stmt = this.db.prepare(`
                    UPDATE payment_requests 
                    SET status = 'completed', completed_at = ?, transaction_hash = ?
                    WHERE request_id = ?
                `);
                stmt.run([new Date().toISOString(), transactionHash, requestId]);
                stmt.free();
            } else {
                this.updatePaymentRequestInLocalStorage(requestId, 'completed', transactionHash);
            }

            // Update UI
            const qrStatus = document.getElementById('qrStatus');
            qrStatus.textContent = 'Completed';
            qrStatus.className = 'status-completed';

            // Stop monitoring
            if (this.paymentMonitorInterval) {
                clearInterval(this.paymentMonitorInterval);
                this.paymentMonitorInterval = null;
            }

            // Refresh balance
            await this.refreshBalance();

            // Update payment requests history
            this.loadPaymentRequestsHistory();

            this.showStatus(`Payment received! Amount: ${amount} XRP`, 'success');

        } catch (error) {
            console.error('Error completing payment request:', error);
        }
    }

    updatePaymentRequestInLocalStorage(requestId, status, transactionHash) {
        const requests = JSON.parse(localStorage.getItem('cryptoPayPaymentRequests') || '[]');
        const request = requests.find(r => r.requestId === requestId);
        if (request) {
            request.status = status;
            request.completed_at = new Date().toISOString();
            request.transaction_hash = transactionHash;
            localStorage.setItem('cryptoPayPaymentRequests', JSON.stringify(requests));
        }
    }

    cancelPaymentRequest() {
        if (this.currentPaymentRequest) {
            const requestId = this.currentPaymentRequest.requestId;
            
            // Update status
            if (this.db && !this.useLocalStorage) {
                const stmt = this.db.prepare(`
                    UPDATE payment_requests 
                    SET status = 'cancelled', completed_at = ?
                    WHERE request_id = ?
                `);
                stmt.run([new Date().toISOString(), requestId]);
                stmt.free();
            } else {
                this.updatePaymentRequestInLocalStorage(requestId, 'cancelled', null);
            }

            // Stop monitoring
            if (this.paymentMonitorInterval) {
                clearInterval(this.paymentMonitorInterval);
                this.paymentMonitorInterval = null;
            }

            // Hide QR code
            document.getElementById('qrCodeContainer').style.display = 'none';
            this.currentPaymentRequest = null;

            // Clear form
            document.getElementById('requestAmount').value = '';
            document.getElementById('requestMemo').value = '';

            // Update payment requests history
            this.loadPaymentRequestsHistory();

            this.showStatus('Payment request cancelled', 'info');
        }
    }

    loadPaymentRequestsHistory() {
        let requests = [];
        
        if (this.db && !this.useLocalStorage) {
            try {
                const stmt = this.db.prepare(`
                    SELECT * FROM payment_requests 
                    ORDER BY created_at DESC
                `);
                while (stmt.step()) {
                    requests.push(stmt.getAsObject());
                }
                stmt.free();
            } catch (error) {
                console.error('Database query failed:', error);
                requests = JSON.parse(localStorage.getItem('cryptoPayPaymentRequests') || '[]');
            }
        } else {
            requests = JSON.parse(localStorage.getItem('cryptoPayPaymentRequests') || '[]');
        }

        this.updatePaymentRequestsHistoryUI(requests);
    }

    updatePaymentRequestsHistoryUI(requests) {
        const historyContainer = document.getElementById('paymentRequestsHistory');
        
        if (requests.length === 0) {
            historyContainer.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No payment requests yet</p>';
            return;
        }

        const historyHTML = requests.map(req => `
            <div class="transaction-item">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <div class="transaction-amount">+${req.amount} XRP</div>
                    <div style="font-size: 0.9rem; color: #666;">${new Date(req.created_at).toLocaleString()}</div>
                </div>
                <div style="margin-bottom: 5px;">
                    <strong>Request ID:</strong> ${req.request_id}
                </div>
                ${req.memo ? `<div style="margin-bottom: 5px;"><strong>Memo:</strong> ${req.memo}</div>` : ''}
                <div style="margin-bottom: 5px;">
                    <strong>Status:</strong> <span class="status-${req.status}">${req.status}</span>
                </div>
                ${req.transaction_hash ? `<div class="transaction-hash"><strong>Transaction:</strong> ${req.transaction_hash}</div>` : ''}
            </div>
        `).join('');

        historyContainer.innerHTML = historyHTML;
    }

    // Removed unused debug, backup, and recovery methods to keep only functional features

    async disconnect() {
        if (this.paymentMonitorInterval) {
            clearInterval(this.paymentMonitorInterval);
        }
        
        if (this.client && this.isConnected) {
            await this.client.disconnect();
            this.isConnected = false;
            console.log('Disconnected from XRPL');
        }
    }
}

// Global functions for HTML onclick events
let app = null;

// Initialize app when page loads
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Small delay to ensure DOM is fully ready
        await new Promise(resolve => setTimeout(resolve, 100));
        
        app = new CryptoPayApp();
        await app.loadTransactionHistory();
        await app.loadPaymentRequestsHistory();
        
        // Try to load existing wallet
        const walletLoaded = await app.loadExistingWallet();
        if (!walletLoaded) {
            console.log('No existing wallet found, user needs to create one');
            app.showStatus('Welcome! Please create a wallet to get started.', 'info');
        } else {
            app.showStatus('App loaded successfully!', 'success');
        }
    } catch (error) {
        console.error('App initialization failed:', error);
        app = null;
        // Show error in console since app is null
        console.error('Failed to initialize CryptoPay app. Please refresh the page.');
    }
});

// Global functions
async function createWallet() {
    if (!app) {
        console.error('App not initialized');
        return;
    }
    await app.createWallet();
}

async function refreshBalance() {
    if (!app) {
        console.error('App not initialized');
        return;
    }
    await app.refreshBalance();
}

async function sendPayment() {
    if (!app) {
        console.error('App not initialized');
        return;
    }
    await app.sendPayment();
}

function exportWallet() {
    if (!app) {
        console.error('App not initialized');
        return;
    }
    app.exportWallet();
}

async function generatePaymentRequest() {
    if (!app) {
        console.error('App not initialized');
        return;
    }
    await app.generatePaymentRequest();
}

function cancelPaymentRequest() {
    if (!app) {
        console.error('App not initialized');
        return;
    }
    app.cancelPaymentRequest();
}

// Removed unused debug and test functions to keep only functional features

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (app) {
        app.disconnect();
    }
});
