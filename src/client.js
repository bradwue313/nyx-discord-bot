"use strict";

const { Client, GatewayIntentBits } = require("discord.js");

// Single shared client instance. Modules import this so there is exactly one
// gateway connection for the whole bot.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

module.exports = { client };
