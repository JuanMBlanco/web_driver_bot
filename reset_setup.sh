#!/bin/bash
# Script para resetear completamente el setup y preparar para reiniciar

echo "=========================================="
echo "RESET COMPLETO DEL SETUP"
echo "=========================================="
echo ""

BOT_NAME="ezcater_bot_v3"
KEEPER_PID_FILE="/tmp/ezcater_bot_v3_log_keeper.pid"
TERMINAL_PID_FILE="/tmp/ezcater_bot_v3_log_terminal.pid"

# 1. Detener todos los procesos
echo "1. Deteniendo todos los procesos..."
echo ""

# Detener keepers
echo "   → Deteniendo keepers de logs..."
pkill -9 -f "keep_logs_open.sh" 2>/dev/null || true
sleep 3
# Limpiar lock files
rm -f /tmp/ezcater_bot_v3_keeper.lock

# Cerrar todas las terminales
echo "   → Cerrando terminales del bot..."
pkill -9 -f "EZCater Bot V3 - Logs" 2>/dev/null || true
pkill -9 -f "EZCater Bot V3" 2>/dev/null || true
sleep 2

# Detener el bot en PM2
echo "   → Deteniendo bot en PM2..."
pm2 stop "$BOT_NAME" 2>/dev/null || true
pm2 delete "$BOT_NAME" 2>/dev/null || true
sleep 1

# Cerrar procesos de Chrome
echo "   → Cerrando procesos de Chrome relacionados..."
pkill -9 -f "chrome.*ezcater" 2>/dev/null || true

echo "   ✓ Todos los procesos detenidos"
echo ""

# 2. Limpiar archivos PID y temporales
echo "2. Limpiando archivos temporales..."
rm -f "$KEEPER_PID_FILE"
rm -f "$TERMINAL_PID_FILE"
rm -f /tmp/ezcater_bot_v3_keeper.lock
rm -f /tmp/ezcater_log_keeper.log
echo "   ✓ Archivos temporales limpiados"
echo ""

# 3. Eliminar tarea de cron
echo "3. Eliminando tarea de cron..."
if crontab -l 2>/dev/null | grep -q "monitor_bot_v3.sh"; then
    echo "   → Eliminando entrada de cron para monitor_bot_v3.sh..."
    # Eliminar todas las líneas que contengan monitor_bot_v3.sh
    (crontab -l 2>/dev/null | grep -v "monitor_bot_v3.sh") | crontab -
    if [ $? -eq 0 ]; then
        echo "   ✓ Tarea de cron eliminada"
    else
        echo "   ⚠ Error al eliminar tarea de cron"
    fi
else
    echo "   ✓ No hay tarea de cron configurada"
fi
echo ""

# 4. Verificar estado de PM2
echo "4. Verificando estado de PM2..."
if pm2 list | grep -q "$BOT_NAME"; then
    echo "   ⚠ Aún hay procesos del bot en PM2, eliminando..."
    pm2 delete "$BOT_NAME" 2>/dev/null || true
    pm2 save --force 2>/dev/null || true
else
    echo "   ✓ PM2 limpio"
fi
echo ""

# 5. Verificar procesos restantes
echo "5. Verificando procesos restantes..."
KEEPER_COUNT=$(pgrep -f "keep_logs_open" 2>/dev/null | wc -l)
TERMINAL_COUNT=$(pgrep -f "EZCater Bot V3" 2>/dev/null | wc -l)

if [ "$KEEPER_COUNT" -gt 0 ] || [ "$TERMINAL_COUNT" -gt 0 ]; then
    echo "   ⚠ Aún hay procesos activos:"
    if [ "$KEEPER_COUNT" -gt 0 ]; then
        echo "      - Keepers: $KEEPER_COUNT"
        ps aux | grep "keep_logs_open" | grep -v grep
    fi
    if [ "$TERMINAL_COUNT" -gt 0 ]; then
        echo "      - Terminales: $TERMINAL_COUNT"
        ps aux | grep "EZCater Bot V3" | grep -v grep
    fi
    echo ""
    echo "   ¿Deseas forzar la detención? (s/n)"
    read -r response
    if [[ "$response" =~ ^[Ss]$ ]]; then
        pkill -9 -f "keep_logs_open" 2>/dev/null || true
        pkill -9 -f "EZCater Bot V3" 2>/dev/null || true
        sleep 2
        echo "   ✓ Procesos forzados a detenerse"
    fi
else
    echo "   ✓ No hay procesos restantes"
fi
echo ""

# 6. Mostrar resumen
echo "=========================================="
echo "RESET COMPLETADO"
echo "=========================================="
echo ""
echo "Estado actual:"
echo "  - Bot en PM2: $(pm2 list | grep -q "$BOT_NAME" && echo "❌ Aún existe" || echo "✓ Limpio")"
echo "  - Keepers: $(pgrep -f "keep_logs_open" > /dev/null && echo "❌ Aún corriendo" || echo "✓ Detenidos")"
echo "  - Terminales: $(pgrep -f "EZCater Bot V3" > /dev/null && echo "❌ Aún abiertas" || echo "✓ Cerradas")"
echo "  - Cron: $(crontab -l 2>/dev/null | grep -q "monitor_bot_v3.sh" && echo "❌ Aún configurado" || echo "✓ Eliminado")"
echo ""
echo "Próximos pasos:"
echo "  1. Ejecutar el setup: ./setup_monitor.sh"
echo "  2. O iniciar manualmente: ./monitor_bot_v3.sh"
echo ""
echo "=========================================="
