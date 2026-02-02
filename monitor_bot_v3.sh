#!/bin/bash
# Script de monitoreo que mantiene el bot siempre activo durante el horario configurado
# - Asegura una sola instancia del bot corriendo
# - Asegura una sola terminal abierta para monitoreo
# - Reinicia el bot periódicamente para liberar memoria
# - Solo se ejecuta durante el horario configurado (6:00 AM - 10:00 PM)

# =============================================================================
# CONFIGURACIÓN
# =============================================================================
# Rango de horas (formato 24h: HH:MM)
START_HOUR="06:00"    # 6:00 AM
END_HOUR="22:00"      # 10:00 PM (22:00)

# Intervalo de reinicio del bot (en horas) para liberar memoria
RESTART_INTERVAL_HOURS=6  # Reiniciar cada 6 horas

# Nombre del proceso en PM2
BOT_NAME="ezcater_bot_v3"

# Ruta del proyecto (se detecta automáticamente desde el script)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$SCRIPT_DIR"

# Archivos de control
MONITOR_LOCK_FILE="/tmp/ezcater_bot_v3_monitor.lock"
MONITOR_PID_FILE="/tmp/ezcater_bot_v3_monitor.pid"
BOT_START_TIME_FILE="/tmp/ezcater_bot_v3_start_time.txt"
KEEPER_PID_FILE="/tmp/ezcater_bot_v3_log_keeper.pid"
LOG_TERMINAL_PID_FILE="/tmp/ezcater_bot_v3_log_terminal.pid"

# Ruta al script que mantiene los logs abiertos
KEEPER_SCRIPT="$SCRIPT_DIR/keep_logs_open.sh"

# Intervalo de verificación del monitor (en segundos)
MONITOR_CHECK_INTERVAL=60  # Verificar cada minuto

# Daily Telegram detected-orders log (8:00 PM Miami time)
TELEGRAM_SEND_HOUR="20:00"
TELEGRAM_TZ="America/New_York"
TELEGRAM_LAST_SENT_FILE="/tmp/ezcater_telegram_log_last_sent.txt"
API_BASE_URL="${EZCATER_API_BASE_URL:-http://localhost:3000}"

# =============================================================================
# FUNCIONES DE CONTROL DE INSTANCIAS
# =============================================================================

# Verificar si ya hay otra instancia del monitor corriendo
check_monitor_instance() {
    # Verificar lock file
    if [ -f "$MONITOR_LOCK_FILE" ]; then
        local lock_pid=$(cat "$MONITOR_LOCK_FILE" 2>/dev/null)
        if [ -n "$lock_pid" ] && ps -p "$lock_pid" > /dev/null 2>&1; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Otra instancia del monitor ya está corriendo (PID: $lock_pid)"
            exit 1
        else
            # Lock file huérfano, eliminarlo
            rm -f "$MONITOR_LOCK_FILE"
        fi
    fi
    
    # Verificar por nombre de proceso
    local existing_pids=$(pgrep -f "monitor_bot_v3.sh" | grep -v $$)
    if [ -n "$existing_pids" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Encontradas otras instancias del monitor. Deteniéndolas..."
        echo "$existing_pids" | xargs kill 2>/dev/null || true
        sleep 2
        # Forzar si aún existen
        local still_running=$(pgrep -f "monitor_bot_v3.sh" | grep -v $$)
        if [ -n "$still_running" ]; then
            echo "$still_running" | xargs kill -9 2>/dev/null || true
        fi
        sleep 1
    fi
    
    # Crear lock file
    echo $$ > "$MONITOR_LOCK_FILE"
    echo $$ > "$MONITOR_PID_FILE"
}

# Limpiar archivos de control al salir
cleanup_monitor() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Deteniendo monitor..."
    rm -f "$MONITOR_LOCK_FILE"
    rm -f "$MONITOR_PID_FILE"
    exit 0
}

trap cleanup_monitor SIGTERM SIGINT EXIT

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
    # Verificar que no hay múltiples instancias del keeper
    local keeper_count=$(pgrep -f "keep_logs_open.sh" 2>/dev/null | wc -l)
    if [ "$keeper_count" -gt 0 ]; then
        if [ "$keeper_count" -gt 1 ]; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Múltiples instancias del keeper detectadas ($keeper_count). Limpiando todas..."
            pkill -9 -f "keep_logs_open.sh" 2>/dev/null || true
            sleep 3
            rm -f "$KEEPER_PID_FILE"
            rm -f /tmp/ezcater_bot_v3_keeper.lock
        elif is_log_keeper_running; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Keeper de logs ya está corriendo correctamente"
            return 0
        else
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Proceso keeper encontrado pero no válido. Limpiando..."
            pkill -9 -f "keep_logs_open.sh" 2>/dev/null || true
            sleep 2
            rm -f "$KEEPER_PID_FILE"
            rm -f /tmp/ezcater_bot_v3_keeper.lock
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
    
    # Cerrar todas las terminales con el título (por si hay múltiples)
    pkill -9 -f "EZCater Bot V3 - Logs" 2>/dev/null || true
    
    # Limpiar lock file
    rm -f /tmp/ezcater_bot_v3_keeper.lock
    
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

