#!/bin/bash
# Script de monitoreo que verifica si el bot debe estar corriendo
# y lo inicia/detiene según el rango de horas configurado
# Configurado para: 6:00 AM - 10:00 PM (22:00)
# Mantiene una consola abierta con los logs mientras el bot está corriendo

# =============================================================================
# CONFIGURACIÓN
# =============================================================================
# Rango de horas (formato 24h: HH:MM)
START_HOUR="06:00"    # 6:00 AM
END_HOUR="22:00"      # 10:00 PM (22:00)

# Nombre del proceso en PM2
BOT_NAME="ezcater_bot_v3"

# Ruta del proyecto (se detecta automáticamente desde el script)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$SCRIPT_DIR"

# Archivo PID para el keeper de logs
KEEPER_PID_FILE="/tmp/ezcater_bot_v3_log_keeper.pid"
LOG_TERMINAL_PID_FILE="/tmp/ezcater_bot_v3_log_terminal.pid"

# Ruta al script que mantiene los logs abiertos
KEEPER_SCRIPT="$SCRIPT_DIR/keep_logs_open.sh"

# =============================================================================
# FUNCIONES PARA TERMINAL DE LOGS
# =============================================================================

# Verificar si el keeper de logs está corriendo
is_log_keeper_running() {
    if [ -f "$KEEPER_PID_FILE" ]; then
        local pid=$(cat "$KEEPER_PID_FILE" 2>/dev/null)
        if [ -n "$pid" ] && ps -p "$pid" > /dev/null 2>&1; then
            return 0  # Keeper está corriendo
        else
            # PID file existe pero el proceso no, limpiar
            rm -f "$KEEPER_PID_FILE"
            return 1
        fi
    fi
    return 1  # Keeper no está corriendo
}

# Iniciar el keeper de logs (mantiene la terminal siempre abierta)
start_log_keeper() {
    # Si ya está corriendo, verificar que realmente está corriendo
    if is_log_keeper_running; then
        # Verificar también que no hay múltiples instancias
        local keeper_count=$(pgrep -f "keep_logs_open.sh" | wc -l)
        if [ "$keeper_count" -gt 1 ]; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Múltiples instancias del keeper detectadas. Limpiando..."
            # Matar todas las instancias excepto la actual
            pkill -f "keep_logs_open.sh" 2>/dev/null || true
            sleep 2
            rm -f "$KEEPER_PID_FILE"
        else
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Keeper de logs ya está corriendo"
            return 0
        fi
    fi
    
    # Verificar que el script existe
    if [ ! -f "$KEEPER_SCRIPT" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Error: No se encontró $KEEPER_SCRIPT"
        return 1
    fi
    
    # Dar permisos de ejecución si no los tiene
    if [ ! -x "$KEEPER_SCRIPT" ]; then
        chmod +x "$KEEPER_SCRIPT"
    fi
    
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando keeper de logs (mantiene terminal siempre abierta)..."
    
    # Configurar DISPLAY si es necesario
    export DISPLAY=:1
    
    # Ejecutar el keeper en background
    nohup bash "$KEEPER_SCRIPT" > /tmp/ezcater_log_keeper.log 2>&1 &
    local keeper_pid=$!
    
    # Guardar el PID
    echo $keeper_pid > "$KEEPER_PID_FILE"
    
    # Esperar un momento para verificar que se inició
    sleep 2
    if is_log_keeper_running; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Keeper de logs iniciado correctamente (PID: $keeper_pid)"
        return 0
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✗ Error al iniciar keeper de logs"
        rm -f "$KEEPER_PID_FILE"
        return 1
    fi
}

# Detener el keeper de logs
stop_log_keeper() {
    if [ -f "$KEEPER_PID_FILE" ]; then
        local pid=$(cat "$KEEPER_PID_FILE" 2>/dev/null)
        if [ -n "$pid" ] && ps -p "$pid" > /dev/null 2>&1; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Deteniendo keeper de logs..."
            kill "$pid" 2>/dev/null || true
            sleep 2
            # Asegurarse de que se cerró
            if ps -p "$pid" > /dev/null 2>&1; then
                kill -9 "$pid" 2>/dev/null || true
            fi
        fi
        rm -f "$KEEPER_PID_FILE"
    fi
    
    # También cerrar la terminal si está abierta
    if [ -f "$LOG_TERMINAL_PID_FILE" ]; then
        local term_pid=$(cat "$LOG_TERMINAL_PID_FILE" 2>/dev/null)
        if [ -n "$term_pid" ] && ps -p "$term_pid" > /dev/null 2>&1; then
            kill "$term_pid" 2>/dev/null || true
            sleep 1
            kill -9 "$term_pid" 2>/dev/null || true
        fi
        rm -f "$LOG_TERMINAL_PID_FILE"
    fi
    
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Keeper de logs detenido"
    return 0
}

# =============================================================================
# FUNCIONES PRINCIPALES
# =============================================================================

# Cargar nvm si es necesario
load_nvm() {
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
}

# Verificar si PM2 está disponible
check_pm2() {
    if ! command -v pm2 &> /dev/null; then
        echo "ERROR: PM2 no está instalado"
        exit 1
    fi
}

# Verificar si el bot está corriendo en PM2
is_bot_running() {
    pm2 list | grep -q "$BOT_NAME" && pm2 list | grep "$BOT_NAME" | grep -q "online"
}

# Obtener hora actual en formato HH:MM
get_current_time() {
    date +"%H:%M"
}

# Convertir hora HH:MM a minutos desde medianoche
time_to_minutes() {
    local time_str=$1
    local hour=$(echo $time_str | cut -d: -f1 | sed 's/^0//')
    local minute=$(echo $time_str | cut -d: -f2 | sed 's/^0//')
    hour=${hour:-0}
    minute=${minute:-0}
    echo $((hour * 60 + minute))
}

# Verificar si la hora actual está dentro del rango
is_within_time_range() {
    local current_time=$(get_current_time)
    local current_minutes=$(time_to_minutes "$current_time")
    local start_minutes=$(time_to_minutes "$START_HOUR")
    local end_minutes=$(time_to_minutes "$END_HOUR")
    
    # Rango normal (no cruza medianoche: 06:00 a 22:00)
    if [ $current_minutes -ge $start_minutes ] && [ $current_minutes -lt $end_minutes ]; then
        return 0  # Dentro del rango
    else
        return 1  # Fuera del rango
    fi
}

# Iniciar el bot
start_bot() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando bot $BOT_NAME..."
    
    cd "$PROJECT_DIR" || {
        echo "ERROR: No se pudo cambiar al directorio del proyecto: $PROJECT_DIR"
        exit 1
    }
    
    # Configurar DISPLAY si es necesario
    export DISPLAY=:1
    
    # Verificar si ya está corriendo
    if is_bot_running; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] El bot ya está corriendo"
        # Asegurar que el keeper de logs esté corriendo
        if ! is_log_keeper_running; then
            start_log_keeper
        fi
        return 0
    fi
    
    # Limpiar instancias anteriores si existen
    if pm2 list | grep -q "$BOT_NAME"; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Limpiando instancia anterior..."
        pm2 delete "$BOT_NAME" 2>/dev/null || true
        sleep 1
    fi
    
    # Iniciar con PM2
    pm2 start npm --name "$BOT_NAME" -- run test:continuous:v3
    
    # Esperar un momento y verificar
    sleep 3
    if is_bot_running; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Bot iniciado correctamente"
        
        # Iniciar keeper de logs (mantiene terminal siempre abierta)
        sleep 2  # Esperar un poco más para que PM2 genere logs
        start_log_keeper
        
        return 0
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✗ Error al iniciar el bot"
        pm2 logs "$BOT_NAME" --lines 10 --nostream 2>/dev/null || true
        return 1
    fi
}

