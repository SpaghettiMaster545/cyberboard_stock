# Lightweight image for running the bot in continuous "watch" mode
# (e.g. on a free Oracle Cloud VM, Fly.io, Render worker, a Raspberry Pi, etc.)
#
#   docker build -t stock-bot .
#   docker run -d --name stockbot --restart unless-stopped \
#     -e TELEGRAM_BOT_TOKEN=xxxx -e TELEGRAM_CHAT_ID=yyyy \
#     -v "$(pwd)/data:/app/data" stock-bot
FROM node:20-alpine
WORKDIR /app

# No runtime dependencies, so just copy the source.
COPY package.json config.json ./
COPY src ./src
COPY scripts ./scripts

# Persist state, history and Telegram-made settings here.
VOLUME ["/app/data"]

STOPSIGNAL SIGINT
CMD ["node", "src/index.js", "--watch"]
