# Compatibilidad — Fase 0

Fecha de verificación: 2026-10-24. La disponibilidad de terceros puede cambiar; esta matriz debe verificarse de nuevo durante el instalador y antes de cada release.

| Componente | Hallazgo | Estado |
|---|---|---|
| GTA V Enhanced Story Mode | Script Hook V tiene soporte publicado para Enhanced. | Condicional: depende del build instalado. |
| ScriptHookVDotNet Enhanced | El fork comunitario publica releases Legacy + Enhanced; la release v1.1.0.6 corrige un patrón de memoria ausente en GTA5 Enhanced 1.0.1158.13. El propio proyecto documenta que la versión de archivo incrementa el major para distinguir SHVDNE de Legacy. Sus requisitos publicados incluyen .NET Framework >= 4.8 y Visual C++ Redistributable x64. | Candidato compatible por documentación, no validado en esta máquina. |
| TikTokLive | Librería Python de terceros expone eventos de LIVE y regalos; no es una API oficial estable de TikTok. | Adaptador experimental reemplazable. |
| Tauri 2 + React/Vite | Tauri admite frontend React y empaquetado Windows; WebView2 es un requisito operativo habitual. | Adecuado para el dashboard. |
| SQLite | Persistencia local sin servicio comercial. | Adecuado. |

## Evidencia local

El host contiene una instalación Legacy con `ScriptHookV.dll` 1.0.3411.0 y `ScriptHookVDotNet3.dll` 3.7.0.6. El mod compila contra ese ensamblado con `csc.exe` de .NET Framework; el diagnóstico marca como Enhanced-compatible únicamente una FileVersion con major >= 4, siguiendo la distinción publicada por SHVDNE, y ahora informa .NET Framework 4.8 y Visual C++ Runtime x64. No hay `GTA5_Enhanced.exe` detectable, por lo que esto no valida Enhanced. Visual Studio Community 18 aporta `link.exe` y Windows SDK 10.0.26100 aporta `kernel32.lib`/`dbghelp.lib`; `cargo check` y el bundle Tauri x64 fueron verificados.

## Fuentes consultadas

- Script Hook V Enhanced, sitio del autor: https://www.dev-c.com/post/scripthookv-enhanced
- ScriptHookVDotNet Enhanced, releases: https://github.com/Chiheb-Bacha/ScriptHookVDotNetEnhanced/releases
- ScriptHookVDotNet Enhanced, requisitos e instalación: https://github.com/Chiheb-Bacha/ScriptHookVDotNetEnhanced
- ScriptHookVDotNet, requisitos base: https://github.com/crosire/scripthookvdotnet
- TikTokLive: https://github.com/isaackogan/TikTokLive
- Tauri: https://tauri.app/
- .NET Framework 4.8: https://dotnet.microsoft.com/download/dotnet-framework/net48
- Visual C++ Redistributable x64: https://aka.ms/vs/17/release/vc_redist.x64.exe

## Bloqueos de validación real

1. Necesitamos la ruta y el build exacto de GTA V Enhanced del usuario.
2. Necesitamos comprobar que Script Hook V y ScriptHookVDotNet Enhanced cargan juntos en Story Mode.
3. Necesitamos ejecutar el mod mínimo y confirmar un efecto simple, por ejemplo ragdoll, desde un comando local autenticado.
4. TikTokLive puede romperse por cambios de protocolo o limitaciones de la cuenta; por eso el simulador es obligatorio.

No se descarga ni ejecuta ningún binario de modding automáticamente. La compatibilidad de SHVDNE debe seguirse alineando con el build exacto de GTA: las releases corrigen patrones para builds concretos, por lo que “Enhanced compatible” no equivale a una garantía universal.
