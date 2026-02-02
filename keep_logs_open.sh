#!/bin/bash
# Script que mantiene UNA SOLA terminal de logs siempre abierta
# Se ejecuta en un loop para reabrir la terminal si se cierra
# Asegura que solo hay UNA instancia del keeper y UNA terminal abierta

BOT_NAME="ezcater_bot_v3"
LOG_TERMINAL_PID_FILE="/tmp/ezcater_bot_v3_log_terminal.pid"
KEEPER_PID_FILE="/tmp/ezcater_bot_v3_log_keeper.pid"
LOCK_FILE="/tmp/ezcater_bot_v3_keeper.lock"

# Cargar nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Configurar DISPLAY
export DISPLAY=:1

# Detectar terminal disponible
detect_terminal() {
    if command -v xfce4-terminal &> /dev/null; then
        echo "xfce4-terminal"
    elif command -v gnome-terminal &> /dev/null; then
        echo "gnome-terminal"
    elif command -v xterm &> /dev/null; then
        echo "xterm"
    elif command -v konsole &> /dev/null; then
        echo "konsole"
    else
        echo ""
    fi
}

# Verificar si el bot está corriendo
is_bot_running() {
    pm2 list | grep -q "$BOT_NAME" && pm2 list | grep "$BOT_NAME" | grep -q "online"
}

