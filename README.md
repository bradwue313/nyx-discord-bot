# NYX Discord Bot

Discord administration and account-status bot for NYX Access.

## Hosting

Run `bot.js` with Node.js 22 or newer. On Bot-Hosting.net, configure the startup file as `bot.js` and add the variables from `.env.example` in the host environment panel. Never place real secrets in source files.

Required variables:

- `BOT_TOKEN` — Discord bot token.
- `CLIENT_ID` — Discord application ID.
- `NYX_AUTH_URL` — deployed NYX Access URL, without a trailing slash.
- `BOT_API_SECRET` — exact same shared secret configured on the website.
- `AUDIT_LOG_CHANNEL_ID` — optional private Discord channel for moderator action logs.

Optional variables:

- `ALLOWED_GUILD_IDS` — comma-separated Discord guild IDs the bot is allowed to operate in. Commands are refused everywhere else (fail-closed). Add more at runtime with `/owner allow`.
- `BOT_OWNER_IDS` — comma-separated Discord user IDs that own the bot and can use `/owner`.
- `GIVEAWAY_MAX_KEYS` — maximum keys per giveaway (1–25, default 10).
- `GIVEAWAY_COOLDOWN_MINUTES` — per-guild cooldown between giveaways in minutes (default 0).
- `GIVEAWAY_CHANNEL_ID` — channel ID for scheduled auto-giveaways.
- `GIVEAWAY_AUTO_INTERVAL_HOURS` — hours between auto-giveaways (0 disables, default 0).
- `GIVEAWAY_AUTO_DURATION` — license duration for auto-giveaways (default `1w`).
- `GIVEAWAY_AUTO_COUNT` — number of keys per auto-giveaway (1–25, default 3).

## Commands

Account commands:

- `/help` — command and setup guide.
- `/health` — website and authorization status.
- `/mystatus` — linked account, license, plan, expiry, and device status.
- `/redeem` — validate a license key and get your registration link.
- `/download` — client download link and latest version.
- `/link` — how to connect your Discord account.

License-team commands:

- `/keygen` — generate one to ten licenses.
- `/keyinfo` — inspect a complete license.
- `/keys` — search licenses by account, Discord, or key preview.
- `/setgenrole` — configure roles allowed to generate and inspect keys.

Administrator commands:

- `/stats` — live license totals.
- `/daily` — daily license summary with expiring keys.
- `/status` — live NYX service and license metrics.
- `/userlookup` — locate an account and its license.
- `/whois` — alias for `/userlookup`.
- `/notifyall` — broadcast a DM to accounts with release alerts enabled.
- `/notifyuser` — queue a DM for a specific linked Discord user.
- `/giveaway` — drop giveaway license keys with a claim button.
- `/keyrevoke`, `/keyreset`, `/keypause`, `/keyresume` — confirmed license actions.
- `/keyextend` — replace the expiration period.
- `/keynote` — save a private moderator note.

Owner commands:

- `/owner` — manage the server allowlist (`allow`, `deny`, `list`).

Destructive operations require a private confirmation button and are recorded by the website audit log. If `AUDIT_LOG_CHANNEL_ID` is set, a matching Discord audit embed is also posted.

Giveaway state is synced to the website when available, with local JSON files as fallback.

## Secret rotation

1. Set the old website secret as `BOT_API_SECRET_PREVIOUS` on Render.
2. Set a newly generated value as `BOT_API_SECRET` on Render.
3. Set the new value as `BOT_API_SECRET` on the bot host and restart the bot.
4. Confirm `/health` and `/stats`, then remove `BOT_API_SECRET_PREVIOUS` from Render.

## Checks

Run `npm test` to validate the bot source before deployment.
