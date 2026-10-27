# Testing

La suite se divide en pruebas deterministas de protocolo/orquestador y pruebas manuales dentro de GTA. El simulador debe cubrir un regalo, ráfagas, duplicados, desconexión y Emergency Stop.

El adaptador Python se valida con:

```powershell
.\.venv-tiktok\Scripts\python.exe -m unittest services/tiktok-connector/test_connector.py
```

Los eventos TikTok conservan `order_id`, `event_id` o `log_id` cuando la librería los expone; esos identificadores forman el ID del envelope para que un replay tras reconexión sea deduplicable. Si TikTok no entrega ningún identificador, se usa un UUID nuevo deliberadamente para no fusionar regalos legítimos idénticos.

El adaptador registra sus handlers una sola vez por instancia, publica `live.status` para conexión, desconexión y `LiveEndEvent`, y filtra las actualizaciones intermedias de streak. La suite Python cubre estas rutas para evitar duplicados después de una reconexión.

`services/orchestrator/src/mock-gta.ts` simula únicamente el protocolo del mod y devuelve ACKs; no ejecuta natives ni demuestra compatibilidad con GTA. Debe usarse para pruebas de flujo antes de la validación real.

El simulador soporta ráfagas de 1, 10 y 100 eventos con `--connect`; los eventos conservan IDs únicos y pasan por la misma autenticación y deduplicación que TikTokLive. Para probar conexiones simultáneas y replay:

```powershell
.\.venv-tiktok\Scripts\python.exe services/tiktok-connector/simulator.py 100 --connect --clients 4 --duplicates
```

Esto publica 400 eventos únicos desde cuatro sockets y repite cada ID una vez; el orquestador debe contar 400 regalos, no 800. Si la cola alcanza 100 comandos, los siguientes eventos reciben `queue_full` explícitamente para evitar expiraciones silenciosas.

El smoke automatizado equivalente requiere el orquestador y, para validar ACKs de efectos, el Mock GTA:

```powershell
$env:CHAOS_TOKEN = 'use-a-random-local-test-token'
pnpm --filter @gta-chaos/orchestrator dev:mock-gta
python tools/load-smoke.py --token $env:CHAOS_TOKEN
```

Por defecto publica 100 eventos únicos por 4 conexiones simultáneas y repite cada envelope una vez. La prueba exige que `stats.snapshot` contabilice exactamente los 400 eventos únicos y que al menos un `result.status=succeeded` llegue desde el Mock GTA; la duplicación debe permanecer deduplicada aunque la cola limite los comandos ejecutables. En un runtime empaquetado, el mismo `CHAOS_TOKEN` debe heredarse al supervisor y al Mock GTA. Ese ACK sigue siendo simulado y no valida GTA V Enhanced.
## Smoke test de runtime local

Con el orquestador y `pnpm --filter @gta-chaos/orchestrator dev:mock-gta` activos en `127.0.0.1:39177`, definir primero `$env:CHAOS_TOKEN` y ejecutar `python tools/runtime-smoke.py`. El script autentica un cliente simulador, registra un regalo, publica un evento y verifica respuestas `accepted`, snapshots y un ACK `succeeded` del Mock GTA. Si solo está activo el orquestador, el resultado correcto es que no hay ejecución de efecto; esta prueba no representa una ejecución real dentro de GTA V. También verifica que el arranque siembre en SQLite los efectos implementados `world.weather` y `vehicle.engine_off` con sus categorías, sin reemplazar configuraciones existentes.
También verifica que el orquestador publique `sessions.snapshot` y `analytics.snapshot` con la sesión y el regalo persistidos.

Cada arranque crea una sesión SQLite; los contadores se actualizan durante el flujo y los ACKs/fallos se guardan en `effect_results`. La prueba automatizada de almacenamiento cubre la creación, actualización y cierre de una sesión.

Los tres perfiles de rendimiento se validan en el dashboard y el orquestador; `low` limita la cola a 25, `balanced` a 100 y `high` a 120 comandos.

Con el orquestador activo y `$env:CHAOS_TOKEN` definido, `python tools/performance-smoke.py` cambia a `low`, verifica el broadcast y confirma el valor tras reconectar.

Para medir recursos durante una sesión real, ejecutar desde PowerShell `powershell -ExecutionPolicy Bypass -File .\tools\performance-measure.ps1 -DurationSeconds 60 -OutputPath .\data\performance-real.json`. La herramienta muestrea CPU y RAM de GTA V, GTA Chaos Live, Node y el conector TikTok; el resultado es evidencia de recursos, no una promesa de FPS. Repetirla en el hardware objetivo (Ryzen 3 3200G, GTX 1660, 8 GB RAM) con una carga representativa y documentar el archivo generado.

`runtime-smoke.py` también cubre eliminación explícita de un regalo: verifica que SQLite/reglas publiquen un snapshot sin el elemento y que el ACK sea `accepted`.

