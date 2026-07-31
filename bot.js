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
    ALLOWED_ROLES_FILE: path.join(__dirname, "allowed_roles.json")
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

if (!fs.existsSync(CONFIG.ALLOWED_ROLES_FILE)) {
    fs.writeFileSync(CONFIG.ALLOWED_ROLES_FILE, JSON.stringify([], null, 4));
}

function loadAllowedRoles() {
    try {
        const parsed = JSON.parse(fs.readFileSync(CONFIG.ALLOWED_ROLES_FILE, "utf8"));
        return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
    } catch {
        return [];
    }
}

function saveAllowedRoles(roles) {
    fs.writeFileSync(CONFIG.ALLOWED_ROLES_FILE, JSON.stringify([...new Set(roles)], null, 4));
}

function isAdministrator(member) {
    return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
}

function hasGeneratorPermission(member) {
    if (isAdministrator(member)) return true;
    const allowedRoles = loadAllowedRoles();
    return allowedRoles.length > 0 && member?.roles?.cache?.some((role) => allowedRoles.includes(role.id));
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
    new SlashCommandBuilder().setName("mystatus").setDescription("Check whether your Discord is linked to an active NYX account")
];

client.once("ready", async () => {
    console.log(`[NYX BOT] Logged in as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: "NYX authorization" }], status: "online" });
    const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN);
    await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: commands.map((command) => command.toJSON()) });
    console.log(`[NYX BOT] Registered ${commands.length} commands`);
    await pollNotifications();
    setInterval(pollNotifications, 60_000).unref();
});

function confirmationRow(id) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`nyx_confirm:${id}`).setLabel("Confirm").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`nyx_cancel:${id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    );
}

async function requestConfirmation(interaction, action, key) {
    const id = crypto.randomUUID();
    pendingActions.set(id, { action, key, userId: interaction.user.id, expiresAt: Date.now() + 60_000 });
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
    const pending = pendingActions.get(id);
    if (!pending || pending.userId !== interaction.user.id || pending.expiresAt < Date.now()) {
        pendingActions.delete(id);
        return interaction.reply({ embeds: [errorEmbed("This confirmation expired. Run the command again.")], ephemeral: true });
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

        if (commandName === "help") {
            const embed = nyxEmbed("NYX command guide", "Website accounts use a license from this bot, a linked Discord account, and a one-time launch code.")
                .addFields(
                    { name: "Account", value: "`/mystatus` — check your linked account\n`/health` — check service availability", inline: false },
                    { name: "License team", value: "`/keygen` `/keyinfo` `/keys`", inline: false },
                    { name: "Administrators", value: "`/stats` `/userlookup` `/keyrevoke` `/keyreset` `/keyextend` `/keypause` `/keyresume` `/keynote` `/setgenrole`", inline: false }
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
            if (!isAdministrator(member)) return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
            const action = interaction.options.getString("action");
            const role = interaction.options.getRole("role");
            let allowedRoles = loadAllowedRoles();
            if (action === "list") {
                const roles = allowedRoles.length ? allowedRoles.map((id) => `<@&${id}>`).join("\n") : "No generator roles configured.";
                return interaction.reply({ embeds: [nyxEmbed("License generator roles", roles)], ephemeral: true });
            }
            if (!role) return interaction.reply({ embeds: [errorEmbed("Choose a role to add or remove.")], ephemeral: true });
            if (action === "add") allowedRoles.push(role.id);
            if (action === "remove") allowedRoles = allowedRoles.filter((id) => id !== role.id);
            saveAllowedRoles(allowedRoles);
            await sendAudit("Generator role updated", interaction, `${action === "add" ? "Added" : "Removed"} ${role.name}`);
            return interaction.reply({ embeds: [nyxEmbed("Generator role updated", `${action === "add" ? "Added" : "Removed"} <@&${role.id}>.`)], ephemeral: true });
        }

        if (commandName === "keygen") {
            if (!hasGeneratorPermission(member)) return interaction.reply({ embeds: [errorEmbed("You do not have permission to generate licenses.")], ephemeral: true });
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

        if (["keys", "userlookup"].includes(commandName)) {
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
