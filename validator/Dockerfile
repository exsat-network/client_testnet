FROM node:20.15.1

WORKDIR /app

COPY package.json yarn.lock ./


RUN yarn

COPY . .

CMD ["yarn", "start"]
