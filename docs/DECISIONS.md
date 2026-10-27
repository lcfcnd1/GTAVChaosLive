# Decisiones

## D-001 — TikTokLive detrás de un adaptador

TikTokLive es útil para el primer conector, pero es una librería de terceros no oficial. El sistema consume eventos normalizados, de modo que un cambio de librería no obliga a reescribir reglas, overlay o mod.

## D-002 — Mod seguro por cola de juego

La red nunca ejecuta natives. El mod recibe mensajes, valida y los encola; el tick del script procesa comandos y devuelve ACK o error.

## D-003 — Costos no confirmados

Un regalo sin costo verificado se mantiene fuera del orden económico y se marca como pendiente. No se inventan precios.
