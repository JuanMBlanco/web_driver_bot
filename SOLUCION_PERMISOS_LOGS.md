# Solución al Problema de Permisos en el Directorio de Logs

## Problema

El error `EACCES: permission denied` indica que el usuario que ejecuta PM2 no tiene permisos para crear o escribir en el directorio `logs`.

```
[ERROR] Error initializing log file: EACCES: permission denied, open '/home/ui.desktop.vps/.../logs/detected_orders_...log'
```

## Causas Comunes

1. **El directorio `logs` no existe** y el usuario no puede crearlo
2. **El directorio existe pero pertenece a otro usuario** (ej: root)
3. **El directorio tiene permisos incorrectos** (ej: solo lectura)
4. **El directorio padre no tiene permisos de escritura**

## Solución Automática

Ejecuta el script de verificación:

```bash
chmod +x ensure_logs_directory.sh
./ensure_logs_directory.sh
```

Este script:
- Crea el directorio `logs` si no existe
- Configura los permisos correctos (755)
- Verifica que se puede escribir en el directorio

## Solución Manual

### Paso 1: Verificar el directorio actual

```bash
# Navegar al directorio del proyecto
cd /ruta/a/tu/proyecto/ezcater_web_driver_bot

# Verificar si el directorio logs existe
ls -ld logs
```

### Paso 2: Crear el directorio si no existe

```bash
mkdir -p logs
chmod 755 logs
```

### Paso 3: Verificar permisos y propietario

```bash
# Ver permisos y propietario
ls -ld logs

# Si el propietario no es tu usuario, cambiarlo:
sudo chown -R $USER:$USER logs

# Asegurar permisos correctos
chmod 755 logs
```

### Paso 4: Verificar permisos del directorio padre

```bash
# Ver permisos del directorio padre (donde está el proyecto)
ls -ld .

# Si no tienes permisos de escritura, ajustarlos:
chmod 755 .
```

### Paso 5: Verificar el usuario que ejecuta PM2

```bash
# Ver qué usuario ejecuta PM2
pm2 list
ps aux | grep pm2

# Si PM2 se ejecuta como otro usuario, puedes:
# Opción A: Cambiar el propietario del proyecto completo
sudo chown -R $USER:$USER /ruta/a/tu/proyecto

# Opción B: Ejecutar PM2 como tu usuario
pm2 kill
pm2 start ...
```

## Verificación

Después de aplicar la solución, verifica que funciona:

```bash
# Probar escritura en el directorio
touch logs/test_write.txt
rm logs/test_write.txt

# Si no hay errores, está funcionando correctamente
```

## Prevención

El script `monitor_bot_v3.sh` ahora verifica automáticamente el directorio de logs antes de iniciar el bot. El script `setup_monitor.sh` también incluye esta verificación.

## Comandos Útiles

```bash
# Ver permisos detallados
ls -la logs/

# Ver propietario y grupo
stat logs/

# Cambiar propietario recursivamente
sudo chown -R usuario:grupo logs/

# Cambiar permisos recursivamente
chmod -R 755 logs/

# Ver qué usuario eres
whoami

# Ver el usuario que ejecuta un proceso
ps aux | grep node
```

## Si el Problema Persiste

1. **Verifica que estás en el directorio correcto:**
   ```bash
   pwd
   ```

2. **Verifica que el directorio del proyecto tiene permisos correctos:**
   ```bash
   ls -ld .
   ```

3. **Verifica el usuario que ejecuta PM2:**
   ```bash
   pm2 show ezcater_bot_v3
   ```

4. **Si PM2 se ejecuta como otro usuario, reinícialo:**
   ```bash
   pm2 kill
   pm2 start ...
   ```

5. **Si nada funciona, crea el directorio manualmente con sudo y luego cambia el propietario:**
   ```bash
   sudo mkdir -p logs
   sudo chown -R $USER:$USER logs
   chmod 755 logs
   ```
