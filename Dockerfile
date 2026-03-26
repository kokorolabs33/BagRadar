FROM node:22-slim
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY server/ server/
COPY shared/ shared/
COPY public/ public/
COPY tsconfig.json ./

EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
