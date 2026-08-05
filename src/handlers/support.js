"use strict";

const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { client } = require("../client");
const { CONFIG } = require("../config");
const { nyxEmbed, errorEmbed } = require("../embeds");
const { callAuthApi } = require("../api");
const { ticketChannelName } = require("../util");
const { isAdministrator } = require("../access");
const { sendAudit } = require("../audit");
const { ticketCloseRow } = require("../tickets");
const { giveawayRow } = require("../giveaways");
const state = require("../state");

// ---------------------------------------------------------------------------
// /ticket — private support channel
// ---------------------------------------------------------------------------

async function ticket(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ embeds: [errorEmbed("Tickets can only be opened inside a server.")], ephemeral: true });
    }
    if (!CONFIG.TICKET_CATEGORY_ID) {
        return interaction.reply({
            embeds: [errorEmbed("Ticket support is not configured. Ask an administrator to set `TICKET_CATEGORY_ID`.")],
            ephemeral: true
        });
    }
    await interaction.deferReply({ ephemeral: true });
    const category = await interaction.guild.channels.fetch(CONFIG.TICKET_CATEGORY_ID).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
        return interaction.editReply({
            embeds: [errorEmbed("Ticket support is misconfigured. Ask an administrator to set a valid `TICKET_CATEGORY_ID`.")]
        });
    }
    const existing = interaction.guild.channels.cache.find(
        (channel) =>
            channel.parentId === category.id &&
            channel.name === ticketChannelName(interaction.user.username) &&
            channel.permissionOverwrites?.cache?.has(interaction.user.id)
    );
    if (existing) {
        return interaction.editReply({ embeds: [nyxEmbed("Ticket already open", `You already have an open ticket: ${existing}`)] });
    }
    const overwrites = [
        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
            id: interaction.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks
            ]
        },
        {
            id: client.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.EmbedLinks
            ]
        }
    ];
    for (const role of interaction.guild.roles.cache.values()) {
        if (role.id === interaction.guild.id) continue;
        if (!role.permissions.has(PermissionFlagsBits.Administrator)) continue;
        overwrites.push({
            id: role.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks
            ]
        });
    }
    let ticketChannel;
    try {
        ticketChannel = await interaction.guild.channels.create({
            name: ticketChannelName(interaction.user.username),
            type: ChannelType.GuildText,
            parent: category.id,
            topic: `Support ticket for ${interaction.user.username} (${interaction.user.id})`,
            permissionOverwrites: overwrites,
            reason: `Ticket opened by ${interaction.user.username}`
        });
    } catch (error) {
        console.error(`[NYX BOT] Could not create ticket channel: ${error.message}`);
        return interaction.editReply({
            embeds: [errorEmbed("Could not create the ticket channel. Check the bot's Manage Channels permission and category access.")]
        });
    }
    await ticketChannel.send({
        content: `${interaction.user}`,
        embeds: [
            nyxEmbed("Support ticket", `Thanks ${interaction.user}. Staff will respond here. Use the button below when you are finished.`)
        ],
        components: [ticketCloseRow(interaction.user.id)]
    });
    await sendAudit("Ticket opened", interaction, `Channel ${ticketChannel} for ${interaction.user.username}`);
    return interaction.editReply({ embeds: [nyxEmbed("Ticket created", `Your private ticket is ready: ${ticketChannel}`)] });
}

// ---------------------------------------------------------------------------
// /giveaway — drop giveaway keys with a claim button
// ---------------------------------------------------------------------------

async function giveaway(interaction) {
    if (!isAdministrator(interaction.member))
        return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
    if (interaction.guildId && CONFIG.GIVEAWAY_COOLDOWN_MINUTES > 0) {
        const lastAt = Number(state.getLastGiveawayAt()[interaction.guildId] || 0);
        const elapsedMs = Date.now() - lastAt;
        const cooldownMs = CONFIG.GIVEAWAY_COOLDOWN_MINUTES * 60_000;
        if (lastAt && elapsedMs < cooldownMs) {
            const waitMinutes = Math.ceil((cooldownMs - elapsedMs) / 60_000);
            return interaction.reply({
                embeds: [
                    errorEmbed(
                        `Giveaways are on cooldown in this server. Try again in **${waitMinutes} minute${waitMinutes === 1 ? "" : "s"}**.`
                    )
                ],
                ephemeral: true
            });
        }
    }
    await interaction.deferReply({ ephemeral: true });
    const duration = interaction.options.getString("duration");
    let count = interaction.options.getInteger("count") || 1;
    const capped = count > CONFIG.GIVEAWAY_MAX_KEYS;
    count = Math.min(count, CONFIG.GIVEAWAY_MAX_KEYS);
    const result = await callAuthApi("/api/bot/keys", {
        action: "generate",
        duration,
        amount: count,
        createdBy: interaction.user.username,
        actorId: interaction.user.id
    });
    // Record the cooldown only after generation succeeds, so a failed
    // giveaway (website down, maintenance) does not burn the server's window.
    state.getLastGiveawayAt()[interaction.guildId] = Date.now();
    state.queueGiveawaySave();
    const message = await interaction.editReply({
        embeds: [
            nyxEmbed(
                "NYX key giveaway",
                `Claim a **${duration.toUpperCase()}** license key below. **${result.keys.length}** available — first come, first served. Keys are delivered by DM.`
            )
        ],
        components: [giveawayRow("pending")]
    });
    // Re-post with a real message id so claim buttons can find the embed.
    await message.delete().catch(() => {});
    const posted = await interaction.channel.send({
        embeds: [
            nyxEmbed(
                "NYX key giveaway",
                `Claim a **${duration.toUpperCase()}** license key below. **${result.keys.length}** available — first come, first served. Keys are delivered by DM.`
            )
        ],
        components: [giveawayRow("pending")]
    });
    state.getGiveaways().set(posted.id, {
        keys: result.keys,
        claimed: [],
        duration,
        guildId: interaction.guildId,
        channelId: interaction.channel.id
    });
    state.queueGiveawaySave();
    await posted.edit({ components: [giveawayRow(posted.id)] });
    await sendAudit("Giveaway started", interaction, `${result.keys.length} × ${duration}`);
    const followUpText =
        `Giveaway started with **${result.keys.length}** key${result.keys.length === 1 ? "" : "s"}. Claim button is live in this channel.` +
        (capped
            ? ` (Requested ${interaction.options.getInteger("count")} — capped at the server max of ${CONFIG.GIVEAWAY_MAX_KEYS}.)`
            : "");
    return interaction.followUp({ embeds: [nyxEmbed("Giveaway posted", followUpText)], ephemeral: true });
}

module.exports = { ticket, giveaway };
