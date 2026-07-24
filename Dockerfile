# Lightweight image for running the bot in continuous "watch" mode
# (e.g. on a free Oracle Cloud VM, Fly.io, Render worker, a Raspberry Pi, etc.)
#
#   docker build -t angrymiao-stock-bot .
#   docker run -d --name stockbot --restart unless-stopped \
#     -e TELEGRAM_BOT_TOKEN=xxxx -e TELEGRAM_CHAT_ID=yyyy \
#     -v "$(pwd)/data:/app/data" angrymiao-stock-bot
FROM node:20-alpine
WORKDIR /app

# No runtime dependencies, so just copy the source.
COPY package.json ./
COPY config.json ./
COPY src ./src

# Persist state here (mount a volume to keep it across restarts).
VOLUME ["/app/data"]

CMD ["node", "src/index.js", "--watch"]