Analytics se valida además en SQLite: el snapshot persistente agrega regalos y usuarios desde `gift_events`, efectos solo con estado `succeeded` desde `effect_results` y calcula la latencia media sin inventar ingresos o equivalencias monetarias.

El flujo de recuperación se prueba con `$env:CHAOS_TOKEN` definido y `python tools/resilience-smoke.py`: autentica, ejecuta Emergency Stop, reanuda efectos y vuelve a conectar el dashboard.
Emergency Stop persiste los comandos cancelados, y los comandos expirados incrementan `effectsFailed` y quedan en `effect_results`; así las métricas no pierden fallos internos del orquestador. El almacenamiento también conserva una tabla `logs` estructurada con nivel, evento, `sessionId`, `correlationId` y metadata JSON para auditoría de autenticación, regalos rechazados, paradas y resultados.

El reinicio del cliente GTA se prueba con `$env:CHAOS_TOKEN` definido y `python tools/gta-reconnect-smoke.py`: un cliente Mock GTA recibe un comando, se desconecta antes del ACK y un segundo cliente recibe el mismo ID reencolado y confirma `succeeded`. El orquestador limita los reintentos a tres, evita despachar mientras GTA está desconectado y marca como expirados los comandos sin ACK; este smoke sigue siendo simulado.

Las pruebas del orquestador también cubren condiciones declarativas, probabilidad, duración predeterminada, propagación de parámetros configurados y ordenamiento de la cola por prioridad descendente con FIFO para empates. El mod acepta los parámetros numéricos seguros `durationMs` y `level`; ambos se vuelven a limitar dentro del efecto antes de invocar natives.

Para probar la sincronización de Overlay Studio con una Browser Source conectada:

```powershell
python tools/overlay-config-smoke.py  # requiere $env:CHAOS_TOKEN
```

El smoke autentica un dashboard, recibe la configuración actual, publica un cambio de proporción/columnas/cantidad y verifica el broadcast actualizado.

Para comprobar las fuentes OBS completas contra el runtime empaquetado:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\start-local.ps1 -Packaged
python tools/overlay-http-smoke.py --token $env:CHAOS_TOKEN
powershell -ExecutionPolicy Bypass -File .\tools\stop-local.ps1
```

El smoke verifica `/overlay/vertical`, `/overlay/gifts`, `/overlay/alerts` y `/overlay/chaos`, además de `overlay.css` y su fondo transparente.

La regla de alertas ACK-gated se prueba sin navegador mediante `node tools/overlay-alert-smoke.js`: un resultado `accepted` permanece silencioso, `succeeded` muestra la alerta y `failed` se presenta como fallo.

El diagnóstico y el instalador tienen un smoke read-only reproducible:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\installer-prereq-smoke.ps1
```

Comprueba el esquema de .NET/VC++, los enlaces oficiales, la coherencia de `safeToInstall`, que una instalación negativa sobre una carpeta sin GTA Enhanced sea rechazada sin crear `scripts/` y que las fuentes de autenticación no contengan un fallback predecible. Si existe el runtime empaquetado, también ejecuta `tiktok-connector.exe` sin token y exige su rechazo explícito (`tokenFailClosed=ok`).

El launcher `tools/start-tiktok.ps1` también rechaza el inicio antes de crear su archivo de estado cuando `CHAOS_TOKEN` no está configurado.

`tools/start-local.ps1` espera hasta 8 segundos a que los puertos locales estén escuchando; si un servicio falla, termina los procesos que sí alcanzó a iniciar, conserva sus logs y no crea un estado de arranque exitoso.

El runtime empaquetado también expone las operaciones de persistencia usadas por el dashboard. Con una base temporal, se pueden verificar exportación, importación y backup:

```powershell
$env:CHAOS_DB = 'data/profile-smoke/chaos-live.db'
node apps/desktop/src-tauri/runtime/profile-cli.cjs export data/profile-smoke/profile.json
node apps/desktop/src-tauri/runtime/profile-cli.cjs import data/profile-smoke/profile.json
node apps/desktop/src-tauri/runtime/profile-cli.cjs backup data/profile-smoke/backup.db
```

El dashboard ofrece los mismos tres comandos mediante `ProfileCard`; las rutas se solicitan antes de escribir y el proceso usa la base de datos local de AppData en la aplicación instalada.

## Smoke test real del mod GTA

Con el orquestador activo, ScriptHookVDotNet Enhanced cargado en GTA V Enhanced Story Mode y el jugador dentro de una partida, ejecutar `python tools/gta-real-smoke.py --token <CHAOS_TOKEN> --effect-id player.ragdoll --parameters '{"durationMs":750}'` o definir `CHAOS_TOKEN`. El script no usa el fallback de desarrollo; el mod se identifica como `gta-mod`, rechaza pasar si detecta solamente `mock-gta`, envía el efecto elegido con parámetros JSON acotados y exige un ACK `succeeded`. El resultado debe documentarse como prueba real, separada de los smoke tests simulados.
