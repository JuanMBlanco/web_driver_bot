#!/bin/bash
# Script para abrir una terminal con los logs del bot manualmente

BOT_NAME="ezcater_bot_v3"

# Cargar nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Verificar PM2
if ! command -v pm2 &> /dev/null; then
    echo "ERROR: PM2 no está instalado"
    exit 1
fi

# Detectar terminal
if command -v xfce4-terminal &> /dev/null; then
    TERMINAL="xfce4-terminal"
elif command -v gnome-terminal &> /dev/null; then
    TERMINAL="gnome-terminal"
elif command -v xterm &> /dev/null; then
    TERMINAL="xterm"
elif command -v konsole &> /dev/null; then
    TERMINAL="konsole"
else
    echo "No se encontró terminal disponible"
    exit 1
fi

# Verificar que el bot está corriendo
if ! pm2 list | grep -q "$BOT_NAME" || ! pm2 list | grep "$BOT_NAME" | grep -q "online"; then
    echo "⚠ El bot no está corriendo. Mostrando logs de PM2 de todos modos..."
fi

# Abrir terminal con logs
case "$TERMINAL" in
    xfce4-terminal)
        xfce4-terminal \
            --title="EZCater Bot V3 - Logs" \
            --command="bash -c 'export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"; pm2 logs $BOT_NAME --lines 1000'" \
            --geometry=120x40
        ;;
    gnome-terminal)
        gnome-terminal \
            --title="EZCater Bot V3 - Logs" \
            -- bash -c "export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"; pm2 logs $BOT_NAME --lines 1000"
        ;;
    xterm)
        xterm \
            -title "EZCater Bot V3 - Logs" \
            -geometry 120x40 \
            -e "bash -c 'export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"; pm2 logs $BOT_NAME --lines 1000'"
        ;;
    konsole)
        konsole \
            --title "EZCater Bot V3 - Logs" \
            -e "bash -c 'export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"; pm2 logs $BOT_NAME --lines 1000'"
        ;;
esac
