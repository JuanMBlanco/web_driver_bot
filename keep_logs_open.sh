#!/bin/bash
# Script que mantiene la terminal de logs siempre abierta
# Se ejecuta en un loop para reabrir la terminal si se cierra

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

# Verificar si la terminal está abierta
is_terminal_open() {
    if [ -f "$LOG_TERMINAL_PID_FILE" ]; then
        local pid=$(cat "$LOG_TERMINAL_PID_FILE" 2>/dev/null)
        if [ -n "$pid" ]; then
            # Verificar que el proceso existe
            if ps -p "$pid" > /dev/null 2>&1; then
                # Verificar que es realmente una terminal (no solo un proceso zombie)
                local cmd=$(ps -p "$pid" -o comm= 2>/dev/null)
                if [ -n "$cmd" ] && [[ "$cmd" =~ (xfce4-terminal|gnome-terminal|xterm|konsole) ]]; then
                    return 0
                fi
            fi
        fi
        # Si llegamos aquí, el PID no es válido, limpiar
        rm -f "$LOG_TERMINAL_PID_FILE"
    fi
    
    # Verificar también si hay terminales abiertas con el título específico
    local terminal=$(detect_terminal)
    case "$terminal" in
        xfce4-terminal)
            if pgrep -f "EZCater Bot V3 - Logs" > /dev/null 2>&1; then
                return 0
            fi
            ;;
        gnome-terminal)
            if pgrep -f "EZCater Bot V3 - Logs" > /dev/null 2>&1; then
                return 0
            fi
            ;;
        xterm)
            if pgrep -f "EZCater Bot V3 - Logs" > /dev/null 2>&1; then
                return 0
            fi
            ;;
        konsole)
            if pgrep -f "EZCater Bot V3 - Logs" > /dev/null 2>&1; then
                return 0
            fi
            ;;
    esac
    
    return 1
}

