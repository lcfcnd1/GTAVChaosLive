# GTA Chaos Live — mod

Este proyecto se compila contra los ensamblados proporcionados por ScriptHookVDotNet Enhanced en una instalación local validada. No se incluyen DLLs de terceros en el repositorio.

## Compilación local

```powershell
powershell -ExecutionPolicy Bypass -File .\mods\gta-chaos-live\build.ps1 -GtaPath 'C:\ruta\a\GTA V Enhanced'
```

El script usa el compilador .NET Framework disponible y solo lee `ScriptHookVDotNet3.dll`; no copia el DLL al juego.

## Primera prueba prevista

`player.ragdoll` durante una duración acotada, solicitado por el orquestador y ejecutado únicamente en `OnTick`. La implementación no toca GTA Online.