# Verificar si la terminal está abierta (solo UNA)
is_terminal_open() {
    # Primero, verificar si hay múltiples terminales (esto no debería pasar)
    local terminal_count=$(pgrep -f "EZCater Bot V3 - Logs" 2>/dev/null | wc -l)
    if [ "$terminal_count" -gt 1 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ ERROR: Se detectaron $terminal_count terminales. Cerrando todas..."
        pkill -9 -f "EZCater Bot V3 - Logs" 2>/dev/null || true
        rm -f "$LOG_TERMINAL_PID_FILE"
        return 1
    fi
    
    # Verificar PID file
    if [ -f "$LOG_TERMINAL_PID_FILE" ]; then
        local pid=$(cat "$LOG_TERMINAL_PID_FILE" 2>/dev/null)
        if [ -n "$pid" ]; then
            # Verificar que el proceso existe
            if ps -p "$pid" > /dev/null 2>&1; then
                # Verificar que es realmente una terminal (no solo un proceso zombie)
                local cmd=$(ps -p "$pid" -o comm= 2>/dev/null)
                if [ -n "$cmd" ] && [[ "$cmd" =~ (xfce4-terminal|gnome-terminal|xterm|konsole) ]]; then
                    # Verificar que solo hay UNA terminal con el título
                    local title_count=$(pgrep -f "EZCater Bot V3 - Logs" 2>/dev/null | wc -l)
                    if [ "$title_count" -eq 1 ]; then
                        return 0
                    else
                        # Hay múltiples, limpiar
                        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Múltiples terminales detectadas por título. Limpiando..."
                        pkill -9 -f "EZCater Bot V3 - Logs" 2>/dev/null || true
                        rm -f "$LOG_TERMINAL_PID_FILE"
                        return 1
                    fi
                fi
            fi
        fi
        # Si llegamos aquí, el PID no es válido, limpiar
        rm -f "$LOG_TERMINAL_PID_FILE"
    fi
    
    # Verificar también si hay terminales abiertas con el título específico (solo UNA)
    local terminal=$(detect_terminal)
    local title_count=$(pgrep -f "EZCater Bot V3 - Logs" 2>/dev/null | wc -l)
    
    if [ "$title_count" -eq 1 ]; then
        # Hay exactamente una terminal, verificar que sea válida
        local term_pid=$(pgrep -f "EZCater Bot V3 - Logs" | head -1)
        if [ -n "$term_pid" ] && ps -p "$term_pid" > /dev/null 2>&1; then
            echo "$term_pid" > "$LOG_TERMINAL_PID_FILE"
            return 0
        fi
    elif [ "$title_count" -gt 1 ]; then
        # Hay múltiples terminales, cerrar todas
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ ERROR: Se detectaron $title_count terminales. Cerrando todas..."
        pkill -9 -f "EZCater Bot V3 - Logs" 2>/dev/null || true
        rm -f "$LOG_TERMINAL_PID_FILE"
        return 1
    fi
    
    return 1
}

# Cerrar todas las terminales (asegurar que no hay ninguna)
close_all_terminals() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cerrando todas las terminales de logs..."
    
    # Cerrar por PID file
    if [ -f "$LOG_TERMINAL_PID_FILE" ]; then
        local pid=$(cat "$LOG_TERMINAL_PID_FILE" 2>/dev/null)
        if [ -n "$pid" ]; then
            kill "$pid" 2>/dev/null || true
            sleep 1
            kill -9 "$pid" 2>/dev/null || true
        fi
        rm -f "$LOG_TERMINAL_PID_FILE"
    fi
    
    # Cerrar todas las terminales con el título
    pkill -9 -f "EZCater Bot V3 - Logs" 2>/dev/null || true
    sleep 2
    
    # Verificar que no quedan terminales
    local remaining=$(pgrep -f "EZCater Bot V3 - Logs" 2>/dev/null | wc -l)
    if [ "$remaining" -gt 0 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Aún quedan $remaining terminales. Forzando cierre..."
        pkill -9 -f "EZCater Bot V3 - Logs" 2>/dev/null || true
        sleep 1
    fi
}

# Abrir terminal con logs (solo UNA)
open_terminal() {
    # PRIMERO: Verificar si ya hay una terminal abierta y válida
    local existing_count=$(pgrep -f "EZCater Bot V3 - Logs" 2>/dev/null | wc -l)
    
    if [ "$existing_count" -eq 1 ]; then
        # Hay exactamente una terminal, verificar que sea válida
        local existing_pid=$(pgrep -f "EZCater Bot V3 - Logs" | head -1)
        if [ -n "$existing_pid" ] && ps -p "$existing_pid" > /dev/null 2>&1; then
            # La terminal existe y está corriendo, actualizar PID file y no hacer nada más
            echo "$existing_pid" > "$LOG_TERMINAL_PID_FILE"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Terminal ya está abierta y es válida (PID: $existing_pid). No se cerrará."
            return 0
        fi
    elif [ "$existing_count" -gt 1 ]; then
        # Hay múltiples terminales, cerrar todas antes de abrir una nueva
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Se detectaron $existing_count terminales. Cerrando todas antes de abrir una nueva..."
        close_all_terminals
        sleep 2
    fi
    
    # Verificar que no hay terminales (o solo quedó una válida después de limpiar)
    existing_count=$(pgrep -f "EZCater Bot V3 - Logs" 2>/dev/null | wc -l)
    if [ "$existing_count" -gt 0 ]; then
        # Si aún hay terminales después de limpiar, verificar si es válida
        if [ "$existing_count" -eq 1 ]; then
            local remaining_pid=$(pgrep -f "EZCater Bot V3 - Logs" | head -1)
            if [ -n "$remaining_pid" ] && ps -p "$remaining_pid" > /dev/null 2>&1; then
                echo "$remaining_pid" > "$LOG_TERMINAL_PID_FILE"
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Terminal válida encontrada después de limpieza (PID: $remaining_pid). No se abrirá otra."
                return 0
            fi
        else
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✗ ERROR: Aún quedan $existing_count terminales después de limpiar. No se abrirá una nueva."
            return 1
        fi
    fi
    
    local terminal=$(detect_terminal)
    
    if [ -z "$terminal" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] No se encontró terminal disponible"
        return 1
    fi
    
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Abriendo terminal única..."
    
    local term_pid=""
    
    case "$terminal" in
        xfce4-terminal)
            xfce4-terminal \
                --title="EZCater Bot V3 - Logs (Siempre Abierto)" \
                --command="bash -c 'export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"; pm2 logs $BOT_NAME --lines 1000'" \
                --geometry=120x40 \
                &
            term_pid=$!
            ;;
        gnome-terminal)
            gnome-terminal \
                --title="EZCater Bot V3 - Logs (Siempre Abierto)" \
                -- bash -c "export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"; pm2 logs $BOT_NAME --lines 1000" \
                &
            term_pid=$!
            ;;
        xterm)
            xterm \
                -title "EZCater Bot V3 - Logs (Siempre Abierto)" \
                -geometry 120x40 \
                -e "bash -c 'export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"; pm2 logs $BOT_NAME --lines 1000'" \
                &
            term_pid=$!
            ;;
        konsole)
            konsole \
                --title "EZCater Bot V3 - Logs (Siempre Abierto)" \
                -e "bash -c 'export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"; pm2 logs $BOT_NAME --lines 1000'" \
                &
            term_pid=$!
            ;;
    esac
    
    # Esperar un momento para que la terminal se abra
    sleep 5
    
    # Verificar que solo hay UNA terminal abierta
    local final_count=$(pgrep -f "EZCater Bot V3 - Logs" 2>/dev/null | wc -l)
    if [ "$final_count" -eq 0 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✗ ERROR: La terminal no se abrió correctamente"
        rm -f "$LOG_TERMINAL_PID_FILE"
        return 1
    elif [ "$final_count" -gt 1 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✗ ERROR: Se abrieron múltiples terminales ($final_count). Cerrando todas..."
        close_all_terminals
        return 1
    fi
    
    # Obtener el PID real de la terminal (debe ser solo UNA)
    local real_pid=$(pgrep -f "EZCater Bot V3 - Logs" | head -1)
    
    if [ -n "$real_pid" ]; then
        echo "$real_pid" > "$LOG_TERMINAL_PID_FILE"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Terminal única abierta con PID: $real_pid"
        
        # Verificar una vez más que solo hay UNA
        sleep 1
        local verify_count=$(pgrep -f "EZCater Bot V3 - Logs" 2>/dev/null | wc -l)
        if [ "$verify_count" -eq 1 ]; then
            return 0
        else
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✗ ERROR: Verificación falló. Se detectaron $verify_count terminales."
            close_all_terminals
            return 1
        fi
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✗ ERROR: No se pudo obtener el PID de la terminal"
        close_all_terminals
        return 1
    fi
}

# Función principal: mantener la terminal abierta (solo UNA)
keep_logs_open() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando keeper de logs (asegurando terminal única)..."
    
    # Verificar si ya hay una terminal válida al inicio (no cerrarla si existe)
    local initial_count=$(pgrep -f "EZCater Bot V3 - Logs" 2>/dev/null | wc -l)
    if [ "$initial_count" -eq 1 ]; then
        local initial_pid=$(pgrep -f "EZCater Bot V3 - Logs" | head -1)
        if [ -n "$initial_pid" ] && ps -p "$initial_pid" > /dev/null 2>&1; then
            echo "$initial_pid" > "$LOG_TERMINAL_PID_FILE"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Terminal válida ya está abierta (PID: $initial_pid). No se cerrará."
        else
            # Terminal inválida, limpiar
            close_all_terminals
            sleep 2
        fi
    elif [ "$initial_count" -gt 1 ]; then
        # Hay múltiples terminales, cerrar todas
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Se detectaron $initial_count terminales al inicio. Cerrando todas..."
        close_all_terminals
        sleep 2
    fi
    
    while true; do
        # Verificar si el bot está corriendo
        if is_bot_running; then
            # Si el bot está corriendo, asegurar que hay EXACTAMENTE UNA terminal abierta
            if is_terminal_open; then
                # Terminal está abierta y es única, no hacer nada (no cerrarla)
                :
            else
                # Terminal no está abierta o hay múltiples
                # Si hay múltiples, cerrar todas primero
                local term_count=$(pgrep -f "EZCater Bot V3 - Logs" 2>/dev/null | wc -l)
                if [ "$term_count" -gt 1 ]; then
                    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Se detectaron $term_count terminales. Cerrando todas..."
                    close_all_terminals
                    sleep 3
                fi
                
                # Intentar abrir terminal (esta función ahora verifica si ya hay una válida)
                if open_terminal; then
                    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Terminal única verificada/abierta correctamente"
                else
                    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✗ Error al abrir terminal única. Reintentando en 15 segundos..."
                    sleep 15
                fi
            fi
        else
            # Si el bot no está corriendo, cerrar la terminal y salir
            if is_terminal_open; then
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] Bot detenido. Cerrando terminal..."
                close_all_terminals
            fi
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Bot detenido. Cerrando keeper de logs..."
            exit 0
        fi
        
        # Esperar antes de verificar de nuevo
        sleep 10
    done
}

