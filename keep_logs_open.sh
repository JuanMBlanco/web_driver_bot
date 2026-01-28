#!/bin/bash
# Script que mantiene la terminal de logs siempre abierta
# Se ejecuta en un loop para reabrir la terminal si se cierra

BOT_NAME="ezcater_bot_v3"
LOG_TERMINAL_PID_FILE="/tmp/ezcater_bot_v3_log_terminal.pid"
KEEPER_PID_FILE="/tmp/ezcater_bot_v3_log_keeper.pid"

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
        if [ -n "$pid" ] && ps -p "$pid" > /dev/null 2>&1; then
            return 0
        else
            rm -f "$LOG_TERMINAL_PID_FILE"
            return 1
        fi
    fi
    return 1
}

# Abrir terminal con logs
open_terminal() {
    local terminal=$(detect_terminal)
    
    if [ -z "$terminal" ]; then
        return 1
    fi
    
    case "$terminal" in
        xfce4-terminal)
            xfce4-terminal \
                --title="EZCater Bot V3 - Logs (Siempre Abierto)" \
                --command="bash -c 'export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"; pm2 logs $BOT_NAME --lines 1000'" \
                --geometry=120x40 \
                &
            echo $! > "$LOG_TERMINAL_PID_FILE"
            ;;
        gnome-terminal)
            gnome-terminal \
                --title="EZCater Bot V3 - Logs (Siempre Abierto)" \
                -- bash -c "export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"; pm2 logs $BOT_NAME --lines 1000" \
                &
            echo $! > "$LOG_TERMINAL_PID_FILE"
            ;;
        xterm)
            xterm \
                -title "EZCater Bot V3 - Logs (Siempre Abierto)" \
                -geometry 120x40 \
                -e "bash -c 'export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"; pm2 logs $BOT_NAME --lines 1000'" \
                &
            echo $! > "$LOG_TERMINAL_PID_FILE"
            ;;
        konsole)
            konsole \
                --title "EZCater Bot V3 - Logs (Siempre Abierto)" \
                -e "bash -c 'export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"; pm2 logs $BOT_NAME --lines 1000'" \
                &
            echo $! > "$LOG_TERMINAL_PID_FILE"
            ;;
    esac
    
    sleep 2
    if is_terminal_open; then
        return 0
    else
        return 1
    fi
}

# Función principal: mantener la terminal abierta
keep_logs_open() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando keeper de logs..."
    
    while true; do
        # Verificar si el bot está corriendo
        if is_bot_running; then
            # Si el bot está corriendo, asegurar que la terminal esté abierta
            if ! is_terminal_open; then
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] Terminal cerrada. Reabriendo..."
                open_terminal
            fi
        else
            # Si el bot no está corriendo, cerrar la terminal y salir
            if is_terminal_open; then
                local pid=$(cat "$LOG_TERMINAL_PID_FILE" 2>/dev/null)
                if [ -n "$pid" ]; then
                    kill "$pid" 2>/dev/null || true
                fi
                rm -f "$LOG_TERMINAL_PID_FILE"
            fi
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Bot detenido. Cerrando keeper de logs..."
            exit 0
        fi
        
        # Esperar 5 segundos antes de verificar de nuevo
        sleep 5
    done
}

# Manejar señales para limpiar
cleanup() {
    if [ -f "$LOG_TERMINAL_PID_FILE" ]; then
        local pid=$(cat "$LOG_TERMINAL_PID_FILE" 2>/dev/null)
        if [ -n "$pid" ]; then
            kill "$pid" 2>/dev/null || true
        fi
        rm -f "$LOG_TERMINAL_PID_FILE"
    fi
    rm -f "$KEEPER_PID_FILE"
    exit 0
}

trap cleanup SIGTERM SIGINT

# Guardar PID del keeper
echo $$ > "$KEEPER_PID_FILE"

# Iniciar el loop
keep_logs_open
