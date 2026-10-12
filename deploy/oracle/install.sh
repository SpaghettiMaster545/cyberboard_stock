#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:?APP_DIR is required}"
SERVICE_NAME="${SERVICE_NAME:-angrymiao-stock-bot}"
DEPLOY_USER="${DEPLOY_USER:-$USER}"

install_node_apt() {
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  sudo mkdir -p /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/nodesource.gpg ]; then
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
      sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  fi
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" |
    sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y nodejs
}

install_node_rpm() {
  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y ca-certificates curl gnupg2
  else
    sudo yum install -y ca-certificates curl gnupg2
  fi
  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nodejs
  else
    sudo yum install -y nodejs
  fi
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" && return 0
  fi

  if command -v apt-get >/dev/null 2>&1; then
    install_node_apt
    return 0
  fi

  if command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
    install_node_rpm
    return 0
  fi

  echo "Unsupported Linux distribution. Need apt, dnf, or yum." >&2
  exit 1
}

ensure_node

mkdir -p "$APP_DIR/data"
chmod 700 "$APP_DIR"
if [ -f "$APP_DIR/.env" ]; then
  chmod 600 "$APP_DIR/.env"
fi

NODE_BIN="$(command -v node)"

sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<EOF
[Unit]
Description=Stock bot (Shopify, Steam, web pages) with Telegram
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${DEPLOY_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
EnvironmentFile=${APP_DIR}/.env
ExecStart=${NODE_BIN} src/index.js --watch
Restart=always
RestartSec=3
KillSignal=SIGINT
TimeoutStopSec=20
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}.service"
sudo systemctl restart "${SERVICE_NAME}.service"
sudo systemctl --no-pager --full status "${SERVICE_NAME}.service"