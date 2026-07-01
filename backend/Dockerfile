FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p uploads/avatars uploads/documents uploads/formations uploads/interventions uploads/products

EXPOSE 5000

CMD ["npm", "start"]