# Verificar si ya hay otra instancia corriendo
check_existing_instance() {
    # Verificar lock file
    if [ -f "$LOCK_FILE" ]; then
        local lock_pid=$(cat "$LOCK_FILE" 2>/dev/null)
        if [ -n "$lock_pid" ] && ps -p "$lock_pid" > /dev/null 2>&1; then
            # Hay otra instancia corriendo
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Otra instancia del keeper ya está corriendo (PID: $lock_pid). Saliendo."
            exit 1
        else
            # Lock file huérfano, eliminarlo
            rm -f "$LOCK_FILE"
        fi
    fi
    
    # Verificar por nombre de proceso
    local existing_pids=$(pgrep -f "keep_logs_open.sh" | grep -v $$)
    if [ -n "$existing_pids" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Encontradas otras instancias del keeper. Deteniéndolas..."
        echo "$existing_pids" | xargs kill 2>/dev/null || true
        sleep 2
        # Forzar si aún existen
        local still_running=$(pgrep -f "keep_logs_open.sh" | grep -v $$)
        if [ -n "$still_running" ]; then
            echo "$still_running" | xargs kill -9 2>/dev/null || true
        fi
        sleep 1
    fi
    
    # Verificar terminales existentes antes de iniciar
    # Solo cerrar si hay múltiples, no si hay una válida
    local existing_count=$(pgrep -f "EZCater Bot V3 - Logs" 2>/dev/null | wc -l)
    if [ "$existing_count" -gt 1 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Se detectaron $existing_count terminales. Cerrando todas antes de iniciar..."
        close_all_terminals
        sleep 2
    elif [ "$existing_count" -eq 1 ]; then
        # Hay una terminal, verificar si es válida
        local existing_pid=$(pgrep -f "EZCater Bot V3 - Logs" | head -1)
        if [ -n "$existing_pid" ] && ps -p "$existing_pid" > /dev/null 2>&1; then
            echo "$existing_pid" > "$LOG_TERMINAL_PID_FILE"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Terminal válida encontrada (PID: $existing_pid). No se cerrará."
        else
            # Terminal inválida, limpiar
            close_all_terminals
            sleep 2
        fi
    fi
}

# Manejar señales para limpiar
cleanup() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Limpiando y cerrando keeper..."
    
    # Cerrar todas las terminales
    close_all_terminals
    
    # Limpiar archivos
    rm -f "$KEEPER_PID_FILE"
    rm -f "$LOCK_FILE"
    
    exit 0
}

trap cleanup SIGTERM SIGINT EXIT

# Verificar instancias existentes antes de iniciar
check_existing_instance

# Crear lock file
echo $$ > "$LOCK_FILE"

# Guardar PID del keeper
echo $$ > "$KEEPER_PID_FILE"

# Iniciar el loop
keep_logs_open
