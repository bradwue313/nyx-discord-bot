const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    REST,
    Routes
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const CONFIG = {
    TOKEN: process.env.BOT_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    AUTH_URL: (process.env.NYX_AUTH_URL || "").replace(/\/+$/, ""),
    API_SECRET: process.env.BOT_API_SECRET,
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
        return JSON.parse(fs.readFileSync(CONFIG.ALLOWED_ROLES_FILE, "utf8"));
    } catch {
        return [];
    }
}

function saveAllowedRoles(roles) {
    fs.writeFileSync(CONFIG.ALLOWED_ROLES_FILE, JSON.stringify(roles, null, 4));
}

function isAdministrator(member) {
    return member.permissions.has(PermissionFlagsBits.Administrator);
}

function hasGeneratorPermission(member) {
    if (isAdministrator(member)) return true;
    const allowedRoles = loadAllowedRoles();
    return allowedRoles.length > 0 && member.roles.cache.some((role) => allowedRoles.includes(role.id));
}

async function callAuthApi(pathname, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
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
            throw new Error(payload.message || `Website API returned HTTP ${response.status}`);
        }
        return payload;
    } finally {
        clearTimeout(timeout);
    }
}

function formatTimestamp(value) {
    if (!value) return "Not set";
    return `<t:${Math.floor(Number(value))}:F>`;
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const durations = [
    { name: "12 Hours", value: "12h" },
    { name: "1 Day", value: "1d" },
    { name: "1 Week", value: "1w" },
    { name: "1 Month", value: "1m" },
    { name: "1 Year", value: "1y" },
    { name: "Lifetime", value: "lifetime" }
];

const commands = [
    new SlashCommandBuilder()
        .setName("keygen")
        .setDescription("Generate NYX website license keys")
        .addStringOption((option) =>
            option.setName("duration").setDescription("License duration after activation").setRequired(true).addChoices(...durations))
        .addIntegerOption((option) =>
            option.setName("amount").setDescription("Number of keys, from 1 to 10").setMinValue(1).setMaxValue(10)),
    new SlashCommandBuilder()
        .setName("setgenrole")
        .setDescription("Manage roles allowed to generate keys")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option.setName("action").setDescription("Role action").setRequired(true).addChoices(
                { name: "Add Role", value: "add" },
                { name: "Remove Role", value: "remove" },
                { name: "List Allowed Roles", value: "list" }
            ))
        .addRoleOption((option) => option.setName("role").setDescription("Role to add or remove")),
    new SlashCommandBuilder()
        .setName("keyinfo")
        .setDescription("Check a NYX license")
        .addStringOption((option) => option.setName("key").setDescription("Complete NYX key").setRequired(true)),
    new SlashCommandBuilder()
        .setName("keyrevoke")
        .setDescription("Revoke a NYX license")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option.setName("key").setDescription("Complete NYX key").setRequired(true)),
    new SlashCommandBuilder()
        .setName("keyreset")
        .setDescription("Reset the device attached to a NYX license")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option.setName("key").setDescription("Complete NYX key").setRequired(true)),
    new SlashCommandBuilder()
        .setName("keyextend")
        .setDescription("Replace the expiration period for a NYX license")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option.setName("key").setDescription("Complete NYX key").setRequired(true))
        .addStringOption((option) =>
            option.setName("duration").setDescription("New duration from now").setRequired(true).addChoices(...durations)),
    new SlashCommandBuilder()
        .setName("mystatus")
        .setDescription("Check whether your Discord is linked to an active NYX account")
];

