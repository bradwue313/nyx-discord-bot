const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    EmbedBuilder,
    GatewayIntentBits,
    PermissionFlagsBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CONFIG = {
    TOKEN: process.env.BOT_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    AUTH_URL: (process.env.NYX_AUTH_URL || "").replace(/\/+$/, ""),
    API_SECRET: process.env.BOT_API_SECRET,
    AUDIT_LOG_CHANNEL_ID: process.env.AUDIT_LOG_CHANNEL_ID || "",
    // Comma-separated guild IDs the bot is allowed to operate in. Empty means
    // the bot refuses every command (fail-closed) until a server is added via
    // ALLOWED_GUILD_IDS or the /owner allow command.
    ALLOWED_GUILD_IDS: (process.env.ALLOWED_GUILD_IDS || "").split(",").map((value) => value.trim()).filter(Boolean),
    // Comma-separated Discord user IDs that bypass the allowlist and own the bot.
    BOT_OWNER_IDS: (process.env.BOT_OWNER_IDS || "").split(",").map((value) => value.trim()).filter(Boolean),
    ALLOWED_ROLES_FILE: path.join(__dirname, "allowed_roles.json"),
    ALLOWED_SERVERS_FILE: path.join(__dirname, "allowed_servers.json")
};

for (const [name, value] of Object.entries({
    BOT_TOKEN: CONFIG.TOKEN,
    CLIENT_ID: CONFIG.CLIENT_ID,
    NYX_AUTH_URL: CONFIG.AUTH_URL,
    BOT_API_SECRET: CONFIG.API_SECRET
})) {
    if (!value) {
        console.error(`[NYX BOT] Missing required environment variable: ${name}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

// Runtime server allowlist (managed via /owner allow|deny), merged with the
// static ALLOWED_GUILD_IDS env var so owners can add servers without redeploying.
let allowedServers = new Set(CONFIG.ALLOWED_GUILD_IDS);
try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG.ALLOWED_SERVERS_FILE, "utf8"));
    if (Array.isArray(parsed)) for (const id of parsed) if (typeof id === "string" && id) allowedServers.add(id);
} catch { /* first run */ }

function saveAllowedServers() {
    try {
        fs.writeFileSync(CONFIG.ALLOWED_SERVERS_FILE, JSON.stringify([...allowedServers], null, 4));
    } catch (error) {
        console.error(`[NYX BOT] Could not persist server allowlist: ${error.message}`);
    }
}

function isAllowedGuild(guildId) {
    return Boolean(guildId && allowedServers.has(guildId));
}

function isBotOwner(userId) {
    return Boolean(userId && CONFIG.BOT_OWNER_IDS.includes(userId));
}

// Public commands that are safe to run in DMs or non-whitelisted servers.
const PUBLIC_COMMANDS = new Set(["help", "health", "mystatus"]);

// Per-guild generator roles: { [guildId]: string[] }. Scoped so a role
// configured in one server cannot grant key generation in another.
if (!fs.existsSync(CONFIG.ALLOWED_ROLES_FILE)) {
    fs.writeFileSync(CONFIG.ALLOWED_ROLES_FILE, JSON.stringify({}, null, 4));
}

function loadAllowedRoles(guildId) {
    try {
        const parsed = JSON.parse(fs.readFileSync(CONFIG.ALLOWED_ROLES_FILE, "utf8"));
        const list = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed[guildId] : undefined;
        return Array.isArray(list) ? list.filter((value) => typeof value === "string") : [];
    } catch {
        return [];
    }
}

function saveAllowedRoles(guildId, roles) {
    let store = {};
    try {
        const parsed = JSON.parse(fs.readFileSync(CONFIG.ALLOWED_ROLES_FILE, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) store = parsed;
    } catch { /* rebuild */ }
    store[guildId] = [...new Set(roles)];
    fs.writeFileSync(CONFIG.ALLOWED_ROLES_FILE, JSON.stringify(store, null, 4));
}

function isAdministrator(member) {
    return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
}

function hasGeneratorPermission(member) {
    if (isAdministrator(member)) return true;
    const guildId = member?.guild?.id;
    if (!guildId) return false;
    const allowedRoles = loadAllowedRoles(guildId);
    return allowedRoles.length > 0 && member?.roles?.cache?.some((role) => allowedRoles.includes(role.id));
}

// Simple per-user sliding-window limiter for sensitive commands.
const commandUsage = new Map();

function checkRateLimit(userId, limit, windowMs) {
    const now = Date.now();
    const entry = commandUsage.get(userId) || { timestamps: [] };
    entry.timestamps = entry.timestamps.filter((time) => now - time < windowMs);
    if (entry.timestamps.length >= limit) {
        commandUsage.set(userId, entry);
        return false;
    }
    entry.timestamps.push(now);
    commandUsage.set(userId, entry);
    return true;
}

function logDenied(interaction, reason) {
    const where = interaction.guild ? `guild=${interaction.guild.id} (${interaction.guild.name})` : "dm";
    const actor = `${interaction.user.tag} (${interaction.user.id})`;
    const command = interaction.isChatInputCommand() ? `/${interaction.commandName}` : `button:${interaction.customId}`;
    console.warn(`[NYX BOT] DENIED ${command} by ${actor} in ${where}: ${reason}`);
}

function nyxEmbed(title, description = null) {
    const embed = new EmbedBuilder()
        .setColor(0xffffff)
        .setTitle(title)
        .setTimestamp()
        .setFooter({ text: "NYX ACCESS // AUTHORIZATION" });
    if (description) embed.setDescription(description);
    return embed;
}

function errorEmbed(message) {
    return nyxEmbed("Request failed", message).setColor(0x777777);
}

async function callAuthApi(pathname, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        const response = await fetch(`${CONFIG.AUTH_URL}${pathname}`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${CONFIG.API_SECRET}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
            const error = new Error(payload.message || `Website API returned HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }
        return payload;
    } finally {
        clearTimeout(timeout);
    }
}