# Abrir terminal con logs
open_terminal() {
    # Verificar primero si ya hay una terminal abierta
    if is_terminal_open; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Terminal ya está abierta, no se abrirá otra"
        return 0
    fi
    
    # Verificar que no haya múltiples terminales abiertas
    local terminal_count=$(pgrep -f "EZCater Bot V3 - Logs" 2>/dev/null | wc -l)
    if [ "$terminal_count" -gt 0 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Encontradas $terminal_count terminales abiertas. Cerrando todas..."
        pkill -9 -f "EZCater Bot V3 - Logs" 2>/dev/null || true
        sleep 2
        rm -f "$LOG_TERMINAL_PID_FILE"
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
    
    # Esperar un momento y buscar el PID real de la terminal
    sleep 4
    
    # Buscar el PID real de la terminal por su título (solo UNA)
    local real_pid=""
    case "$terminal" in
        xfce4-terminal|gnome-terminal|xterm|konsole)
            # Buscar el proceso de la terminal por su comando (solo el primero)
            real_pid=$(pgrep -f "EZCater Bot V3 - Logs" | head -1)
            ;;
    esac
    
    # Verificar que solo hay UNA terminal
    local final_count=$(pgrep -f "EZCater Bot V3 - Logs" 2>/dev/null | wc -l)
    if [ "$final_count" -gt 1 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ ERROR: Se abrieron múltiples terminales ($final_count). Cerrando todas..."
        pkill -9 -f "EZCater Bot V3 - Logs" 2>/dev/null || true
        sleep 2
        rm -f "$LOG_TERMINAL_PID_FILE"
        return 1
    fi
    
    # Si encontramos un PID real, usarlo; si no, usar el PID del proceso hijo
    if [ -n "$real_pid" ]; then
        echo "$real_pid" > "$LOG_TERMINAL_PID_FILE"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Terminal abierta con PID: $real_pid"
    elif [ -n "$term_pid" ]; then
        echo "$term_pid" > "$LOG_TERMINAL_PID_FILE"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Terminal abierta con PID: $term_pid"
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ No se pudo obtener el PID de la terminal"
        return 1
    fi
    
    # Verificar que la terminal está realmente abierta
    sleep 1
    if is_terminal_open; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Terminal verificada y funcionando"
        return 0
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✗ Terminal no se pudo verificar"
        rm -f "$LOG_TERMINAL_PID_FILE"
        return 1
    fi
}

# Función principal: mantener la terminal abierta
keep_logs_open() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando keeper de logs..."
    
    # Variable para rastrear si la terminal está abierta
    local terminal_was_open=false
    
    while true; do
        # Verificar si el bot está corriendo
        if is_bot_running; then
            # Si el bot está corriendo, asegurar que la terminal esté abierta
            if is_terminal_open; then
                terminal_was_open=true
                # Terminal está abierta, no hacer nada
            else
                # Terminal no está abierta
                # Verificar que no haya múltiples terminales antes de abrir una nueva
                local term_count=$(pgrep -f "EZCater Bot V3 - Logs" 2>/dev/null | wc -l)
                if [ "$term_count" -gt 0 ]; then
                    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Encontradas $term_count terminales pero no detectadas correctamente. Limpiando..."
                    pkill -9 -f "EZCater Bot V3 - Logs" 2>/dev/null || true
                    rm -f "$LOG_TERMINAL_PID_FILE"
                    sleep 3
                fi
                
                if [ "$terminal_was_open" = "true" ]; then
                    # La terminal se cerró, esperar un poco antes de reabrir
                    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Terminal cerrada. Esperando antes de reabrir..."
                    sleep 5
                fi
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] Abriendo terminal..."
                if open_terminal; then
                    terminal_was_open=true
                else
                    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Error al abrir terminal, reintentando en 15 segundos..."
                    terminal_was_open=false
                    sleep 15
                fi
            fi
        else
            # Si el bot no está corriendo, cerrar la terminal y salir
            if is_terminal_open; then
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] Bot detenido. Cerrando terminal..."
                # Cerrar todas las terminales con el título
                pkill -f "EZCater Bot V3 - Logs" 2>/dev/null || true
                local pid=$(cat "$LOG_TERMINAL_PID_FILE" 2>/dev/null)
                if [ -n "$pid" ]; then
                    kill "$pid" 2>/dev/null || true
                fi
                rm -f "$LOG_TERMINAL_PID_FILE"
                sleep 2
            fi
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Bot detenido. Cerrando keeper de logs..."
            exit 0
        fi
        
        # Esperar 10 segundos antes de verificar de nuevo (aumentado para evitar loops)
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
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Otra instancia del keeper ya está corriendo (PID: $lock_pid)"
            exit 0
        else
            # Lock file huérfano, eliminarlo
            rm -f "$LOCK_FILE"
        fi
    fi
    
    # Verificar por nombre de proceso
    local existing_pids=$(pgrep -f "keep_logs_open.sh" | grep -v $$)
    if [ -n "$existing_pids" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Encontradas otras instancias del keeper. Deteniéndolas..."
        echo "$existing_pids" | xargs kill 2>/dev/null || true
        sleep 2
        # Forzar si aún existen
        local still_running=$(pgrep -f "keep_logs_open.sh" | grep -v $$)
        if [ -n "$still_running" ]; then
            echo "$still_running" | xargs kill -9 2>/dev/null || true
        fi
        sleep 1
    fi
}

# Manejar señales para limpiar
cleanup() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Limpiando y cerrando keeper..."
    
    # Cerrar terminal si está abierta
    if [ -f "$LOG_TERMINAL_PID_FILE" ]; then
        local pid=$(cat "$LOG_TERMINAL_PID_FILE" 2>/dev/null)
        if [ -n "$pid" ]; then
            kill "$pid" 2>/dev/null || true
        fi
        rm -f "$LOG_TERMINAL_PID_FILE"
    fi
    
    # Cerrar todas las terminales con el título
    pkill -f "EZCater Bot V3 - Logs" 2>/dev/null || true
    
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
