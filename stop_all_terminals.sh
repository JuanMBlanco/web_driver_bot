#!/bin/bash
# Script de emergencia para detener todas las terminales y procesos relacionados

echo "=========================================="
echo "DETENIENDO TODAS LAS TERMINALES Y PROCESOS"
echo "=========================================="
echo ""

# 1. Detener todos los keepers
echo "1. Deteniendo todos los keepers de logs..."
pkill -9 -f "keep_logs_open.sh" 2>/dev/null || true
sleep 2
echo "   ✓ Keepers detenidos"
echo ""

# 2. Cerrar todas las terminales con el título del bot
echo "2. Cerrando todas las terminales del bot..."
pkill -9 -f "EZCater Bot V3 - Logs" 2>/dev/null || true
pkill -9 -f "EZCater Bot V3" 2>/dev/null || true
sleep 2
echo "   ✓ Terminales cerradas"
echo ""

# 3. Detener el bot en PM2
echo "3. Deteniendo el bot en PM2..."
pm2 stop ezcater_bot_v3 2>/dev/null || true
pm2 delete ezcater_bot_v3 2>/dev/null || true
sleep 1
echo "   ✓ Bot detenido"
echo ""

# 4. Limpiar archivos PID
echo "4. Limpiando archivos PID..."
rm -f /tmp/ezcater_bot_v3_log_keeper.pid
rm -f /tmp/ezcater_bot_v3_log_terminal.pid
echo "   ✓ Archivos PID limpiados"
echo ""

# 5. Verificar procesos restantes
echo "5. Verificando procesos restantes..."
echo ""
echo "   Procesos keep_logs_open:"
ps aux | grep "keep_logs_open" | grep -v grep || echo "   → Ninguno"
echo ""
echo "   Terminales del bot:"
ps aux | grep -E "(EZCater|ezcater_bot_v3)" | grep -v grep || echo "   → Ninguna"
echo ""

# 6. Cerrar procesos de Chrome relacionados
echo "6. Cerrando procesos de Chrome relacionados..."
pkill -9 -f "chrome.*ezcater" 2>/dev/null || true
echo "   ✓ Procesos de Chrome cerrados"
echo ""

echo "=========================================="
echo "✓ TODOS LOS PROCESOS DETENIDOS"
echo "=========================================="
echo ""
echo "Si el problema persiste, verifica:"
echo "1. Que el cron no esté ejecutando el monitor: crontab -l"
echo "2. Que no haya otros scripts ejecutándose: ps aux | grep monitor"
echo ""