async function websiteHealth() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
        const response = await fetch(`${CONFIG.AUTH_URL}/api/health`, { headers: { Accept: "application/json" }, signal: controller.signal });
        if (!response.ok) return { online: false, status: `HTTP ${response.status}` };
        const data = await response.json();
        return { online: true, status: data.status || "operational" };
    } catch {
        return { online: false, status: "unreachable" };
    } finally {
        clearTimeout(timeout);
    }
}

function formatTimestamp(value) {
    if (!value) return "Not set";
    return `<t:${Math.floor(Number(value))}:F>`;
}

function licenseState(license) {
    if (license.revokedAt) return "REVOKED";
    if (license.pausedAt) return "PAUSED";
    if (license.expiresAt && Number(license.expiresAt) <= Math.floor(Date.now() / 1000)) return "EXPIRED";
    if (!license.activatedAt) return "UNUSED";
    return "ACTIVE";
}

function licenseEmbed(license, title = "NYX license") {
    return nyxEmbed(title)
        .addFields(
            { name: "Key", value: `\`${license.keyPreview || "Hidden"}\``, inline: false },
            { name: "Status", value: licenseState(license), inline: true },
            { name: "Plan", value: String(license.duration || "unknown").toUpperCase(), inline: true },
            { name: "Account", value: license.username || "Not activated", inline: true },
            { name: "Discord", value: license.discordUsername ? `@${license.discordUsername}` : "Not linked", inline: true },
            { name: "Expires", value: license.duration === "lifetime" ? "Lifetime" : formatTimestamp(license.expiresAt), inline: true },
            { name: "Device", value: license.deviceId ? `${license.deviceId.slice(0, 12)}…` : "Not bound", inline: true },
            { name: "Private note", value: license.note || "None", inline: false }
        );
}

