/**
 * WhitelistErrorHandler - Centralized error handling for whitelist operations
 */
class WhitelistErrorHandler {
    constructor() {
        this.errorCounts = new Map();
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second
    }

    /**
     * Handle storage errors with retry logic
     * @param {Function} operation - The operation to retry
     * @param {string} operationName - Name of the operation for logging
     * @param {number} maxRetries - Maximum number of retries
     * @returns {Promise<any>} - Result of the operation
     */
    async handleWithRetry(operation, operationName, maxRetries = this.maxRetries) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await operation();
                
                // Reset error count on success
                this.errorCounts.delete(operationName);
                
                if (attempt > 1) {
                    console.log(`${operationName} succeeded on attempt ${attempt}`);
                }
                
                return result;
                
            } catch (error) {
                lastError = error;
                
                // Track error count
                const currentCount = this.errorCounts.get(operationName) || 0;
                this.errorCounts.set(operationName, currentCount + 1);
                
                console.error(`${operationName} failed on attempt ${attempt}:`, error.message);
                
                // Don't retry on certain types of errors
                if (this.isNonRetryableError(error)) {
                    console.log(`Non-retryable error for ${operationName}, stopping retries`);
                    break;
                }
                
                // Wait before retry (except on last attempt)
                if (attempt < maxRetries) {
                    await this.delay(this.retryDelay * attempt);
                }
            }
        }
        
        // All retries failed
        console.error(`${operationName} failed after ${maxRetries} attempts`);
        throw this.createEnhancedError(lastError, operationName, maxRetries);
    }

    /**
     * Check if an error should not be retried
     * @param {Error} error - The error to check
     * @returns {boolean} - True if error should not be retried
     */
    isNonRetryableError(error) {
        const nonRetryablePatterns = [
            'Invalid address format',
            'Address is required',
            'Maximum whitelist size',
            'EACCES', // Permission denied
            'ENOTDIR', // Not a directory
            'EISDIR', // Is a directory
            'Invalid JSON'
        ];
        
        return nonRetryablePatterns.some(pattern => 
            error.message.includes(pattern)
        );
    }

    /**
     * Create an enhanced error with additional context
     * @param {Error} originalError - The original error
     * @param {string} operationName - Name of the failed operation
     * @param {number} attempts - Number of attempts made
     * @returns {Error} - Enhanced error
     */
    createEnhancedError(originalError, operationName, attempts) {
        const enhancedError = new Error(
            `${operationName} failed after ${attempts} attempts: ${originalError.message}`
        );
        
        enhancedError.originalError = originalError;
        enhancedError.operationName = operationName;
        enhancedError.attempts = attempts;
        enhancedError.timestamp = new Date().toISOString();
        
        return enhancedError;
    }

    /**
     * Handle storage corruption by attempting recovery
     * @param {string} filePath - Path to the corrupted file
     * @param {Function} recoveryOperation - Function to recover data
     * @returns {Promise<boolean>} - True if recovery was successful
     */
    async handleStorageCorruption(filePath, recoveryOperation) {
        try {
            console.warn(`Attempting to recover from storage corruption: ${filePath}`);
            
            // Create backup of corrupted file
            const backupPath = `${filePath}.corrupted.${Date.now()}`;
            
            try {
                const fs = require('fs').promises;
                await fs.copyFile(filePath, backupPath);
                console.log(`Created backup of corrupted file: ${backupPath}`);
            } catch (backupError) {
                console.error('Failed to create backup of corrupted file:', backupError);
            }
            
            // Attempt recovery
            await recoveryOperation();
            
            console.log('Storage corruption recovery successful');
            return true;
            
        } catch (error) {
            console.error('Storage corruption recovery failed:', error);
            return false;
        }
    }

    /**
     * Validate file system permissions and space
     * @param {string} filePath - Path to check
     * @returns {Promise<object>} - Validation results
     */
    async validateFileSystemAccess(filePath) {
        const fs = require('fs').promises;
        const path = require('path');
        
        const results = {
            canRead: false,
            canWrite: false,
            hasSpace: false,
            directoryExists: false,
            errors: []
        };
        
        try {
            const directory = path.dirname(filePath);
            
            // Check if directory exists
            try {
                await fs.access(directory);
                results.directoryExists = true;
            } catch (error) {
                results.errors.push(`Directory does not exist: ${directory}`);
            }
            
            // Check read permissions
            try {
                await fs.access(filePath, fs.constants.R_OK);
                results.canRead = true;
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    results.errors.push(`Cannot read file: ${error.message}`);
                }
            }
            
            // Check write permissions
            try {
                await fs.access(directory, fs.constants.W_OK);
                results.canWrite = true;
            } catch (error) {
                results.errors.push(`Cannot write to directory: ${error.message}`);
            }
            
            // Check available space (basic check)
            try {
                const stats = await fs.stat(directory);
                results.hasSpace = true; // Assume space is available if we can stat
            } catch (error) {
                results.errors.push(`Cannot check disk space: ${error.message}`);
            }
            
        } catch (error) {
            results.errors.push(`File system validation error: ${error.message}`);
        }
        
        return results;
    }

    /**
     * Handle concurrent access to whitelist file
     * @param {Function} operation - The operation to perform
     * @param {string} lockKey - Unique key for the lock
     * @returns {Promise<any>} - Result of the operation
     */
    async handleConcurrentAccess(operation, lockKey) {
        // Simple in-memory lock mechanism
        if (!this.locks) {
            this.locks = new Map();
        }
        
        // Wait for existing lock to release
        while (this.locks.has(lockKey)) {
            await this.delay(50); // Wait 50ms
        }
        
        // Acquire lock
        this.locks.set(lockKey, Date.now());
        
        try {
            const result = await operation();
            return result;
        } finally {
            // Release lock
            this.locks.delete(lockKey);
        }
    }

    /**
     * Sanitize and validate user input
     * @param {string} input - User input to sanitize
     * @param {string} type - Type of input (address, command, etc.)
     * @returns {object} - Sanitization results
     */
    sanitizeInput(input, type = 'general') {
        const result = {
            sanitized: '',
            isValid: false,
            errors: []
        };
        
        try {
            if (!input || typeof input !== 'string') {
                result.errors.push('Input must be a non-empty string');
                return result;
            }
            
            // Basic sanitization
            let sanitized = input.trim();
            
            // Remove potentially dangerous characters
            sanitized = sanitized.replace(/[<>\"'&]/g, '');
            
            // Type-specific validation
            switch (type) {
                case 'address':
                    // Ethereum address validation
                    if (!/^0x[a-fA-F0-9]{40}$/.test(sanitized)) {
                        result.errors.push('Invalid Ethereum address format');
                        return result;
                    }
                    break;
                    
                case 'command':
                    // Command validation
                    if (!/^\/[a-zA-Z_]+(\s+.*)?$/.test(sanitized)) {
                        result.errors.push('Invalid command format');
                        return result;
                    }
                    break;
                    
                case 'general':
                default:
                    // General input validation
                    if (sanitized.length > 1000) {
                        result.errors.push('Input too long');
                        return result;
                    }
                    break;
            }
            
            result.sanitized = sanitized;
            result.isValid = true;
            
        } catch (error) {
            result.errors.push(`Sanitization error: ${error.message}`);
        }
        
        return result;
    }

    /**
     * Get error statistics
     * @returns {object} - Error statistics
     */
    getErrorStats() {
        const stats = {
            totalOperations: 0,
            totalErrors: 0,
            errorsByOperation: {},
            timestamp: new Date().toISOString()
        };
        
        for (const [operation, count] of this.errorCounts.entries()) {
            stats.errorsByOperation[operation] = count;
            stats.totalErrors += count;
        }
        
        return stats;
    }

    /**
     * Reset error statistics
     */
    resetErrorStats() {
        this.errorCounts.clear();
        console.log('Error statistics reset');
    }

    /**
     * Delay utility for retries
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise} - Promise that resolves after delay
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Create user-friendly error messages
     * @param {Error} error - The error to format
     * @param {string} context - Context of the error
     * @returns {string} - User-friendly error message
     */
    formatUserError(error, context = '') {
        const contextPrefix = context ? `${context}: ` : '';
        
        // Map technical errors to user-friendly messages
        const errorMappings = {
            'ENOENT': 'File not found. The system will create it automatically.',
            'EACCES': 'Permission denied. Please check file permissions.',
            'ENOSPC': 'Not enough disk space available.',
            'EMFILE': 'Too many files open. Please try again later.',
            'ENOTDIR': 'Invalid directory path.',
            'EISDIR': 'Expected a file but found a directory.',
            'Invalid address format': 'Please provide a valid Ethereum address (0x...).',
            'Maximum whitelist size': 'Whitelist is full. Please remove some addresses first.',
            'Address is required': 'Please provide an address.',
            'Invalid JSON': 'Configuration file is corrupted. Using default settings.'
        };
        
        // Check for known error patterns
        for (const [pattern, message] of Object.entries(errorMappings)) {
            if (error.message.includes(pattern)) {
                return `${contextPrefix}${message}`;
            }
        }
        
        // Generic error message
        return `${contextPrefix}An unexpected error occurred. Please try again later.`;
    }
}

module.exports = WhitelistErrorHandler;