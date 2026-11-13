FROM node:22-alpine

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies first, so this layer is cached until package*.json change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# next.config.ts resolves the /api rewrite at build time, so the backend URL is needed here.
ARG BACKEND_INTERNAL_URL=http://backend:8000
ENV BACKEND_INTERNAL_URL=${BACKEND_INTERNAL_URL}
RUN npm run build

ENV NODE_ENV=production
# Do not run as root inside the container.
RUN chown -R node:node /app/.next
USER node

EXPOSE 3000
CMD ["npm", "run", "start"]
