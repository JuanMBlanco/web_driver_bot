# Configuración del Bot en VM Linux

Este documento contiene todos los comandos necesarios para configurar el bot y su sistema de monitoreo automático en una VM Linux.

## Prerrequisitos

- VM Linux con acceso SSH o consola
- Usuario con permisos sudo (para algunas operaciones)
- XFCE, GNOME u otro entorno de escritorio instalado (para las terminales de logs)

---

## Paso 1: Navegar al Directorio del Proyecto

```bash
# Cambiar al directorio del proyecto
cd /ruta/a/tu/proyecto/ezcater_web_driver_bot

# O si estás en el home del usuario:
cd ~/ezcater_web_driver_bot
```

**Nota**: Ajusta la ruta según la ubicación real de tu proyecto.

---

## Paso 2: Dar Permisos de Ejecución a los Scripts

```bash
# Dar permisos de ejecución a todos los scripts necesarios
chmod +x monitor_bot_v3.sh
chmod +x keep_logs_open.sh
chmod +x open_bot_logs.sh
chmod +x start_ezcater_web_driver_bot.sh
chmod +x setup_with_pm2.sh
```

---

## Paso 3: Verificar Instalación de PM2

```bash
# Verificar si PM2 está instalado
pm2 --version

# Si no está instalado, instalarlo globalmente
npm install -g pm2

# O si usas NVM, cargar NVM primero:
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
npm install -g pm2
```

---

## Paso 4: Verificar Instalación de Node.js y Dependencias

```bash
# Cargar NVM si es necesario
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Verificar versión de Node.js
node --version

# Instalar dependencias del proyecto
npm install
# O si usas yarn:
yarn install
```

---

## Paso 5: Probar el Script de Monitoreo Manualmente

```bash
# Ejecutar el script de monitoreo para verificar que funciona
./monitor_bot_v3.sh

# Verificar que el bot se inició (si está dentro del rango de horas)
pm2 list

# Ver logs del bot
pm2 logs ezcater_bot_v3
```

---

## Paso 6: Configurar Ejecución Automática con Cron

### 6.1. Obtener la Ruta Absoluta del Proyecto

```bash
# Obtener la ruta absoluta del proyecto
pwd

# Copiar esta ruta, la necesitarás en el siguiente paso
# Ejemplo de salida: /home/usuario/ezcater_web_driver_bot
```

### 6.2. Editar el Crontab

```bash
# Abrir el editor de crontab
crontab -e

# Si es la primera vez, elegir un editor (nano es el más simple)
```

### 6.3. Agregar la Línea de Cron

Agrega esta línea al final del archivo (reemplaza `/ruta/a/tu/proyecto/ezcater_web_driver_bot` con la ruta real obtenida en el paso 6.1):

```cron
# Monitorear bot v3 cada 5 minutos (inicia 6:00 AM, detiene 22:00)
*/5 * * * * cd /ruta/a/tu/proyecto/ezcater_web_driver_bot && /ruta/a/tu/proyecto/ezcater_web_driver_bot/monitor_bot_v3.sh >> /tmp/ezcater_monitor.log 2>&1
```

**Ejemplo con ruta real:**
```cron
*/5 * * * * cd /home/usuario/ezcater_web_driver_bot && /home/usuario/ezcater_web_driver_bot/monitor_bot_v3.sh >> /tmp/ezcater_monitor.log 2>&1
```

### 6.4. Guardar y Salir

- Si usas **nano**: `Ctrl+O` (guardar), `Enter` (confirmar), `Ctrl+X` (salir)
- Si usas **vi/vim**: `Esc`, luego `:wq` y `Enter`

### 6.5. Verificar que el Cron se Agregó Correctamente

```bash
# Ver el crontab actual
crontab -l

# Deberías ver la línea que agregaste
```

---

## Paso 7: Configurar DISPLAY (si es necesario)

Si estás usando X11 forwarding o un servidor X remoto:

```bash
# Verificar DISPLAY actual
echo $DISPLAY

# Si está vacío, configurarlo (ajusta según tu configuración)
export DISPLAY=:1
# O para X11 forwarding:
export DISPLAY=localhost:10.0

# Para hacerlo permanente, agregar al ~/.bashrc o ~/.profile:
echo 'export DISPLAY=:1' >> ~/.bashrc
source ~/.bashrc
```

---

## Paso 8: Verificar que la Terminal Está Disponible