# Verificar si hay múltiples instancias del bot en PM2
check_multiple_bot_instances() {
    local count=$(pm2 list | grep "$BOT_NAME" | wc -l)
    if [ "$count" -gt 1 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ ADVERTENCIA: Se detectaron $count instancias del bot en PM2. Limpiando..."
        pm2 delete "$BOT_NAME" 2>/dev/null || true
        sleep 2
        return 1
    fi
    return 0
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

# Guardar el tiempo de inicio del bot
save_bot_start_time() {
    date +%s > "$BOT_START_TIME_FILE"
}

# Obtener el tiempo de inicio del bot (en segundos desde epoch)
get_bot_start_time() {
    if [ -f "$BOT_START_TIME_FILE" ]; then
        cat "$BOT_START_TIME_FILE" 2>/dev/null
    else
        echo "0"
    fi
}

# Verificar si el bot necesita reinicio (por tiempo de ejecución)
should_restart_bot() {
    local start_time=$(get_bot_start_time)
    if [ "$start_time" = "0" ]; then
        return 1  # No hay tiempo guardado, no reiniciar
    fi
    
    local current_time=$(date +%s)
    local elapsed_seconds=$((current_time - start_time))
    local restart_interval_seconds=$((RESTART_INTERVAL_HOURS * 3600))
    
    if [ $elapsed_seconds -ge $restart_interval_seconds ]; then
        return 0  # Necesita reinicio
    else
        return 1  # No necesita reinicio
    fi
}

# Reiniciar el bot (detener y volver a iniciar)
restart_bot() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Reiniciando bot (ha estado corriendo por $RESTART_INTERVAL_HOURS horas)..."
    
    # Detener el bot
    if is_bot_running; then
        pm2 stop "$BOT_NAME" 2>/dev/null || true
        sleep 2
        pm2 delete "$BOT_NAME" 2>/dev/null || true
        sleep 1
    fi
    
    # Cerrar procesos de Chrome relacionados
    pkill -f "chrome.*ezcater" 2>/dev/null || true
    sleep 1
    
    # Iniciar el bot de nuevo
    start_bot
}

# Iniciar el bot
start_bot() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando bot $BOT_NAME..."
    
    cd "$PROJECT_DIR" || {
        echo "ERROR: No se pudo cambiar al directorio del proyecto: $PROJECT_DIR"
        exit 1
    }
    
    # Asegurar que el directorio logs existe y tiene permisos correctos
    if [ -f "$PROJECT_DIR/ensure_logs_directory.sh" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Verificando directorio de logs..."
        bash "$PROJECT_DIR/ensure_logs_directory.sh" || {
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Advertencia: Problemas con el directorio de logs, pero continuando..."
        }
    else
        # Fallback: crear directorio manualmente si el script no existe
        if [ ! -d "$PROJECT_DIR/logs" ]; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Creando directorio logs..."
            mkdir -p "$PROJECT_DIR/logs" && chmod 755 "$PROJECT_DIR/logs" || {
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Advertencia: No se pudo crear el directorio logs"
            }
        fi
    fi
    
    # Verificar que no hay múltiples instancias
    check_multiple_bot_instances
    
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
        
        # Guardar tiempo de inicio
        save_bot_start_time
        
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
        # Limpiar archivo de tiempo de inicio
        rm -f "$BOT_START_TIME_FILE"
        return 0
    fi
    
    pm2 stop "$BOT_NAME"
    sleep 1
    pm2 delete "$BOT_NAME"
    
    # También cerrar procesos de Chrome relacionados
    pkill -f "chrome.*ezcater" 2>/dev/null || true
    
    # Detener keeper de logs (esto cerrará la terminal automáticamente)
    stop_log_keeper
    
    # Limpiar archivo de tiempo de inicio
    rm -f "$BOT_START_TIME_FILE"
    
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Bot detenido correctamente"
    return 0
}

# =============================================================================
# DAILY TELEGRAM DETECTED-ORDERS LOG
# =============================================================================

# Obtener token de API: env EZCATER_API_TOKEN o primer token en config YAML
get_api_token() {
    if [ -n "${EZCATER_API_TOKEN:-}" ]; then
        echo "$EZCATER_API_TOKEN"
        return 0
    fi
    local yaml="$PROJECT_DIR/config/ezcater_web_driver_bot.yaml"
    if [ -f "$yaml" ]; then
        local token
        token=$(grep -E "^\s+token:\s+" "$yaml" | head -1 | sed 's/.*token:\s*//' | tr -d ' ')
        if [ -n "$token" ]; then
            echo "$token"
            return 0
        fi
    fi
    return 1
}

# Enviar log de detected-orders a Telegram una vez al día a las 20:00 Miami
send_daily_telegram_log_if_due() {
    local current_date current_time last_sent api_token
    current_date=$(TZ=$TELEGRAM_TZ date +"%Y-%m-%d")
    current_time=$(TZ=$TELEGRAM_TZ date +"%H:%M")
    if [ "$current_time" != "$TELEGRAM_SEND_HOUR" ]; then
        return 0
    fi
    if [ -f "$TELEGRAM_LAST_SENT_FILE" ]; then
        last_sent=$(cat "$TELEGRAM_LAST_SENT_FILE" 2>/dev/null | tr -d '\n')
        if [ "$last_sent" = "$current_date" ]; then
            return 0
        fi
    fi
    if ! api_token=$(get_api_token); then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Daily Telegram log: no API token (set EZCATER_API_TOKEN or token in config)" >&2
        return 1
    fi
    if curl -s -o /tmp/ezcater_telegram_log_curl.log -w "%{http_code}" -X POST \
        "$API_BASE_URL/api/notifications/send-detected-orders-log" \
        -H "Content-Type: application/json" \
        -H "Authorization: Token $api_token" > /tmp/ezcater_telegram_log_http_code.txt 2>/dev/null; then
        local http_code
        http_code=$(cat /tmp/ezcater_telegram_log_http_code.txt 2>/dev/null)
        if [ "$http_code" = "200" ]; then
            echo "$current_date" > "$TELEGRAM_LAST_SENT_FILE"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Daily Telegram detected-orders log sent (8 PM Miami)"
        else
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Daily Telegram log: API returned HTTP $http_code"
        fi
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Daily Telegram log: curl failed (check /tmp/ezcater_telegram_log_curl.log)"
    fi
}

# =============================================================================
# LÓGICA PRINCIPAL - LOOP CONTINUO
# =============================================================================

# Verificar instancia única del monitor
check_monitor_instance

load_nvm
check_pm2

echo "=========================================="
echo "Monitor del bot iniciado - $(date '+%Y-%m-%d %H:%M:%S')"
echo "Rango permitido: $START_HOUR - $END_HOUR"
echo "Intervalo de reinicio: $RESTART_INTERVAL_HOURS horas"
echo "Intervalo de verificación: $MONITOR_CHECK_INTERVAL segundos"
echo "PID del monitor: $$"
echo "=========================================="

# Loop principal del monitor
while true; do
    current_time=$(get_current_time)
    is_running=$(is_bot_running && echo "true" || echo "false")
    in_range=$(is_within_time_range && echo "true" || echo "false")
    
    # Verificar si hay múltiples instancias del bot
    check_multiple_bot_instances
    
    # Decisión: ¿debe estar corriendo?
    if [ "$in_range" = "true" ]; then
        # Debe estar corriendo (entre 6:00 AM y 10:00 PM)
        if [ "$is_running" = "false" ]; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] → El bot debe estar corriendo pero no lo está. Iniciando..."
            start_bot
        else
            # Bot está corriendo, verificar si necesita reinicio
            if should_restart_bot; then
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] → Bot necesita reinicio periódico. Reiniciando..."
                restart_bot
            else
                # Asegurar que el keeper de logs esté corriendo (mantiene terminal siempre abierta)
                if ! is_log_keeper_running; then
                    echo "[$(date '+%Y-%m-%d %H:%M:%S')] → Keeper de logs no está corriendo. Iniciando..."
                    start_log_keeper
                fi
            fi
        fi
    else
        # No debe estar corriendo (fuera de 6:00 AM - 10:00 PM)
        if [ "$is_running" = "true" ]; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] → El bot está corriendo fuera del rango permitido. Deteniendo..."
            stop_bot
        else
            # Asegurar que el keeper de logs esté detenido
            if is_log_keeper_running; then
                stop_log_keeper
            fi
        fi
    fi
    
    # Enviar log de detected-orders a Telegram una vez al día a las 20:00 Miami
    send_daily_telegram_log_if_due
    
    # Esperar antes de la siguiente verificación
    sleep $MONITOR_CHECK_INTERVAL
done
