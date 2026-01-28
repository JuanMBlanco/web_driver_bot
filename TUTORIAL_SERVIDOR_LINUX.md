# Tutorial: Uso del EZCater Web Driver Bot en Servidor Linux (VM)

Este tutorial te guiará paso a paso para configurar y ejecutar el bot de EZCater en un servidor Linux dentro de una máquina virtual.

> **⚠️ IMPORTANTE - Permisos en Linux:**  
> En Linux, los scripts `.sh` necesitan permisos de ejecución para poder ejecutarse. Si obtienes un error "Permission denied" al ejecutar un script, usa el comando `chmod +x nombre_del_script.sh` para darle permisos de ejecución. Esto es diferente de Windows donde los scripts se ejecutan automáticamente.

## Tabla de Contenidos

1. [Requisitos Previos](#requisitos-previos)
2. [Instalación Inicial](#instalación-inicial)
3. [Configuración del Proyecto](#configuración-del-proyecto)
4. [Opción A: Configuración con PM2 y XFCE](#opción-a-configuración-con-pm2-y-xfce-recomendado-para-vms-con-gui)
5. [Opción B: Configuración del Servicio Systemd](#opción-b-configuración-del-servicio-systemd-recomendado-para-servidores-sin-gui)
6. [Uso del Servidor](#uso-del-servidor)
7. [Monitoreo y Logs](#monitoreo-y-logs)
8. [Solución de Problemas](#solución-de-problemas)

---

## Requisitos Previos

### Software Necesario

- **Node.js** (versión 18 o superior)
- **npm** o **yarn**
- **Google Chrome** o **Chromium**
- **Git** (para clonar el repositorio)

### Verificar Instalaciones

```bash
# Verificar Node.js
node --version

# Verificar npm
npm --version

# Verificar Chrome/Chromium
google-chrome --version
# o
chromium --version

# Verificar Git
git --version
```

---

## Instalación Inicial

### 1. Instalar Node.js (si no está instalado)

```bash
# Opción 1: Usando NodeSource (recomendado)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Opción 2: Usando nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
```

### 2. Instalar Google Chrome o Chromium

```bash
# Opción A: Instalar Google Chrome
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install ./google-chrome-stable_current_amd64.deb

# Opción B: Instalar Chromium (más ligero)
sudo apt-get update
sudo apt-get install -y chromium-browser
```

### 3. Instalar Dependencias del Sistema

```bash
# Actualizar sistema
sudo apt-get update
sudo apt-get upgrade -y

# Instalar dependencias necesarias
sudo apt-get install -y \
    build-essential \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libatspi2.0-0 \
    libxshmfence1
```

---

## Configuración del Proyecto

### 1. Clonar o Copiar el Proyecto

```bash
# Si tienes el proyecto en un repositorio Git
git clone <tu-repositorio> ezcater_web_driver_bot
cd ezcater_web_driver_bot

# O si ya tienes el proyecto, navega a su directorio
cd /ruta/a/tu/proyecto
```

### 2. Instalar Dependencias del Proyecto

```bash
# Instalar todas las dependencias
npm install

# O si usas yarn
yarn install
```

### 3. Compilar el Proyecto TypeScript

```bash
# Compilar TypeScript a JavaScript
npm run build

# Verificar que se creó la carpeta dist/
ls -la dist/
```

### 4. Configurar el Archivo de Configuración

Edita el archivo `config/ezcater_web_driver_bot.yaml`:

```bash
nano config/ezcater_web_driver_bot.yaml
```

**Configuraciones importantes:**

```yaml
browser:
  # Ruta al ejecutable de Chrome/Chromium
  executablePath: "/usr/bin/google-chrome"  # o "/usr/bin/chromium-browser"
  # Directorio de datos del usuario
  userDataPath: "./browsers/{__context__}/chrome_profile_{__instance__}"
  poolSize: 3

task:
  # URL de las entregas
  url: "https://dm.ezcater.com/s/tu-enlace-aqui"
  # Intervalo en segundos (60 = 1 minuto)
  checkInterval: 60
  # Número de teléfono para solicitar nuevo link
  phoneNumber: "1-786-220-1484"

paths:
  # Ruta para archivos de datos y logs
  dataPath: "./data"

server:
  basePath: /api/
  port: 3000
```

### 5. Configurar Variables de Entorno (Opcional)

Si usas Telegram para notificaciones, crea el archivo `.env.secrets`:

```bash
nano config/.env.secrets
```

```env
TELEGRAM_API_TOKEN=tu_token_aqui
TELEGRAM_CHAT_IDS=chat_id_1,chat_id_2
```

### 6. Dar Permisos de Ejecución a los Scripts

**IMPORTANTE:** En Linux, los scripts deben tener permisos de ejecución. Ejecuta estos comandos:

```bash
# Dar permisos de ejecución al script de inicio
chmod +x start_ezcater_web_driver_bot.sh

# Si existe el script de setup con PM2
chmod +x setup_with_pm2.sh

# Verificar permisos
ls -la *.sh
```

Deberías ver algo como:
```
-rwxr-xr-x 1 usuario usuario  ... start_ezcater_web_driver_bot.sh
```

Si no ves la `x` (ejecutable), el script no se podrá ejecutar.

---

## Opción A: Configuración con PM2 y XFCE (Recomendado para VMs con GUI)

Esta opción es ideal si estás usando una VM Linux con XFCE y quieres que la aplicación se inicie automáticamente al iniciar sesión.

### 1. Ejecutar el Script de Configuración

```bash
# Asegúrate de estar en el directorio del proyecto
cd /ruta/a/tu/proyecto/ezcater_web_driver_bot

# Dar permisos de ejecución al script de setup
chmod +x setup_with_pm2.sh

# Ejecutar el script de configuración
./setup_with_pm2.sh
```

El script hará lo siguiente:
- Verificará e instalará Node.js (usando nvm si es necesario)
- Instalará PM2 globalmente
- Creará el script `start_ezcater_web_driver_bot.sh` con permisos de ejecución
- Configurará el autostart de XFCE para iniciar la aplicación al hacer login
- Creará accesos directos en el escritorio

### 2. Verificar que el Script de Inicio Tiene Permisos

```bash
# Verificar permisos
ls -la start_ezcater_web_driver_bot.sh

# Si no tiene permisos de ejecución, dárselos:
chmod +x start_ezcater_web_driver_bot.sh
```

### 3. Probar el Script Manualmente

Antes de confiar en el autostart, prueba el script manualmente:

```bash
# Ejecutar el script de inicio
./start_ezcater_web_driver_bot.sh
```

**Nota:** Si obtienes un error de permisos como "Permission denied", ejecuta:
```bash
chmod +x start_ezcater_web_driver_bot.sh
```

### 4. Verificar que la Aplicación se Inició

```bash
# Ver procesos de PM2
pm2 list

# Ver logs
pm2 logs ezcater_web_driver_bot

# O usar el monitor de logs
tail -f ~/.pm2/logs/ezcater_web_driver_bot-out.log
```

### 5. Comandos Útiles de PM2

```bash
# Ver estado de la aplicación
pm2 list

# Ver logs en tiempo real
pm2 logs ezcater_web_driver_bot

# Reiniciar la aplicación
pm2 restart ezcater_web_driver_bot

# Detener la aplicación
pm2 stop ezcater_web_driver_bot

# Ver información detallada
pm2 show ezcater_web_driver_bot

# Ver monitoreo en tiempo real
pm2 monit
```

### 6. Configurar Autostart en XFCE

El script `setup_with_pm2.sh` ya configura el autostart automáticamente. Si necesitas hacerlo manualmente:

```bash
# El archivo de autostart se crea en:
~/.config/autostart/ezcater_web_driver_bot_start.desktop

# Verificar que existe
ls -la ~/.config/autostart/ezcater_web_driver_bot_start.desktop
```

### 7. Reiniciar la VM para Probar Autostart

```bash
# Reiniciar la VM
sudo reboot

# Después de reiniciar, verificar que la aplicación se inició
pm2 list
```

---

## Opción B: Configuración del Servicio Systemd (Recomendado para servidores sin GUI)

### 1. Crear el Archivo de Servicio

```bash
sudo nano /etc/systemd/system/ezcater-bot.service
```

### 2. Contenido del Archivo de Servicio

```ini
[Unit]
Description=EZCater Web Driver Bot Service
After=network.target

[Service]
Type=simple
User=tu_usuario
WorkingDirectory=/ruta/completa/al/proyecto/ezcater_web_driver_bot
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Límites de recursos (opcional)
LimitNOFILE=65536
MemoryMax=2G

[Install]
WantedBy=multi-user.target
```

**Importante:** Reemplaza:
- `tu_usuario`: Tu usuario de Linux
- `/ruta/completa/al/proyecto/ezcater_web_driver_bot`: Ruta absoluta a tu proyecto

### 3. Habilitar y Iniciar el Servicio

```bash
# Recargar configuración de systemd
sudo systemctl daemon-reload

# Habilitar el servicio para que inicie automáticamente
sudo systemctl enable ezcater-bot.service

# Iniciar el servicio
sudo systemctl start ezcater-bot.service

# Verificar el estado
sudo systemctl status ezcater-bot.service
```

### 4. Comandos Útiles del Servicio

```bash
# Ver estado
sudo systemctl status ezcater-bot.service

# Iniciar
sudo systemctl start ezcater-bot.service

# Detener
sudo systemctl stop ezcater-bot.service

# Reiniciar
sudo systemctl restart ezcater-bot.service

# Ver logs en tiempo real
sudo journalctl -u ezcater-bot.service -f

# Ver últimos 100 logs
sudo journalctl -u ezcater-bot.service -n 100
```

---

## Uso del Servidor

### 1. Verificar que el Servidor Está Corriendo

```bash
# Verificar que el puerto está escuchando
sudo netstat -tlnp | grep 3000
# o
sudo ss -tlnp | grep 3000

# Probar con curl
curl http://localhost:3000/api/
```

### 2. Endpoints Disponibles

El servidor expone los siguientes endpoints bajo `/api/`:

#### **Iniciar Tarea Periódica**
```bash
curl -X POST http://localhost:3000/api/task/start \
  -H "Authorization: Bearer f47ac10b-58cc-4372-a567-0e02b2c3d479" \
  -H "Content-Type: application/json"
```

#### **Detener Tarea Periódica**
```bash
curl -X POST http://localhost:3000/api/task/stop \
  -H "Authorization: Bearer f47ac10b-58cc-4372-a567-0e02b2c3d479" \
  -H "Content-Type: application/json"
```

#### **Ejecutar Tarea Manualmente (Una Vez)**
```bash
curl -X POST http://localhost:3000/api/task/run \
  -H "Authorization: Bearer f47ac10b-58cc-4372-a567-0e02b2c3d479" \
  -H "Content-Type: application/json"
```

**Nota:** Reemplaza el token con uno válido de tu archivo de configuración.

### 3. Ejemplo con Script de Prueba

Crea un archivo `test-api.sh`:

```bash
#!/bin/bash

# Configuración
API_URL="http://localhost:3000/api"
TOKEN="f47ac10b-58cc-4372-a567-0e02b2c3d479"

# Función para hacer requests
api_request() {
    local method=$1
    local endpoint=$2
    curl -X $method "$API_URL$endpoint" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -w "\nHTTP Status: %{http_code}\n"
}

echo "=== Iniciando Tarea ==="
api_request POST /task/start

sleep 5

echo -e "\n=== Estado del Servicio ==="
sudo systemctl status ezcater-bot.service --no-pager

echo -e "\n=== Últimos Logs ==="
sudo journalctl -u ezcater-bot.service -n 20 --no-pager
```

Hazlo ejecutable:
```bash
chmod +x test-api.sh
./test-api.sh
```

---

## Monitoreo y Logs

### 1. Ver Logs en Tiempo Real

```bash
# Logs del servicio systemd
sudo journalctl -u ezcater-bot.service -f

# Logs del archivo (si están configurados)
tail -f data/clicked_orders.log
```

### 2. Verificar Archivos Generados

```bash
# Ver órdenes clickeadas
cat data/clicked_orders.json

# Ver log de órdenes
cat data/clicked_orders.log

# Ver estructura de datos
ls -la data/
```

### 3. Monitoreo de Recursos

```bash
# Ver uso de CPU y memoria del proceso
ps aux | grep node

# Ver uso de recursos del servicio
systemctl status ezcater-bot.service

# Monitoreo continuo
watch -n 1 'ps aux | grep node | grep -v grep'
```

### 4. Verificar Navegadores Abiertos

```bash
# Ver procesos de Chrome/Chromium
ps aux | grep chrome
ps aux | grep chromium

# Ver puertos en uso
sudo netstat -tlnp | grep chrome
```

---

## Solución de Problemas

### Problema: El servicio no inicia

```bash
# Ver logs detallados
sudo journalctl -u ezcater-bot.service -n 50

# Verificar permisos
ls -la /ruta/al/proyecto

# Verificar que Node.js está en el PATH
which node

# Verificar que el ejecutable existe
ls -la dist/main.js
```

### Problema: Chrome/Chromium no se encuentra

```bash
# Buscar Chrome
which google-chrome
which chromium-browser

# Verificar ruta en configuración
cat config/ezcater_web_driver_bot.yaml | grep executablePath

# Instalar Chrome si falta
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install ./google-chrome-stable_current_amd64.deb
```

### Problema: Error de permisos al ejecutar scripts

Si obtienes un error como "Permission denied" al ejecutar `./start_ezcater_web_driver_bot.sh`:

```bash
# Dar permisos de ejecución al script
chmod +x start_ezcater_web_driver_bot.sh

# Verificar permisos
ls -la start_ezcater_web_driver_bot.sh

# Deberías ver algo como: -rwxr-xr-x (la 'x' indica ejecutable)

# Si el problema persiste, verificar que el archivo no esté corrupto
file start_ezcater_web_driver_bot.sh

# Debería mostrar: "Bourne-Again shell script"
```

**Nota importante:** En Linux, los scripts `.sh` necesitan permisos de ejecución (`chmod +x`) para poder ejecutarse. Esto es diferente de Windows donde los scripts se ejecutan automáticamente.

### Problema: Error de permisos en directorios

```bash
# Dar permisos al usuario para el directorio del proyecto
sudo chown -R tu_usuario:tu_usuario /ruta/al/proyecto

# Dar permisos de ejecución al archivo compilado (si es necesario)
chmod +x dist/main.js
```

### Problema: Puerto 3000 ya en uso

```bash
# Ver qué proceso usa el puerto
sudo lsof -i :3000
# o
sudo netstat -tlnp | grep 3000

# Cambiar puerto en configuración
nano config/ezcater_web_driver_bot.yaml
# Cambiar: port: 3000 a otro puerto (ej: 3001)
```

### Problema: El bot no encuentra órdenes

```bash
# Verificar logs
sudo journalctl -u ezcater-bot.service -f

# Verificar que la URL es correcta
cat config/ezcater_web_driver_bot.yaml | grep url

# Verificar conectividad
curl -I https://dm.ezcater.com
```

### Problema: Navegadores no se cierran

```bash
# Matar procesos de Chrome huérfanos
pkill -f chrome
pkill -f chromium

# Verificar configuración de browserAge
cat config/ezcater_web_driver_bot.yaml | grep browserAge
```

### Reiniciar Todo desde Cero

```bash
# Detener servicio
sudo systemctl stop ezcater-bot.service

# Limpiar procesos
pkill -f node
pkill -f chrome

# Limpiar datos (opcional - ¡CUIDADO!)
# rm -rf data/clicked_orders.json
# rm -rf browsers/

# Recompilar
npm run build

# Reiniciar servicio
sudo systemctl start ezcater-bot.service
```

---

## Configuración de Firewall (si es necesario)

Si necesitas acceder al servidor desde fuera de la VM:

```bash
# Instalar ufw si no está instalado
sudo apt-get install ufw

# Permitir puerto 3000
sudo ufw allow 3000/tcp

# Verificar reglas
sudo ufw status
```

**Nota:** Por seguridad, considera usar un proxy reverso (nginx) con autenticación en lugar de exponer directamente el puerto.

---

## Actualización del Servicio

Cuando actualices el código:

```bash
# 1. Detener el servicio
sudo systemctl stop ezcater-bot.service

# 2. Actualizar código (git pull, etc.)
git pull origin main

# 3. Reinstalar dependencias si es necesario
npm install

# 4. Recompilar
npm run build

# 5. Reiniciar servicio
sudo systemctl start ezcater-bot.service

# 6. Verificar
sudo systemctl status ezcater-bot.service
```

---

## Comandos Rápidos de Referencia

```bash
# Iniciar servicio
sudo systemctl start ezcater-bot.service

# Detener servicio
sudo systemctl stop ezcater-bot.service

# Ver logs
sudo journalctl -u ezcater-bot.service -f

# Ver estado
sudo systemctl status ezcater-bot.service

# Reiniciar
sudo systemctl restart ezcater-bot.service

# Ver órdenes clickeadas
cat data/clicked_orders.json | jq .

# Ejecutar tarea manualmente
curl -X POST http://localhost:3000/api/task/run \
  -H "Authorization: Bearer TU_TOKEN_AQUI"
```

---

## Notas Adicionales

1. **Seguridad**: Asegúrate de proteger los tokens de autenticación. No los compartas públicamente.

2. **Backups**: Considera hacer backups regulares de:
   - `config/ezcater_web_driver_bot.yaml`
   - `data/clicked_orders.json`
   - `data/clicked_orders.log`

3. **Monitoreo**: Configura alertas si el servicio se detiene:
   ```bash
   # Ejemplo con cron para verificar cada 5 minutos
   */5 * * * * systemctl is-active --quiet ezcater-bot.service || systemctl start ezcater-bot.service
   ```

4. **Recursos**: El bot puede consumir recursos significativos. Monitorea:
   - Uso de memoria
   - Uso de CPU
   - Espacio en disco (especialmente en `browsers/`)

---

## Soporte

Si encuentras problemas:
1. Revisa los logs: `sudo journalctl -u ezcater-bot.service -n 100`
2. Verifica la configuración: `cat config/ezcater_web_driver_bot.yaml`
3. Verifica que todas las dependencias estén instaladas
4. Revisa los permisos de archivos y directorios

---

**¡Listo!** Tu servidor EZCater Web Driver Bot debería estar funcionando correctamente.
