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
- `TICKET_CATEGORY_ID` — category ID that `/ticket` channels are created under.
- `TICKET_TRANSCRIPT_CHANNEL_ID` — channel to archive closed-ticket transcripts to (falls back to `AUDIT_LOG_CHANNEL_ID`).
- `VERIFY_ROLE_ID` — role granted by `/verify` to members whose Discord is linked to an active license (also auto-assigned on join).
- `DIGEST_CHANNEL_ID` — channel ID for the scheduled daily license digest.
- `DIGEST_TIME` — fixed daily digest time in 24-hour UTC (`HH:MM`). Wins over the interval below.
- `DIGEST_INTERVAL_HOURS` — fallback digest cadence in hours (0 disables, default 0).
- `GIVEAWAY_REQUIRED_ROLE_ID` — optional role required to claim giveaway keys.
- `GIVEAWAY_REQUIRE_LINKED` — when `true`, only Discord accounts linked to NYX can claim giveaway keys (default `false`).
- `GIVEAWAY_CLAIM_COOLDOWN_MINUTES` — per-user cooldown between giveaway claims (default 0).
- `PUBLIC_RATE_LIMIT_PER_MINUTE` — per-user limit for `/mystatus`, `/redeem`, and `/verify` (default 10).

## Commands

Account commands (available in DMs and all servers):

- `/panel` — account and support control panel.
- `/help` — command and setup guide.
- `/setup` — guided account setup checklist.
- `/privacy` — privacy and account-safety information.
- `/health` — website, authorization, bot uptime, and alert-feed status.
- `/mystatus` — linked account, license, plan, expiry, and device status.
- `/redeem` — validate a license key and get your registration link.
- `/download` — client download link and latest version.
- `/link` — how to connect your Discord account.
- `/ping` — bot gateway latency and uptime.
- `/ticket` — open a private support ticket channel (server only).

Verification:

- `/verify` — check that your Discord is linked to an active license and grant the configured member role.
- `/verifysync` — re-check verified members and strip the role from inactive or unlinked accounts (administrators).

License-team commands:

- `/keygen` — generate one to ten licenses.
- `/keyinfo` — inspect a complete license.
- `/keys` — search licenses by account, Discord, or key preview.
- `/setgenrole` — configure roles allowed to generate and inspect keys.

Administrator commands:

- `/stats` — live license totals.
- `/daily` — daily license summary with expiring keys.
- `/digest` — view the daily digest, or post it publicly to `DIGEST_CHANNEL_ID`.
- `/status` — live NYX service and license metrics.
- `/userlookup` — locate an account and its license.
- `/whois` — alias for `/userlookup`.
- `/notifyall` — broadcast a DM to accounts with release alerts enabled (requires a confirmation click).
- `/notifyuser` — queue a DM for a specific linked Discord user.
- `/giveaway` — drop giveaway license keys with a claim button.
- `/giveawayend` — stop a giveaway early (message ID or link).
- `/keyrevoke`, `/keyreset`, `/keypause`, `/keyresume` — confirmed license actions.
- `/keyextend` — replace the expiration period.
- `/keynote` — save a private moderator note.

Context menus (right-click, administrators):

- **Look up license** on a member — instant license lookup without typing IDs.
- **Check license key** on a message — inspect a key that appears in a message.

Owner commands:

- `/owner` — manage the server allowlist (`allow`, `deny`, `list`).

Destructive operations require a private confirmation button and are recorded by the website audit log. If `AUDIT_LOG_CHANNEL_ID` is set, a matching Discord audit embed is also posted — including allowlist changes made with `/owner`.

Giveaway state is synced to the website when available, with local JSON files as fallback. All state files are written atomically (temp file + rename), so a crash cannot corrupt them; a corrupt file is backed up with a `.corrupt-<timestamp>` suffix rather than silently dropped. The files contain raw license keys, so keep the bot host's filesystem private.

## Command registration

Public account commands are registered globally so they work in DMs. The full command set is registered per allowed guild, so servers outside the allowlist do not see unusable commands in their command picker. Adding a server with `/owner allow` registers its commands immediately.

## Secret rotation

1. Set the old website secret as `BOT_API_SECRET_PREVIOUS` on Render.
2. Set a newly generated value as `BOT_API_SECRET` on Render.
3. Set the new value as `BOT_API_SECRET` on the bot host and restart the bot.
4. Confirm `/health` and `/stats`, then remove `BOT_API_SECRET_PREVIOUS` from Render.

`BOT_API_SECRET_PREVIOUS` is used only by the website, never by the bot.

## Repository layout

- `bot.js` — entry point (kept as a shim so the hosting startup file never changes).
- `src/` — application modules:
    - `config.js` — environment parsing and validation.
    - `client.js` — shared Discord client.
    - `state.js` — persisted state (allowlist, roles, giveaways, cooldowns, expiry reminders) with atomic writes.
    - `api.js` — signed requests to the NYX website.
    - `access.js` — allowlist, owner/admin/role permissions, denied-request logging.
    - `embeds.js`, `audit.js`, `tickets.js`, `giveaways.js` — shared rendering and features.
    - `polls.js` — notification, expiry-reminder, and security-alert polls with exponential backoff.
    - `commands.js` — slash-command definitions.
    - `handlers/` — one module per command group (account, licensing, actions, support, tools).
    - `buttons.js` — button interactions (confirmations, giveaway claims, tickets, panel).
    - `router.js` — access gate, dispatch, and user-safe error mapping.
    - `registration.js` — global and per-guild command registration.
    - `bot.js` — boot, scheduling (digest, auto-giveaway), and graceful shutdown.
- `test/` — unit tests for the pure logic (run with `node --test`).

## Checks

```sh
npm test     # syntax-check every file, then run the unit tests
npm run lint # eslint
npm run format # prettier --write
```

CI runs the same checks (plus `prettier --check`) on every push and pull request.
