#!/bin/bash
# =============================================================================
# Script para enviar el reporte diario de detected-orders a Telegram
# Diseñado para ejecutarse via crontab a las 8:00 PM hora de Miami
# 
# Este script envía mensajes DIRECTAMENTE a Telegram usando la Bot API,
# sin depender del servidor Express de main.ts
#
# Uso con crontab (ejecutar: crontab -e):
#   0 20 * * * TZ=America/New_York /path/to/project/send_telegram_daily_report.sh >> /tmp/ezcater_telegram_report.log 2>&1
#
# Para testing a las 12:00 PM:
#   0 12 * * * TZ=America/New_York /path/to/project/send_telegram_daily_report.sh >> /tmp/ezcater_telegram_report.log 2>&1
# =============================================================================

# Ruta del proyecto (se detecta automáticamente desde el script)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$SCRIPT_DIR"

# Directorio de logs
LOGS_DIR="$PROJECT_DIR/logs"

# Archivo para evitar envíos duplicados en el mismo día
LAST_SENT_FILE="/tmp/ezcater_telegram_daily_report_last_sent.txt"

# Zona horaria de Miami
TELEGRAM_TZ="America/New_York"

# Telegram API URL
TELEGRAM_API_BASE="https://api.telegram.org/bot"

# Límite de caracteres por mensaje de Telegram
TELEGRAM_MAX_LENGTH=4096

# =============================================================================
# FUNCIONES
# =============================================================================

log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Cargar credenciales de Telegram desde .env.secrets
load_telegram_credentials() {
    local secrets_file="$PROJECT_DIR/config/.env.secrets"
    
    if [ ! -f "$secrets_file" ]; then
        log_message "ERROR: No se encontró archivo de credenciales: $secrets_file"
        return 1
    fi
    
    # Leer TELEGRAM_API_TOKEN
    TELEGRAM_BOT_TOKEN=$(grep -E "^TELEGRAM_API_TOKEN=" "$secrets_file" | cut -d'=' -f2 | tr -d ' \r\n')
    
    # Leer TELEGRAM_CHAT_IDS
    TELEGRAM_CHAT_IDS=$(grep -E "^TELEGRAM_CHAT_IDS=" "$secrets_file" | cut -d'=' -f2 | tr -d ' \r\n')
    
    if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
        log_message "ERROR: TELEGRAM_API_TOKEN no encontrado en $secrets_file"
        return 1
    fi
    
    if [ -z "$TELEGRAM_CHAT_IDS" ]; then
        log_message "ERROR: TELEGRAM_CHAT_IDS no encontrado en $secrets_file"
        return 1
    fi
    
    log_message "Credenciales de Telegram cargadas correctamente"
    log_message "Chat IDs: $TELEGRAM_CHAT_IDS"
    return 0
}

# Obtener la fecha actual en formato YYYY-MM-DD (hora de Miami)
get_today_date() {
    TZ=$TELEGRAM_TZ date +"%Y-%m-%d"
}

# Buscar el archivo de log de detected-orders más reciente para hoy
find_todays_log() {
    local today_date
    today_date=$(get_today_date)
    
    if [ ! -d "$LOGS_DIR" ]; then
        log_message "ERROR: Directorio de logs no existe: $LOGS_DIR"
        return 1
    fi
    
    # Buscar archivos que coincidan con el patrón detected_orders_YYYY-MM-DD*.log
    local log_file
    log_file=$(find "$LOGS_DIR" -maxdepth 1 -name "detected_orders_${today_date}*.log" -type f -printf "%T@ %p\n" 2>/dev/null | sort -rn | head -1 | cut -d" " -f2-)
    
    if [ -z "$log_file" ] || [ ! -f "$log_file" ]; then
        log_message "No se encontró archivo de log para hoy ($today_date)"
        return 1
    fi
    
    echo "$log_file"
    return 0
}

