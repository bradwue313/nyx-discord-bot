# NYX Discord Bot & Key Authentication Server

This repository contains the Discord Bot (`bot.js`) and REST Key Verification API for **NYX External**.

---

## 🚀 How to Deploy on bot-hosting.net

1. Log into your dashboard on [bot-hosting.net](https://bot-hosting.net).
2. Create a new Node.js server instance.
3. Access your server's **Files** or **SFTP** tab.
4. Upload all files from this folder:
   - `package.json`
   - `bot.js`
5. Open the **Console** tab on bot-hosting.net and run:
   ```bash
   npm install
   ```
6. Set your environment variables in the bot-hosting.net dashboard (or edit `bot.js` directly):
   - `BOT_TOKEN`: Your Discord Bot Token (from Discord Developer Portal)
   - `CLIENT_ID`: Your Discord Bot Application Client ID
7. Click **Start** to run your 24/7 Discord bot server!

---

## 🔑 Discord Commands

- `/keygen duration:<12h|1d|1w|1m|1y|lifetime> [amount:1-10]`
- `/keyinfo key:<NYX-XXXX-XXXX-XXXX>`
- `/keyrevoke key:<NYX-XXXX-XXXX-XXXX>`
