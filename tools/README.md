# Herramientas locales

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\start-local.ps1
powershell -ExecutionPolicy Bypass -File .\tools\stop-local.ps1
```

El supervisor solo inicia procesos propios del monorepo, guarda PIDs en `data/local-processes.json` y redirige logs a `data/logs/`. No inicia GTA, no instala dependencias y no modifica archivos del juego.

Con el runtime empaquetado activo y `$env:CHAOS_TOKEN` definido, `python tools/overlay-http-smoke.py --token $env:CHAOS_TOKEN` comprueba que `/overlay/vertical`, `/overlay/gifts`, `/overlay/alerts` y `/overlay/chaos` entreguen HTML y que `overlay.css` conserve el fondo transparente para OBS.

Con el mismo runtime activo, `python tools/role-authorization-smoke.py --token $env:CHAOS_TOKEN` verifica que un simulador no pueda ejecutar controles administrativos, que sí pueda publicar catálogo y que un cliente autenticado no pueda renegociar su rol.

`python tools/effect-catalog-smoke.py` comprueba que todos los efectos implementados estén presentes exactamente una vez en el mod C#, el catálogo predeterminado del orquestador y el Effects Manager del Dashboard.

`powershell -ExecutionPolicy Bypass -File .\tools\performance-measure.ps1 -DurationSeconds 60` mide CPU/RAM de los procesos relevantes durante una sesión real. No convierte esos datos en una promesa de FPS; para la aceptación, repetirlo en el hardware objetivo y conservar el JSON generado.
