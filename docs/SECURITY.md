# Seguridad

- Solo se admite localhost por defecto.
- El handshake exige un token local (`CHAOS_TOKEN` para el orquestador, conector y mod). La app empaquetada genera un UUID por instalación en AppData, lo propaga a los servicios y lo instala como `gta-chaos-live.token` junto al DLL. El orquestador, el dashboard, el conector, el overlay y el mod fallan cerrados si no reciben ese token; los simuladores explícitos pueden recibir un token de prueba sólo mediante su configuración de desarrollo.
- El dashboard obtiene el token configurado por Tauri y las URLs OBS lo llevan como parámetro local para autenticar el overlay; no publique esas URLs fuera de la máquina.
- El overlay no usa una credencial implícita: una URL OBS sin el token de instalación queda sin autenticación válida y no puede recibir snapshots ni comandos.
- Los comandos tienen nonce/ID único, TTL y deduplicación.
- El cliente WebSocket del mod limita cada mensaje entrante a 64 KiB y descarta conexiones que excedan ese límite, evitando acumulación ilimitada en memoria.
- El mod solo permite efectos registrados y parámetros dentro de límites.
- Antes de ejecutar cada efecto, el mod consulta `NETWORK_IS_IN_SESSION` y `NETWORK_IS_SESSION_ACTIVE` en el hilo de tick; si detecta GTA Online o no puede demostrar Story Mode, devuelve `story_mode_only` y no aplica el efecto.
- El mod observa el handle, salud y estado de muerte del jugador en cada tick. Un cambio de ped, muerte, respawn o estado transitoriamente ilegible limpia los efectos temporales y descarta comandos pendientes; mientras el jugador no esté disponible, los comandos reciben `player_state_unavailable`.
- Emergency Stop se propaga al mod, vacía comandos pendientes y ejecuta cleanup de efectos registrados.
- Se rechazan eventos que intenten seleccionar tipos de comando arbitrarios.
- La validación runtime del protocolo comprueba la forma y los rangos de cada envelope antes de procesarlo; no basta con declarar un `type` conocido.
- El orquestador aplica autorización por rol después del handshake: dashboard controla configuración/sistema, TikTok y simulator publican eventos permitidos, GTA solo informa resultados y overlay es de solo lectura. Un segundo `auth.hello` cierra la conexión.
- El producto no incluye compatibilidad con GTA Online ni evasión de anticheat.
