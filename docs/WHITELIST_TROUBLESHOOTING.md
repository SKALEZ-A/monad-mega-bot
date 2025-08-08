# Whitelist System Troubleshooting Guide

This guide helps resolve common issues with the address whitelisting system.

## Quick Diagnosis

### Check Your Status
1. Try using a bot command like `/balances`
2. If you see "Access Denied", you're not whitelisted
3. If you see "create or import a wallet", you need to set up a wallet first
4. If the command works, you're whitelisted and everything is fine

### For Administrators
Use `/whitelist_monitor` to check system health and statistics.

## Common User Issues

### Issue: "Access Denied" Message

**Symptoms:**
```
🚫 Access Denied

Your wallet address is not authorized to use this bot.

Address: 0x1234567890123456789012345678901234567890

Please contact the bot administrator if you believe this is an error.
```

**Causes & Solutions:**

1. **Address Not Whitelisted**
   - **Cause**: Your wallet address is not in the whitelist
   - **Solution**: Contact the bot administrator with your wallet address
   - **How to get your address**: Use `/wallet` command to see your address

2. **Wrong Wallet**
   - **Cause**: You're using a different wallet than the whitelisted one
   - **Solution**: Import the correct wallet or ask admin to whitelist your current address

3. **Case Sensitivity Issues**
   - **Cause**: Address was added with different case
   - **Solution**: This shouldn't happen (system normalizes case), but contact admin

### Issue: "Create or Import Wallet" Message

**Symptoms:**
```
⚠️ Please create or import a wallet first to verify your access.

Use /start to begin wallet setup.
```

**Solution:**
1. Use `/start` command
2. Choose "🔑 Generate Wallet" or "📥 Import Wallet"
3. Follow the setup process
4. Once wallet is set up, try your command again

### Issue: Bot Not Responding

**Symptoms:**
- Bot doesn't respond to commands
- Commands seem to hang

**Possible Causes & Solutions:**

1. **Bot Initialization**
   - **Cause**: Bot is still starting up
   - **Solution**: Wait 30 seconds and try again

2. **System Error**
   - **Cause**: Whitelist system error
   - **Solution**: Contact administrator

## Common Admin Issues

### Issue: "Whitelist manager not initialized"

**Symptoms:**
```
❌ Whitelist manager not initialized.
```

**Causes & Solutions:**

1. **Bot Still Starting**
   - **Cause**: Bot is still initializing
   - **Solution**: Wait for bot to fully start (check logs)

2. **File System Issues**
   - **Cause**: Cannot access data directory
   - **Solution**: Check file permissions and disk space

3. **Corrupted Data**
   - **Cause**: Whitelist file is corrupted
   - **Solution**: Bot should auto-recover, but may need manual intervention

### Issue: "Invalid address format"

**Symptoms:**
```
❌ Invalid address format. Please provide a valid Ethereum address.
```

**Causes & Solutions:**

1. **Wrong Format**
   - **Cause**: Address doesn't start with 0x or wrong length
   - **Solution**: Ensure address is exactly 42 characters starting with 0x
   - **Example**: `0x1234567890123456789012345678901234567890`

2. **Typos**
   - **Cause**: Typing errors in address
   - **Solution**: Copy-paste the address instead of typing

3. **Invalid Characters**
   - **Cause**: Non-hexadecimal characters in address
   - **Solution**: Only use 0-9 and a-f characters after 0x

### Issue: "Access denied. Admin privileges required"

**Symptoms:**
```
🚫 Access denied. Admin privileges required.
```

**Causes & Solutions:**

1. **Not Configured as Admin**
   - **Cause**: Your user ID is not in ADMIN_USER_IDS
   - **Solution**: Add your Telegram user ID to environment variable
   - **How to find your ID**: Use a bot like @userinfobot

2. **Environment Variable Not Set**
   - **Cause**: ADMIN_USER_IDS not configured
   - **Solution**: Set environment variable and restart bot

3. **Wrong User ID**
   - **Cause**: Incorrect user ID in configuration
   - **Solution**: Verify your Telegram user ID is correct

## System Health Issues

### Issue: Slow Performance

**Symptoms:**
- Commands take a long time to respond
- Bot seems sluggish

**Diagnosis:**
Use `/whitelist_monitor` to check performance metrics:
```
⚡ Performance
• Avg response time: 2500.50ms  ← This is slow (should be <100ms)
• Slowest check: 5000ms
• Recent avg: 3000.20ms
```

**Solutions:**

1. **High Load**
   - **Cause**: Too many concurrent users
   - **Solution**: Monitor usage patterns, consider optimization

2. **Storage Issues**
   - **Cause**: Slow disk I/O
   - **Solution**: Check disk performance, consider SSD

