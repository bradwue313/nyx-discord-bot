"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { CONFIG } = require("../config");
const { nyxEmbed } = require("../embeds");
const { callAuthApi, websiteHealth, fetchPublicStatus } = require("../api");
const { formatTimestamp } = require("../util");
const { runtime } = require("../runtime");
const { pollHealth } = require("../polls");

// ---------------------------------------------------------------------------
// /panel — account and support controls
// ---------------------------------------------------------------------------

async function panel(interaction) {
    const controls = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`nyx_panel_status:${interaction.user.id}`).setLabel("My access").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setLabel("Dashboard").setStyle(ButtonStyle.Link).setURL(`${CONFIG.AUTH_URL}/dashboard`),
        new ButtonBuilder().setLabel("Download").setStyle(ButtonStyle.Link).setURL(`${CONFIG.AUTH_URL}/download`),
        new ButtonBuilder().setLabel("Service status").setStyle(ButtonStyle.Link).setURL(`${CONFIG.AUTH_URL}/status`)
    );
    return interaction.reply({
        embeds: [nyxEmbed("NYX control panel", "Check access, open your account, download the current release, or review service health.")],
        components: [controls],
        ephemeral: true
    });
}

// ---------------------------------------------------------------------------
// /setup — guided setup checklist
// ---------------------------------------------------------------------------

async function setup(interaction) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Create account").setStyle(ButtonStyle.Link).setURL(`${CONFIG.AUTH_URL}/register`),
        new ButtonBuilder().setLabel("Open dashboard").setStyle(ButtonStyle.Link).setURL(`${CONFIG.AUTH_URL}/dashboard`),
        new ButtonBuilder().setLabel("Check status").setStyle(ButtonStyle.Link).setURL(`${CONFIG.AUTH_URL}/status`)
    );
    const embed = nyxEmbed("Set up NYX", "Complete these steps in order. You can come back to this checklist at any time.")
        .addFields(
            {
                name: "1  Create or sign in",
                value: "Register with your license, then secure the account with a unique password or passkey.",
                inline: false
            },
            {
                name: "2  Connect Discord",
                value: "Open the dashboard and connect the same Discord account you are using now.",
                inline: false
            },
            {
                name: "3  Verify access",
                value: "Run `/mystatus`. If your license is active, the dashboard can issue a short-lived one-time code.",
                inline: false
            }
        )
        .setFooter({ text: "NYX account services • Never share one-time codes" });
    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

// ---------------------------------------------------------------------------
// /privacy — privacy and account safety
// ---------------------------------------------------------------------------

async function privacy(interaction) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Privacy policy").setStyle(ButtonStyle.Link).setURL(`${CONFIG.AUTH_URL}/privacy`),
        new ButtonBuilder().setLabel("Account settings").setStyle(ButtonStyle.Link).setURL(`${CONFIG.AUTH_URL}/settings`),
        new ButtonBuilder().setLabel("Support").setStyle(ButtonStyle.Link).setURL(`${CONFIG.AUTH_URL}/support`)
    );
    const embed = nyxEmbed(
        "Privacy & account safety",
        "NYX bot responses keep account details private and redact sensitive identifiers."
    ).addFields(
        {
            name: "Never share",
            value: "Passwords, one-time codes, complete license keys, session tokens, or full device identifiers.",
            inline: false
        },
        {
            name: "Safe diagnostics",
            value: "Use the client's **Copy redacted report** action or the website support checklist. Review anything before sending it.",
            inline: false
        },
        {
            name: "Session control",
            value: "Review active sessions in account settings and revoke anything you do not recognize.",
            inline: false
        }
    );
    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

// ---------------------------------------------------------------------------
// /help — command overview
// ---------------------------------------------------------------------------

async function help(interaction) {
    const embed = nyxEmbed("NYX commands", "Use `/panel` for the common account and launch actions.").addFields(
        {
            name: "Account",
            value: "`/panel` `/setup` `/health` `/mystatus` `/redeem` `/download` `/link` `/privacy` `/ticket`",
            inline: false
        },
        { name: "License team", value: "`/keygen` `/keyinfo` `/keys` `/setgenrole`", inline: false },
        {
            name: "Administrators",
            value: "`/stats` `/daily` `/digest` `/status` `/userlookup` `/whois` `/notifyall` `/notifyuser` `/giveaway` `/keyrevoke` `/keyreset` `/keyextend` `/keypause` `/keyresume` `/keynote`",
            inline: false
        },
        { name: "Owner", value: "`/owner` — manage the server allowlist", inline: false }
    );
    return interaction.reply({ embeds: [embed], ephemeral: true });
}

// ---------------------------------------------------------------------------
// /health — website, authorization, and bot health
// ---------------------------------------------------------------------------