client.once("ready", async () => {
    console.log(`[NYX BOT] Logged in as ${client.user.tag}`);
    try {
        const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN);
        await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), {
            body: commands.map((command) => command.toJSON())
        });
        console.log("[NYX BOT] Slash commands registered.");
    } catch (error) {
        console.error("[NYX BOT] Command registration failed:", error.message);
    }
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, member } = interaction;

    try {
        if (commandName === "setgenrole") {
            if (!isAdministrator(member)) {
                return interaction.reply({ content: "You must be an administrator.", ephemeral: true });
            }
            const action = interaction.options.getString("action");
            const role = interaction.options.getRole("role");
            let allowedRoles = loadAllowedRoles();
            if (action === "list") {
                const value = allowedRoles.length ? allowedRoles.map((id) => `<@&${id}>`).join(", ") : "No generator roles configured.";
                return interaction.reply({ content: value, ephemeral: true });
            }
            if (!role) return interaction.reply({ content: "Select a role.", ephemeral: true });
            if (action === "add" && !allowedRoles.includes(role.id)) allowedRoles.push(role.id);
            if (action === "remove") allowedRoles = allowedRoles.filter((id) => id !== role.id);
            saveAllowedRoles(allowedRoles);
            return interaction.reply({ content: `${action === "add" ? "Added" : "Removed"} <@&${role.id}>.`, ephemeral: true });
        }

        if (commandName === "keygen") {
            if (!hasGeneratorPermission(member)) {
                return interaction.reply({ content: "You do not have permission to generate keys.", ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const duration = interaction.options.getString("duration");
            const amount = interaction.options.getInteger("amount") || 1;
            const result = await callAuthApi("/api/bot/keys", {
                action: "generate",
                duration,
                amount,
                createdBy: `${interaction.user.tag} (${interaction.user.id})`
            });
            const embed = new EmbedBuilder()
                .setTitle("NYX website license generated")
                .setColor("#C8FF48")
                .setDescription(`\`\`\`\n${result.keys.join("\n")}\n\`\`\``)
                .addFields(
                    { name: "Duration", value: duration.toUpperCase(), inline: true },
                    { name: "Quantity", value: String(result.keys.length), inline: true },
                    { name: "Activation", value: "Starts when registered", inline: true }
                )
                .setFooter({ text: "These keys are displayed in full only here." });
            return interaction.editReply({ embeds: [embed] });
        }

        if (commandName === "keyinfo") {
            if (!hasGeneratorPermission(member)) {
                return interaction.reply({ content: "You do not have permission to inspect keys.", ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const result = await callAuthApi("/api/bot/keys", {
                action: "info",
                key: interaction.options.getString("key").trim()
            });
            const license = result.license;
            const status = license.revokedAt ? "Revoked" : license.username ? "Activated" : "Unused";
            const embed = new EmbedBuilder()
                .setTitle(`License ${license.keyPreview}`)
                .setColor(status === "Revoked" ? "#FF6B57" : "#C8FF48")
                .addFields(
                    { name: "Status", value: status, inline: true },
                    { name: "Duration", value: String(license.duration).toUpperCase(), inline: true },
                    { name: "Account", value: license.username || "Not registered", inline: true },
                    { name: "Discord", value: license.discordUsername ? `@${license.discordUsername}` : "Not linked", inline: true },
                    { name: "Activated", value: formatTimestamp(license.activatedAt), inline: true },
                    { name: "Expires", value: license.duration === "lifetime" ? "Lifetime" : formatTimestamp(license.expiresAt), inline: true },
                    { name: "Device", value: license.deviceId ? `${license.deviceId.slice(0, 12)}…` : "Not bound", inline: false }
                );
            return interaction.editReply({ embeds: [embed] });
        }

        if (["keyrevoke", "keyreset", "keyextend"].includes(commandName)) {
            if (!isAdministrator(member)) {
                return interaction.reply({ content: "You must be an administrator.", ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const action = commandName === "keyrevoke" ? "revoke" : commandName === "keyreset" ? "reset" : "extend";
            const result = await callAuthApi("/api/bot/keys", {
                action,
                key: interaction.options.getString("key").trim(),
                duration: interaction.options.getString("duration")
            });
            return interaction.editReply({ content: result.message });
        }

        if (commandName === "mystatus") {
            await interaction.deferReply({ ephemeral: true });
            const result = await callAuthApi("/api/bot/status", { discordId: interaction.user.id });
            if (!result.linked) {
                return interaction.editReply({ content: "Your Discord is not linked. Sign in to the NYX website dashboard and choose **Connect Discord**." });
            }
            const embed = new EmbedBuilder()
                .setTitle("Your NYX account")
                .setColor(result.active ? "#C8FF48" : "#FF6B57")
                .addFields(
                    { name: "Website account", value: result.account.username, inline: true },
                    { name: "License", value: result.active ? "Active" : "Inactive", inline: true },
                    { name: "Plan", value: result.account.duration.toUpperCase(), inline: true },
                    { name: "Expires", value: result.account.duration === "lifetime" ? "Lifetime" : formatTimestamp(result.account.expiresAt), inline: true },
                    { name: "Device", value: result.account.deviceId ? "Bound" : "Not bound", inline: true }
                );
            return interaction.editReply({ embeds: [embed] });
        }
    } catch (error) {
        const message = error.name === "AbortError" ? "The NYX website did not respond in time." : error.message;
        if (interaction.deferred || interaction.replied) return interaction.editReply({ content: `Request failed: ${message}` });
        return interaction.reply({ content: `Request failed: ${message}`, ephemeral: true });
    }
});

client.login(CONFIG.TOKEN);
