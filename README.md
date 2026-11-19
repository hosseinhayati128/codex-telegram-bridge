# Codex Telegram Bridge

Control selected local Codex Desktop chats from a paired Telegram account. The bridge provides chat navigation, final replies, optional progress, files, effort settings, and supported native questions and approvals.

## Ubuntu Desktop

Install the official ChatGPT desktop app, Node.js 24.5 or later, and bubblewrap. From this checkout, run `node --use-env-proxy ubuntu/setup.mjs`. The installer prompts for an existing local chat and pairs the bot. Follow the [Persian setup guide](README-Ubuntu.fa.md) from the setup step onward.

Use one active service per Telegram bot token. The Ubuntu doctor checks live service and desktop connectivity. Ubuntu Desktop and keyring compatibility still need validation on the target machine.

## Ubuntu startup and app updates

After setup, run `node ubuntu/refresh.mjs` once. It installs a user-level `chatgpt.desktop` entry, so the normal ChatGPT icon uses `start-codex`; the system desktop file is unchanged. Fully quit an already-running app once, then reopen it. Opening another window of an existing unbridged process cannot enable the bridge.

The launcher runs the same preflight on later starts. It repairs a removed App Tools cache path using the installed package and keeps the existing bot pairing, chats, proxy service override, and language/model preferences. If the bundled CLI changes, preflight accepts a new fingerprint only for a protected root-owned file listed by the ChatGPT package, after sandbox-isolation, initialization, and read-only model-list checks pass. Custom executables are not accepted automatically. This is a startup compatibility check; unsupported native request shapes still stay on the desktop.

`node ubuntu/doctor.mjs` now distinguishes missing adapters, changed CLI fingerprints, and a missing live desktop link. It prints a recovery command instead of reporting only that Codex is unavailable. Stale sockets are discarded; the service never guesses another socket to send commands to.

To undo the icon integration, restore `private/chatgpt.desktop.before-bridge` to `~/.local/share/applications/chatgpt.desktop` if a prior user entry was backed up. Otherwise remove only that user desktop entry. The system app launcher remains available through `chatgpt`.

## Model selection

Open `/menu` → Settings → Model, or send `/model`, to choose a model for the displayed chat. The saved override applies from its next Telegram text or file message; changing the preference does not run a model turn. Choices come from Codex’s local visible model catalog. An incompatible saved effort override is cleared, and `/effort` shows compatible levels. Use the Codex-default button or `/model default` to stop overriding the current chat setting. The desktop validates model access when a message is sent.

## Bot language

Open `/menu` → Settings → Bot language and choose **فارسی** or **English**. Persian remains the default. The saved choice applies to this bot’s menus, help, notices, and approval controls across chats. ChatGPT replies, chat titles, original questions/options, and file contents keep their own language. Previously sent Telegram messages keep their original text.

## Windows source

The Windows launcher, broker, supervisor, and installation helpers are retained as source. Fresh Windows provisioning requires local Codex paths, a qualified build, and locally prepared DPAPI pairing files. The installed Windows configuration is machine-specific.

On Windows, the service and relay rediscover the registered Codex Store package at startup. If an app update removes the saved CLI or App Tools adapter, the service also retries discovery when reconnecting. A changed CLI is accepted only from the registered OpenAI.Codex Store package under WindowsApps after a Windows sandbox command, app-server initialization, and a read-only model-list check succeed. The refresh affects the running configuration, so the installation receipt and rollback hashes remain valid. Custom CLI installations use their explicitly qualified configuration.

## Tests

Run `node --test`. The Unix socket and credential-permissions test runs on Linux.
