# Problemas conocidos

La matriz de aceptación y la separación entre evidencia local y validación externa están en [ACCEPTANCE.md](ACCEPTANCE.md).

- La compatibilidad de ScriptHookVDotNet Enhanced con un build concreto de GTA V Enhanced aún no está probada en este equipo.
- Este entorno no tiene una instalación detectable de GTA V Enhanced; el mod sí se compiló contra el ensamblado Legacy local, pero todavía no se ha cargado ni validado dentro de Enhanced.
- La detección del instalador rechaza `ScriptHookVDotNet3.dll` Legacy aunque el nombre del archivo coincida; requiere la FileVersion Enhanced-compatible.
- El bundle Tauri x64 ya fue generado en este host con Visual Studio Community y Windows SDK; la instalación NSIS en un directorio aislado y su desinstalación fueron verificadas. Aún falta una máquina completamente externa para validar permisos, WebView2 y GTA.
- TikTokLive no es una API oficial estable y puede requerir mantenimiento.
- El instalador Windows NSIS/MSI existe, pero su flujo completo de instalación del mod y ejecución autónoma de todos los servicios aún requiere validación en una máquina limpia.
- El bundle ya incluye `node.exe`, bundles autocontenidos del orquestador/overlay y `tiktok-connector.exe`; el flujo real de TikTok aún depende de la disponibilidad/protocolo de TikTokLive y no se ha probado contra un LIVE real en una máquina limpia.
- No hay afirmación de rendimiento/FPS hasta medir en el hardware objetivo.
- El sonido opcional depende de la política de autoplay de OBS/WebView; si el contexto no permite crear o reanudar AudioContext, la alerta visual continúa sin sonido ni error.
