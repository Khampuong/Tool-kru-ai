FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY seed ./seed
COPY cloud ./cloud
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "cloud/boot.js"]
