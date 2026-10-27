# Desktop app

La aplicación de escritorio usa Tauri 2 y carga el dashboard Vite como frontend. El scaffolding está en `apps/desktop/src-tauri`.

La ventana expone comandos Tauri para iniciar, detener y consultar los servicios locales mediante `tools/start-local.ps1` y `tools/stop-local.ps1`. El supervisor comprueba conflictos en los puertos 39177, 39178 y 5173 antes de iniciar en desarrollo, y detiene el árbol completo de cada servicio para no dejar procesos Node huérfanos. El dashboard consulta además los procesos `GTA5_Enhanced`/`GTA5`: distingue juego detectado de mod conectado, sin presentar la detección del proceso como validación de SHVDN. En desarrollo, la raíz se obtiene desde el proyecto y el estado queda en `data/`; en una instalación empaquetada, Tauri resuelve los recursos desde `resource_dir` y entrega `GTA_CHAOS_DATA` apuntando a AppData, evitando escribir SQLite, logs o PID dentro de `Program Files`. `GTA_CHAOS_ROOT` sigue disponible para runtimes distribuidos fuera del ejecutable.

También puede iniciar y detener el conector TikTok desde Command ingresando el username. En desarrollo el supervisor usa `.venv-tiktok`; en el bundle usa `runtime/tiktok-connector.exe` y no descarga dependencias durante la transmisión.

Command incluye `Run read-only check`, que ejecuta el diagnóstico empaquetado y presenta el JSON de detección sin copiar archivos al directorio del juego. La instalación del mod sigue siendo una acción separada y exige consentimiento explícito.

```powershell
pnpm --dir apps/desktop tauri:dev
pnpm --dir apps/desktop tauri:build
```

El código Rust se valida con `cargo check` usando Visual Studio Community 18 y Windows SDK 10.0.26100. El bundle Windows x64 genera ambos instaladores: `target/release/bundle/nsis/GTA Chaos Live_0.1.0_x64-setup.exe` y `target/release/bundle/msi/GTA Chaos Live_0.1.0_x64_en-US.msi`. El instalador de mod separado mantiene diagnóstico de rutas de GTA, detección de builds, comprobación de Script Hook y consentimiento explícito antes de copiar archivos al juego.
