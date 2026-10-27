# TikTok connector

El adaptador real está implementado en `connector.py` con TikTokLive y publica eventos normalizados al orquestador. Este paquete conserva un simulador local para probar sin una transmisión activa. Nunca se inventan precios o iconos: esos campos serán opcionales y verificables.

```powershell
python -m venv .venv-tiktok
.\.venv-tiktok\Scripts\python.exe -m pip install -r services/tiktok-connector/requirements.txt
$env:CHAOS_TOKEN = 'use-a-random-local-test-token'
.\.venv-tiktok\Scripts\python.exe services/tiktok-connector/connector.py @tu_usuario
```

El conector rechaza iniciar si no recibe `--token` o `CHAOS_TOKEN`; no utiliza un token de desarrollo implícito.

La librería documenta que es no oficial y no está considerada API de producción; el sistema mantiene este adaptador reemplazable y el simulador como rutas de operación soportadas.

El simulador puede publicar ráfagas al orquestador:

```powershell
.\.venv-tiktok\Scripts\python.exe services/tiktok-connector/simulator.py 1 --connect
.\.venv-tiktok\Scripts\python.exe services/tiktok-connector/simulator.py 10 --connect
.\.venv-tiktok\Scripts\python.exe services/tiktok-connector/simulator.py 100 --connect
```
