# NYX Discord License Bot

This bot generates and administers licenses through the NYX Access website API. The website owns accounts, keys, Discord links, device bindings, and application sessions.

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
6. Set these environment variables in the bot-hosting.net dashboard:
   - `BOT_TOKEN`: Your Discord Bot Token (from Discord Developer Portal)
   - `CLIENT_ID`: Your Discord Bot Application Client ID
   - `NYX_AUTH_URL`: The deployed NYX Access website URL
   - `BOT_API_SECRET`: The same private API secret configured for the website
7. Click **Start** to run your 24/7 Discord bot server!

---

## 🔑 Discord Commands

- `/keygen duration:<12h|1d|1w|1m|1y|lifetime> [amount:1-10]`
- `/keyinfo key:<NYX-XXXX-XXXX-XXXX>`
- `/keyrevoke key:<NYX-XXXX-XXXX-XXXX>`
- `/keyreset key:<NYX-...>`
- `/keyextend key:<NYX-...> duration:<...>`
- `/mystatus`
