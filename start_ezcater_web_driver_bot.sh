#!/bin/bash

# =============================================================================
# Configuration
# =============================================================================
APP_NAME="ezcater_web_driver_bot"  # Change this for different projects
RUN_BUILD=true          # Set to false to skip build step

# =============================================================================
# Script Start
# =============================================================================

# Log file for debugging
LOG_FILE="$HOME/start_${APP_NAME}.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=========================================="
echo "Script started at: $(date)"
echo "Current user: $(whoami)"
echo "Current directory: $(pwd)"
echo "Initial DISPLAY: $DISPLAY"
echo "=========================================="

# Wait for X server with retries
wait_for_display() {
    local max_attempts=30
    local attempt=0

    echo "Waiting for X server to be ready..."

    while [ $attempt -lt $max_attempts ]; do
        # Try multiple display numbers
        for display_num in 1 0 2; do
            if DISPLAY=:${display_num} xdpyinfo >/dev/null 2>&1; then
                echo "X server is ready on DISPLAY :${display_num}"
                export DISPLAY=:${display_num}
                return 0
            fi
        done

        echo "Waiting for X server... attempt $((attempt+1))/$max_attempts"
        sleep 2
        attempt=$((attempt+1))
    done

    echo "ERROR: X server not available after $max_attempts attempts"
    return 1
}

# Wait for X server to be ready
wait_for_display || exit 1

echo "Final DISPLAY variable: $DISPLAY"

# Give X11 permissions
xhost +local: 2>/dev/null || true

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "PM2 version: $(pm2 --version)"

# Start PM2 daemon if not running
pm2 ping > /dev/null 2>&1

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "Project directory: $SCRIPT_DIR"

# Navigate to project directory
cd "$SCRIPT_DIR"

# Clean up any errored instances
echo "Checking for errored instances of $APP_NAME..."
if pm2 list | grep "$APP_NAME" | grep -q "errored"; then
    echo "Found errored instance(s), cleaning up..."
    pm2 delete "$APP_NAME" 2>/dev/null || true
    sleep 1
fi

# Check if app is already running properly
if pm2 list | grep "$APP_NAME" | grep -q "online"; then
    echo "App '$APP_NAME' is already running online"
    echo "Restarting to ensure latest code..."
    pm2 restart "$APP_NAME"
    echo "Application restarted successfully!"
    exit 0
fi

# Install dependencies if package.json exists
if [ -f "package.json" ]; then
    echo "Installing dependencies..."
    npm install --production=false
fi

# Run build if enabled and build script exists
if [ "$RUN_BUILD" = "true" ] && [ -f "package.json" ]; then
    if grep -q '"build"' package.json; then
        echo "Running build..."
        npm run build
    fi
fi

# Start application with PM2
echo "Starting application with PM2..."
pm2 start npm --name "$APP_NAME" -- start

# IMPORTANT: DO NOT save PM2 state
echo "Application started successfully!"
echo "Note: PM2 state NOT saved - XFCE autostart will manage restarts"

exit 0

