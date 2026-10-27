# GTA Chaos Live

GTA Chaos Live is a local Windows application that connects configured live-event inputs to controlled GTA V Story Mode effects. It includes a Tauri desktop shell, a WebSocket orchestrator, a React/Vite dashboard, an OBS browser-source overlay, a Python TikTokLive connector/simulator, and a C# ScriptHookVDotNet mod.

## Current status

The current experimental baseline is **v7 for GTA V Enhanced**.

- GTA V Enhanced `1.0.1158.16` was tested in Story Mode.
- Script Hook V `3889.0.1158.13` and ScriptHookVDotNet Enhanced `1.1.0.6` loaded successfully.
- The real mod authenticated as `client=gta`, `source=gta-mod`.
- `player.recover_health` executed in GTA and returned a real `succeeded` result.
- The result was received, validated, persisted, and published by the Node.js orchestrator without `ack_timeout`.
- v7 SHA-256: `15A42447F59302BC76342B23C11BC8CCDB5688E2DBB1DFEEE36858A0AA560392`.
- Dashboard HTTP routes and local WebSocket handshakes are verified.
- Overlay HTTP routes, authentication, snapshots, and ACK-gated alert logic are verified by automated smoke tests.
- Visual rendering in a browser or OBS has not yet been independently signed off.
- TikTok LIVE is not connected in the validated baseline.

This is an experimental Story Mode project. It is not intended for GTA Online and does not disable or bypass anti-cheat protections.

## Architecture

```text
TikTokLive connector or simulator
              |
              v
       Local WebSocket orchestrator :39177
          /                    \\
         v                      v
  GTA Chaos Live mod       Dashboard / overlay clients
  ScriptHookVDotNet        dashboard :5173, overlay :39178
```

Important directories:

- `apps/dashboard/` — React/Vite control dashboard.
- `apps/desktop/` — Tauri 2 Windows shell and local-service controls.
- `apps/overlay/` — transparent OBS browser-source UI.
- `services/orchestrator/` — authenticated local WebSocket server, queues, persistence, and result handling.
- `services/tiktok-connector/` — TikTokLive connector and local simulator.
- `mods/gta-chaos-live/` — C# ScriptHookVDotNet mod source and Enhanced build scripts.
- `packages/protocol/` — shared TypeScript protocol validation.
- `installer/` — diagnostic, install, backup, and restore scripts.
- `tools/` — reproducible smoke tests and diagnostics.
- `docs/` — architecture, compatibility, installation, testing, security, and progress records.

## Requirements

- Windows 10/11 x64.
- Node.js 22.5 or newer.
- pnpm 9 or newer.
- Python 3.11 or newer for the connector and Python tests.
- .NET Framework 4.8 / Microsoft .NET Framework compiler for the GTA mod.
- GTA V Enhanced installed through Steam/Rockstar Launcher for real Story Mode validation.
- Official Script Hook V and ScriptHookVDotNet Enhanced dependencies only.

## Local development

```powershell
corepack enable
pnpm install
pnpm dev:orchestrator
pnpm dev:overlay
pnpm dev:dashboard
```

The dashboard is served from `http://127.0.0.1:5173/`. The orchestrator listens on `127.0.0.1:39177`; the overlay server listens on `127.0.0.1:39178`.

For coordinated startup:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-local.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\stop-local.ps1
```

The dashboard and overlay use the local authentication token. Do not commit the token or place it in a public issue, log, screenshot, or repository file.

## GTA Enhanced installation and safety

Use the diagnostic and experimental installer procedures before modifying a game directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\diagnose.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\experimental-install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\experimental-restore.ps1
```

The installation procedure must confirm that GTA is closed, identify `GTA5_Enhanced.exe`, verify dependency provenance and hashes, back up files, and require explicit authorization before changing the game directory.

Never use the mod in GTA Online. Do not modify the GTA executable, Rockstar Launcher, Steam configuration, or anti-cheat mechanisms.

## Building the Enhanced mod

The Enhanced build validates the GTA executable version and compiles against the installed ScriptHookVDotNet Enhanced assembly:

```powershell
$gta = '<GTA_V_ENHANCED_DIRECTORY>'
$out = '.\data\experimental-dependencies\gta-chaos-live-build\GtaChaosLive.dll'
powershell -NoProfile -ExecutionPolicy Bypass -File .\mods\gta-chaos-live\build-enhanced-v7.ps1 -GtaPath $gta -OutputPath $out
```

Generated DLLs, archives, and staging dependencies are intentionally excluded from Git.

## Testing

```powershell
pnpm --filter @gta-chaos/orchestrator typecheck
pnpm --filter @gta-chaos/orchestrator test
pnpm --filter @gta-chaos/dashboard typecheck
pnpm --filter @gta-chaos/overlay-server typecheck
pnpm --filter @gta-chaos/dashboard build
pnpm test:python
pnpm -r test
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\local-command-client-parameter-smoke.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\local-command-client-ack-json-test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\dashboard-route-smoke.ps1
node .\tools\overlay-alert-smoke.js
```

Real-GTA validation must use an authenticated `gta-mod` connection and a final `result.status=succeeded`. `mock-gta` is never sufficient evidence of real integration.

## Overlay behavior

OBS browser-source routes are `/overlay/vertical`, `/overlay/gifts`, `/overlay/alerts`, and `/overlay/chaos`.

The overlay authenticates over the orchestrator WebSocket and renders alerts only for terminal effect results (`succeeded` or `failed`). `accepted` and `rejected` messages do not create effect alerts. Gift catalog images are accepted only from HTTP(S) URLs or bounded image data URLs validated by the protocol.

## Security and scope

- Local services bind to loopback interfaces.
- Authentication is required for GTA, dashboard, overlay, and connector roles.
- Tokens are not logged in full.
- Effects are allowlisted and parameter-bounded in C#.
- Network callbacks do not execute GTA natives directly; effects run through the game-safe ScriptHookVDotNet path.
- TikTok input remains separate from the local simulator and is not required for local testing.

See [docs/SECURITY.md](docs/SECURITY.md), [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md), [docs/TESTING.md](docs/TESTING.md), and [docs/PROGRESS.md](docs/PROGRESS.md) for supporting records.

## Using the project

1. Install the required runtimes and official GTA mod dependencies.
2. Clone the repository and install the JavaScript workspace dependencies.
3. Run the local orchestrator, dashboard, and overlay.
4. Configure the local authentication token without committing it.
5. Use the installer diagnostics before installing anything into the GTA directory.
6. Start GTA V Enhanced in Story Mode only and verify the mod connection.
7. Use the dashboard or documented local smoke tests to send controlled effects.

The repository intentionally does not include compiled mod binaries, local tokens, game files, staging archives, or user databases. These must be obtained or generated locally according to the installation and compatibility documentation.

## Contributing

Contributions are welcome. Before opening a pull request:

- Keep secrets, tokens, local databases, logs, game files, compiled binaries, and staging artifacts out of Git.
- Keep GTA-native calls on the ScriptHookVDotNet game-safe path; do not add network-thread native execution.
- Add or update automated tests for protocol, persistence, UI, or connector changes.
- Preserve the distinction between simulated tests and evidence from a real GTA Story Mode session.
- Document dependency versions and compatibility changes.
- Run the relevant typechecks, builds, and tests listed above.

## License

This repository is distributed under the license in [LICENSE](LICENSE).