```bash
# Verificar qué terminales están disponibles
which xfce4-terminal
which gnome-terminal
which xterm
which konsole

# Al menos una de estas debe estar instalada
# Si ninguna está disponible, instalar una:

# Para XFCE:
sudo apt-get update
sudo apt-get install xfce4-terminal

# Para GNOME:
sudo apt-get install gnome-terminal

# Para XTerm:
sudo apt-get install xterm
```

---

## Paso 9: Probar el Sistema Completo

### 9.1. Verificar que Cron Está Ejecutando el Script

```bash
# Esperar 5 minutos y luego verificar los logs
tail -f /tmp/ezcater_monitor.log

# O ver los últimos logs
tail -20 /tmp/ezcater_monitor.log
```

### 9.2. Verificar que el Bot se Inicia Automáticamente

```bash
# Ver estado del bot
pm2 list

# Ver logs en tiempo real
pm2 logs ezcater_bot_v3

# Ver información detallada
pm2 show ezcater_bot_v3
```

### 9.3. Verificar que la Terminal de Logs se Abre

Si estás en el escritorio de la VM, deberías ver una terminal abierta con los logs del bot.

---

## Paso 10: Comandos Útiles para Monitoreo y Mantenimiento

### Ver Logs del Monitoreo

```bash
# Ver logs en tiempo real
tail -f /tmp/ezcater_monitor.log

# Ver últimas 50 líneas
tail -50 /tmp/ezcater_monitor.log

# Buscar errores
grep -i error /tmp/ezcater_monitor.log
```

### Ver Estado del Bot

```bash
# Listar procesos PM2
pm2 list

# Ver logs del bot
pm2 logs ezcater_bot_v3

# Ver información detallada
pm2 show ezcater_bot_v3

# Monitoreo en tiempo real
pm2 monit
```

### Controlar el Bot Manualmente

```bash
# Iniciar el bot manualmente
pm2 start npm --name "ezcater_bot_v3" -- run test:continuous:v3

# Detener el bot
pm2 stop ezcater_bot_v3

# Reiniciar el bot
pm2 restart ezcater_bot_v3

# Eliminar el bot de PM2
pm2 delete ezcater_bot_v3
```

### Abrir Terminal de Logs Manualmente

```bash
# Si necesitas abrir la terminal de logs manualmente
./open_bot_logs.sh
```

### Verificar Procesos del Keeper de Logs

```bash
# Ver si el keeper está corriendo
ps aux | grep keep_logs_open

# Ver PID del keeper
cat /tmp/ezcater_bot_v3_log_keeper.pid

# Ver PID de la terminal de logs
cat /tmp/ezcater_bot_v3_log_terminal.pid
```

### Detener Todo Manualmente

```bash
# Detener el bot
pm2 stop ezcater_bot_v3
pm2 delete ezcater_bot_v3

# Detener el keeper de logs
kill $(cat /tmp/ezcater_bot_v3_log_keeper.pid) 2>/dev/null || true

# Cerrar terminal de logs
kill $(cat /tmp/ezcater_bot_v3_log_terminal.pid) 2>/dev/null || true

# Limpiar archivos PID
rm -f /tmp/ezcater_bot_v3_log_keeper.pid
rm -f /tmp/ezcater_bot_v3_log_terminal.pid
```

---

## Paso 11: Verificar Configuración de Horarios

Si necesitas cambiar los horarios de inicio y fin, edita el archivo `monitor_bot_v3.sh`:

```bash
# Editar el archivo
nano monitor_bot_v3.sh

# Buscar estas líneas y modificarlas:
START_HOUR="06:00"    # Cambiar por la hora de inicio deseada
END_HOUR="22:00"      # Cambiar por la hora de fin deseada

# Guardar y salir (Ctrl+O, Enter, Ctrl+X en nano)
```

---

## Envío diario del log de detected-orders a Telegram

El script `monitor_bot_v3.sh` envía una vez al día el log de detected-orders a Telegram a las **20:00 hora Miami** (America/New_York). No hace falta configurar un cron aparte: el mismo monitor que controla el horario del bot (6:00–22:00) ejecuta este envío.

**Requisitos:**

- El **servidor API** (main.ts, puerto 3000) debe estar corriendo en la misma VM (por ejemplo con `start_ezcater_web_driver_bot.sh` o PM2). El monitor llama a `http://localhost:3000/api/notifications/send-detected-orders-log`.

**Variables de entorno opcionales:**

