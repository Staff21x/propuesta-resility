# ============================================================
# Dockerfile - WhatsApp Server Staff21x (Baileys)
# Sin Puppeteer ni Chromium - imagen mucho mas liviana
# ============================================================
FROM node:18-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

RUN mkdir -p /app/.wsp_session

EXPOSE 3000

CMD ["node", "index.js"]