async function sendAudit(title, interaction, details) {
    if (!CONFIG.AUDIT_LOG_CHANNEL_ID) return;
    try {
        const channel = await client.channels.fetch(CONFIG.AUDIT_LOG_CHANNEL_ID);
        if (!channel?.isTextBased()) return;
        await channel.send({
            embeds: [nyxEmbed(title, details).addFields(
                { name: "Moderator", value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
                { name: "Server", value: interaction.guild?.name || "Unknown", inline: true }
            )]
        });
    } catch (error) {
        console.error(`[NYX BOT] Could not write audit log: ${error.message}`);
    }
}

let notificationPollActive = false;

// Licenses whose expiry has already been announced, keyed by license id.
// Persisted so restarts do not re-announce the same expirations.
const EXPIRY_REMINDER_FILE = path.join(__dirname, "expiry_reminders.json");
let announcedExpiries = {};
try {
    const parsed = JSON.parse(fs.readFileSync(EXPIRY_REMINDER_FILE, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) announcedExpiries = parsed;
} catch { /* first run */ }

function saveAnnouncedExpiries() {
    try {
        fs.writeFileSync(EXPIRY_REMINDER_FILE, JSON.stringify(announcedExpiries));
    } catch (error) {
        console.error(`[NYX BOT] Could not persist expiry reminders: ${error.message}`);
    }
}

let expiryPollActive = false;

// DMs each user once per license as their key approaches its expiry, so
// renewals are not missed. Only licenses expiring within the window are
// returned by the website, and already-announced expiries are skipped.
async function pollExpiryReminders() {
    if (expiryPollActive || !client.isReady()) return;
    expiryPollActive = true;
    try {
        const { expiring = [] } = await callAuthApi("/api/bot/expiring", { windowSeconds: 72 * 60 * 60 });
        const now = Math.floor(Date.now() / 1000);
        for (const license of expiring) {
            const announced = announcedExpiries[license.licenseId];
            if (announced === license.expiresAt) continue;
            try {
                const user = await client.users.fetch(license.discordId);
                const hoursLeft = Math.max(1, Math.ceil((Number(license.expiresAt) - now) / 3600));
                await user.send({ embeds: [nyxEmbed("NYX license expiring soon", `Your NYX license (${license.username}) expires in approximately **${hoursLeft} hour${hoursLeft === 1 ? "" : "s"}** (${formatTimestamp(license.expiresAt)}). Renew before it lapses to keep your access active.`)] });
                announcedExpiries[license.licenseId] = license.expiresAt;
                saveAnnouncedExpiries();
            } catch (error) {
                console.error(`[NYX BOT] Could not send expiry reminder for ${license.licenseId}: ${error.message}`);
            }
        }
    } catch (error) {
        console.error(`[NYX BOT] Expiry reminder poll failed: ${error.message}`);
    } finally {
        expiryPollActive = false;
    }
}

async function pollNotifications() {
    if (notificationPollActive || !client.isReady()) return;
    notificationPollActive = true;
    try {
        const { notifications = [] } = await callAuthApi("/api/bot/notifications", { action: "poll" });
        const deliveredIds = [];
        for (const notification of notifications) {
            try {
                const user = await client.users.fetch(notification.discordId);
                const title = notification.kind === "release" ? "NYX release available" : "NYX account notice";
                await user.send({ embeds: [nyxEmbed(title, notification.message)] });
                deliveredIds.push(notification.id);
            } catch (error) {
                console.error(`[NYX BOT] Could not deliver notification ${notification.id}: ${error.message}`);
            }
        }
        if (deliveredIds.length) {
            await callAuthApi("/api/bot/notifications", { action: "ack", ids: deliveredIds });
        }
    } catch (error) {
        console.error(`[NYX BOT] Notification poll failed: ${error.message}`);
    } finally {
        notificationPollActive = false;
    }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const pendingActions = new Map();
const durations = [
    { name: "12 Hours", value: "12h" },
    { name: "1 Day", value: "1d" },
    { name: "1 Week", value: "1w" },
    { name: "1 Month", value: "1m" },
    { name: "1 Year", value: "1y" },
    { name: "Lifetime", value: "lifetime" }
];

const commands = [
    new SlashCommandBuilder().setName("help").setDescription("Show NYX bot commands and account setup"),
    new SlashCommandBuilder().setName("keygen").setDescription("Generate NYX website license keys")
        .addStringOption((option) => option.setName("duration").setDescription("License duration after activation").setRequired(true).addChoices(...durations))
        .addIntegerOption((option) => option.setName("amount").setDescription("Number of keys, from 1 to 10").setMinValue(1).setMaxValue(10)),
    new SlashCommandBuilder().setName("setgenrole").setDescription("Manage roles allowed to generate keys")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option.setName("action").setDescription("Role action").setRequired(true).addChoices(
            { name: "Add Role", value: "add" }, { name: "Remove Role", value: "remove" }, { name: "List Allowed Roles", value: "list" }))
        .addRoleOption((option) => option.setName("role").setDescription("Role to add or remove")),
    new SlashCommandBuilder().setName("keyinfo").setDescription("Check a NYX license")
        .addStringOption((option) => option.setName("key").setDescription("Complete NYX key").setRequired(true)),
    new SlashCommandBuilder().setName("keys").setDescription("Search recent NYX licenses")
        .addStringOption((option) => option.setName("query").setDescription("Username, email, Discord, or key preview").setRequired(true)),
    new SlashCommandBuilder().setName("userlookup").setDescription("Find a NYX account and license")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option.setName("query").setDescription("Username, email, Discord ID, or Discord username").setRequired(true)),
    new SlashCommandBuilder().setName("whois").setDescription("Find a NYX account and license (alias for /userlookup)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option.setName("query").setDescription("Username, email, Discord ID, or Discord username").setRequired(true)),
    new SlashCommandBuilder().setName("notifyall").setDescription("Send an announcement DM to every account with release alerts enabled")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option.setName("message").setDescription("Announcement text").setRequired(true).setMaxLength(500)),
    new SlashCommandBuilder().setName("stats").setDescription("Show live NYX license totals")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("health").setDescription("Check the NYX website and authorization service"),
    ...[
        ["keyrevoke", "Revoke a NYX license"],
        ["keyreset", "Reset the device attached to a NYX license"],
        ["keypause", "Temporarily pause a NYX license"],
        ["keyresume", "Resume a paused NYX license"]
    ].map(([name, description]) => new SlashCommandBuilder().setName(name).setDescription(description)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option.setName("key").setDescription("Complete NYX key").setRequired(true))),
    new SlashCommandBuilder().setName("keyextend").setDescription("Replace the expiration period for a NYX license")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option.setName("key").setDescription("Complete NYX key").setRequired(true))
        .addStringOption((option) => option.setName("duration").setDescription("New duration from now").setRequired(true).addChoices(...durations)),
    new SlashCommandBuilder().setName("keynote").setDescription("Attach a private note to a NYX license")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option.setName("key").setDescription("Complete NYX key").setRequired(true))
        .addStringOption((option) => option.setName("note").setDescription("Private note, or blank text to replace it").setRequired(true).setMaxLength(300)),
    new SlashCommandBuilder().setName("mystatus").setDescription("Check whether your Discord is linked to an active NYX account"),
    new SlashCommandBuilder().setName("owner").setDescription("Manage the server allowlist (owner only)")
        .addStringOption((option) => option.setName("action").setDescription("Allowlist action").setRequired(true).addChoices(
            { name: "Allow Server", value: "allow" }, { name: "Deny Server", value: "deny" }, { name: "List Allowed Servers", value: "list" }))
        .addStringOption((option) => option.setName("serverid").setDescription("Guild ID to allow or deny"))
];

