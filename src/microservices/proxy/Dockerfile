FROM node:18-alpine

WORKDIR .

COPY package*.json ./

RUN yarn

COPY . .

EXPOSE 8000

CMD ["node", "server.js"]


