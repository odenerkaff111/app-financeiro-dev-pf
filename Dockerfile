FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

# O pulo do gato: roda como "dev" no Docker
CMD ["npm", "run", "dev"]