# Leer y formatear el contenido del log como RESUMEN
# Extrae el último ciclo de detección y muestra un resumen formateado
format_log_content() {
    local log_file="$1"
    local today_date
    today_date=$(get_today_date)
    
    if [ ! -f "$log_file" ]; then
        echo "No hay datos de órdenes detectadas para hoy."
        return
    fi
    
    local content
    content=$(cat "$log_file")
    
    if [ -z "$content" ]; then
        echo "📋 *Detected Orders Summary*
📅 Fecha: $today_date

No se detectaron órdenes hoy."
        return
    fi
    
    # Contar ciclos de detección (líneas con "Total orders detected")
    local cycle_count
    cycle_count=$(grep -c "# Total orders detected:" "$log_file" 2>/dev/null || echo "0")
    
    # Obtener el último ciclo de detección
    local last_header_line
    last_header_line=$(grep -n "# Total orders detected:" "$log_file" | tail -1 | cut -d: -f1)
    
    if [ -z "$last_header_line" ]; then
        echo "📋 *Detected Orders Summary*
📅 Fecha: $today_date

⚠️ No se encontraron ciclos de detección en el log."
        return
    fi
    
    # Extraer información del último ciclo
    local last_cycle_header
    last_cycle_header=$(sed -n "${last_header_line}p" "$log_file")
    
    # Extraer total de órdenes y timestamp del header
    local total_orders
    total_orders=$(echo "$last_cycle_header" | grep -oP 'Total orders detected: \K[0-9]+')
    
    local detection_time
    detection_time=$(echo "$last_cycle_header" | grep -oP 'Timestamp: \K[^\s]+')
    
    # Extraer las órdenes del último ciclo
    local orders_data
    orders_data=$(tail -n +$((last_header_line + 2)) "$log_file" | grep -E "^[0-9]{4}-[0-9]{2}-[0-9]{2}T" | head -n "$total_orders")
    
    # Formatear las órdenes para el mensaje
    local formatted_orders=""
    while IFS= read -r line; do
        if [ -n "$line" ]; then
            local order_code
            order_code=$(echo "$line" | awk -F'|' '{print $2}' | tr -d ' ')
            local delivery_time
            delivery_time=$(echo "$line" | awk -F'|' '{print $3}' | tr -d ' ')
            local status
            status=$(echo "$line" | awk -F'|' '{print $4}' | tr -d ' ')
            
            case "$status" in
                "N/A") status="Completed" ;;
                "Completed") status="Completed" ;;
                "In Progress"|"InProgress") status="In Progress" ;;
            esac
            
            formatted_orders="${formatted_orders}${order_code} | ${delivery_time} | ${status}
"
        fi
    done <<< "$orders_data"
    
    echo "📋 *Detected Orders Summary*

Total orders: *${total_orders}*
Detection time: ${detection_time}

_Order Code | Delivery Time | Status_
${formatted_orders}
_Note: Log contains ${cycle_count} detection cycles. Showing latest._"
}

