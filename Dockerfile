FROM node:20-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    build-essential \
    libsodium-dev \
    libopus-dev \
    && pip3 install --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --verbose

# Verify installations
RUN ffmpeg -version && yt-dlp --version

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
