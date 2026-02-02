#!/bin/bash
# Script de configuración rápida del sistema de monitoreo
# Ejecuta los pasos esenciales para configurar el bot en la VM Linux

set -e  # Salir si hay algún error

echo "=========================================="
echo "Configuración del Sistema de Monitoreo"
echo "=========================================="
echo ""

# Obtener la ruta del proyecto
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$SCRIPT_DIR"

echo "Directorio del proyecto: $PROJECT_DIR"
echo ""

# Paso 1: Dar permisos de ejecución
echo "Paso 1: Dando permisos de ejecución a los scripts..."
chmod +x monitor_bot_v3.sh 2>/dev/null || echo "  ⚠ monitor_bot_v3.sh no encontrado"
chmod +x keep_logs_open.sh 2>/dev/null || echo "  ⚠ keep_logs_open.sh no encontrado"
chmod +x open_bot_logs.sh 2>/dev/null || echo "  ⚠ open_bot_logs.sh no encontrado"
chmod +x start_ezcater_web_driver_bot.sh 2>/dev/null || echo "  ⚠ start_ezcater_web_driver_bot.sh no encontrado"
chmod +x ensure_logs_directory.sh 2>/dev/null || echo "  ⚠ ensure_logs_directory.sh no encontrado"
echo "  ✓ Permisos configurados"
echo ""

# Paso 1.5: Asegurar directorio de logs
echo "Paso 1.5: Verificando directorio de logs..."
if [ -f "$PROJECT_DIR/ensure_logs_directory.sh" ]; then
    bash "$PROJECT_DIR/ensure_logs_directory.sh"
    if [ $? -eq 0 ]; then
        echo "  ✓ Directorio de logs verificado"
    else
        echo "  ⚠ Problemas con el directorio de logs (ver mensajes arriba)"
    fi
else
    # Crear directorio manualmente si el script no existe
    if [ ! -d "$PROJECT_DIR/logs" ]; then
        mkdir -p "$PROJECT_DIR/logs" && chmod 755 "$PROJECT_DIR/logs" && echo "  ✓ Directorio logs creado" || echo "  ⚠ No se pudo crear directorio logs"
    else
        echo "  ✓ Directorio logs existe"
    fi
fi
echo ""

# Paso 2: Verificar PM2
echo "Paso 2: Verificando PM2..."
if command -v pm2 &> /dev/null; then
    PM2_VERSION=$(pm2 --version)
    echo "  ✓ PM2 está instalado (versión: $PM2_VERSION)"
else
    echo "  ⚠ PM2 no está instalado"
    echo "  → Instalando PM2..."
    
    # Cargar NVM si existe
    export NVM_DIR="$HOME/.nvm"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        . "$NVM_DIR/nvm.sh"
        echo "  → NVM detectado y cargado"
    fi
    
    npm install -g pm2
    echo "  ✓ PM2 instalado"
fi
echo ""

# Paso 3: Verificar Node.js
echo "Paso 3: Verificando Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "  ✓ Node.js está instalado (versión: $NODE_VERSION)"
else
    echo "  ✗ Node.js no está instalado"
    echo "  → Por favor, instala Node.js primero"
    exit 1
fi
echo ""

# Paso 4: Verificar dependencias
echo "Paso 4: Verificando dependencias del proyecto..."
if [ -d "node_modules" ]; then
    echo "  ✓ node_modules existe"
else
    echo "  ⚠ node_modules no existe"
    echo "  → Instalando dependencias..."
    
    # Cargar NVM si existe
    export NVM_DIR="$HOME/.nvm"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        . "$NVM_DIR/nvm.sh"
    fi
    
    if [ -f "package.json" ]; then
        npm install
        echo "  ✓ Dependencias instaladas"
    else
        echo "  ✗ package.json no encontrado"
    fi
fi
echo ""

# Paso 5: Verificar terminal disponible
echo "Paso 5: Verificando terminal disponible..."
if command -v xfce4-terminal &> /dev/null; then
    echo "  ✓ xfce4-terminal disponible"
elif command -v gnome-terminal &> /dev/null; then
    echo "  ✓ gnome-terminal disponible"
elif command -v xterm &> /dev/null; then
    echo "  ✓ xterm disponible"