# Detener el bot
stop_bot() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Deteniendo bot $BOT_NAME..."
    
    if ! is_bot_running; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] El bot no está corriendo"
        # Detener keeper de logs de todos modos
        stop_log_keeper
        return 0
    fi
    
    pm2 stop "$BOT_NAME"
    sleep 1
    pm2 delete "$BOT_NAME"
    
    # También cerrar procesos de Chrome relacionados
    pkill -f "chrome.*ezcater" 2>/dev/null || true
    
    # Detener keeper de logs (esto cerrará la terminal automáticamente)
    stop_log_keeper
    
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Bot detenido correctamente"
    return 0
}

# =============================================================================
# LÓGICA PRINCIPAL
# =============================================================================

load_nvm
check_pm2

current_time=$(get_current_time)
is_running=$(is_bot_running && echo "true" || echo "false")
in_range=$(is_within_time_range && echo "true" || echo "false")

echo "=========================================="
echo "Monitoreo del bot - $(date '+%Y-%m-%d %H:%M:%S')"
echo "Hora actual: $current_time"
echo "Rango permitido: $START_HOUR - $END_HOUR"
echo "Bot corriendo: $is_running"
echo "Dentro del rango: $in_range"
echo "=========================================="

# Decisión: ¿debe estar corriendo?
if [ "$in_range" = "true" ]; then
    # Debe estar corriendo (entre 6:00 AM y 10:00 PM)
    if [ "$is_running" = "false" ]; then
        echo "→ El bot debe estar corriendo pero no lo está. Iniciando..."
        start_bot
    else
        echo "→ El bot está corriendo correctamente."
        # Asegurar que el keeper de logs esté corriendo (mantiene terminal siempre abierta)
        if ! is_log_keeper_running; then
            echo "→ Keeper de logs no está corriendo. Iniciando..."
            start_log_keeper
        else
            echo "→ Keeper de logs está corriendo. Terminal de logs disponible."
        fi
    fi
else
    # No debe estar corriendo (fuera de 6:00 AM - 10:00 PM)
    if [ "$is_running" = "true" ]; then
        echo "→ El bot está corriendo fuera del rango permitido. Deteniendo..."
        stop_bot
    else
        echo "→ El bot está detenido (fuera del rango). No se requiere acción."
        # Asegurar que el keeper de logs esté detenido
        if is_log_keeper_running; then
            stop_log_keeper
        fi
    fi
fi

echo "=========================================="
