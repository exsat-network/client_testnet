FROM node:20.15.1

WORKDIR /app

COPY package.json ./


RUN yarn

COPY . .

ENTRYPOINT ["yarn", "start"]
CMD []