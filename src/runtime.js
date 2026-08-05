"use strict";

// Small shared runtime facts (uptime anchors, process health). Set once at
// boot and read by commands such as /health.
const runtime = {
    startedAt: Date.now()
};

module.exports = { runtime };
