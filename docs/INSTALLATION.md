# Instalación (borrador ejecutable)

La primera versión no instala dependencias de terceros automáticamente. Antes de instalar el mod, el usuario debe verificar Story Mode, Script Hook V y ScriptHookVDotNet Enhanced según sus instrucciones oficiales.

1. Para desarrollo desde el repositorio, instalar Node.js 22.5+, pnpm 9+ y Python 3.11+; el instalador empaquetado ya incluye los runtimes de Node y TikTok.
2. Ejecutar `pnpm install`.
3. Para regenerar el conector autónomo y ejecutar los smoke tests, crear `.venv-tiktok` e instalar `services/tiktok-connector/requirements.txt` junto con `pyinstaller`.

```powershell
python -m venv .venv-tiktok
.\.venv-tiktok\Scripts\python.exe -m pip install -r .\services\tiktok-connector\requirements.txt pyinstaller
```

4. Iniciar el orquestador y el dashboard.
5. Configurar la ruta de GTA V Enhanced en el dashboard.
6. Confirmar la carga del mod mediante el diagnóstico.
7. Solo después habilitar TikTok y OBS.

Para levantar las tres superficies locales juntas durante desarrollo, use `tools/start-local.ps1`; `tools/stop-local.ps1` las detiene usando los PIDs registrados.

La aplicación empaquetada conserva el estado mutable (SQLite, logs y archivos de procesos) en el directorio AppData de GTA Chaos Live. El instalador incluye `node.exe` y bundles autocontenidos del orquestador y del overlay; el modo empaquetado inicia esos servicios sin pnpm ni `node_modules`. El dashboard vive dentro de la ventana Tauri y no necesita un servidor Vite separado.

Para inspeccionar la máquina sin modificarla:

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\diagnose.ps1
```

El dashboard empaquetado ejecuta el diagnóstico read-only antes de instalar; detecta rutas, builds, WebView2 y dependencias, muestra enlaces oficiales y pide consentimiento antes de copiar archivos al directorio del juego.

El diagnóstico actual ya incluye enlaces oficiales de GTA V Enhanced/Script Hook V, ScriptHookVDotNet Enhanced y WebView2, además de comprobar los puertos locales del orquestador y overlay y el endpoint `/overlay/vertical`. El instalador Tauri usa `webviewInstallMode: skip`: no descarga ni ejecuta WebView2 ni ningún otro componente de terceros. Si WebView2 falta, debe instalarse previamente desde el enlace oficial mostrado por el diagnóstico.

El instalador manual seguro está en `installer/install-mod.ps1`; exige `GTA5_Enhanced.exe`, `ScriptHookVDotNet3.dll` Enhanced, `ScriptHookV.dll`, .NET Framework 4.8, Visual C++ Redistributable x64, un token local de 16–128 caracteres y la confirmación literal `I UNDERSTAND STORY MODE ONLY`. La aplicación Tauri genera y pasa automáticamente el token por instalación; el flujo manual debe usar el mismo valor que usarán los servicios y el mod.

Los perfiles se pueden respaldar y restaurar sin tocar archivos del juego:

```powershell
pnpm --filter @gta-chaos/orchestrator profile export profile.json
pnpm --filter @gta-chaos/orchestrator profile import profile.json
```

Los perfiles exportados usan `schemaVersion: 2` e incluyen regalos y configuraciones de efectos. Los perfiles `schemaVersion: 1` existentes, que solo contenían regalos, siguen siendo importables.

Antes de una transmisión, la aplicación empaquetada genera un UUID local en AppData y lo comparte con los servicios; al instalar el mod lo guarda en `gta-chaos-live.token` junto a `GtaChaosLive.dll`. Para desarrollo manual, configure el mismo valor aleatorio en `CHAOS_TOKEN` para los servicios y coloque ese valor en `gta-chaos-live.token`. No distribuya el fallback `dev-only-change-me`.
El diagnóstico y el instalador verifican `GTA5_Enhanced.exe`, `ScriptHookV.dll`, `ScriptHookVDotNet3.dll` Enhanced, .NET Framework 4.8 y Visual C++ Redistributable x64 antes de copiar el mod. El diagnóstico muestra enlaces oficiales para las dependencias ausentes. Para backups de la base SQLite use `pnpm --filter @gta-chaos/orchestrator profile backup data/chaos-live-backup.db`.

El bundle Tauri incluye `runtime/node.exe`, los bundles autocontenidos del orquestador y overlay, y `runtime/tiktok-connector.exe`. La app usa esa carpeta de recursos al iniciar servicios empaquetados y no una ruta absoluta del árbol de desarrollo. Node.js, pnpm, `node_modules` y Python no son necesarios para el flujo empaquetado; solo se requieren para desarrollo y recompilación.

También incluye el DLL propio bajo `mods/gta-chaos-live/bin/`. `install-mod.ps1` solo lo copia después de detectar GTA V Enhanced, Script Hook V, SHVDN Enhanced y recibir el consentimiento literal de Story Mode; nunca instala componentes de terceros automáticamente.

Desde el mismo panel se puede desinstalar `GtaChaosLive.dll`. La operación exige nuevamente el consentimiento literal y mueve el DLL a un backup fechado recuperable; no elimina archivos de terceros. Si el DLL no coincide con el build local, el script se detiene para evitar retirar un archivo modificado sin confirmación adicional.
