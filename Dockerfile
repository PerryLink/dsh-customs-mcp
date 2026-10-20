FROM node:22-alpine

WORKDIR /app

COPY package.json server.json ./
COPY src ./src

ENTRYPOINT ["node", "src/index.js"]