3. **Memory Issues**
   - **Cause**: Low available memory
   - **Solution**: Restart bot, check system resources

### Issue: High Error Rate

**Symptoms:**
Monitoring shows high error rate:
```
⚠️ Warnings
• High error rate: 15.50%
```

**Solutions:**

1. **Check Error Logs**
   - Location: `./logs/whitelist-errors.log`
   - Look for patterns in errors

2. **Common Error Patterns**
   - Storage errors: Check disk space and permissions
   - Network errors: Check connectivity
   - Validation errors: Check for malformed data

3. **Reset Statistics**
   - Use `/whitelist_reset_stats` to clear old error data
   - Monitor if errors continue

## File System Issues

### Issue: "Log directory not writable"

**Symptoms:**
```
⚠️ Warnings
• Log directory not writable: Permission denied
```

**Solutions:**

1. **Fix Permissions**
   ```bash
   chmod 755 ./logs
   chown user:group ./logs
   ```

2. **Create Directory**
   ```bash
   mkdir -p ./logs
   ```

3. **Check Disk Space**
   ```bash
   df -h
   ```

### Issue: "Cannot read whitelist file"

**Symptoms:**
- Bot fails to start
- Whitelist commands don't work

**Solutions:**

1. **Reinitialize Whitelist**
   ```bash
   npm run init-whitelist
   ```

2. **Check File Permissions**
   ```bash
   ls -la data/whitelist.json
   chmod 600 data/whitelist.json
   ```

3. **Restore from Backup**
   - Look for `.backup` files in data directory
   - Copy most recent backup to `whitelist.json`

## Network and Connectivity Issues

### Issue: "Access verification failed"

**Symptoms:**
```
⚠️ Access verification failed. Please try again later.
```

**Causes & Solutions:**

1. **Temporary System Error**
   - **Solution**: Wait a few minutes and try again

2. **Database Connection Issues**
   - **Solution**: Restart the bot

3. **File System Issues**
   - **Solution**: Check disk space and permissions

## Recovery Procedures

### Complete System Reset

If the whitelist system is completely broken:

1. **Stop the Bot**
   ```bash
   # Stop the running bot process
   ```

2. **Backup Current Data**
   ```bash
   cp -r data data.backup.$(date +%Y%m%d_%H%M%S)
   cp -r logs logs.backup.$(date +%Y%m%d_%H%M%S)
   ```

3. **Reinitialize System**
   ```bash
   npm run init-whitelist
   ```

4. **Restore Important Addresses**
   - Use admin commands to re-add important addresses
   - Or manually edit `data/whitelist.json` (be careful with format)

5. **Restart Bot**
   ```bash
   npm start
   ```

### Emergency Admin Access

If you're locked out of admin commands:

1. **Direct File Edit** (Use with caution)
   ```bash
   # Edit whitelist file directly
   nano data/whitelist.json
   
   # Add your address to the addresses array
   # Ensure proper JSON format
   ```

2. **Environment Variable Fix**
   ```bash
   # Check current admin IDs
   echo $ADMIN_USER_IDS
   
   # Set correct admin ID
   export ADMIN_USER_IDS=your_telegram_user_id
   
   # Restart bot
   npm start
   ```

## Getting Additional Help

### Log Files to Check

1. **Access Logs**: `./logs/whitelist-access.log`
   - Shows all access attempts
   - Useful for debugging user access issues

2. **Modification Logs**: `./logs/whitelist-modifications.log`
   - Shows all whitelist changes
   - Useful for audit trail

3. **Error Logs**: `./logs/whitelist-errors.log`
   - Shows system errors
   - Most important for troubleshooting

4. **Debug Logs**: `./logs/whitelist-debug.log`
   - Detailed system information
   - Useful for complex issues

### Information to Provide When Seeking Help

1. **Error Message**: Exact text of any error messages
2. **User ID**: Your Telegram user ID
3. **Wallet Address**: The address you're trying to whitelist
4. **Timestamp**: When the issue occurred
5. **Steps to Reproduce**: What you were doing when the error happened
6. **Log Excerpts**: Relevant portions of log files (remove sensitive info)

### Monitoring Commands for Diagnosis

```bash
# Check system health
/whitelist_monitor

# View current whitelist
/whitelist_list

# Check statistics
/whitelist_stats

# Reset stats to clear old data
/whitelist_reset_stats
```

### Prevention Tips

1. **Regular Monitoring**: Check `/whitelist_monitor` regularly
2. **Backup Data**: Regularly backup the `data` directory
3. **Monitor Logs**: Check log files for errors
4. **Update Documentation**: Keep admin contact info current
5. **Test Changes**: Test whitelist changes with non-critical addresses first

---

If you continue to experience issues after following this guide, please contact the system administrator with the specific error messages and steps you've tried.