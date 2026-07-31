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

## Commands

Account commands:

- `/help` — command and setup guide.
- `/health` — website and authorization status.
- `/mystatus` — linked account, license, plan, expiry, and device status.

License-team commands:

- `/keygen` — generate one to ten licenses.
- `/keyinfo` — inspect a complete license.
- `/keys` — search licenses by account, Discord, or key preview.
- `/setgenrole` — configure roles allowed to generate and inspect keys.

Administrator commands:

- `/stats` — live license totals.
- `/userlookup` — locate an account and its license.
- `/keyrevoke`, `/keyreset`, `/keypause`, `/keyresume` — confirmed license actions.
- `/keyextend` — replace the expiration period.
- `/keynote` — save a private moderator note.

Destructive operations require a private confirmation button and are recorded by the website audit log. If `AUDIT_LOG_CHANNEL_ID` is set, a matching Discord audit embed is also posted.

## Secret rotation

1. Set the old website secret as `BOT_API_SECRET_PREVIOUS` on Render.
2. Set a newly generated value as `BOT_API_SECRET` on Render.
3. Set the new value as `BOT_API_SECRET` on the bot host and restart the bot.
4. Confirm `/health` and `/stats`, then remove `BOT_API_SECRET_PREVIOUS` from Render.

## Checks

Run `npm test` to validate the bot source before deployment.