elif command -v konsole &> /dev/null; then
    echo "  ✓ konsole disponible"
else
    echo "  ⚠ No se encontró terminal disponible"
    echo "  → Instala una terminal (xfce4-terminal, gnome-terminal, xterm o konsole)"
fi
echo ""

# Paso 6: Verificar DISPLAY
echo "Paso 6: Verificando DISPLAY..."
if [ -z "$DISPLAY" ]; then
    echo "  ⚠ DISPLAY no está configurado"
    echo "  → Configurando DISPLAY=:1"
    export DISPLAY=:1
    echo "  → Para hacerlo permanente, agrega 'export DISPLAY=:1' a ~/.bashrc"
else
    echo "  ✓ DISPLAY está configurado: $DISPLAY"
fi
echo ""

# Paso 7: Configurar cron
echo "Paso 7: Configuración de Cron"
echo ""
echo "¿Deseas configurar el cron automáticamente? (s/n)"
read -r response

if [[ "$response" =~ ^[Ss]$ ]]; then
    CRON_LINE="*/5 * * * * cd $PROJECT_DIR && $PROJECT_DIR/monitor_bot_v3.sh >> /tmp/ezcater_monitor.log 2>&1"
    
    # Verificar si ya existe
    if crontab -l 2>/dev/null | grep -q "monitor_bot_v3.sh"; then
        echo "  ⚠ Ya existe una entrada de cron para monitor_bot_v3.sh"
        echo "  → Entrada actual:"
        crontab -l 2>/dev/null | grep "monitor_bot_v3.sh"
        echo ""
        echo "¿Deseas reemplazarla? (s/n)"
        read -r replace_response
        if [[ "$replace_response" =~ ^[Ss]$ ]]; then
            # Eliminar la línea existente y agregar la nueva
            (crontab -l 2>/dev/null | grep -v "monitor_bot_v3.sh"; echo "$CRON_LINE") | crontab -
            echo "  ✓ Cron actualizado"
        else
            echo "  → Cron no modificado"
        fi
    else
        # Agregar la nueva línea
        (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
        echo "  ✓ Cron configurado"
    fi
    
    echo ""
    echo "  Entrada de cron agregada:"
    echo "  $CRON_LINE"
else
    echo "  → Cron no configurado"
    echo ""
    echo "  Para configurarlo manualmente, ejecuta:"
    echo "  crontab -e"
    echo ""
    echo "  Y agrega esta línea:"
    echo "  */5 * * * * cd $PROJECT_DIR && $PROJECT_DIR/monitor_bot_v3.sh >> /tmp/ezcater_monitor.log 2>&1"
fi
echo ""

# Paso 8: Probar el script
echo "Paso 8: Prueba del sistema"
echo ""
echo "¿Deseas probar el script de monitoreo ahora? (s/n)"
read -r test_response

if [[ "$test_response" =~ ^[Ss]$ ]]; then
    echo "  → Ejecutando monitor_bot_v3.sh..."
    echo ""
    ./monitor_bot_v3.sh
    echo ""
    echo "  ✓ Prueba completada"
else
    echo "  → Prueba omitida"
fi
echo ""

# Resumen
echo "=========================================="
echo "Resumen de la Configuración"
echo "=========================================="
echo ""
echo "✓ Scripts con permisos de ejecución"
echo "✓ PM2 verificado/instalado"
echo "✓ Node.js verificado"
echo "✓ Dependencias verificadas"
echo "✓ Terminal verificada"
echo "✓ DISPLAY configurado"
if [[ "$response" =~ ^[Ss]$ ]]; then
    echo "✓ Cron configurado"
else
    echo "⚠ Cron pendiente de configuración manual"
fi
echo ""
echo "Próximos pasos:"
echo "1. Verifica que el cron está configurado: crontab -l"
echo "2. Monitorea los logs: tail -f /tmp/ezcater_monitor.log"
echo "3. Verifica el estado del bot: pm2 list"
echo "4. Ver logs del bot: pm2 logs ezcater_bot_v3"
echo ""
echo "Para más información, consulta: SETUP_VM_LINUX.md"
echo ""
echo "=========================================="
echo "Configuración completada!"
echo "=========================================="
