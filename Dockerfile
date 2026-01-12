# Base image Node.js
FROM node:20-slim

# Install FFmpeg dan dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose port untuk Express (anti-sleep)
EXPOSE 3000

# Jalankan bot
CMD ["npm", "start"]
