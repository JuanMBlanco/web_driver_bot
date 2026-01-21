#!/bin/bash

# =============================================================================
# PM2 Auto-Start Setup Script for XFCE
# =============================================================================
# This script sets up a Node.js application to run with PM2 on XFCE login
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
APP_NAME=""
PROJECT_PATH="$PWD"  # Default to current directory
START_COMMAND="npm start"
RUN_BUILD="true"
OVERWRITE_CONFIG="false"

# =============================================================================
# Functions
# =============================================================================

print_help() {
    cat << EOF
${GREEN}PM2 Auto-Start Setup Script for XFCE${RESET}

${BLUE}USAGE:${RESET}
    $0 [--app=<app-name>] [OPTIONS]

${BLUE}OPTIONS:${RESET}
    --app=<name>           Application name for PM2 (optional, auto-detected from package.json)
    --path=<path>          Full path to your Node.js project (default: current directory)
    --cmd=<command>        Start command (default: "npm start")
    --build=<yes|no>       Run 'npm run build' before starting (default: yes)
    --overwrite-config     Overwrite existing configuration files
    --help                 Show this help message

${BLUE}EXAMPLE:${RESET}
    ${YELLOW}# Auto-detect app name from package.json${RESET}
    $0

    ${YELLOW}# Specify app name manually${RESET}
    $0 --app=ezcater_web_driver_bot

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

check_root() {
    if [ "$EUID" -eq 0 ]; then
        print_error "This script should NOT be run as root!"
        print_info "Please run as a regular user"
        exit 1
    fi
}

detect_desktop_path() {
    if [ -d "$HOME/Desktop" ]; then
        echo "$HOME/Desktop"
    elif [ -d "$HOME/Escritorio" ]; then
        echo "$HOME/Escritorio"
    else
        mkdir -p "$HOME/Desktop"
        echo "$HOME/Desktop"
    fi
}

detect_app_name() {
    if [ -n "$APP_NAME" ]; then
        print_info "Using provided app name: $APP_NAME"
        return 0
    fi

    print_info "No app name provided, attempting auto-detection from package.json..."

    local PACKAGE_JSON="$PROJECT_PATH/package.json"

    if [ ! -f "$PACKAGE_JSON" ]; then
        print_error "package.json not found in: $PROJECT_PATH"
        print_info "Please provide --app=<name> or ensure package.json exists in the project directory"
        exit 1
    fi

    print_success "Found package.json"

    if command -v node &> /dev/null; then
        APP_NAME=$(node -e "try { const pkg = require('$PACKAGE_JSON'); console.log(pkg.name || ''); } catch(e) { console.log(''); }" 2>/dev/null)
    else
        APP_NAME=$(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "$PACKAGE_JSON" | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' | head -n 1)
    fi

    if [ -z "$APP_NAME" ]; then
        print_error "The 'name' field in package.json is empty or not found"
        exit 1
    fi

    if [[ "$APP_NAME" =~ ^[[:space:]]*$ ]]; then
        print_error "The 'name' field in package.json contains only whitespace"
        exit 1
    fi

    print_success "Auto-detected app name: ${GREEN}${BOLD}$APP_NAME${RESET}"
}

check_xfce() {
    if [ -z "$XDG_CURRENT_DESKTOP" ] && [ ! -d "$HOME/.config/autostart" ]; then
        print_warning "XFCE session not detected, but continuing anyway..."
        print_info "Make sure you're running XFCE desktop environment"
    fi
}

check_pm2_app_status() {
    print_info "Checking if app is already running in PM2..."

    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

    if ! command -v pm2 &> /dev/null; then
        print_info "PM2 not found, this will be a fresh installation"
        return 1
    fi

    if pm2 list | grep -q "$APP_NAME"; then
        print_success "App '$APP_NAME' is already running in PM2"
        return 0
    else
        print_info "App '$APP_NAME' not found in PM2, will create new setup"
        return 1
    fi
}

update_existing_app() {
    print_info "Updating existing application..."

    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

    cd "$PROJECT_PATH"

    print_info "Stopping application..."
    pm2 stop "$APP_NAME"
    print_success "Application stopped"

    if [ -d ".git" ]; then
        print_info "Git repository detected, pulling latest changes..."

        if ! git diff-index --quiet HEAD -- 2>/dev/null; then
            print_warning "Uncommitted changes detected!"
            print_info "Stashing changes before pull..."
            git stash
            GIT_STASHED=true
        fi

        if git pull; then
            print_success "Git pull completed successfully"

            if [ "$GIT_STASHED" = "true" ]; then
                print_info "Restoring stashed changes..."
                git stash pop || print_warning "Could not restore stashed changes automatically"
            fi
        else
            print_error "Git pull failed!"
            print_info "Starting application with current code..."
        fi
    else
        print_warning "Not a git repository, skipping git pull"
    fi

    print_info "Installing dependencies..."
    npm install --production=false
    print_success "Dependencies installed"

    if [ "$RUN_BUILD" = "true" ] && [ -f "package.json" ]; then
        if grep -q '"build"' package.json; then
            print_info "Running build..."
            npm run build
            print_success "Build completed"
        fi
    fi

    print_info "Starting application..."
    pm2 start "$APP_NAME"
    print_success "Application started"

    pm2 save

    echo ""
    print_success "Application updated successfully!"

    if [ "$OVERWRITE_CONFIG" = "true" ]; then
        print_info "Config files will be recreated (--overwrite-config specified)"
        return 0
    else
        print_info "Config files NOT updated (use --overwrite-config to recreate them)"
        return 1
    fi
}

check_project_structure() {
    print_info "Analyzing project structure..."

    if [ ! -f "$PROJECT_PATH/package.json" ]; then
        print_warning "No package.json found in project directory"
        return
    fi

    if grep -q '"build"' "$PROJECT_PATH/package.json"; then
        print_success "Build script detected in package.json"

        if [ -f "$PROJECT_PATH/tsconfig.json" ]; then
            print_info "TypeScript project detected"
        fi

        if [ -d "$PROJECT_PATH/dist" ]; then
            print_info "Found dist/ directory"
        elif [ -d "$PROJECT_PATH/build" ]; then
            print_info "Found build/ directory"
        fi
    else
        print_info "No build script found in package.json"
        if [ "$RUN_BUILD" = "true" ]; then
            print_warning "Build is enabled but no 'build' script found in package.json"
            print_warning "The build step will be skipped during startup"
        fi
    fi

    if [ -d "$PROJECT_PATH/.git" ]; then
        print_success "Git repository detected"
        GIT_BRANCH=$(cd "$PROJECT_PATH" && git branch --show-current 2>/dev/null || echo "unknown")
        print_info "Current branch: $GIT_BRANCH"
    fi
}

install_nvm_and_node() {
    print_info "Checking Node.js installation..."

    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        print_success "Node.js is already installed: $NODE_VERSION"
        return 0
    fi

    print_info "Node.js not found. Installing via nvm..."

    if [ -d "$HOME/.nvm" ]; then
        print_success "nvm is already installed"
    else
        print_info "Downloading and installing nvm..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

        if [ $? -ne 0 ]; then
            print_error "Failed to install nvm"
            exit 1
        fi
        print_success "nvm installed successfully"
    fi

    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

    print_info "Installing Node.js v24..."
    nvm install 24

    if [ $? -ne 0 ]; then
        print_error "Failed to install Node.js"
        exit 1
    fi

    nvm use 24
    nvm alias default 24

    NODE_VERSION=$(node --version)
    print_success "Node.js $NODE_VERSION installed successfully"
}

install_pm2() {
    print_info "Checking PM2 installation..."

    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

    if command -v pm2 &> /dev/null; then
        PM2_VERSION=$(pm2 --version)
        print_success "PM2 is already installed: v$PM2_VERSION"
        return 0
    fi

    print_info "Installing PM2 globally..."
    npm install -g pm2

    if [ $? -ne 0 ]; then
        print_error "Failed to install PM2"
        exit 1
    fi

    PM2_VERSION=$(pm2 --version)
    print_success "PM2 v$PM2_VERSION installed successfully"
}

create_start_script() {
    local SCRIPT_PATH="$PROJECT_PATH/start_${APP_NAME}.sh"

    if [ -f "$SCRIPT_PATH" ]; then
        print_info "Start script already exists: $SCRIPT_PATH"
        print_info "Skipping creation (delete it or use --overwrite-config to recreate)"
        return 0
    fi

    print_info "Creating start script in project directory..."

    cat > "$SCRIPT_PATH" << EOFSCRIPT
#!/bin/bash

APP_NAME="$APP_NAME"
RUN_BUILD="$RUN_BUILD"

LOG_FILE="\$HOME/start_\${APP_NAME}.log"
exec > >(tee -a "\$LOG_FILE") 2>&1

echo "=========================================="
echo "Script started at: \$(date)"
echo "Current user: \$(whoami)"
echo "Current directory: \$(pwd)"
echo "Initial DISPLAY: \$DISPLAY"
echo "=========================================="

wait_for_display() {
    local max_attempts=30
    local attempt=0

    echo "Waiting for X server to be ready..."

    while [ \$attempt -lt \$max_attempts ]; do
        for display_num in 1 0 2; do
            if DISPLAY=:\${display_num} xdpyinfo >/dev/null 2>&1; then
                echo "X server is ready on DISPLAY :\${display_num}"
                export DISPLAY=:\${display_num}
                return 0
            fi
        done

        echo "Waiting for X server... attempt \$((attempt+1))/\$max_attempts"
        sleep 2
        attempt=\$((attempt+1))
    done

    echo "ERROR: X server not available after \$max_attempts attempts"
    return 1
}

wait_for_display || exit 1

echo "Final DISPLAY variable: \$DISPLAY"

xhost +local: 2>/dev/null || true

export NVM_DIR="\$HOME/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && \. "\$NVM_DIR/nvm.sh"

echo "Node version: \$(node --version)"
echo "NPM version: \$(npm --version)"
echo "PM2 version: \$(pm2 --version)"

pm2 ping > /dev/null 2>&1

SCRIPT_DIR="\$( cd "\$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"

echo "Project directory: \$SCRIPT_DIR"

cd "\$SCRIPT_DIR"

echo "Checking for errored instances of \$APP_NAME..."
if pm2 list | grep "\$APP_NAME" | grep -q "errored"; then
    echo "Found errored instance(s), cleaning up..."
    pm2 delete "\$APP_NAME" 2>/dev/null || true
    sleep 1
fi

if pm2 list | grep "\$APP_NAME" | grep -q "online"; then
    echo "App '\$APP_NAME' is already running online"
    echo "Restarting to ensure latest code..."
    pm2 restart "\$APP_NAME"
    echo "Application restarted successfully!"
    exit 0
fi

if [ -f "package.json" ]; then
    echo "Installing dependencies..."
    npm install --production=false
fi

if [ "\$RUN_BUILD" = "true" ] && [ -f "package.json" ]; then
    if grep -q '"build"' package.json; then
        echo "Running build..."
        npm run build
    fi
fi

echo "Starting application with PM2..."
pm2 start npm --name "\$APP_NAME" -- start

echo "Application started successfully!"
echo "Note: PM2 state NOT saved - XFCE autostart will manage restarts"

exit 0
EOFSCRIPT

    chmod +x "$SCRIPT_PATH"

    print_success "Start script created: $SCRIPT_PATH"
}

create_pm2_logs_monitor_script() {
    local SCRIPT_PATH="$PROJECT_PATH/pm2_logs_monitor.sh"

    if [ -f "$SCRIPT_PATH" ]; then
        print_info "Logs monitor script already exists: $SCRIPT_PATH"
        print_info "Skipping creation (delete it or use --overwrite-config to recreate)"
        return 0
    fi

    print_info "Creating logs monitor script (using tail -f)..."

    cat > "$SCRIPT_PATH" << 'EOFMONITOR'
#!/bin/bash

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

trap 'echo ""; echo ""; echo "Logs streaming stopped."; echo ""; read -p "Press Enter to close..." dummy; exit 0' INT TERM

echo "╔══════════════════════════════════════════════════════════╗"
echo "║      Logs Monitor for APP_NAME_PLACEHOLDER (tail -f)    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Streaming logs in real-time using tail -f..."
echo "Press Ctrl+C to stop streaming"
echo "============================================================"
echo ""

APP_NAME="APP_NAME_PLACEHOLDER"
LOG_NAME="${APP_NAME//_/-}"

LOG_OUT="$HOME/.pm2/logs/${LOG_NAME}-out.log"
LOG_ERR="$HOME/.pm2/logs/${LOG_NAME}-error.log"

echo "App name: $APP_NAME"
echo "Log file prefix: $LOG_NAME"
echo ""

if [ ! -f "$LOG_OUT" ] && [ ! -f "$LOG_ERR" ]; then
    echo "ERROR: Log files not found!"
    echo ""
    echo "Expected locations:"
    echo "  - $LOG_OUT"
    echo "  - $LOG_ERR"
    echo ""
    echo "This might mean:"
    echo "  - The app '$APP_NAME' has never been started"
    echo "  - PM2 is using a different log location"
    echo "  - The app name is different"
    echo ""
    echo "Current PM2 processes:"
    pm2 list
    echo ""
    echo "Actual log files in ~/.pm2/logs/:"
    ls -la "$HOME/.pm2/logs/" | grep -E "(out|error)\.log"
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

if [ -f "$LOG_OUT" ]; then
    echo "Following: $LOG_OUT"
    echo ""
    tail -f "$LOG_OUT"
else
    echo "Output log not found, showing error log instead"
    echo "Following: $LOG_ERR"
    echo ""
    tail -f "$LOG_ERR"
fi

echo ""
echo "============================================================"
echo "WARNING: tail command exited unexpectedly"
echo ""
read -p "Press Enter to close..."
EOFMONITOR

    sed -i "s/APP_NAME_PLACEHOLDER/$APP_NAME/g" "$SCRIPT_PATH"

    chmod +x "$SCRIPT_PATH"

    print_success "Logs monitor script created: $SCRIPT_PATH"
}

create_desktop_shortcut() {
    local DESKTOP_PATH=$(detect_desktop_path)
    local DESKTOP_FILE="$DESKTOP_PATH/pm2_monitor_${APP_NAME}.desktop"
    local SCRIPT_PATH="$PROJECT_PATH/pm2_logs_monitor.sh"

    if [ -f "$DESKTOP_FILE" ] && [ "$OVERWRITE_CONFIG" = "false" ]; then
        print_info "Desktop shortcut already exists, skipping"
        return 0
    fi

    print_info "Creating desktop shortcut..."

    cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Logs Monitor ${APP_NAME}
Comment=Stream logs of ${APP_NAME} using tail -f
Exec=$SCRIPT_PATH
Icon=utilities-terminal
Path=$PROJECT_PATH
Terminal=true
StartupNotify=false
EOF

    chmod +x "$DESKTOP_FILE"

    print_success "Desktop shortcut created: $DESKTOP_FILE"
}

create_autostart_desktop() {
    local DESKTOP_FILE="$HOME/.config/autostart/${APP_NAME}_start.desktop"
    local SCRIPT_PATH="$PROJECT_PATH/start_${APP_NAME}.sh"

    if [ -f "$DESKTOP_FILE" ] && [ "$OVERWRITE_CONFIG" = "false" ]; then
        print_info "Autostart entry already exists, skipping (use --overwrite-config to recreate)"
        return 0
    fi

    print_info "Creating XFCE autostart entry..."

    mkdir -p "$HOME/.config/autostart"

    cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Type=Application
Name=Start ${APP_NAME}
Comment=Start Node.js application ${APP_NAME} with PM2
Exec=$SCRIPT_PATH
Terminal=false
Hidden=false
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=5
EOF

    print_success "Autostart entry created: $DESKTOP_FILE"
}

create_autostart_logs_monitor() {
    local DESKTOP_FILE="$HOME/.config/autostart/${APP_NAME}_logs_monitor.desktop"
    local SCRIPT_PATH="$PROJECT_PATH/pm2_logs_monitor.sh"

    if [ -f "$DESKTOP_FILE" ] && [ "$OVERWRITE_CONFIG" = "false" ]; then
        print_info "Autostart logs monitor already exists, skipping"
        return 0
    fi

    print_info "Creating autostart logs monitor..."

    mkdir -p "$HOME/.config/autostart"

    cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Type=Application
Name=Logs Monitor ${APP_NAME}
Comment=Auto-open logs monitor (tail -f) for ${APP_NAME} on login
Exec=$SCRIPT_PATH
Icon=utilities-terminal
Path=$PROJECT_PATH
Terminal=true
Hidden=false
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=15
StartupNotify=false
EOF

    print_success "Autostart logs monitor created: $DESKTOP_FILE"
}

create_logout_desktop() {
    local DESKTOP_FILE="$HOME/.config/autostart/${APP_NAME}_stop.desktop"

    if [ -f "$DESKTOP_FILE" ] && [ "$OVERWRITE_CONFIG" = "false" ]; then
        print_info "Logout entry already exists, skipping (use --overwrite-config to recreate)"
        return 0
    fi

    print_info "Creating XFCE logout entry..."

    cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Type=Application
Name=Stop ${APP_NAME}
Comment=Stop Node.js application ${APP_NAME} on logout
Exec=bash -c 'export NVM_DIR="\$HOME/.nvm"; [ -s "\$NVM_DIR/nvm.sh" ] && \. "\$NVM_DIR/nvm.sh"; pm2 stop ${APP_NAME}'
Terminal=false
Hidden=false
X-GNOME-Autostart-Phase=Logout
EOF

    print_success "Logout entry created: $DESKTOP_FILE"
}

show_useful_commands() {
    local DESKTOP_PATH=$(detect_desktop_path)

    cat << EOF

${GREEN}═══════════════════════════════════════════════════════════════${RESET}
${GREEN}${BOLD}                    SETUP COMPLETED!${RESET}
${GREEN}═══════════════════════════════════════════════════════════════${RESET}

${BLUE}USEFUL PM2 COMMANDS:${RESET}

  ${YELLOW}View all processes:${RESET}
    pm2 list

  ${YELLOW}View logs (using tail -f - RECOMMENDED):${RESET}
    tail -f ~/.pm2/logs/${APP_NAME}-out.log
    tail -f ~/.pm2/logs/${APP_NAME}-error.log

  ${YELLOW}Restart application:${RESET}
    pm2 restart ${APP_NAME}

  ${YELLOW}Stop application:${RESET}
    pm2 stop ${APP_NAME}

${BLUE}PROJECT CONFIGURATION:${RESET}
  App Name:      ${GREEN}${APP_NAME}${RESET}
  Project Path:  ${GREEN}${PROJECT_PATH}${RESET}
  Start Command: ${GREEN}${START_COMMAND}${RESET}
  Auto Build:    ${GREEN}${RUN_BUILD}${RESET}

${YELLOW}NOTE:${RESET}
  - The application will start automatically on next login (delay: 5s)
  - The logs monitor will open automatically on next login (delay: 15s)
  - To start now: ${GREEN}$PROJECT_PATH/start_${APP_NAME}.sh${RESET}

${GREEN}═══════════════════════════════════════════════════════════════${RESET}

EOF
}

# =============================================================================
# Main Script
# =============================================================================

for arg in "$@"; do
    case $arg in
        --app=*)
            APP_NAME="${arg#*=}"
            shift
            ;;
        --path=*)
            PROJECT_PATH="${arg#*=}"
            shift
            ;;
        --cmd=*)
            START_COMMAND="${arg#*=}"
            shift
            ;;
        --build=*)
            BUILD_ARG="${arg#*=}"
            if [ "$BUILD_ARG" = "no" ] || [ "$BUILD_ARG" = "false" ]; then
                RUN_BUILD="false"
            elif [ "$BUILD_ARG" = "yes" ] || [ "$BUILD_ARG" = "true" ]; then
                RUN_BUILD="true"
            else
                print_error "Invalid value for --build. Use 'yes' or 'no'"
                exit 1
            fi
            shift
            ;;
        --overwrite-config)
            OVERWRITE_CONFIG="true"
            shift
            ;;
        --help)
            print_help
            exit 0
            ;;
        *)
            print_error "Unknown option: $arg"
            print_info "Use --help for usage information"
            exit 1
            ;;
    esac
done

if [ ! -d "$PROJECT_PATH" ]; then
    print_error "Project path does not exist: $PROJECT_PATH"
    exit 1
fi

echo "${GREEN}═══════════════════════════════════════════════════════════════${RESET}"
echo "${GREEN}${BOLD}        PM2 Auto-Start Setup for XFCE${RESET}"
echo "${GREEN}═══════════════════════════════════════════════════════════════${RESET}"
echo ""

check_root
detect_app_name
check_xfce
check_project_structure

if check_pm2_app_status; then
    if update_existing_app; then
        create_start_script
        create_pm2_logs_monitor_script
        create_desktop_shortcut
        create_autostart_desktop
        create_autostart_logs_monitor
        create_logout_desktop
    else
        create_pm2_logs_monitor_script
        create_desktop_shortcut
        create_autostart_desktop
        create_autostart_logs_monitor
        create_logout_desktop
    fi
    show_useful_commands
else
    install_nvm_and_node
    install_pm2
    create_start_script
    create_pm2_logs_monitor_script
    create_desktop_shortcut
    create_autostart_desktop
    create_autostart_logs_monitor
    create_logout_desktop
    show_useful_commands
fi

print_success "All done! Log out and log back in to test auto-start."

exit 0

