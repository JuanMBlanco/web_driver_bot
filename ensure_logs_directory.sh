#!/bin/bash
# Script para asegurar que el directorio logs existe y tiene los permisos correctos

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LOGS_DIR="$SCRIPT_DIR/logs"

echo "Verificando directorio de logs: $LOGS_DIR"

# Crear directorio si no existe
if [ ! -d "$LOGS_DIR" ]; then
    echo "Creando directorio logs..."
    mkdir -p "$LOGS_DIR"
    if [ $? -eq 0 ]; then
        echo "✓ Directorio logs creado"
    else
        echo "✗ Error al crear directorio logs"
        exit 1
    fi
else
    echo "✓ Directorio logs ya existe"
fi

# Asegurar permisos de escritura (755 = rwxr-xr-x)
chmod 755 "$LOGS_DIR"
if [ $? -eq 0 ]; then
    echo "✓ Permisos configurados correctamente (755)"
else
    echo "⚠ Advertencia: No se pudieron cambiar los permisos. Verificando permisos actuales..."
    ls -ld "$LOGS_DIR"
fi

# Verificar que podemos escribir en el directorio
TEST_FILE="$LOGS_DIR/.ezcater_test_write"
if touch "$TEST_FILE" 2>/dev/null; then
    rm -f "$TEST_FILE"
    echo "✓ El directorio es escribible"
    exit 0
else
    echo "✗ ERROR: No se puede escribir en el directorio logs"
    echo ""
    echo "Solución:"
    echo "1. Verifica los permisos del directorio:"
    echo "   ls -ld $LOGS_DIR"
    echo ""
    echo "2. Si el directorio pertenece a otro usuario, cambia el propietario:"
    echo "   sudo chown -R \$USER:\$USER $LOGS_DIR"
    echo ""
    echo "3. O ajusta los permisos:"
    echo "   chmod 755 $LOGS_DIR"
    echo ""
    echo "4. Si el directorio padre no tiene permisos, verifica:"
    echo "   ls -ld $(dirname $LOGS_DIR)"
    exit 1
fi
