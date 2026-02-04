#!/bin/bash

# =============================================================================
# Script de Despliegue Rápido de Cambios
# =============================================================================
# Este script facilita el proceso de aplicar cambios de código a la VM Linux
# sin necesidad de ejecutar el setup completo
# =============================================================================

set -e

# Colors using tput
RED=$(tput setaf 1)
GREEN=$(tput setaf 2)
YELLOW=$(tput setaf 3)
BLUE=$(tput setaf 4)
BOLD=$(tput bold)
RESET=$(tput sgr0)

# Default values
APP_NAME="ezcater_bot_v3"
SKIP_BUILD="false"
SHOW_LOGS="true"

# =============================================================================
# Functions
# =============================================================================

print_help() {
    cat << EOF
${GREEN}Script de Despliegue Rápido de Cambios${RESET}

${BLUE}USAGE:${RESET}
    $0 [OPTIONS]

${BLUE}OPTIONS:${RESET}
    --app=<name>        Nombre de la aplicación en PM2 (default: ezcater_bot_v3)
    --skip-build        Saltar la compilación (solo reiniciar PM2)
    --no-logs           No mostrar logs después del reinicio
    --help              Mostrar esta ayuda

${BLUE}EJEMPLOS:${RESET}
    ${YELLOW}# Despliegue básico (recompilar y reiniciar)${RESET}
    $0

    ${YELLOW}# Solo reiniciar sin recompilar${RESET}
    $0 --skip-build

    ${YELLOW}# Despliegue sin mostrar logs${RESET}
    $0 --no-logs

EOF
}

print_error() {
    echo "${RED}ERROR: $1${RESET}" >&2
}

print_success() {
    echo "${GREEN}✓ $1${RESET}"
}

print_info() {
    echo "${BLUE}➜ $1${RESET}"
}

print_warning() {
    echo "${YELLOW}⚠ $1${RESET}"
}

# =============================================================================
# Parse arguments
# =============================================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --app=*)
            APP_NAME="${1#*=}"
            shift
            ;;
        --skip-build)
            SKIP_BUILD="true"
            shift
            ;;
        --no-logs)
            SHOW_LOGS="false"
            shift
            ;;
        --help)
            print_help
            exit 0
            ;;
        *)
            print_error "Opción desconocida: $1"
            print_help
            exit 1
            ;;
    esac
done

# =============================================================================
# Main script
# =============================================================================

echo "${GREEN}═══════════════════════════════════════════════════════════════${RESET}"
echo "${GREEN}${BOLD}        Despliegue Rápido de Cambios${RESET}"
echo "${GREEN}═══════════════════════════════════════════════════════════════${RESET}"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

print_info "Directorio del proyecto: $SCRIPT_DIR"
echo ""

# Step 1: Check if PM2 is available
print_info "Paso 1: Verificando PM2..."
if ! command -v pm2 &> /dev/null; then
    print_error "PM2 no está instalado. Por favor instálalo primero: npm install -g pm2"
    exit 1
fi
print_success "PM2 está disponible"
echo ""

# Step 2: Check if app is running
print_info "Paso 2: Verificando estado de la aplicación..."
if ! pm2 list | grep -q "$APP_NAME"; then
    print_warning "La aplicación '$APP_NAME' no está corriendo en PM2"
    print_info "¿Deseas iniciarla? (s/n)"
    read -r response
    if [[ "$response" =~ ^[Ss]$ ]]; then
        print_info "Iniciando aplicación..."
        if [ "$SKIP_BUILD" = "false" ]; then
            npm run build
        fi
        pm2 start npm --name "$APP_NAME" -- start
        print_success "Aplicación iniciada"
    else
        print_info "Saliendo sin iniciar la aplicación"
        exit 0
    fi
else
    APP_STATUS=$(pm2 list | grep "$APP_NAME" | awk '{print $10}')
    if [ "$APP_STATUS" = "errored" ]; then
        print_warning "La aplicación está en estado 'errored', limpiando..."
        pm2 delete "$APP_NAME" 2>/dev/null || true
        sleep 1
    fi
    print_success "Aplicación encontrada en PM2 (estado: $APP_STATUS)"
fi
echo ""

# Step 4: Build (if not skipped)
if [ "$SKIP_BUILD" = "false" ]; then
    print_info "Paso 4: Compilando TypeScript..."
    if [ ! -f "package.json" ]; then
        print_error "package.json no encontrado. ¿Estás en el directorio correcto?"
        exit 1
    fi
    
    if grep -q '"build"' package.json; then
        if npm run build; then
            print_success "Compilación completada"
            
            # Verify build output
            if [ ! -f "dist/main.js" ] && [ ! -f "dist/test-continuous-v3.js" ]; then
                print_warning "Compilación completada pero no se encontró dist/main.js ni dist/test-continuous-v3.js"
                print_info "Verificando contenido de dist/..."
                ls -la dist/ 2>/dev/null || print_warning "Directorio dist/ no existe"
            fi
        else
            print_error "Error en la compilación"
            exit 1
        fi
    else
        print_warning "No se encontró script 'build' en package.json, saltando compilación"
    fi
    echo ""
else
    print_info "Paso 3: Saltando compilación (--skip-build)"
    echo ""
fi

# Step 4: Restart PM2
print_info "Paso 4: Reiniciando aplicación en PM2..."
if pm2 restart "$APP_NAME"; then
    print_success "Aplicación reiniciada exitosamente"
else
    print_error "Error al reiniciar la aplicación"
    exit 1
fi
echo ""

# Step 5: Wait a moment and check status
print_info "Paso 5: Verificando estado..."
sleep 2
APP_STATUS=$(pm2 list | grep "$APP_NAME" | awk '{print $10}')
if [ "$APP_STATUS" = "online" ]; then
    print_success "Aplicación está online"
elif [ "$APP_STATUS" = "errored" ]; then
    print_error "Aplicación está en estado 'errored'"
    print_info "Revisa los logs con: pm2 logs $APP_NAME"
    exit 1
else
    print_warning "Estado de la aplicación: $APP_STATUS"
fi
echo ""

# Step 6: Show logs (if requested)
if [ "$SHOW_LOGS" = "true" ]; then
    print_info "Paso 6: Mostrando últimas 30 líneas de logs..."
    echo ""
    echo "${YELLOW}─────────────────────────────────────────────────────────────${RESET}"
    pm2 logs "$APP_NAME" --lines 30 --nostream
    echo "${YELLOW}─────────────────────────────────────────────────────────────${RESET}"
    echo ""
    print_info "Para ver logs en tiempo real: ${GREEN}pm2 logs $APP_NAME${RESET}"
    echo ""
fi

# Summary
echo "${GREEN}═══════════════════════════════════════════════════════════════${RESET}"
print_success "Despliegue completado exitosamente!"
echo ""
print_info "Comandos útiles:"
echo "  ${GREEN}pm2 logs $APP_NAME${RESET}           - Ver logs en tiempo real"
echo "  ${GREEN}pm2 status${RESET}                   - Ver estado de todas las aplicaciones"
echo "  ${GREEN}pm2 restart $APP_NAME${RESET}        - Reiniciar aplicación"
echo "  ${GREEN}pm2 stop $APP_NAME${RESET}           - Detener aplicación"
echo "${GREEN}═══════════════════════════════════════════════════════════════${RESET}"

exit 0
