# Acceptance matrix

Este documento separa la evidencia reproducible en este equipo de la validación que exige una instalación real de GTA V Enhanced y un LIVE real de TikTok. Una casilla local no sustituye la prueba de integración indicada en la especificación.

| Área | Evidencia local actual | Estado |
| --- | --- | --- |
| Orquestador, reglas, colas, cooldowns, persistencia y analytics | `pnpm test` y `tools/runtime-smoke.py` | Verificado localmente |
| Parser TikTokLive, streaks, deduplicación y reconexión | `pnpm test:python` | Verificado con fixtures/simulador |
| Overlay WebSocket y endpoints OBS | `tools/overlay-config-smoke.py`, `tools/runtime-smoke.py`, `tools/overlay-http-smoke.py` (las cuatro rutas HTTP y CSS transparente) | Verificado localmente |
| Dashboard Tauri/React y type safety | `pnpm typecheck`, `cargo check` | Verificado localmente |
| Instalador, diagnóstico y consentimiento explícito | Bundle NSIS/MSI, `installer/diagnose.ps1`, instalación aislada documentada | Verificado localmente; falta máquina limpia |
| Comunicación empaquetada | staging release con puertos `39177`/`39178` y diagnóstico saludable | Verificado localmente |
| Mod compilado | DLL compilada contra ensamblado Legacy disponible | Compilado; no es prueba Enhanced |
| Mod cargado en GTA V Enhanced | Requiere GTA V Enhanced + SHVDN Enhanced del usuario | Pendiente externo |
| Efecto real con ACK desde GTA | `tools/gta-real-smoke.py --token ...` | Pendiente externo |
| TikTok LIVE real | Requiere username/live accesible y protocolo operativo | Pendiente externo |
| Rendimiento en Ryzen 3 3200G / GTX 1660 / 8 GB | No hay hardware objetivo disponible para medición | Pendiente externo |

## Criterio de cierre

El proyecto no debe marcarse como aceptado mientras las tres pruebas externas —carga del mod Enhanced, efecto real con ACK y sesión TikTok LIVE— no estén registradas con fecha, versión del juego/mod y resultado. Los smoke tests con Mock GTA sirven para detectar regresiones del protocolo, no para convertir una integración simulada en una integración real.

## Comandos reproducibles

La auditoría local de solo lectura resume artefactos, configuración del instalador, diagnóstico y hashes del bundle:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\acceptance-audit.ps1
```

Para incluir las suites automatizadas:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\acceptance-audit.ps1 -RunTests
```

```powershell
pnpm test
pnpm test:python
pnpm typecheck
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
$env:CHAOS_TOKEN = '<random-local-test-token>'
python tools/runtime-smoke.py
python tools/resilience-smoke.py
python tools/overlay-config-smoke.py
python tools/overlay-http-smoke.py --token $env:CHAOS_TOKEN
python tools/gta-real-smoke.py --token <CHAOS_TOKEN> --effect-id player.ragdoll --parameters '{"durationMs":750}'
```

El último comando debe ejecutarse únicamente con el orquestador activo, GTA V Enhanced en Story Mode, SHVDN Enhanced cargado y un token local válido; sin esos prerrequisitos debe permanecer pendiente. `--effect-id` permite repetir la prueba con cualquier efecto registrado y `--parameters` solo acepta un objeto JSON, sin ejecutar código.
