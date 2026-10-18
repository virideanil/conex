FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "server/index.ts"]
