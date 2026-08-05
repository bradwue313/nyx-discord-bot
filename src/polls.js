"use strict";

const { client } = require("./client");
const { CONFIG } = require("./config");
const { callAuthApi } = require("./api");
const { securityAlertEmbed, notificationEmbed, expiringReminderEmbed } = require("./embeds");
const { makeBackoff } = require("./util");
const state = require("./state");

const MAX_DELIVERY_ATTEMPTS = 5;

// Backoff per poller: while the website is unreachable, polling pauses with an
// exponential delay (capped) instead of hammering the API every tick and
// spamming the logs thousands of times a day.
const notificationBackoff = makeBackoff(60_000, 30 * 60_000);
const expiryBackoff = makeBackoff(6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000);
const securityAlertBackoff = makeBackoff(15_000, 15 * 60_000);

const lastPoll = {
    notifications: 0,
    expiries: 0,
    securityAlerts: 0
};

let notificationPollActive = false;
let expiryPollActive = false;
let securityAlertPollActive = false;

function pollHealth() {
    return { ...lastPoll };
}

async function pollNotifications() {
    if (notificationPollActive || !client.isReady()) return;
    if (!notificationBackoff.allow()) return;
    notificationPollActive = true;
    lastPoll.notifications = Date.now();
    try {
        const { notifications = [] } = await callAuthApi("/api/bot/notifications", { action: "poll" });
        if (notificationBackoff.success()) console.log("[NYX BOT] Notification poll recovered");
        const deliveredIds = [];
        for (const notification of notifications) {
            const key = `notify:${notification.id}`;
            try {
                const user = await client.users.fetch(notification.discordId);
                await user.send({ embeds: [notificationEmbed(notification)] });
                deliveredIds.push(notification.id);
                state.clearDeliveryFailure(key);
            } catch (error) {
                const attempts = state.recordDeliveryFailure(key);
                if (attempts >= MAX_DELIVERY_ATTEMPTS) {
                    // Acknowledge so the queue does not pin forever on a user
                    // who cannot receive DMs; staff still see the failure log.
                    deliveredIds.push(notification.id);
                    state.clearDeliveryFailure(key);
                    console.warn(
                        `[NYX BOT] Gave up delivering notification ${notification.id} to ${notification.discordId} after ${attempts} attempts (DMs likely closed)`
                    );
                } else {
                    console.error(`[NYX BOT] Could not deliver notification ${notification.id}: ${error.message}`);
                }
            }
        }
        if (deliveredIds.length) {
            await callAuthApi("/api/bot/notifications", { action: "ack", ids: deliveredIds });
        }
    } catch (error) {
        notificationBackoff.failure();
        console.error(`[NYX BOT] Notification poll failed: ${error.message}`);
    } finally {
        notificationPollActive = false;
    }
}

async function pollExpiryReminders() {
    if (expiryPollActive || !client.isReady()) return;
    if (!expiryBackoff.allow()) return;
    expiryPollActive = true;
    lastPoll.expiries = Date.now();
    try {
        const { expiring = [] } = await callAuthApi("/api/bot/expiring", { windowSeconds: 72 * 60 * 60 });
        if (expiryBackoff.success()) console.log("[NYX BOT] Expiry reminder poll recovered");
        const now = Math.floor(Date.now() / 1000);
        for (const license of expiring) {
            const announced = state.announcedExpiries[license.licenseId];
            if (announced === license.expiresAt) continue;
            const key = `expiry:${license.licenseId}`;
            try {
                const user = await client.users.fetch(license.discordId);
                const hoursLeft = Math.max(1, Math.ceil((Number(license.expiresAt) - now) / 3600));
                await user.send({ embeds: [expiringReminderEmbed(license, hoursLeft)] });
                state.announcedExpiries[license.licenseId] = license.expiresAt;
                state.saveAnnouncedExpiries();
                state.clearDeliveryFailure(key);
            } catch (error) {
                const attempts = state.recordDeliveryFailure(key);
                if (attempts >= MAX_DELIVERY_ATTEMPTS) {
                    // Stop retrying so the reminder is not sent forever; the
                    // license still appears in the daily digest for staff.
                    state.announcedExpiries[license.licenseId] = license.expiresAt;
                    state.saveAnnouncedExpiries();
                    state.clearDeliveryFailure(key);
                    console.warn(`[NYX BOT] Gave up sending expiry reminder for ${license.licenseId} (DMs likely closed)`);
                } else {
                    console.error(`[NYX BOT] Could not send expiry reminder for ${license.licenseId}: ${error.message}`);
                }
            }
        }
    } catch (error) {
        expiryBackoff.failure();
        console.error(`[NYX BOT] Expiry reminder poll failed: ${error.message}`);
    } finally {
        expiryPollActive = false;
    }
}

async function pollSecurityAlerts() {
    if (securityAlertPollActive || !client.isReady()) return;
    if (!securityAlertBackoff.allow()) return;
    securityAlertPollActive = true;
    lastPoll.securityAlerts = Date.now();
    try {
        const { alerts = [] } = await callAuthApi("/api/bot/alerts", { action: "poll" });
        if (securityAlertBackoff.success()) console.log("[NYX BOT] Security alert poll recovered");
        const acked = [];
        for (const alert of alerts) {
            const embed = securityAlertEmbed(alert);
            if (CONFIG.AUDIT_LOG_CHANNEL_ID) {
                try {
                    const channel = await client.channels.fetch(CONFIG.AUDIT_LOG_CHANNEL_ID);
                    if (channel?.isTextBased()) await channel.send({ embeds: [embed] });
                } catch (error) {
                    console.error(`[NYX BOT] Could not post security alert to audit channel: ${error.message}`);
                }
            }
            for (const ownerId of CONFIG.BOT_OWNER_IDS) {
                try {
                    const owner = await client.users.fetch(ownerId);
                    await owner.send({ embeds: [embed] });
                } catch (error) {
                    console.error(`[NYX BOT] Could not DM owner ${ownerId}: ${error.message}`);
                }
            }
            acked.push(alert.id);
        }
        if (acked.length) {
            await callAuthApi("/api/bot/alerts", { action: "ack", ids: acked });
        }
    } catch (error) {
        securityAlertBackoff.failure();
        if (securityAlertBackoff.failures() <= 3 || securityAlertBackoff.failures() % 10 === 0) {
            console.error(`[NYX BOT] Security alert poll failed: ${error.message}`);
        }
    } finally {
        securityAlertPollActive = false;
    }
}

function startPolls() {
    // Run once shortly after startup, then on the fixed cadence. The backoff
    // gates each poller while the website is down.
    pollNotifications();
    pollExpiryReminders();
    pollSecurityAlerts();
    setInterval(pollNotifications, 60_000).unref();
    setInterval(pollExpiryReminders, 6 * 60 * 60 * 1000).unref();
    // Crack alerts are time-sensitive — poll every 15 seconds.
    setInterval(pollSecurityAlerts, 15_000).unref();
}

module.exports = { startPolls, pollHealth };
