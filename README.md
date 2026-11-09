# Codex Telegram Bridge

Control selected local Codex Desktop chats from a paired Telegram account. The bridge provides chat navigation, final replies, optional progress, files, effort settings, and supported native questions and approvals.

## Ubuntu Desktop

Install the official ChatGPT desktop app, Node.js 24.5 or later, and bubblewrap. From this checkout, run `node --use-env-proxy ubuntu/setup.mjs`. The installer prompts for an existing local chat and pairs the bot. Follow the [Persian setup guide](README-Ubuntu.fa.md) from the setup step onward.

Use one active service per Telegram bot token. The Ubuntu doctor checks live service and desktop connectivity. Ubuntu Desktop and keyring compatibility still need validation on the target machine.

## Bot language

Open `/menu` → Settings → Bot language and choose **فارسی** or **English**. Persian remains the default. The saved choice applies to this bot’s menus, help, notices, and approval controls across chats. ChatGPT replies, chat titles, original questions/options, and file contents keep their own language. Previously sent Telegram messages keep their original text.

## Windows source

The Windows launcher, broker, supervisor, and installation helpers are retained as source. Fresh Windows provisioning requires local Codex paths, a qualified build, and locally prepared DPAPI pairing files. The installed Windows configuration is machine-specific.

## Tests

Run `node --test`. The Unix socket and credential-permissions test runs on Linux.
