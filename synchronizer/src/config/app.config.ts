import process from 'node:process';

export default () => ({
  app: {
    password: process.env.PASSWORD,
    root_dir: process.cwd(),
  },
});