client.once("ready", async () => {
    console.log(`[NYX BOT] Logged in as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: "NYX authorization" }], status: "online" });
    const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN);
    await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: commands.map((command) => command.toJSON()) });
    console.log(`[NYX BOT] Registered ${commands.length} commands`);
    console.log(`[NYX BOT] Server allowlist: ${allowedServers.size ? [...allowedServers].join(", ") : "NONE (fail-closed; add via ALLOWED_GUILD_IDS or /owner allow)"}`);
    console.log(`[NYX BOT] Owners: ${CONFIG.BOT_OWNER_IDS.length ? CONFIG.BOT_OWNER_IDS.join(", ") : "none configured"}`);

    // Leave any server the bot is in that is not on the allowlist.
    for (const guild of client.guilds.cache.values()) {
        if (!isAllowedGuild(guild.id)) {
            console.warn(`[NYX BOT] Leaving non-whitelisted guild ${guild.id} (${guild.name})`);
            await guild.leave().catch((error) => console.error(`[NYX BOT] Could not leave ${guild.id}: ${error.message}`));
        }
    }

    await pollNotifications();
    await pollExpiryReminders();
    setInterval(pollNotifications, 60_000).unref();
    setInterval(pollExpiryReminders, 6 * 60 * 60 * 1000).unref();
});

// Auto-leave if the bot is added to a server that is not on the allowlist.
client.on("guildCreate", (guild) => {
    if (isAllowedGuild(guild.id)) {
        console.log(`[NYX BOT] Added to whitelisted guild ${guild.id} (${guild.name})`);
        return;
    }
    console.warn(`[NYX BOT] Leaving newly-added non-whitelisted guild ${guild.id} (${guild.name})`);
    guild.leave().catch((error) => console.error(`[NYX BOT] Could not leave ${guild.id}: ${error.message}`));
});

function confirmationRow(id) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`nyx_confirm:${id}`).setLabel("Confirm").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`nyx_cancel:${id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    );
}

async function requestConfirmation(interaction, action, key) {
    const id = crypto.randomUUID();
    pendingActions.set(id, { action, key, userId: interaction.user.id, guildId: interaction.guildId, expiresAt: Date.now() + 60_000 });
    const label = { revoke: "revoke this license", reset: "reset its device", pause: "pause this license", resume: "resume this license" }[action];
    return interaction.reply({
        embeds: [nyxEmbed("Confirm license action", `Are you sure you want to **${label}**?\n\n\`${key.slice(0, 8)}…${key.slice(-8)}\``)],
        components: [confirmationRow(id)],
        ephemeral: true
    });
}

async function handleButton(interaction) {
    const [prefix, id] = interaction.customId.split(":");
    if (!id || !["nyx_confirm", "nyx_cancel"].includes(prefix)) return;
    // Buttons are subject to the same server allowlist as commands.
    if (interaction.guildId && !isAllowedGuild(interaction.guildId)) {
        logDenied(interaction, "server not on allowlist");
        return interaction.reply({ embeds: [errorEmbed("Commands are not enabled in this server.")], ephemeral: true });
    }
    const pending = pendingActions.get(id);
    if (!pending || pending.userId !== interaction.user.id || pending.guildId !== interaction.guildId || pending.expiresAt < Date.now()) {
        pendingActions.delete(id);
        return interaction.reply({ embeds: [errorEmbed("This confirmation expired or is not valid here. Run the command again.")], ephemeral: true });
    }
    pendingActions.delete(id);
    if (prefix === "nyx_cancel") {
        return interaction.update({ embeds: [nyxEmbed("Action cancelled", "No license changes were made.")], components: [] });
    }
    if (!isAdministrator(interaction.member)) {
        return interaction.update({ embeds: [errorEmbed("Administrator permission is required.")], components: [] });
    }
    await interaction.deferUpdate();
    const result = await callAuthApi("/api/bot/keys", { action: pending.action, key: pending.key, actorId: interaction.user.id });
    await sendAudit(`License ${pending.action}`, interaction, result.message);
    return interaction.editReply({ embeds: [nyxEmbed("License updated", result.message)], components: [] });
}

client.on("interactionCreate", async (interaction) => {
    try {
        if (interaction.isButton()) return await handleButton(interaction);
        if (!interaction.isChatInputCommand()) return;
        const { commandName, member } = interaction;

        // --- Access gate ---------------------------------------------------
        // DMs: only public commands. Guilds: only whitelisted servers.
        if (interaction.guildId) {
            if (!isAllowedGuild(interaction.guildId)) {
                logDenied(interaction, "server not on allowlist");
                return interaction.reply({ embeds: [errorEmbed("Commands are not enabled in this server.")], ephemeral: true });
            }
        } else if (!PUBLIC_COMMANDS.has(commandName)) {
            logDenied(interaction, "sensitive command used in DMs");
            return interaction.reply({ embeds: [errorEmbed("This command must be used inside an authorized server.")], ephemeral: true });
        }

        if (commandName === "owner") {
            if (!isBotOwner(interaction.user.id)) {
                logDenied(interaction, "not a bot owner");
                return interaction.reply({ embeds: [errorEmbed("This command is reserved for the bot owner.")], ephemeral: true });
            }
            const action = interaction.options.getString("action");
            if (action === "list") {
                const list = allowedServers.size ? [...allowedServers].map((id) => `\`${id}\``).join("\n") : "No servers allowed yet.";
                return interaction.reply({ embeds: [nyxEmbed("Allowed servers", list)], ephemeral: true });
            }
            const serverId = interaction.options.getString("serverid")?.trim();
            if (!serverId || !/^\d{15,20}$/u.test(serverId)) {
                return interaction.reply({ embeds: [errorEmbed("Enter a valid Discord guild ID.")], ephemeral: true });
            }
            if (action === "allow") {
                allowedServers.add(serverId);
                saveAllowedServers();
                return interaction.reply({ embeds: [nyxEmbed("Server allowed", `\`${serverId}\` is now on the allowlist.`)] , ephemeral: true });
            }
            if (action === "deny") {
                allowedServers.delete(serverId);
                saveAllowedServers();
                const guild = client.guilds.cache.get(serverId);
                if (guild) await guild.leave().catch(() => {});
                return interaction.reply({ embeds: [nyxEmbed("Server denied", `\`${serverId}\` was removed from the allowlist.`)], ephemeral: true });
            }
            return interaction.reply({ embeds: [errorEmbed("Unknown owner action.")], ephemeral: true });
        }

        if (commandName === "help") {
            const embed = nyxEmbed("NYX command guide", "Website accounts use a license from this bot, a linked Discord account, and a one-time launch code.")
                .addFields(
                    { name: "Account", value: "`/mystatus` — check your linked account\n`/health` — check service availability", inline: false },
                    { name: "License team", value: "`/keygen` `/keyinfo` `/keys`", inline: false },
                    { name: "Administrators", value: "`/stats` `/userlookup` `/whois` `/notifyall` `/keyrevoke` `/keyreset` `/keyextend` `/keypause` `/keyresume` `/keynote` `/setgenrole`", inline: false }
                );
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (commandName === "health") {
            await interaction.deferReply({ ephemeral: true });
            const health = await websiteHealth();
            return interaction.editReply({ embeds: [nyxEmbed("NYX service health").addFields(
                { name: "Website", value: health.online ? "ONLINE" : "UNREACHABLE", inline: true },
                { name: "Authorization", value: String(health.status).toUpperCase(), inline: true },
                { name: "Address", value: CONFIG.AUTH_URL, inline: false }
            )] });
        }

        if (commandName === "setgenrole") {
            if (!interaction.guildId) return interaction.reply({ embeds: [errorEmbed("This command must be used inside a server.")], ephemeral: true });
            if (!isAdministrator(member)) return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
            const action = interaction.options.getString("action");
            const role = interaction.options.getRole("role");
            let allowedRoles = loadAllowedRoles(interaction.guildId);
            if (action === "list") {
                const roles = allowedRoles.length ? allowedRoles.map((id) => `<@&${id}>`).join("\n") : "No generator roles configured.";
                return interaction.reply({ embeds: [nyxEmbed("License generator roles", roles)], ephemeral: true });
            }
            if (!role) return interaction.reply({ embeds: [errorEmbed("Choose a role to add or remove.")], ephemeral: true });
            if (action === "add") allowedRoles.push(role.id);
            if (action === "remove") allowedRoles = allowedRoles.filter((id) => id !== role.id);
            saveAllowedRoles(interaction.guildId, allowedRoles);
            await sendAudit("Generator role updated", interaction, `${action === "add" ? "Added" : "Removed"} ${role.name} in ${interaction.guild.name}`);
            return interaction.reply({ embeds: [nyxEmbed("Generator role updated", `${action === "add" ? "Added" : "Removed"} <@&${role.id}>.`)], ephemeral: true });
        }

        if (commandName === "keygen") {
            if (!hasGeneratorPermission(member)) return interaction.reply({ embeds: [errorEmbed("You do not have permission to generate licenses.")], ephemeral: true });
            // Limit key minting to 5 generations per user per minute to stop
            // accidental or malicious flooding of the license pool.
            if (!checkRateLimit(interaction.user.id, 5, 60_000)) {
                return interaction.reply({ embeds: [errorEmbed("Key generation is rate-limited. Try again in a minute.")], ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const duration = interaction.options.getString("duration");
            const amount = interaction.options.getInteger("amount") || 1;
            const result = await callAuthApi("/api/bot/keys", { action: "generate", duration, amount, createdBy: interaction.user.tag, actorId: interaction.user.id });
            const embed = nyxEmbed("NYX licenses generated", `These complete keys are shown only in this private response.\n\n${result.keys.map((key) => `\`${key}\``).join("\n")}`)
                .addFields({ name: "Duration", value: duration.toUpperCase(), inline: true }, { name: "Quantity", value: String(result.keys.length), inline: true });
            await sendAudit("Licenses generated", interaction, `${result.keys.length} × ${duration}`);
            return interaction.editReply({ embeds: [embed] });
        }

        if (commandName === "keyinfo") {
            if (!hasGeneratorPermission(member)) return interaction.reply({ embeds: [errorEmbed("You do not have permission to inspect licenses.")], ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const result = await callAuthApi("/api/bot/keys", { action: "info", key: interaction.options.getString("key").trim(), actorId: interaction.user.id });
            return interaction.editReply({ embeds: [licenseEmbed(result.license)] });
        }

        if (["keys", "userlookup", "whois"].includes(commandName)) {
            if (commandName === "keys" ? !hasGeneratorPermission(member) : !isAdministrator(member)) {
                return interaction.reply({ embeds: [errorEmbed("You do not have permission to search licenses.")], ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const query = interaction.options.getString("query").trim();
            const result = await callAuthApi("/api/bot/keys", { action: commandName === "keys" ? "search" : "lookup", query, actorId: interaction.user.id });
            if (!result.licenses.length) return interaction.editReply({ embeds: [nyxEmbed("No results", "No NYX accounts or licenses matched that search.")] });
            const embed = nyxEmbed("NYX search results", `Showing ${Math.min(result.licenses.length, 10)} of ${result.licenses.length} matches.`);
            for (const license of result.licenses.slice(0, 10)) {
                embed.addFields({ name: `${license.username || "Unused"} // ${licenseState(license)}`, value: `\`${license.keyPreview}\`\n${license.discordUsername ? `@${license.discordUsername}` : "No Discord"} · ${String(license.duration).toUpperCase()}`, inline: false });
            }
            return interaction.editReply({ embeds: [embed] });
        }

        if (commandName === "stats") {
            if (!isAdministrator(member)) return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const { stats } = await callAuthApi("/api/bot/keys", { action: "stats", actorId: interaction.user.id });
            return interaction.editReply({ embeds: [nyxEmbed("Live NYX license totals").addFields(
                { name: "Total", value: String(stats.total), inline: true },
                { name: "Active", value: String(stats.active), inline: true },
                { name: "Unused", value: String(stats.unused), inline: true },
                { name: "Paused", value: String(stats.paused), inline: true },
                { name: "Expired", value: String(stats.expired), inline: true },
                { name: "Revoked", value: String(stats.revoked), inline: true }
            )] });
        }

        const confirmationActions = { keyrevoke: "revoke", keyreset: "reset", keypause: "pause", keyresume: "resume" };
        if (confirmationActions[commandName]) {
            if (!isAdministrator(member)) return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
            return requestConfirmation(interaction, confirmationActions[commandName], interaction.options.getString("key").trim());
        }

        if (["keyextend", "keynote"].includes(commandName)) {
            if (!isAdministrator(member)) return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const action = commandName === "keyextend" ? "extend" : "note";
            const result = await callAuthApi("/api/bot/keys", {
                action,
                key: interaction.options.getString("key").trim(),
                duration: interaction.options.getString("duration"),
                note: interaction.options.getString("note"),
                actorId: interaction.user.id
            });
            await sendAudit(commandName === "keyextend" ? "License extended" : "License note updated", interaction, result.message);
            return interaction.editReply({ embeds: [nyxEmbed("License updated", result.message)] });
        }

        if (commandName === "notifyall") {
            if (!isAdministrator(member)) return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const message = interaction.options.getString("message");
            const result = await callAuthApi("/api/bot/notifications", { action: "broadcast", message });
            await sendAudit("Broadcast announcement", interaction, `Queued ${result.recipients} DM notifications`);
            return interaction.editReply({ embeds: [nyxEmbed("Announcement queued", `The message will be delivered to **${result.recipients}** accounts with release alerts enabled.`)] });
        }

        if (commandName === "mystatus") {
            await interaction.deferReply({ ephemeral: true });
            const result = await callAuthApi("/api/bot/status", { discordId: interaction.user.id });
            if (!result.linked) return interaction.editReply({ embeds: [nyxEmbed("Discord not linked", "Sign in to the NYX website dashboard and choose **Connect Discord**.")] });
            const account = result.account;
            return interaction.editReply({ embeds: [nyxEmbed("Your NYX account").addFields(
                { name: "Website account", value: account.username, inline: true },
                { name: "License", value: result.active ? "ACTIVE" : account.pausedAt ? "PAUSED" : "INACTIVE", inline: true },
                { name: "Plan", value: account.duration.toUpperCase(), inline: true },
                { name: "Expires", value: account.duration === "lifetime" ? "Lifetime" : formatTimestamp(account.expiresAt), inline: true },
                { name: "Device", value: account.deviceId ? "Bound" : "Not bound", inline: true },
                { name: "Dashboard", value: CONFIG.AUTH_URL, inline: false }
            )] });
        }
    } catch (error) {
        const message = error.name === "AbortError"
            ? "The NYX website is waking up or did not respond in time. Try again in a moment."
            : error.status === 503
                ? "NYX is currently in maintenance mode."
                : error.message;
        const payload = { embeds: [errorEmbed(message)], components: [] };
        if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
        return interaction.reply({ ...payload, ephemeral: true });
    }
});

setInterval(() => {
    const now = Date.now();
    for (const [id, pending] of pendingActions.entries()) if (pending.expiresAt < now) pendingActions.delete(id);
}, 60_000).unref();

process.on("unhandledRejection", (error) => console.error("[NYX BOT] Unhandled error:", error?.message || error));
client.login(CONFIG.TOKEN);
