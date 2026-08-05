"use strict";

const { EmbedBuilder } = require("discord.js");
const { formatTimestamp, licenseState } = require("./util");
const { callAuthApi } = require("./api");

function nyxEmbed(title, description = null) {
    const embed = new EmbedBuilder().setColor(0xdededa).setTitle(title).setTimestamp().setFooter({ text: "NYX account services" });
    if (description) embed.setDescription(description);
    return embed;
}

function errorEmbed(message) {
    return nyxEmbed("Request failed", message).setColor(0xb85c64);
}

function licenseEmbed(license, title = "NYX license") {
    return nyxEmbed(title).addFields(
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

function securityAlertEmbed(alert) {
    const title =
        {
            device_ban: "HWID banned",
            device_unban: "HWID ban lifted",
            token_replay: "Refresh-token replay",
            sharing: "License sharing detected"
        }[alert.kind] || "Security alert";
    const embed = nyxEmbed(`⚠️ ${title}`, alert.message).addFields({
        name: "Time",
        value: `<t:${Math.floor(Number(alert.createdAt))}:F>`,
        inline: false
    });
    if (alert.details) {
        try {
            const parsed = JSON.parse(alert.details);
            const lines = Object.entries(parsed)
                .map(([key, value]) => `**${key}:** \`${value}\``)
                .join("\n");
            if (lines) embed.addFields({ name: "Details", value: lines.slice(0, 1000), inline: false });
        } catch {
            /* ignore malformed details */
        }
    }
    return embed;
}

function notificationEmbed(notification) {
    const title = notification.kind === "release" ? "NYX release available" : "NYX account notice";
    return nyxEmbed(title, notification.message);
}

function expiringReminderEmbed(license, hoursLeft) {
    return nyxEmbed(
        "NYX license expiring soon",
        `Your NYX license (${license.username}) expires in approximately **${hoursLeft} hour${hoursLeft === 1 ? "" : "s"}** (${formatTimestamp(license.expiresAt)}). Renew before it lapses to keep your access active.`
    );
}

/** Shared daily / digest snapshot used by /daily, /digest, and the scheduled poster. */
async function buildDailySummaryEmbed(actorId = "system") {
    const [statsResult, expiringResult] = await Promise.all([
        callAuthApi("/api/bot/keys", { action: "stats", actorId }),
        callAuthApi("/api/bot/expiring", { windowSeconds: 72 * 60 * 60 }).catch(() => ({ expiring: [] }))
    ]);
    const stats = statsResult.stats;
    const expiringSoon = (expiringResult.expiring || []).slice(0, 8);
    const embed = nyxEmbed("Daily NYX summary", `Snapshot at ${formatTimestamp(Math.floor(Date.now() / 1000))}`).addFields(
        { name: "Total licenses", value: String(stats.total), inline: true },
        { name: "Active", value: String(stats.active), inline: true },
        { name: "Unused", value: String(stats.unused), inline: true },
        { name: "Paused", value: String(stats.paused), inline: true },
        { name: "Expired", value: String(stats.expired), inline: true },
        { name: "Revoked", value: String(stats.revoked), inline: true }
    );
    if (expiringSoon.length) {
        embed.addFields({
            name: "Expiring within 72h",
            value: expiringSoon.map((entry) => `\`${entry.keyPreview ?? entry.username}\` — ${formatTimestamp(entry.expiresAt)}`).join("\n")
        });
    }
    return embed;
}

module.exports = {
    nyxEmbed,
    errorEmbed,
    licenseEmbed,
    securityAlertEmbed,
    notificationEmbed,
    expiringReminderEmbed,
    buildDailySummaryEmbed
};
