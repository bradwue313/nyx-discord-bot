"use strict";

// ESLint flat config (ESLint 9+).
module.exports = [
    {
        ignores: [
            "node_modules/**",
            "package-lock.json",
            "giveaways.json",
            "allowed_roles.json",
            "allowed_servers.json",
            "expiry_reminders.json",
            "giveaway_cooldowns.json"
        ]
    },
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "commonjs",
            globals: {
                process: "readonly",
                console: "readonly",
                Buffer: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                fetch: "readonly",
                AbortController: "readonly",
                AbortSignal: "readonly",
                URL: "readonly",
                require: "readonly",
                module: "readonly",
                __dirname: "readonly"
            }
        },
        rules: {
            "no-undef": "error",
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }],
            "no-constant-condition": "error",
            "no-dupe-keys": "error",
            "no-dupe-args": "error",
            "no-else-return": "warn",
            "prefer-const": "warn",
            "no-var": "warn",
            eqeqeq: ["warn", "smart"]
        }
    }
];
