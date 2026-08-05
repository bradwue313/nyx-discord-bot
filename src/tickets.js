"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { client } = require("./client");
const { CONFIG } = require("./config");
const { nyxEmbed } = require("./embeds");
const { ticketChannelName } = require("./util");

function ticketCloseRow(openerId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`nyx_ticket_close:${openerId}`).setLabel("Close ticket").setStyle(ButtonStyle.Danger)
    );
}

/**
 * Fetch a channel's messages and build a plain-text transcript plus a count.
 * Runs before the channel is deleted, so the archive survives the close.
 */
async function buildTicketTranscript(channel, limit = 200) {
    const messages = await channel.messages.fetch({ limit }).catch(() => null);
    if (!messages || !messages.size) return null;
    const lines = [];
    for (const message of [...messages.values()].reverse()) {
        if (message.system) continue;
        const stamp = new Date(message.createdTimestamp).toISOString();
        let content = message.content || "";
        if (message.attachments.size) {
            const names = [...message.attachments.values()].map((attachment) => attachment.name).join(", ");
            content += content ? `\n[attachment: ${names}]` : `[attachment: ${names}]`;
        }
        if (content.trim()) lines.push(`[${stamp}] ${message.author.username}: ${content.trim()}`);
    }
    if (!lines.length) return null;
    return { text: lines.join("\n"), count: lines.length };
}

/**
 * Archive a closing ticket to TICKET_TRANSCRIPT_CHANNEL_ID (falling back to
 * the audit channel) as a text file plus a summary embed. Best effort — never
 * blocks the close.
 */
async function postTicketTranscript(channel, closer) {
    const targetChannelId = CONFIG.TICKET_TRANSCRIPT_CHANNEL_ID || CONFIG.AUDIT_LOG_CHANNEL_ID;
    if (!targetChannelId) return;
    try {
        const transcript = await buildTicketTranscript(channel);
        if (!transcript) return;
        const target = await client.channels.fetch(targetChannelId);
        if (!target?.isTextBased()) return;
        const openedMs = channel.createdTimestamp ? Date.now() - channel.createdTimestamp : null;
        const duration = openedMs != null ? `${Math.max(0, Math.round(openedMs / 60_000))} min` : "unknown";
        const embed = nyxEmbed("Ticket closed").addFields(
            { name: "Channel", value: channel.name, inline: true },
            { name: "Closed by", value: closer, inline: true },
            { name: "Messages", value: String(transcript.count), inline: true },
            { name: "Open duration", value: duration, inline: true }
        );
        await target.send({
            embeds: [embed],
            files: [{ attachment: Buffer.from(transcript.text, "utf8"), name: `transcript-${channel.name}-${Date.now()}.txt` }]
        });
    } catch (error) {
        console.error(`[NYX BOT] Could not post ticket transcript: ${error.message}`);
    }
}

module.exports = { ticketChannelName, ticketCloseRow, postTicketTranscript };
