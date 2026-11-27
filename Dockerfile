FROM node:24.16.0-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY config ./config
COPY src ./src
COPY public ./public
COPY server/templates.js ./server/templates.js
RUN npm run build && npm prune --omit=dev

FROM node:24.16.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production YAKUTORING_HOST=0.0.0.0 YAKUTORING_PYTHON=/opt/yaku/bin/python PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libgomp1 && rm -rf /var/lib/apt/lists/* && python3 -m venv /opt/yaku
COPY ml/requirements-render.txt /tmp/requirements-render.txt
RUN /opt/yaku/bin/pip install --no-cache-dir -r /tmp/requirements-render.txt
# Optional CPU runtime for the archived MLP and hybrids.
ARG INSTALL_TORCH=0
RUN if [ "$INSTALL_TORCH" = "1" ]; then /opt/yaku/bin/pip install --no-cache-dir torch==2.9.1 --index-url https://download.pytorch.org/whl/cpu; fi
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY src/environment.js src/sensors.js ./src/
COPY ml ./ml
COPY config ./config
COPY scripts/setup-auth.js ./scripts/setup-auth.js
CMD ["node", "server/index.js"]
