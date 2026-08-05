"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { ticketChannelName } = require("./util");

function ticketCloseRow(openerId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`nyx_ticket_close:${openerId}`).setLabel("Close ticket").setStyle(ButtonStyle.Danger)
    );
}

module.exports = { ticketChannelName, ticketCloseRow };
