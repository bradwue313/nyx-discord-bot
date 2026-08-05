"use strict";

const { nyxEmbed, errorEmbed } = require("./embeds");
const { callAuthApi } = require("./api");
const { formatTimestamp } = require("./util");
const { isAllowedGuild, isAdministrator, logDenied } = require("./access");
const { sendAudit } = require("./audit");
const { handleGiveawayClaim } = require("./giveaways");
const state = require("./state");

async function handleButton(interaction) {
    const [prefix, id] = interaction.customId.split(":");
    if (!id || !["nyx_confirm", "nyx_cancel", "nyx_giveaway", "nyx_ticket_close", "nyx_panel_status"].includes(prefix)) return;
    // Buttons are subject to the same server allowlist as commands.
    if (interaction.guildId && !isAllowedGuild(interaction.guildId)) {
        logDenied(interaction, "server not on allowlist");
        return interaction.reply({ embeds: [errorEmbed("Commands are not enabled in this server.")], ephemeral: true });
    }
    if (prefix === "nyx_giveaway") return handleGiveawayClaim(interaction, id);
    if (prefix === "nyx_panel_status") {
        if (id !== interaction.user.id)
            return interaction.reply({ embeds: [errorEmbed("This panel belongs to another user.")], ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        const result = await callAuthApi("/api/bot/status", { discordId: interaction.user.id });
        if (!result.linked) {
            return interaction.editReply({
                embeds: [nyxEmbed("Account not linked", "Sign in on the website and connect Discord before launching.")]
            });
        }
        return interaction.editReply({
            embeds: [
                nyxEmbed("Your NYX access").addFields(
                    { name: "Account", value: result.username || "Linked", inline: true },
                    { name: "License", value: String(result.status || result.reason || "unknown"), inline: true },
                    { name: "Expires", value: result.expiresAt ? formatTimestamp(result.expiresAt) : "Lifetime", inline: true }
                )
            ]
        });
    }
    if (prefix === "nyx_ticket_close") {
        const openerId = id;
        const isOpener = interaction.user.id === openerId;
        const isStaff = isAdministrator(interaction.member);
        if (!isOpener && !isStaff) {
            return interaction.reply({
                embeds: [errorEmbed("Only the ticket opener or an administrator can close this ticket.")],
                ephemeral: true
            });
        }
        await interaction.reply({ embeds: [nyxEmbed("Closing ticket", "This channel will be deleted shortly.")], ephemeral: true });
        try {
            await interaction.channel?.delete(`Ticket closed by ${interaction.user.username}`);
        } catch (error) {
            console.error(`[NYX BOT] Could not delete ticket channel: ${error.message}`);
            return interaction
                .followUp({
                    embeds: [errorEmbed("Could not delete this channel. Check the bot's Manage Channels permission.")],
                    ephemeral: true
                })
                .catch(() => {});
        }
        return;
    }
    const pending = state.pendingActions.get(id);
    if (!pending || pending.userId !== interaction.user.id || pending.guildId !== interaction.guildId || pending.expiresAt < Date.now()) {
        state.pendingActions.delete(id);
        return interaction.reply({
            embeds: [errorEmbed("This confirmation expired or is not valid here. Run the command again.")],
            ephemeral: true
        });
    }
    state.pendingActions.delete(id);
    if (prefix === "nyx_cancel") {
        return interaction.update({ embeds: [nyxEmbed("Action cancelled", "No license changes were made.")], components: [] });
    }
    if (!isAdministrator(interaction.member)) {
        return interaction.update({ embeds: [errorEmbed("Administrator permission is required.")], components: [] });
    }
    await interaction.deferUpdate();
    if (pending.action === "notifyall") {
        const result = await callAuthApi("/api/bot/notifications", { action: "broadcast", message: pending.message });
        await sendAudit("Broadcast announcement", interaction, `Queued ${result.recipients} DM notifications`);
        return interaction.editReply({
            embeds: [
                nyxEmbed(
                    "Announcement queued",
                    `The message will be delivered to **${result.recipients}** accounts with release alerts enabled.`
                )
            ],
            components: []
        });
    }
    const result = await callAuthApi("/api/bot/keys", { action: pending.action, key: pending.key, actorId: interaction.user.id });
    await sendAudit(`License ${pending.action}`, interaction, result.message);
    return interaction.editReply({ embeds: [nyxEmbed("License updated", result.message)], components: [] });
}

module.exports = { handleButton };
