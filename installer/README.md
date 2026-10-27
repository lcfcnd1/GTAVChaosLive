# Windows installer diagnostics

`diagnose.ps1` is read-only. It reports detected paths and dependencies without copying files, downloading binaries, or changing the GTA installation.

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\diagnose.ps1
powershell -ExecutionPolicy Bypass -File .\installer\diagnose.ps1 -GtaPath 'D:\Games\GTA V Enhanced'
```

The final Tauri installer must run an equivalent diagnostic before offering mod installation and must request explicit consent before writing to the game directory.

The packaged dashboard exposes both install and uninstall. Uninstall moves the own DLL to a timestamped backup and refuses a hash mismatch unless `-Force` is explicitly used in the manual script.

La instalación manual segura requiere una ruta de Enhanced y consentimiento explícito:

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\install-mod.ps1 `
  -GtaPath 'D:\Games\GTA V Enhanced' `
  -Consent 'I UNDERSTAND STORY MODE ONLY' `
  -ChaosToken 'replace-with-a-random-local-token'
```

El token debe tener entre 16 y 128 caracteres alfanuméricos o guiones y debe coincidir con `CHAOS_TOKEN` de los servicios locales. El script verifica además .NET Framework 4.8 y Visual C++ Redistributable x64; solo copia el DLL propio y el token a `scripts/`, no descarga dependencias, no toca GTA Online y se detiene si ya existe el destino con otro token. `-AllowOverwrite` crea un backup antes de reemplazarlo.

Para retirar el mod sin borrar irreversiblemente el archivo:

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\uninstall-mod.ps1 `
  -GtaPath 'D:\Games\GTA V Enhanced' `
  -Consent 'I UNDERSTAND STORY MODE ONLY'
```

La desinstalación mueve el DLL a un backup fechado. Si el DLL fue modificado desde el build local, el script se detiene; `-Force` requiere confirmar explícitamente ese caso.
