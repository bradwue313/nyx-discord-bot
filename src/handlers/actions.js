"use strict";

const crypto = require("crypto");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { client } = require("../client");
const { nyxEmbed, errorEmbed } = require("../embeds");
const { callAuthApi } = require("../api");
const { isBotOwner, isAdministrator, logDenied } = require("../access");
const { sendAudit } = require("../audit");
const state = require("../state");
const { registerGuildCommands } = require("../registration");

const CONFIRM_LABELS = {
    revoke: "revoke this license",
    reset: "reset its device",
    pause: "pause this license",
    resume: "resume this license"
};

function confirmationRow(id) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`nyx_confirm:${id}`).setLabel("Confirm").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`nyx_cancel:${id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    );
}

/**
 * Ask the user to confirm a destructive action. The pending record expires
 * after 60 seconds and is scoped to the same user and guild.
 */
async function requestConfirmation(interaction, action, key, options = {}) {
    const id = crypto.randomUUID();
    const pending = { action, userId: interaction.user.id, guildId: interaction.guildId, expiresAt: Date.now() + 60_000 };
    if (key !== undefined) pending.key = key;
    if (options.message !== undefined) pending.message = options.message;
    state.pendingActions.set(id, pending);
    const description =
        options.description || `Are you sure you want to **${CONFIRM_LABELS[action]}**?\n\n\`${key.slice(0, 8)}…${key.slice(-8)}\``;
    return interaction.reply({
        embeds: [nyxEmbed(options.title || "Confirm license action", description)],
        components: [confirmationRow(id)],
        ephemeral: true
    });
}

// ---------------------------------------------------------------------------
// /keyrevoke, /keyreset, /keypause, /keyresume — confirmed license actions
// ---------------------------------------------------------------------------

const confirmationActions = { keyrevoke: "revoke", keyreset: "reset", keypause: "pause", keyresume: "resume" };

async function confirmAction(interaction) {
    if (!isAdministrator(interaction.member))
        return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
    return requestConfirmation(interaction, confirmationActions[interaction.commandName], interaction.options.getString("key").trim());
}

// ---------------------------------------------------------------------------
// /keyextend, /keynote — direct license updates
// ---------------------------------------------------------------------------

async function keyextend(interaction) {
    if (!isAdministrator(interaction.member))
        return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const result = await callAuthApi("/api/bot/keys", {
        action: "extend",
        key: interaction.options.getString("key").trim(),
        duration: interaction.options.getString("duration"),
        actorId: interaction.user.id
    });
    await sendAudit("License extended", interaction, result.message);
    return interaction.editReply({ embeds: [nyxEmbed("License updated", result.message)] });
}

async function keynote(interaction) {
    if (!isAdministrator(interaction.member))
        return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const result = await callAuthApi("/api/bot/keys", {
        action: "note",
        key: interaction.options.getString("key").trim(),
        note: interaction.options.getString("note"),
        actorId: interaction.user.id
    });
    await sendAudit("License note updated", interaction, result.message);
    return interaction.editReply({ embeds: [nyxEmbed("License updated", result.message)] });
}

// ---------------------------------------------------------------------------
// /notifyall — broadcast announcement, gated behind confirmation because it
// DMs every account with release alerts enabled.
// ---------------------------------------------------------------------------

async function notifyall(interaction) {
    if (!isAdministrator(interaction.member))
        return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
    const message = interaction.options.getString("message");
    return requestConfirmation(interaction, "notifyall", undefined, {
        title: "Confirm announcement",
        description: `Are you sure you want to DM **every account with release alerts enabled**?\n\n> ${message}`,
        message
    });
}

// ---------------------------------------------------------------------------
// /notifyuser — queue a DM for one linked user
// ---------------------------------------------------------------------------

async function notifyuser(interaction) {
    if (!isAdministrator(interaction.member))
        return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const discordId = interaction.options.getString("userid").trim();
    const message = interaction.options.getString("message");
    if (!/^\d{15,20}$/u.test(discordId)) {
        return interaction.editReply({ embeds: [errorEmbed("Enter a valid Discord user ID.")] });
    }
    await callAuthApi("/api/bot/notifications", { action: "direct", discordId, message });
    await sendAudit("Direct notification", interaction, `Queued DM for ${discordId}`);
    return interaction.editReply({
        embeds: [nyxEmbed("Notification queued", `A DM will be delivered to <@${discordId}> via the website notification queue.`)]
    });
}

// ---------------------------------------------------------------------------
// /owner — server allowlist management (bot owner only)
// ---------------------------------------------------------------------------

async function owner(interaction) {
    if (!isBotOwner(interaction.user.id)) {
        logDenied(interaction, "not a bot owner");
        return interaction.reply({ embeds: [errorEmbed("This command is reserved for the bot owner.")], ephemeral: true });
    }
    const action = interaction.options.getString("action");
    if (action === "list") {
        const list = state.getAllowedServers().size
            ? [...state.getAllowedServers()].map((id) => `\`${id}\``).join("\n")
            : "No servers allowed yet.";
        return interaction.reply({ embeds: [nyxEmbed("Allowed servers", list)], ephemeral: true });
    }
    const serverId = interaction.options.getString("serverid")?.trim();
    if (!serverId || !/^\d{15,20}$/u.test(serverId)) {
        return interaction.reply({ embeds: [errorEmbed("Enter a valid Discord guild ID.")], ephemeral: true });
    }
    if (action === "allow") {
        state.addAllowedServer(serverId);
        // Defer before the (slow) per-guild command registration REST call so
        // the reply always lands inside Discord's interaction window.
        await interaction.deferReply({ ephemeral: true });
        await registerGuildCommands(serverId);
        await sendAudit("Server allowlisted", interaction, `\`${serverId}\` is now on the allowlist.`);
        return interaction.editReply({ embeds: [nyxEmbed("Server allowed", `\`${serverId}\` is now on the allowlist.`)] });
    }
    if (action === "deny") {
        state.removeAllowedServer(serverId);
        const guild = client.guilds.cache.get(serverId);
        if (guild) await guild.leave().catch(() => {});
        await sendAudit("Server denied", interaction, `\`${serverId}\` was removed from the allowlist.`);
        return interaction.reply({
            embeds: [nyxEmbed("Server denied", `\`${serverId}\` was removed from the allowlist.`)],
            ephemeral: true
        });
    }
    return interaction.reply({ embeds: [errorEmbed("Unknown owner action.")], ephemeral: true });
}

module.exports = {
    confirmationRow,
    requestConfirmation,
    keyrevoke: confirmAction,
    keyreset: confirmAction,
    keypause: confirmAction,
    keyresume: confirmAction,
    keyextend,
    keynote,
    notifyall,
    notifyuser,
    owner
};
