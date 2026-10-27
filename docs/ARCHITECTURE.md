# Arquitectura

```text
TikTokLive / Simulator
          │ normalized events
          ▼
Orchestrator (localhost WebSocket + SQLite)
     ┌────┴───────────┐
     ▼                ▼
GTA Mod           Overlay Server
 (ACK/result)     (OBS Browser Source)
     ▲                ▲
     └──── Dashboard ─┘
```

El protocolo se versiona en `packages/protocol`. Todos los mensajes llevan `id`, `type`, `createdAt` y `protocolVersion`. Los comandos al juego deben coincidir con un efecto registrado; nunca se evalúan expresiones ni código recibido desde TikTok.

Los clientes deben completar `auth.hello` antes de recibir snapshots o enviar eventos. `system.stop` detiene la cola y `system.resume` exige reanudación explícita. Los comandos enviados al mod pasan a un estado en vuelo hasta recibir ACK; si el cliente GTA se desconecta, vuelven a la cola hasta tres intentos, no se despachan mientras GTA está desconectado y los comandos expirados o agotados se registran como rechazados. Los IDs terminales bloquean ACKs tardíos para no duplicar estadísticas.

La persistencia usa SQLite en `data/chaos-live.db` con migración de esquema, catálogo de regalos, efectos, eventos recibidos, sesiones, estadísticas acumuladas, resultados de ejecución y logs estructurados. El archivo puede cambiarse mediante `CHAOS_DB`. Cada log conserva nivel, evento, mensaje, sesión, correlación y metadata JSON; los perfiles JSON exportan el catálogo y las configuraciones de efectos; los backups completos usan `VACUUM INTO`. `analytics.snapshot` agrega regalos por tipo, usuarios, efectos exitosos y latencia media directamente desde SQLite.

Los perfiles de rendimiento `low`, `balanced` y `high` ajustan límites de cola y efectos activos; se guardan en SQLite y se distribuyen mediante `performance.config`. Son límites de protección de recursos, no promesas de FPS.

Las alertas de éxito se emiten solo al recibir `result.status = succeeded` desde el mod; un comando `effect.command` en tránsito no se muestra como ejecutado. El resultado confirmado conserva usuario, regalo y cantidad para el overlay.

## Límites iniciales

- Listener solo en `127.0.0.1`.
- Cola máxima configurable; por defecto 100.
- Cooldown por efecto y por regalo.
- Emergency Stop cancela cola, marca efectos temporales para cleanup y exige reanudación manual.
- Cualquier estado incierto se presenta como `unknown` y no como éxito.
