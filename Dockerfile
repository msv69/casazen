FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY client/package*.json client/
RUN npm --prefix client ci --include=dev
COPY . .
RUN npm --prefix client run build && rm -rf client/node_modules
EXPOSE 3000
CMD ["node", "server/index.js"]
