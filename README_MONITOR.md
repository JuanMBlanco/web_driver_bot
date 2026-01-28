# Monitor del Bot EZCater V3

Este script monitorea automáticamente el bot y lo inicia/detiene según el rango de horas configurado.

## Configuración

### Horarios
- **Inicio**: 6:00 AM
- **Fin**: 10:00 PM (22:00)

### Características
- Verifica cada 5 minutos si el bot debe estar corriendo
- Inicia el bot automáticamente si no está corriendo (dentro del rango)
- Detiene el bot automáticamente si está corriendo (fuera del rango)
- Mantiene una consola abierta con los logs mientras el bot está corriendo
- Reabre la consola automáticamente si se cierra mientras el bot está corriendo

## Instalación

### 1. Dar permisos de ejecución

```bash
chmod +x monitor_bot_v3.sh
chmod +x open_bot_logs.sh
```

### 2. Probar manualmente

```bash
./monitor_bot_v3.sh
```

### 3. Configurar ejecución automática

#### Opción A: Con Cron (recomendado)

```bash
crontab -e
```

Agrega esta línea (ajusta la ruta según tu proyecto):

```cron
# Monitorear bot v3 cada 5 minutos
*/5 * * * * cd /ruta/a/tu/proyecto/ezcater_web_driver_bot && /ruta/a/tu/proyecto/ezcater_web_driver_bot/monitor_bot_v3.sh >> /tmp/ezcater_monitor.log 2>&1
```

**Nota**: Reemplaza `/ruta/a/tu/proyecto/ezcater_web_driver_bot` con la ruta real de tu proyecto.

#### Opción B: Con Systemd Timer

Crea `/etc/systemd/system/ezcater-bot-v3-monitor.service`:

```ini
[Unit]
Description=Monitor EZCater Bot V3 (6:00 AM - 22:00)
After=network.target

[Service]
Type=oneshot
User=tu_usuario
WorkingDirectory=/ruta/a/tu/proyecto/ezcater_web_driver_bot
Environment="NODE_ENV=production"
Environment="DISPLAY=:1"
ExecStart=/ruta/a/tu/proyecto/ezcater_web_driver_bot/monitor_bot_v3.sh
StandardOutput=journal
StandardError=journal
```

Crea `/etc/systemd/system/ezcater-bot-v3-monitor.timer`:

```ini
[Unit]
Description=Monitor EZCater Bot V3 cada 5 minutos
Requires=ezcater-bot-v3-monitor.service

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
```

Activar:

```bash
sudo systemctl daemon-reload
sudo systemctl enable ezcater-bot-v3-monitor.timer
sudo systemctl start ezcater-bot-v3-monitor.timer

# Verificar
sudo systemctl status ezcater-bot-v3-monitor.timer
```

## Uso

### Verificar estado

```bash
# Ver si el bot está corriendo
pm2 list | grep ezcater_bot_v3

# Ver logs del monitoreo
tail -f /tmp/ezcater_monitor.log

# Ver logs del bot
pm2 logs ezcater_bot_v3
```

### Abrir logs manualmente

```bash
./open_bot_logs.sh
```

### Comandos PM2 útiles

```bash
# Ver todos los procesos
pm2 list

# Ver logs en tiempo real
pm2 logs ezcater_bot_v3

# Reiniciar el bot
pm2 restart ezcater_bot_v3

# Detener el bot
pm2 stop ezcater_bot_v3

# Eliminar el bot de PM2
pm2 delete ezcater_bot_v3

# Ver información detallada
pm2 show ezcater_bot_v3

# Monitoreo en tiempo real
pm2 monit
```

## Personalización

### Cambiar horarios

Edita las variables en `monitor_bot_v3.sh`:

```bash
START_HOUR="06:00"    # Cambia por la hora de inicio (formato HH:MM)
END_HOUR="22:00"      # Cambia por la hora de fin (formato HH:MM)
```

Ejemplos:
- `START_HOUR="07:30"` y `END_HOUR="20:00"` → 7:30 AM a 8:00 PM
- `START_HOUR="08:00"` y `END_HOUR="18:00"` → 8:00 AM a 6:00 PM

### Cambiar intervalo de verificación

En cron, cambia `*/5` por el intervalo deseado:
- `*/1` → cada minuto
- `*/5` → cada 5 minutos (recomendado)
- `*/10` → cada 10 minutos
- `*/15` → cada 15 minutos

## Comportamiento del Script

### Dentro del rango (6:00 AM - 10:00 PM)
- ✅ Si el bot **NO** está corriendo → Lo inicia y abre la consola de logs
- ✅ Si el bot **SÍ** está corriendo → Verifica que la consola esté abierta, si no, la abre
- ✅ Si la consola se cerró → La reabre automáticamente

### Fuera del rango (10:00 PM - 6:00 AM)
- ❌ Si el bot **SÍ** está corriendo → Lo detiene y cierra la consola de logs
- ❌ Si el bot **NO** está corriendo → No hace nada

## Solución de Problemas

### El bot no inicia

```bash
# Ver logs del monitoreo
tail -f /tmp/ezcater_monitor.log

# Ver logs de PM2
pm2 logs ezcater_bot_v3

# Verificar que PM2 está instalado
pm2 --version

# Verificar que el script tiene permisos
ls -la monitor_bot_v3.sh
```

### La consola no se abre

```bash
# Verificar que hay una terminal disponible
which xfce4-terminal
which gnome-terminal
which xterm

# Verificar DISPLAY
echo $DISPLAY

# Abrir manualmente
./open_bot_logs.sh
```

### El bot se detiene inesperadamente

```bash
# Ver logs de PM2 para encontrar el error
pm2 logs ezcater_bot_v3 --lines 100

# Verificar estado
pm2 status

# Verificar que el script de monitoreo está corriendo
ps aux | grep monitor_bot_v3
```

### Verificar que cron está ejecutando el script

```bash
# Ver logs de cron
grep CRON /var/log/syslog | tail -20

# Verificar crontab
crontab -l

# Ver logs del monitoreo
tail -f /tmp/ezcater_monitor.log
```

## Notas Importantes

1. **Terminal disponible**: El script detecta automáticamente la terminal disponible (xfce4-terminal, gnome-terminal, xterm, konsole). Si ninguna está disponible, el script continuará pero no abrirá la consola.

2. **DISPLAY**: Si estás en un servidor sin GUI, asegúrate de configurar `DISPLAY=:1` o la variable apropiada para tu entorno.

3. **PM2**: El script requiere que PM2 esté instalado globalmente: `npm install -g pm2`

4. **NVM**: Si usas NVM para Node.js, el script lo detecta y carga automáticamente.

5. **Logs**: Los logs del monitoreo se guardan en `/tmp/ezcater_monitor.log`

## Ejemplo de Salida del Script

```
==========================================
Monitoreo del bot - 2026-01-27 15:30:00
Hora actual: 15:30
Rango permitido: 06:00 - 22:00
Bot corriendo: false
Dentro del rango: true
==========================================
→ El bot debe estar corriendo pero no lo está. Iniciando...
[2026-01-27 15:30:00] Iniciando bot ezcater_bot_v3...
[2026-01-27 15:30:03] ✓ Bot iniciado correctamente
[2026-01-27 15:30:05] Abriendo terminal con logs del bot...
[2026-01-27 15:30:07] ✓ Terminal de logs abierta correctamente
==========================================
```

---

**¡Listo!** El script está configurado para mantener el bot corriendo entre las 6:00 AM y las 10:00 PM, con una consola de logs siempre visible.
