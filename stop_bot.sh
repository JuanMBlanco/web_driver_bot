#!/bin/bash
# Script para detener el bot y todos los procesos relacionados

BOT_NAME="ezcater_bot_v3"
KEEPER_PID_FILE="/tmp/ezcater_bot_v3_log_keeper.pid"
TERMINAL_PID_FILE="/tmp/ezcater_bot_v3_log_terminal.pid"

echo "=========================================="
echo "Deteniendo Bot EZCater V3"
echo "=========================================="
echo ""

# 1. Detener el bot en PM2
echo "1. Deteniendo el bot en PM2..."
if pm2 list | grep -q "$BOT_NAME"; then
    pm2 stop "$BOT_NAME" 2>/dev/null || true
    sleep 1
    pm2 delete "$BOT_NAME" 2>/dev/null || true
    echo "   ✓ Bot detenido y eliminado de PM2"
else
    echo "   → El bot no está corriendo en PM2"
fi
echo ""

# 2. Detener el keeper de logs
echo "2. Deteniendo keeper de logs..."
if [ -f "$KEEPER_PID_FILE" ]; then
    KEEPER_PID=$(cat "$KEEPER_PID_FILE" 2>/dev/null)
    if [ -n "$KEEPER_PID" ] && ps -p "$KEEPER_PID" > /dev/null 2>&1; then
        kill "$KEEPER_PID" 2>/dev/null || true
        sleep 2
        if ps -p "$KEEPER_PID" > /dev/null 2>&1; then
            kill -9 "$KEEPER_PID" 2>/dev/null || true
        fi
        echo "   ✓ Keeper de logs detenido"
    else
        echo "   → Keeper de logs no está corriendo"
    fi
    rm -f "$KEEPER_PID_FILE"
else
    echo "   → Keeper de logs no está corriendo"
fi
echo ""

# 3. Cerrar terminal de logs
echo "3. Cerrando terminal de logs..."
# Cerrar por PID si existe
if [ -f "$TERMINAL_PID_FILE" ]; then
    TERMINAL_PID=$(cat "$TERMINAL_PID_FILE" 2>/dev/null)
    if [ -n "$TERMINAL_PID" ] && ps -p "$TERMINAL_PID" > /dev/null 2>&1; then
        kill "$TERMINAL_PID" 2>/dev/null || true
        sleep 1
        if ps -p "$TERMINAL_PID" > /dev/null 2>&1; then
            kill -9 "$TERMINAL_PID" 2>/dev/null || true
        fi
    fi
    rm -f "$TERMINAL_PID_FILE"
fi
# Cerrar todas las terminales con el título del bot (por si hay múltiples)
pkill -9 -f "EZCater Bot V3 - Logs" 2>/dev/null || true
sleep 1
echo "   ✓ Terminales de logs cerradas"
echo ""

# 4. Cerrar procesos de Chrome relacionados
echo "4. Cerrando procesos de Chrome relacionados..."
CHROME_PROCESSES=$(pgrep -f "chrome.*ezcater" 2>/dev/null | wc -l)
if [ "$CHROME_PROCESSES" -gt 0 ]; then
    pkill -f "chrome.*ezcater" 2>/dev/null || true
    sleep 1
    pkill -9 -f "chrome.*ezcater" 2>/dev/null || true
    echo "   ✓ Procesos de Chrome cerrados"
else
    echo "   → No hay procesos de Chrome relacionados"
fi
echo ""

# 5. Verificar estado final
echo "5. Verificando estado final..."
echo ""
echo "   Procesos PM2:"
pm2 list | grep -E "(ezcater|$BOT_NAME)" || echo "   → Ningún proceso relacionado encontrado"
echo ""
echo "   Procesos del sistema:"
ps aux | grep -E "(ezcater|keep_logs_open|monitor_bot)" | grep -v grep || echo "   → Ningún proceso relacionado encontrado"
echo ""

echo "=========================================="
echo "✓ Proceso de detención completado"
echo "=========================================="
echo ""
echo "Nota: El cron seguirá ejecutándose cada 5 minutos."
echo "      Si deseas detener el monitoreo automático, ejecuta:"
echo "      crontab -e"
echo "      (y elimina o comenta la línea del monitor)"
echo ""
