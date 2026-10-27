# Efectos

Efectos implementados en el mod compilado localmente contra SHVDN Legacy 3.7.0.6: `player.ragdoll` (100–3000 ms), `player.recover_health`, `player.invincibility` (250–10000 ms con restauración), `player.super_jump` (500–15000 ms mediante `SET_SUPER_JUMP_THIS_FRAME`), `player.speed_boost` (500–15000 ms, multiplicador 1.05–1.5 y restauración a 1.0), `player.change_weapon` (selecciona `WeaponHash.Pistol` sin modificar inventario y devuelve `weapon_unavailable` si no está disponible), `player.wanted_level` (0–5), `player.clear_wanted`, `player.remove_weapons`, `world.weather` (lista cerrada de seis climas, 1000–30000 ms y restauración automática), `world.time` (hora 0–23, minuto 0–59, 1000–30000 ms y restauración precisa de `GTA.Chrono.GameClock`), `vehicle.spin` (requiere vehículo actual; velocidad angular limitada a 1–8 y restauración de `LocalRotationVelocity`) y `vehicle.engine_off` (requiere que el jugador esté en un vehículo; aplica freno forzado, restaura el motor y libera el freno en `Cancel`/`Cleanup`; la API local no expone getter del freno). La ejecución real dentro de GTA V Enhanced todavía requiere validación en ese entorno.

Cada efecto declara límites y participa del ciclo `Execute`, `Update`, `Cancel` y `Cleanup`.

El núcleo observa el handle, salud y estado de muerte del jugador en cada tick. Un cambio de ped, muerte, respawn o estado ilegible cancela y limpia los efectos temporales y descarta la cola pendiente antes de aceptar nuevos comandos.

Al iniciar, el orquestador siembra en SQLite la configuración predeterminada de cada efecto implementado que aún no exista. Esto permite que el overlay muestre nombres y categorías legibles desde el primer arranque; las configuraciones existentes del usuario no se sobrescriben.

El editor visual también guarda `parameters`, `conditions` y `priority` como configuración estructurada. Se validan como datos finitos (sin funciones ni código ejecutable), se persisten en SQLite y se transportan en `effect.upsert`. El orquestador aplica las condiciones declarativas soportadas (`minQuantity`, `maxQuantity`, `minChaosLevel`, `maxChaosLevel`, `requireCostVerified`, `allowedGiftIds` y `allowedSources`), aplica `probability`, inyecta `defaultDurationMs` cuando no hay una duración explícita, mezcla los parámetros configurados en el comando y ordena la cola por prioridad descendente, preservando FIFO cuando empatan. El mod continúa aplicando sus propios límites y no ejecuta esos metadatos como código.

Estados: `queued`, `running`, `succeeded`, `rejected`, `failed`, `cancelled`.

No se publican efectos como disponibles hasta contar con una implementación y prueba correspondiente en el mod.

El medidor de caos tiene seis niveles (0–5), acumula puntos por comandos aceptados, decae con el tiempo y se reinicia mediante Emergency Stop o nueva sesión.
