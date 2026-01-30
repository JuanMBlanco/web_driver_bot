# EZCater Web Driver Bot

Bot automatizado que abre un navegador periódicamente, revisa un listado en una página específica y realiza clicks en elementos configurados.

## Características

- ✅ Pool de navegadores con Puppeteer
- ✅ Tareas periódicas configurables
- ✅ API REST para control manual
- ✅ Integración con Telegram para notificaciones
- ✅ Sistema de logging con timestamps
- ✅ Gestión automática del ciclo de vida de navegadores

## Estructura del Proyecto

```
ezcater_web_driver_bot/
├── src/
│   └── main.ts              # Código principal
├── config/
│   └── ezcater_web_driver_bot.yaml  # Configuración
├── dist/                    # Código compilado (generado)
├── browsers/                # Perfiles de navegador (generado)
├── data/                    # Datos y logs (generado)
├── package.json
├── tsconfig.json
├── setup_with_pm2.sh        # Script de configuración PM2
├── start_ezcater_web_driver_bot.sh  # Script de inicio
├── pm2_logs_monitor.sh      # Monitor de logs
└── init_browser_profile.sh  # Inicialización de perfiles
```

## Instalación

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar el proyecto

Edita el archivo `config/ezcater_web_driver_bot.yaml` con tus configuraciones:

```yaml
task:
  url: "https://tu-pagina.com/list"  # URL a revisar
  checkInterval: 60                   # Intervalo en segundos
  clickSelectors:                     # Selectores CSS para hacer click
    - "button.process-item"
    - "a.action-link"
  listSelector: ".list-item"          # Selector del listado
  maxItemsPerCycle: 10                # Máximo de items por ciclo
```

### 3. Configurar Telegram (Opcional)

La integración con Telegram se configura mediante un archivo de secretos **no versionado** en `config/.env.secrets`.

- **Ubicación del archivo**: `config/.env.secrets` (asegúrate de crearlo en el servidor donde corre el bot).
- **Variables soportadas**:
  - `TELEGRAM_API_TOKEN`: token del bot de Telegram.
  - `TELEGRAM_CHAT_IDS`: lista de chat IDs separados por comas (puede ser 1 o varios chats/grupos).

Formato exacto del archivo (sin comillas, sin espacios alrededor del `=`):

```
TELEGRAM_API_TOKEN=1234567890:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
TELEGRAM_CHAT_IDS=123456789,-100222333444
```

Detalles importantes:

- El archivo se lee desde `src/main.ts` en `config/.env.secrets`, por lo que **debe existir** en cada entorno donde quieras notificaciones.
- Si `TELEGRAM_API_TOKEN` no está definido en el archivo, el bot registrará en los logs que no puede inicializar Telegram y continuará **sin notificaciones**.
- Si `TELEGRAM_CHAT_IDS` falta o está vacío, el bot se inicializa, pero no enviará mensajes a ningún chat (mostrará un warning en logs).
- Los IDs pueden ser de chats privados o grupos; si hay varios, sepáralos con comas y el bot enviará el mismo mensaje a todos.

Verificación rápida:

- Arranca el bot (`npm start` o usando PM2).
- Revisa los logs y comprueba que aparece el mensaje `Telegram bot initialized successfully`.
- Al iniciarse correctamente, el bot enviará un mensaje de texto `"EZCater Web Driver Bot initiated"` a todos los chats configurados.

Notas para producción (VM):

- La VM de producción debe tener **su propio** archivo `config/.env.secrets` con:
  - El token del bot que se usará en producción.
  - El/los chat IDs del grupo compartido donde queréis recibir las alertas.
- Este archivo **no debe** copiarse al repositorio ni a ningún control de versiones; edítalo directamente en la VM (por ejemplo con `nano config/.env.secrets`).
- En local puedes usar otro bot/token y un chat ID personal para pruebas; sólo necesitas mantener la misma estructura de variables.

### 4. Compilar el proyecto

```bash
npm run build
```

## Uso

### Iniciar el servidor

```bash
npm start
```

O usando PM2:

```bash
./start_ezcater_web_driver_bot.sh
```

### Configurar PM2 con autostart

```bash
./setup_with_pm2.sh
```

Este script:
- Instala Node.js v24 (si no está instalado)
- Instala PM2 globalmente
- Crea scripts de inicio y monitoreo
- Configura autostart en XFCE

### Inicializar perfiles de navegador

```bash
./init_browser_profile.sh --context=default --instances=3 --url=https://tu-pagina.com
```

## API Endpoints

El servidor corre en el puerto **3000** por defecto.

### Iniciar tarea periódica

```bash
curl -X POST http://localhost:3000/api/task/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Token f47ac10b-58cc-4372-a567-0e02b2c3d479"
```

### Detener tarea periódica

```bash
curl -X POST http://localhost:3000/api/task/stop \
  -H "Content-Type: application/json" \
  -H "Authorization: Token f47ac10b-58cc-4372-a567-0e02b2c3d479"
```

### Ejecutar tarea manualmente (una vez)

```bash
curl -X POST http://localhost:3000/api/task/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Token f47ac10b-58cc-4372-a567-0e02b2c3d479"
```

## Configuración

### Archivo YAML

El archivo `config/ezcater_web_driver_bot.yaml` contiene toda la configuración:

- **browser**: Configuración del navegador (ruta, argumentos, pool size)
- **task**: Configuración de la tarea (URL, intervalos, selectores)
- **server**: Configuración del servidor (puerto, base path)
- **tokens**: Tokens de autenticación para la API

### Selectores CSS

Los selectores CSS se usan para:
- `listSelector`: Encontrar los items del listado
- `clickSelectors`: Elementos dentro de cada item para hacer click

Ejemplo:
```yaml
task:
  listSelector: ".order-item"        # Cada item del listado
  clickSelectors:                    # Elementos clickeables dentro del item
    - "button.approve"
    - "a.view-details"
```

## Monitoreo

### Ver logs en tiempo real

```bash
./pm2_logs_monitor.sh
```

O directamente:

```bash
tail -f ~/.pm2/logs/ezcater-web-driver-bot-out.log
```

### Comandos PM2 útiles

```bash
pm2 list                              # Ver procesos
pm2 restart ezcater_web_driver_bot   # Reiniciar
pm2 stop ezcater_web_driver_bot      # Detener
pm2 logs ezcater_web_driver_bot      # Ver logs
```

## Desarrollo

### Modo desarrollo

```bash
npm run dev
```

### Compilar TypeScript

```bash
npm run build
```

## Notas

- El bot usa un pool de navegadores para mejor rendimiento
- Los navegadores se cierran automáticamente después de un tiempo configurado
- Las capturas de error se envían automáticamente a Telegram (si está configurado)
- El sistema guarda logs y datos en el directorio `data/`

## Troubleshooting

### El navegador no se abre

- Verifica que la ruta de Chrome esté correcta en el YAML
- Asegúrate de tener permisos X11 (DISPLAY configurado)

### La tarea no encuentra elementos

- Verifica los selectores CSS en la configuración
- Revisa las capturas de pantalla en `data/` o Telegram

### Error de puerto en uso

- Cambia el puerto en `config/ezcater_web_driver_bot.yaml`
- O detén el proceso que está usando el puerto 3000

## Licencia

ISC

