# Administrator Guide - Whitelist System

This guide provides comprehensive information for bot administrators managing the address whitelisting system.

## Table of Contents

- [Admin Setup](#admin-setup)
- [Daily Operations](#daily-operations)
- [Command Reference](#command-reference)
- [Monitoring and Maintenance](#monitoring-and-maintenance)
- [Security Best Practices](#security-best-practices)
- [Troubleshooting](#troubleshooting)
- [Emergency Procedures](#emergency-procedures)

## Admin Setup

### Initial Configuration

1. **Set Admin User IDs**
   ```bash
   # Add your Telegram user ID to .env file
   ADMIN_USER_IDS=123456789,987654321
   ```

2. **Find Your Telegram User ID**
   - Use @userinfobot on Telegram
   - Send any message to get your user ID
   - Add the numeric ID to the environment variable

3. **Initialize Whitelist System**
   ```bash
   npm run init-whitelist
   ```

4. **Verify Admin Access**
   - Start the bot: `npm start`
   - Send `/whitelist_list` to verify admin access
   - You should see the default whitelisted addresses

### Environment Variables

Required admin configuration:
```bash
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token

# Admin Configuration
ADMIN_USER_IDS=123456789,987654321  # Comma-separated user IDs

# System Configuration
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
WALLET_PRIVATE_KEY=your_system_wallet_private_key
ENCRYPTION_KEY=your_secure_encryption_key
```

## Daily Operations

### Common Admin Tasks

#### 1. Adding New Users
```
User Request: "Please whitelist my address: 0x1234...5678"

Admin Actions:
1. Verify the user's identity
2. Check the address format
3. Use: /whitelist_add 0x1234567890123456789012345678901234567890
4. Confirm success message
5. Inform the user they can now access the bot
```

#### 2. Removing Users
```
Admin Actions:
1. Identify the address to remove
2. Use: /whitelist_remove 0x1234567890123456789012345678901234567890
3. Confirm removal
4. Document the reason for removal
```

#### 3. Daily Health Check
```
Morning Routine:
1. /whitelist_monitor - Check system health
2. Review any warnings or issues
3. Check access statistics for unusual patterns
4. Verify system performance metrics
```

### User Request Workflow

1. **Receive Request**
   - User contacts admin requesting whitelist access
   - User provides their wallet address

2. **Verification**
   - Verify user identity (if required)
   - Check address format (42 characters, starts with 0x)
   - Ensure address is valid Ethereum address

3. **Add to Whitelist**
   ```
   /whitelist_add 0x1234567890123456789012345678901234567890
   ```

4. **Confirm and Notify**
   - Verify success message from bot
   - Inform user they can now access the bot
   - Provide basic usage instructions

5. **Document**
   - Keep record of who was added and when
   - Note any special circumstances

## Command Reference

### Essential Admin Commands

#### `/whitelist_add <address>`
**Purpose**: Add an address to the whitelist
**Usage**: `/whitelist_add 0x1234567890123456789012345678901234567890`
**Response**: 
```
✅ Address 0x1234567890123456789012345678901234567890 has been added to the whitelist.

Total whitelisted addresses: 3
```

#### `/whitelist_remove <address>`
**Purpose**: Remove an address from the whitelist
**Usage**: `/whitelist_remove 0x1234567890123456789012345678901234567890`
**Response**:
```
✅ Address 0x1234567890123456789012345678901234567890 has been removed from the whitelist.

Total whitelisted addresses: 2
```

#### `/whitelist_list`
**Purpose**: View all whitelisted addresses
**Usage**: `/whitelist_list`
**Response**:
```
📋 Whitelisted Addresses
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total: 3 addresses

1. 0xe2f92e8f706997b021919a092437372b268a432d
2. 0x5230b89d6728a10b34b8ec1c740a7a7a1c4afe94
3. 0x1234567890123456789012345678901234567890

💡 Admin Commands:
• /whitelist_add <address> - Add address
• /whitelist_remove <address> - Remove address
• /whitelist_list - View all addresses
```

### Monitoring Commands

#### `/whitelist_monitor`
**Purpose**: View comprehensive system monitoring dashboard
**Usage**: `/whitelist_monitor`
**Key Metrics**:
- System health status
- Access attempt statistics
- Performance metrics
- Error rates
- Whitelist utilization

#### `/whitelist_stats`
**Purpose**: View basic whitelist statistics
**Usage**: `/whitelist_stats`
**Information**:
- Total addresses
- Last updated timestamp
- Creation date
- Recent addresses

#### `/whitelist_reset_stats`
**Purpose**: Reset monitoring statistics
**Usage**: `/whitelist_reset_stats`
**When to Use**:
- After resolving system issues
- Monthly statistics reset
- After major system changes

## Monitoring and Maintenance

### Daily Monitoring

#### Health Check Routine
1. **System Status**
   ```
   /whitelist_monitor
   
   Look for:
   • Health: ✅ Healthy (should be green)
   • No critical warnings
   • Reasonable response times (<100ms average)
   • Low error rate (<5%)
   ```

2. **Access Patterns**
   ```
   Review access statistics:
   • Total attempts vs authorized
   • Unusual denial patterns
   • New user activity
   • Suspicious access attempts
   ```

3. **Performance Metrics**
   ```
   Check performance indicators:
   • Average response time
   • Slowest access check
   • Recent performance trends
   ```

#### Weekly Tasks

1. **Whitelist Review**
   - Review current whitelist with `/whitelist_list`
   - Check for inactive addresses
   - Verify all addresses are still needed

2. **Log Review**
   - Check error logs for patterns
   - Review access logs for security issues
   - Monitor modification logs for audit trail

3. **System Health**
   - Check disk space usage
   - Review log file sizes
   - Verify backup systems

#### Monthly Tasks

1. **Statistics Reset**
   - Use `/whitelist_reset_stats` to clear old data
   - Document monthly statistics before reset

2. **Whitelist Cleanup**
   - Remove inactive addresses
   - Update documentation
   - Review admin access list

3. **Security Review**
   - Review access patterns
   - Check for security incidents
   - Update admin procedures if needed

### Performance Monitoring

#### Key Performance Indicators

1. **Response Time**
   - Target: <100ms average
   - Warning: >500ms average
   - Critical: >1000ms average

2. **Success Rate**
   - Target: >95% success rate
   - Warning: <90% success rate
   - Critical: <80% success rate

3. **Error Rate**
   - Target: <2% error rate
   - Warning: >5% error rate
   - Critical: >10% error rate

#### Performance Issues

**Slow Response Times**
```
Symptoms: Average response time >500ms
Causes: High load, storage issues, memory problems
Actions:
1. Check system resources
2. Review recent changes
3. Consider optimization
4. Monitor for improvement
```

**High Error Rate**
```
Symptoms: Error rate >5%
Causes: Storage problems, network issues, bugs
Actions:
1. Check error logs
2. Identify error patterns
3. Fix underlying issues
4. Monitor recovery
```

## Security Best Practices

### Access Control

1. **Admin Account Security**
   - Use strong, unique passwords
   - Enable 2FA on Telegram account
   - Regularly review admin access list
   - Remove inactive admins

2. **Address Verification**
   - Always verify address format before adding
   - Double-check addresses for typos
   - Confirm user identity when possible
   - Document all changes

3. **Monitoring**
   - Regularly review access logs
   - Monitor for suspicious patterns
   - Set up alerts for unusual activity
   - Keep audit trail of all changes

### Data Protection

1. **Backup Strategy**
   - Automatic backups before modifications
   - Regular manual backups
   - Test backup restoration
   - Store backups securely

2. **File Permissions**
   - Restrict access to whitelist files
   - Use appropriate file permissions (600)
   - Secure log file access
   - Protect environment variables

3. **Network Security**
   - Use secure connections
   - Monitor network access
   - Implement rate limiting
   - Protect against DDoS

### Incident Response

1. **Security Incident**
   - Immediately assess impact
   - Document the incident
   - Take corrective action
   - Review and improve procedures

2. **Unauthorized Access**
   - Remove compromised addresses
   - Review access logs
   - Identify attack vector
   - Strengthen security measures

3. **System Compromise**
   - Shut down affected systems
   - Assess damage
   - Restore from backups
   - Implement additional security

## Troubleshooting

### Common Issues

#### "Access denied. Admin privileges required"
**Cause**: Your user ID is not in ADMIN_USER_IDS
**Solution**:
1. Check your Telegram user ID with @userinfobot
2. Add your ID to ADMIN_USER_IDS environment variable
3. Restart the bot
4. Test admin access

#### "Whitelist manager not initialized"
**Cause**: System initialization failure
**Solution**:
1. Check bot startup logs
2. Verify file permissions
3. Run `npm run init-whitelist`
4. Restart the bot

#### "Invalid address format"
**Cause**: Malformed Ethereum address
**Solution**:
1. Verify address starts with 0x
2. Check address is exactly 42 characters
3. Ensure only hexadecimal characters (0-9, a-f)
4. Copy-paste instead of typing

### System Issues

#### High Memory Usage
**Symptoms**: Bot becomes slow or unresponsive
**Diagnosis**: Check system resources
**Solutions**:
1. Restart the bot
2. Clear old log files
3. Reset statistics
4. Monitor for improvement

#### Storage Problems
**Symptoms**: Cannot save whitelist changes
**Diagnosis**: Check disk space and permissions
**Solutions**:
1. Free up disk space
2. Fix file permissions
3. Check directory access
4. Restore from backup if needed

#### Network Issues
**Symptoms**: Bot doesn't respond to commands
**Diagnosis**: Check network connectivity
**Solutions**:
1. Verify internet connection
2. Check Telegram API access
3. Review firewall settings
4. Restart network services

## Emergency Procedures

### System Down

1. **Immediate Actions**
   - Check bot process status
   - Review error logs
   - Verify system resources
   - Attempt restart

2. **If Restart Fails**
   - Check configuration files
   - Verify environment variables
   - Test database connectivity
   - Restore from backup

3. **Communication**
   - Notify users of downtime
   - Provide estimated recovery time
   - Update status regularly
   - Document incident

### Data Corruption

1. **Assessment**
   - Identify corrupted data
   - Check backup availability
   - Assess impact scope
   - Document findings

2. **Recovery**
   - Stop the bot
   - Backup corrupted data
   - Restore from latest backup
   - Verify data integrity
   - Restart system

3. **Prevention**
   - Improve backup procedures
   - Add data validation
   - Monitor for corruption
   - Update recovery procedures

### Security Breach

1. **Immediate Response**
   - Isolate affected systems
   - Change admin credentials
   - Review access logs
   - Document incident

2. **Investigation**
   - Identify attack vector
   - Assess damage
   - Collect evidence
   - Determine scope

3. **Recovery**
   - Remove unauthorized access
   - Restore clean data
   - Implement security fixes
   - Monitor for reoccurrence

4. **Post-Incident**
   - Review security procedures
   - Update access controls
   - Train administrators
   - Improve monitoring

### Contact Information

**System Administrator**: [Your contact info]
**Emergency Contact**: [Emergency contact]
**Documentation**: [Link to documentation]
**Support**: [Support channel/email]

---

This guide should be reviewed and updated regularly to reflect system changes and lessons learned from operational experience.