async function health(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const healthResult = await websiteHealth();
    const polls = pollHealth();
    return interaction.editReply({
        embeds: [
            nyxEmbed("NYX service health").addFields(
                { name: "Website", value: healthResult.online ? "ONLINE" : "UNREACHABLE", inline: true },
                { name: "Authorization", value: String(healthResult.status).toUpperCase(), inline: true },
                { name: "Address", value: CONFIG.AUTH_URL, inline: false },
                { name: "Bot uptime", value: `<t:${Math.floor(runtime.startedAt / 1000)}:R>`, inline: true },
                {
                    name: "Security alert feed",
                    value: polls.securityAlerts ? `Polled <t:${Math.floor(polls.securityAlerts / 1000)}:R>` : "Not polled yet",
                    inline: true
                }
            )
        ]
    });
}

// ---------------------------------------------------------------------------
// /mystatus — linked account, license, device
// ---------------------------------------------------------------------------

async function mystatus(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const result = await callAuthApi("/api/bot/status", { discordId: interaction.user.id });
    if (!result.linked)
        return interaction.editReply({
            embeds: [nyxEmbed("Discord not linked", "Sign in to the NYX website dashboard and choose **Connect Discord**.")]
        });
    const account = result.account;
    const launchReadiness = result.active
        ? account.deviceId
            ? "READY TO LAUNCH"
            : "Launch blocked — no device bound. Launch NYX once to bind your hardware."
        : {
              revoked: "Launch blocked — your license was revoked.",
              paused: "Launch blocked — your license is paused.",
              expired: "Launch blocked — your license has expired.",
              device_unbound: "Launch blocked — no device bound.",
              not_linked: "Launch blocked — Discord is not linked."
          }[result.reason] || "Launch blocked — see the dashboard.";
    return interaction.editReply({
        embeds: [
            nyxEmbed("Your NYX account").addFields(
                { name: "Website account", value: account.username, inline: true },
                { name: "License", value: result.active ? "ACTIVE" : account.pausedAt ? "PAUSED" : "INACTIVE", inline: true },
                { name: "Plan", value: account.duration.toUpperCase(), inline: true },
                { name: "Expires", value: account.duration === "lifetime" ? "Lifetime" : formatTimestamp(account.expiresAt), inline: true },
                { name: "Device", value: account.deviceId ? "Bound" : "Not bound", inline: true },
                { name: "Launch readiness", value: launchReadiness, inline: false },
                ...(account.deviceId
                    ? [
                          {
                              name: "Device reset",
                              value: `To reset your hardware binding, visit [Account settings](${CONFIG.AUTH_URL}/settings).`,
                              inline: false
                          }
                      ]
                    : []),
                { name: "Dashboard", value: CONFIG.AUTH_URL, inline: false }
            )
        ]
    });
}

// ---------------------------------------------------------------------------
// /redeem — validate a key and get the registration link
// ---------------------------------------------------------------------------

async function redeem(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const key = interaction.options.getString("key").trim();
    const result = await callAuthApi("/api/bot/keys", { action: "validate", key });
    if (!result.redeemable) {
        const reason =
            result.reason === "already_claimed"
                ? "This key is already attached to an account. Sign in on the dashboard to view it."
                : "This key is revoked or invalid.";
        return interaction.editReply({ embeds: [nyxEmbed("Key is not redeemable", reason)] });
    }
    const license = result.license;
    const expires = license.duration === "lifetime" ? "Lifetime" : formatTimestamp(license.expiresAt);
    return interaction.editReply({
        embeds: [
            nyxEmbed(
                "License ready to activate",
                `Key \`${license.keyPreview}\` is valid and unclaimed.\n\n**Duration:** ${license.duration.toUpperCase()}\n**Expires:** ${expires}\n\nActivate it here: ${CONFIG.AUTH_URL}/register?key=${encodeURIComponent(key)}`
            )
        ]
    });
}

// ---------------------------------------------------------------------------
// /download — client download link and version
// ---------------------------------------------------------------------------

async function download(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const snapshot = await fetchPublicStatus().catch(() => null);
    const version = snapshot?.metrics?.clientVersion;
    return interaction.editReply({
        embeds: [
            nyxEmbed("Download NYX client").addFields(
                { name: "Latest version", value: version ? `v${version}` : "Unknown", inline: true },
                { name: "Download", value: `${CONFIG.AUTH_URL}/download`, inline: false }
            )
        ]
    });
}

// ---------------------------------------------------------------------------
// /link — how to connect Discord
// ---------------------------------------------------------------------------

async function link(interaction) {
    return interaction.reply({
        embeds: [
            nyxEmbed(
                "Link your Discord account",
                "NYX uses your Discord account for license verification and launch codes.\n\n1. Sign in at the NYX dashboard\n2. Click **Connect Discord**\n3. Authorize the NYX application\n\nOnce linked, use `/mystatus` to verify your account."
            ).addFields({ name: "Dashboard", value: `${CONFIG.AUTH_URL}/dashboard`, inline: false })
        ],
        ephemeral: true
    });
}

module.exports = { panel, setup, privacy, help, health, mystatus, redeem, download, link };
