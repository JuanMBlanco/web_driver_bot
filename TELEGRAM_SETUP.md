# Telegram Bot Setup Guide

This guide walks you through creating a new Telegram bot and configuring it for the EZCater Web Driver Bot.

## Step 1: Create a New Telegram Bot

### 1.1 Open Telegram and Find BotFather

1. Open Telegram (mobile app or web: https://web.telegram.org)
2. Search for **@BotFather** in the search bar
3. Start a chat with BotFather (click "Start" or send `/start`)

### 1.2 Create Your Bot

Send this command to BotFather:
```
/newbot
```

BotFather will ask you:
1. **Choose a name for your bot** (e.g., "EZCater Web Driver Bot" or "EZCater Notifications Bot")
2. **Choose a username for your bot** (must end in `bot`, e.g., "ezcater_web_driver_bot" or "ezcater_notifications_bot")

After creating the bot, BotFather will give you a **token** that looks like:
```
1234567890:ABCdefGHIjklMNOpqrsTUVwxyz1234567890
```

**⚠️ IMPORTANT:** Copy this token immediately and save it somewhere safe. You'll need it in Step 3.

### 1.3 (Optional) Configure Bot Settings

You can optionally configure your bot:
- `/setdescription` - Set a description (e.g., "Bot for EZCater Web Driver notifications")
- `/setabouttext` - Set about text
- `/setuserpic` - Set a profile picture

## Step 2: Get Your Chat ID(s)

You need to know where to send messages. You can send to:
- **Your personal chat** (messages to yourself)
- **A Telegram group** (messages to a group like "Odin-V2-Frontend-Web-Operations")

### 2.1 Get Your Personal Chat ID

1. Search for **@userinfobot** in Telegram
2. Start a chat with it and send `/start`
3. It will reply with your user ID (a number like `123456789`)
4. Copy this number - this is your personal chat ID

### 2.2 Get a Group Chat ID

For your "Odin-V2-Frontend-Web-Operations" group:

1. **Add your new bot to the group:**
   - Open the group "Odin-V2-Frontend-Web-Operations"
   - Click on group info (top right)
   - Click "Add Members"
   - Search for your bot's username (the one you created, e.g., "ezcater_notifications_bot")
   - Add it to the group

2. **Get the group chat ID:**
   - Add **@RawDataBot** to your group temporarily
   - Send `/start` in the group
   - @RawDataBot will reply with JSON data
   - Look for `"chat":{"id":-1001234567890}` - the number after `"id":` is your group chat ID (usually negative, like `-1001234567890`)
   - Copy this number
   - Remove @RawDataBot from the group (optional, but recommended)

**Alternative:** If you can't add @RawDataBot, try **@getidsbot** instead - it works the same way.

**Note:** Group chat IDs are usually negative numbers starting with `-100`.

## Step 3: Create the `.env.secrets` File

1. Navigate to your project directory:
   ```bash
   cd d:\Work\web_driver_bot
   ```

2. Create the secrets file in the `config` folder:
   ```bash
   # Windows PowerShell
   New-Item -Path "config\.env.secrets" -ItemType File -Force
   
   # Or create it manually in your editor
   ```

3. Open `config\.env.secrets` and add your credentials in this exact format:

   ```
   TELEGRAM_API_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz1234567890
   TELEGRAM_CHAT_IDS=-1001234567890
   ```

   **Format rules:**
   - No spaces around the `=` sign
   - No quotes around the values
   - For multiple chat IDs, separate them with commas (no spaces)
   - Replace the example values with your actual token and chat ID(s)

   **Example with only group chat (recommended for your use case):**
   ```
   TELEGRAM_API_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz1234567890
   TELEGRAM_CHAT_IDS=-1001234567890
   ```

   **Example with personal chat + group:**
   ```
   TELEGRAM_API_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz1234567890
   TELEGRAM_CHAT_IDS=123456789,-1001234567890
   ```

4. **⚠️ SECURITY:** Make sure `.env.secrets` is in your `.gitignore` file (it should already be there). Never commit this file to git!

## Step 4: Verify the Configuration

### 4.1 Check that the file exists and has correct format

```bash
# Windows PowerShell
Get-Content config\.env.secrets
```

You should see your token and chat IDs without any extra characters.

### 4.2 Build and Start the Bot

```bash
# Build the project
yarn build

# Start the bot
yarn start
```

### 4.3 Check the Logs

When the bot starts, you should see in the logs:
```
[INFO] Initializing Telegram bot...
[INFO] Loaded 1 Telegram chat IDs successfully
[INFO] Telegram bot initialized successfully
```

If you see errors, check:
- Is the `.env.secrets` file in `config/` folder?
- Are there any typos in the token or chat IDs?
- Are there any extra spaces or quotes?

### 4.4 Test the Telegram Connection

You should receive a message in Telegram saying:
```
EZCater Web Driver Bot initiated
```

This message will appear in:
- Your personal chat (if you included your personal chat ID)
- Your group "Odin-V2-Frontend-Web-Operations" (if you included the group chat ID)

If you don't receive this message:
- Check that your bot token is correct
- Check that your chat ID is correct
- Make sure your bot is added to the group (if using a group chat ID)
- Check the server logs for error messages

## Step 5: Test the API Endpoint

Once the bot is running, test the new `/api/notifications/telegram-test` endpoint:

```bash
# Replace YOUR_TOKEN_HERE with a token from your config/ezcater_web_driver_bot.yaml
curl -X POST http://localhost:3000/api/notifications/telegram-test `
  -H "Content-Type: application/json" `
  -H "Authorization: Token f47ac10b-58cc-4372-a567-0e02b2c3d479" `
  -d '{\"message\": \"Test from PowerShell\"}'
```

Or using PowerShell's `Invoke-RestMethod`:

```powershell
$headers = @{
    "Content-Type" = "application/json"
    "Authorization" = "Token f47ac10b-58cc-4372-a567-0e02b2c3d479"
}

$body = @{
    message = "Test from PowerShell"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/notifications/telegram-test" `
    -Method Post `
    -Headers $headers `
    -Body $body
```

You should:
1. Get a JSON response indicating success
2. Receive the test message in your Telegram chat(s)

## Troubleshooting

### Bot token not found
- Make sure the file is named exactly `.env.secrets` (with the dot at the beginning)
- Make sure it's in the `config/` folder
- Check for typos in `TELEGRAM_API_TOKEN`

### Chat IDs not found
- Make sure `TELEGRAM_CHAT_IDS` is on a separate line
- Check for typos
- Make sure there are no spaces around the `=` sign

### Bot initialized but no messages received
- Verify your chat ID is correct (try the personal chat ID first to test)
- If using a group, make sure your bot is added to the group
- Check that the bot hasn't been blocked
- Make sure the bot has permission to send messages in the group

### Error: "Unauthorized" or "Invalid token"
- Your bot token might be incorrect - double-check it from BotFather
- Make sure there are no extra spaces or newlines in the token
- Try creating a new bot if the token doesn't work

### Bot can't send messages to group
- Make sure the bot is added as a member of the group
- Check that the bot hasn't been restricted by group admins
- Try sending a test message to your personal chat first to verify the bot works

## Quick Reference

**File location:** `config/.env.secrets`

**File format:**
```
TELEGRAM_API_TOKEN=your_token_here
TELEGRAM_CHAT_IDS=chat_id1,chat_id2
```

**Commands:**
```bash
yarn build          # Build the project
yarn start          # Start the bot
yarn dev            # Start in development mode
```

**Test endpoint:**
```
POST http://localhost:3000/api/notifications/telegram-test
Headers: Authorization: Token YOUR_TOKEN
Body: { "message": "Optional custom message" }
```

---

## Alternative: Use an Existing Bot

If you already have a bot and want to use it instead:

1. Open Telegram → search `@BotFather` → send `/mybots`
2. Select your bot from the list
3. Click "API Token" → copy the token
4. Follow Step 2 to get your chat ID
5. Follow Step 3 to create the `.env.secrets` file
