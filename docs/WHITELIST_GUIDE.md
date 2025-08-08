# Whitelist System Guide

## Overview

The Monad Trading Bot includes a comprehensive address whitelisting system that controls access to bot functionality based on user wallet addresses. Only users with whitelisted Ethereum addresses can use the bot's trading and wallet features.

## Table of Contents

- [How It Works](#how-it-works)
- [User Guide](#user-guide)
- [Admin Guide](#admin-guide)
- [Commands Reference](#commands-reference)
- [Troubleshooting](#troubleshooting)
- [Technical Details](#technical-details)

## How It Works

### Access Control Flow

1. **User Interaction**: When a user sends a command to the bot
2. **Wallet Check**: The system checks if the user has a configured wallet
3. **Address Verification**: The user's wallet address is checked against the whitelist
4. **Access Decision**: Access is granted or denied based on whitelist status
5. **Logging**: All access attempts are logged for monitoring and security

### Default Whitelisted Addresses

The system comes pre-configured with these default addresses:
- `0xe2F92e8f706997B021919a092437372B268a432d`
- `0x5230b89d6728a10b34b8EC1C740a7A7a1C4afe94`

### Bypass Commands

These commands are available to all users regardless of whitelist status:
- `/start` - Bot introduction and main menu
- `/help` - Help information and command list

## User Guide

### Getting Access

If you're not whitelisted, you'll see this message when trying to use the bot:
```
🚫 Access Denied

Your wallet address is not authorized to use this bot.

Address: 0x1234...5678

Please contact the bot administrator if you believe this is an error.
```

### Steps to Get Whitelisted

1. **Create or Import Wallet**: Use `/start` to set up your wallet
2. **Note Your Address**: Your wallet address will be displayed
3. **Contact Administrator**: Provide your wallet address to the bot admin
4. **Wait for Approval**: Admin will add your address to the whitelist
5. **Try Again**: Once added, you'll have full access to bot features

### What You Can Do Once Whitelisted

- ✅ View token balances (`/balances`)
- ✅ Swap tokens (`/swap`)
- ✅ Send tokens (`/send`)
- ✅ Manage wallet (`/wallet`)
- ✅ Access all trading features

## Admin Guide

### Admin Setup

Administrators are configured via environment variable:
```bash
ADMIN_USER_IDS=123456789,987654321
```

### Admin Responsibilities

- **Manage Whitelist**: Add and remove authorized addresses
- **Monitor Access**: Review access logs and statistics
- **Handle Requests**: Process whitelist requests from users
- **System Health**: Monitor system performance and health

### Best Practices

1. **Verify Addresses**: Always double-check addresses before adding
2. **Document Changes**: Keep records of who was added/removed and why
3. **Regular Reviews**: Periodically review the whitelist for inactive addresses
4. **Monitor Logs**: Check access logs for suspicious activity
5. **Backup Data**: Ensure whitelist data is backed up regularly

## Commands Reference

### User Commands

| Command | Description | Access Level |
|---------|-------------|--------------|
| `/start` | Show main menu and bot introduction | Everyone |
| `/help` | Display help information | Everyone |
| `/balances` | View token balances | Whitelisted only |
| `/swap` | Swap tokens | Whitelisted only |
| `/send` | Send tokens | Whitelisted only |
| `/wallet` | Manage wallet | Whitelisted only |

### Admin Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/whitelist_add <address>` | Add address to whitelist | `/whitelist_add 0x1234...5678` |
| `/whitelist_remove <address>` | Remove address from whitelist | `/whitelist_remove 0x1234...5678` |
| `/whitelist_list` | View all whitelisted addresses | `/whitelist_list` |
| `/whitelist_stats` | View whitelist statistics | `/whitelist_stats` |
| `/whitelist_monitor` | View monitoring dashboard | `/whitelist_monitor` |
| `/whitelist_reset_stats` | Reset monitoring statistics | `/whitelist_reset_stats` |

### Command Examples

#### Adding an Address
```
Admin: /whitelist_add 0x1234567890123456789012345678901234567890

Bot: ✅ Address 0x1234567890123456789012345678901234567890 has been added to the whitelist.

Total whitelisted addresses: 3
```

#### Viewing Whitelist
```
Admin: /whitelist_list

Bot: 📋 Whitelisted Addresses
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

#### Monitoring Dashboard
```
Admin: /whitelist_monitor

Bot: 📊 Whitelist Monitoring Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 System Status
• Health: ✅ Healthy
• Uptime: Running

🚪 Access Statistics
• Total attempts: 150
• Authorized: 120
• Denied: 30
• Success rate: 80.0%

⚡ Performance
• Avg response time: 45.50ms
• Slowest check: 200ms
• Recent avg: 38.20ms

✏️ Modifications
• Total: 5
• Additions: 3
• Removals: 2

📋 Whitelist Status
• Size: 3/1000
• Utilization: 0%

📅 Generated: 1/15/2024, 2:30:45 PM
```

## Troubleshooting

### Common Issues

#### "Access Denied" Message
**Problem**: User sees access denied when trying to use bot
**Solution**: 
1. Check if user has a wallet configured
2. Verify the wallet address is whitelisted
3. Add address to whitelist if authorized

#### "Whitelist manager not initialized"
**Problem**: Admin commands show initialization error
**Solution**:
1. Restart the bot
2. Check file system permissions
3. Verify data directory exists

#### "Invalid address format"
**Problem**: Error when adding address to whitelist
**Solution**:
1. Ensure address starts with `0x`
2. Verify address is exactly 42 characters
3. Check for typos in the address

#### Slow Performance
**Problem**: Bot responds slowly to commands
**Solution**:
1. Check monitoring dashboard for performance metrics
2. Review error logs for issues
3. Consider clearing cache or restarting bot

### Error Messages and Solutions

| Error Message | Cause | Solution |
|---------------|-------|----------|
| "Access denied. Admin privileges required" | Non-admin trying admin command | Use admin account |
| "Invalid address format" | Malformed Ethereum address | Provide valid 0x... address |
| "Address already whitelisted" | Trying to add existing address | Address is already added |
| "Address not in whitelist" | Trying to remove non-existent address | Check address spelling |
| "Maximum whitelist size reached" | Whitelist is full | Remove unused addresses first |

### Getting Help

If you encounter issues not covered here:

1. **Check Logs**: Review bot logs for error details
2. **Monitor Dashboard**: Use `/whitelist_monitor` to check system health
3. **Contact Support**: Reach out to the bot administrator
4. **Documentation**: Review this guide and README.md

## Technical Details

### System Architecture

```
User Request → Middleware → Whitelist Check → Access Decision
                    ↓
              Monitoring & Logging
```

### Data Storage

- **Location**: `./data/whitelist.json`
- **Format**: JSON with addresses array and metadata
- **Backup**: Automatic backups created before modifications
- **Permissions**: Restricted file access (600)

### Monitoring

- **Access Logs**: `./logs/whitelist-access.log`
- **Modification Logs**: `./logs/whitelist-modifications.log`
- **Error Logs**: `./logs/whitelist-errors.log`
- **Debug Logs**: `./logs/whitelist-debug.log`

### Performance

- **Caching**: User access status cached for 5 minutes
- **Rate Limiting**: Failed attempts tracked and limited
- **Health Checks**: Automatic system health monitoring every 5 minutes
- **Log Rotation**: Automatic log rotation when files exceed 10MB

### Security Features

- **Address Validation**: Strict Ethereum address format checking
- **Admin Authentication**: Environment-based admin user verification
- **Input Sanitization**: All user inputs sanitized and validated
- **Audit Trail**: Complete logging of all access attempts and modifications
- **Error Handling**: Graceful error handling with user-friendly messages

### Configuration

Environment variables:
```bash
# Admin user IDs (comma-separated)
ADMIN_USER_IDS=123456789,987654321

# Optional: Custom data directory
WHITELIST_DATA_DIR=./data

# Optional: Custom log directory  
WHITELIST_LOG_DIR=./logs
```

### Maintenance

Regular maintenance tasks:
- Review whitelist for inactive addresses
- Monitor system health and performance
- Check log files for errors or suspicious activity
- Backup whitelist data
- Update admin user list as needed

---

For more information, see the main [README.md](../README.md) or contact the bot administrator.