- `EZCATER_API_TOKEN`: token de la API para autenticar la petición. Si no se define, el script usa el primer token definido en `config/ezcater_web_driver_bot.yaml`.
- `EZCATER_API_BASE_URL`: URL base del API (por defecto `http://localhost:3000`). Útil si el API está en otro host o puerto.

Para depurar el envío: revisar `/tmp/ezcater_telegram_log_curl.log` y los mensajes del monitor en `/tmp/ezcater_monitor.log`.

---

## Paso 12: Solución de Problemas

### El Bot No Se Inicia

```bash
# Ver logs del monitoreo para encontrar el error
tail -50 /tmp/ezcater_monitor.log

# Ver logs de PM2
pm2 logs ezcater_bot_v3 --lines 100

# Verificar que PM2 está instalado
pm2 --version

# Verificar que Node.js está instalado
node --version

# Verificar que las dependencias están instaladas
ls node_modules/
```

### La Terminal de Logs No Se Abre

```bash
# Verificar que hay una terminal disponible
which xfce4-terminal || which gnome-terminal || which xterm

# Verificar DISPLAY
echo $DISPLAY

# Verificar logs del keeper
tail -20 /tmp/ezcater_log_keeper.log

# Verificar que el keeper está corriendo
ps aux | grep keep_logs_open
```

### Cron No Está Ejecutando el Script

```bash
# Verificar que el cron está configurado
crontab -l

# Ver logs del sistema para errores de cron
sudo grep CRON /var/log/syslog | tail -20

# Verificar permisos del script
ls -la monitor_bot_v3.sh

# Probar ejecutar el script manualmente
./monitor_bot_v3.sh
```

### El Bot Se Detiene Inesperadamente

```bash
# Ver logs de PM2 para encontrar el error
pm2 logs ezcater_bot_v3 --lines 200

# Ver estado del bot
pm2 status

# Ver información detallada
pm2 show ezcater_bot_v3

# Verificar que el script de monitoreo está corriendo
ps aux | grep monitor_bot_v3
```

---

## Resumen de Comandos Esenciales

```bash
# 1. Navegar al proyecto
cd /ruta/a/tu/proyecto/ezcater_web_driver_bot

# 2. Dar permisos
chmod +x monitor_bot_v3.sh keep_logs_open.sh open_bot_logs.sh

# 3. Instalar PM2 (si no está instalado)
npm install -g pm2

# 4. Instalar dependencias
npm install

# 5. Probar manualmente
./monitor_bot_v3.sh

# 6. Configurar cron
crontab -e
# Agregar: */5 * * * * cd /ruta/a/tu/proyecto/ezcater_web_driver_bot && /ruta/a/tu/proyecto/ezcater_web_driver_bot/monitor_bot_v3.sh >> /tmp/ezcater_monitor.log 2>&1

# 7. Verificar
pm2 list
tail -f /tmp/ezcater_monitor.log
```

---

## Notas Importantes

1. **Ruta del Proyecto**: Asegúrate de usar la ruta absoluta completa en el crontab, no rutas relativas.

2. **Permisos**: Los scripts deben tener permisos de ejecución (`chmod +x`).

3. **DISPLAY**: Si estás en un servidor sin GUI, asegúrate de configurar `DISPLAY=:1` o la variable apropiada.

4. **NVM**: Si usas NVM, el script lo detecta automáticamente, pero asegúrate de que NVM esté instalado en `~/.nvm`.

5. **Horarios**: El bot se inicia automáticamente a las 6:00 AM y se detiene a las 10:00 PM (22:00). Puedes cambiar estos horarios editando `monitor_bot_v3.sh`.

6. **Logs**: 
   - Logs del monitoreo: `/tmp/ezcater_monitor.log`
   - Logs del keeper: `/tmp/ezcater_log_keeper.log`
   - Logs del bot: `pm2 logs ezcater_bot_v3`

---

## Verificación Final

Una vez configurado todo, verifica que:

- ✅ El script `monitor_bot_v3.sh` tiene permisos de ejecución
- ✅ El script `keep_logs_open.sh` tiene permisos de ejecución
- ✅ PM2 está instalado y funcionando
- ✅ El crontab está configurado correctamente
- ✅ El bot se inicia automáticamente dentro del rango de horas
- ✅ La terminal de logs se abre automáticamente
- ✅ El bot se detiene automáticamente fuera del rango de horas

---

**¡Listo!** El sistema está configurado para ejecutarse automáticamente entre las 6:00 AM y las 10:00 PM, manteniendo una terminal de logs siempre abierta y disponible.
