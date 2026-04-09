# ============================================================
# Dockerfile - WhatsApp Server Staff21x (Baileys)
# node:18-slim + git + rewrite git+ssh → https para Railway
# ============================================================
FROM node:18-slim

# git requerido por libsignal (dependencia de baileys via git+https).
# python3/make/g++ para modulos nativos (curve25519-js, bufferutil, etc.)
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

# Redirigir cualquier git+ssh://git@github.com/ a https://github.com/
# Esto permite que npm ci instale dependencias de GitHub sin SSH key.
RUN git config --global url."https://github.com/".insteadOf "git+ssh://git@github.com/" \
 && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --legacy-peer-deps

COPY index.js ./

RUN mkdir -p /app/.wsp_session

EXPOSE 3000

CMD ["node", "index.js"]
