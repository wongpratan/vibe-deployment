FROM node:22-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json drizzle.config.ts ./
COPY src ./src

EXPOSE 4000

CMD ["npm", "run", "dev"]