# Dividir mensaje largo en partes
split_message() {
    local message="$1"
    local max_length=$((TELEGRAM_MAX_LENGTH - 100))  # Margen de seguridad
    
    if [ ${#message} -le $max_length ]; then
        echo "$message"
        return
    fi
    
    # Dividir por líneas para no cortar en medio de una línea
    local current_part=""
    local part_num=1
    
    while IFS= read -r line; do
        if [ $((${#current_part} + ${#line} + 1)) -gt $max_length ]; then
            if [ -n "$current_part" ]; then
                echo "---PART_SEPARATOR---"
                echo "$current_part"
            fi
            current_part="$line"
            part_num=$((part_num + 1))
        else
            if [ -n "$current_part" ]; then
                current_part="$current_part
$line"
            else
                current_part="$line"
            fi
        fi
    done <<< "$message"
    
    # Última parte
    if [ -n "$current_part" ]; then
        echo "---PART_SEPARATOR---"
        echo "$current_part"
    fi
}

# Enviar mensaje a un chat específico
send_to_chat() {
    local chat_id="$1"
    local message="$2"
    local parse_mode="${3:-Markdown}"
    
    local api_url="${TELEGRAM_API_BASE}${TELEGRAM_BOT_TOKEN}/sendMessage"
    
    local response
    local http_code
    
    # Crear archivo temporal para el cuerpo de la petición
    local temp_file
    temp_file=$(mktemp)
    
    # Escapar caracteres especiales para JSON
    local escaped_message
    escaped_message=$(echo "$message" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
    
    echo "{\"chat_id\": \"$chat_id\", \"text\": \"$escaped_message\", \"parse_mode\": \"$parse_mode\"}" > "$temp_file"
    
    http_code=$(curl -s -o /tmp/telegram_response.json -w "%{http_code}" -X POST \
        "$api_url" \
        -H "Content-Type: application/json" \
        -d @"$temp_file" \
        --connect-timeout 30 \
        --max-time 60)
    
    rm -f "$temp_file"
    
    if [ "$http_code" = "200" ]; then
        log_message "✓ Mensaje enviado a chat $chat_id (HTTP $http_code)"
        return 0
    else
        log_message "ERROR: Falló envío a chat $chat_id (HTTP $http_code)"
        if [ -f /tmp/telegram_response.json ]; then
            log_message "Respuesta: $(cat /tmp/telegram_response.json)"
        fi
        return 1
    fi
}

# Enviar mensaje a todos los chats configurados
send_to_all_chats() {
    local message="$1"
    local success_count=0
    local fail_count=0
    
    # Convertir lista de chat IDs separados por coma en array
    IFS=',' read -ra CHAT_ARRAY <<< "$TELEGRAM_CHAT_IDS"
    
    for chat_id in "${CHAT_ARRAY[@]}"; do
        # Limpiar espacios
        chat_id=$(echo "$chat_id" | tr -d ' ')
        
        if [ -n "$chat_id" ]; then
            log_message "Enviando a chat ID: $chat_id"
            
            # Verificar si el mensaje es muy largo y necesita dividirse
            if [ ${#message} -gt $TELEGRAM_MAX_LENGTH ]; then
                log_message "Mensaje muy largo (${#message} chars), dividiendo..."
                
                # Enviar encabezado primero
                local header="📋 *Reporte de Órdenes Detectadas*
📅 Fecha: $(get_today_date)
📊 Reporte dividido en múltiples mensajes"
                
                if send_to_chat "$chat_id" "$header"; then
                    sleep 1
                fi
                
                # Dividir el contenido del log y enviar
                local log_content
                log_content=$(cat "$LOG_FILE_PATH" 2>/dev/null || echo "Sin contenido")
                
                local chunk_size=3500
                local total_length=${#log_content}
                local offset=0
                local part=1
                
                while [ $offset -lt $total_length ]; do
                    local chunk="${log_content:$offset:$chunk_size}"
                    local part_message="📄 Parte $part:
\`\`\`
$chunk
\`\`\`"
                    
                    if send_to_chat "$chat_id" "$part_message"; then
                        ((success_count++))
                    else
                        ((fail_count++))
                    fi
                    
                    offset=$((offset + chunk_size))
                    part=$((part + 1))
                    sleep 1  # Evitar rate limiting
                done
            else
                if send_to_chat "$chat_id" "$message"; then
                    ((success_count++))
                else
                    ((fail_count++))
                fi
            fi
        fi
    done
    
    log_message "Resumen: $success_count envíos exitosos, $fail_count fallidos"
    
    if [ $fail_count -eq 0 ]; then
        return 0
    else
        return 1
    fi
}

# Verificar si ya se envió el reporte hoy
already_sent_today() {
    local current_date
    current_date=$(get_today_date)
    
    if [ -f "$LAST_SENT_FILE" ]; then
        local last_sent
        last_sent=$(cat "$LAST_SENT_FILE" 2>/dev/null | tr -d '\n')
        if [ "$last_sent" = "$current_date" ]; then
            return 0  # Ya se envió hoy
        fi
    fi
    return 1  # No se ha enviado hoy
}

# Marcar como enviado hoy
mark_as_sent() {
    local current_date
    current_date=$(get_today_date)
    echo "$current_date" > "$LAST_SENT_FILE"
}

# Enviar el reporte a Telegram
send_telegram_report() {
    # Cargar credenciales
    if ! load_telegram_credentials; then
        return 1
    fi
    
    # Buscar archivo de log de hoy
    LOG_FILE_PATH=$(find_todays_log)
    local log_found=$?
    
    local message
    if [ $log_found -eq 0 ] && [ -n "$LOG_FILE_PATH" ]; then
        log_message "Archivo de log encontrado: $LOG_FILE_PATH"
        message=$(format_log_content "$LOG_FILE_PATH")
    else
        log_message "No se encontró archivo de log para hoy"
        message="📋 *Reporte de Órdenes Detectadas*
📅 Fecha: $(get_today_date)

ℹ️ No se encontraron órdenes detectadas para hoy.

_Este es un mensaje automático del sistema EzCater Bot._"
    fi
    
    log_message "Enviando reporte a Telegram..."
    
    if send_to_all_chats "$message"; then
        mark_as_sent
        return 0
    else
        return 1
    fi
}

# =============================================================================
# MAIN
# =============================================================================

log_message "=========================================="
log_message "Iniciando envío de reporte diario a Telegram"
log_message "Zona horaria: $TELEGRAM_TZ"
log_message "Fecha/Hora actual (Miami): $(TZ=$TELEGRAM_TZ date '+%Y-%m-%d %H:%M:%S')"
log_message "Directorio de logs: $LOGS_DIR"
log_message "=========================================="

# Verificar si ya se envió hoy
if already_sent_today; then
    log_message "El reporte ya fue enviado hoy. Saliendo."
    exit 0
fi

# Enviar el reporte
if send_telegram_report; then
    log_message "Proceso completado exitosamente"
    exit 0
else
    log_message "Proceso completado con errores"
    exit 1
fi
