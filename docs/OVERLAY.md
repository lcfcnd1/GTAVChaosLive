# Overlay

El overlay será servido localmente y consumirá el mismo WebSocket de solo lectura que el dashboard. El preset objetivo es 1080×1920, con gameplay arriba y catálogo abajo. La cuadrícula debe advertir cuando 20–30 tarjetas resulten ilegibles y ofrecer paginación/rotación.

Las fuentes estables están disponibles cuando se ejecuta `pnpm dev:overlay`:

- `http://127.0.0.1:39178/overlay/vertical`
- `http://127.0.0.1:39178/overlay/gifts`
- `http://127.0.0.1:39178/overlay/alerts`
- `http://127.0.0.1:39178/overlay/chaos`

Todas usan el mismo runtime 1080×1920 y consumen el mismo WebSocket local, pero cada ruta limita la superficie renderizada: `vertical` muestra el preset completo, `gifts` solo el catálogo, `alerts` solo el área de alertas y `chaos` solo el indicador de caos. La raíz `/` permanece disponible como atajo. El overlay no captura el gameplay: OBS debe aportar esa fuente por separado. El catálogo se sincroniza mediante snapshots WebSocket y muestra costos pendientes sin inventarlos.

El Overlay Studio incluye un botón para copiar la URL y pasos de configuración: Browser Source, 1080×1920 y fondo transparente. La URL incluye el token local necesario para autenticar el WebSocket; debe mantenerse privada y no publicarse.

Las alertas confirmadas se procesan en una cola serializada para evitar que regalos simultáneos se superpongan.
Las tarjetas reciben también `effects.snapshot` y muestran el nombre configurado del efecto; las alertas usan ese nombre cuando está disponible y conservan el ID como fallback.
## Configuración visual del preset

El dashboard permite ajustar la proporción gameplay/catálogo, elegir 4, 5 o 6 columnas y definir entre 10 y 30 tarjetas visibles. También permite ajustar escala de tipografía e iconos, espaciado, opacidad, color de fondo y borde de las tarjetas, duración y sonido de alertas. La configuración se valida, publica por WebSocket, se persiste en SQLite y el overlay la aplica sin reiniciar OBS. Cuando hay más de 20 tarjetas, la Browser Source muestra hasta dos filas por página y rota automáticamente cada 8 segundos. El preset se conserva localmente para la siguiente sesión y muestra una advertencia cuando la densidad puede afectar la legibilidad.

Gift Manager permite usar una URL oficial o cargar manualmente un icono PNG, JPEG, GIF o WebP de hasta 512 KB. La imagen manual se guarda como referencia base64 validada; el overlay rechaza formatos `data:` que no sean imágenes. El sonido opcional de las alertas también se controla desde Overlay Studio y puede quedar desactivado.
