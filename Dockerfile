FROM node:20-slim

# Install FFmpeg dan dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    build-essential \
    libsodium-dev \
    libopus-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install --verbose

# Verify FFmpeg
RUN ffmpeg -version

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
