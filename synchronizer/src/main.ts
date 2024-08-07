import select, { Separator } from '@inquirer/select';
import 'dotenv/config';
import { bootstrap } from '~/bootstrap';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  importFromMnemonic,
  importFromPrivateKey,
  initializeAccount,
} from 'account-initializer';
import { program } from 'commander';
import { reloadEnv, updateEnvFile } from '~/utils/env';
const commandOptions = program
  .option('--pwd <password>', 'Set password for keystore')
  .option('--pwdfile <password>', 'Set password for keystore')
  .option('--run', 'Run synchronizer')
  .parse(process.argv)
  .opts();
export { commandOptions };
async function main() {
  let init = existKeystore();
  if (init && commandOptions.run) {
    await bootstrap('launch_client');
    return;
  }
  const rpcUrl = process.env.BTC_RPC_URL;
  const menus = {
    mainWithKeystore: [
      {
        name: 'Manage Account',
        value: 'manager_account',
        description: 'Manage Account',
      },
      {
        name: 'Launch Client',
        value: 'launch_client',
        description: 'Launch Client',
      },
      {
        name: `${rpcUrl ? 'Reset' : 'Set'} BTC RPC Node`,
        value: 'set_btc_node',
        description: 'Set/Reset BTC RPC Node',
      },
      new Separator(),
      { name: 'Quit', value: '99', description: 'Quit' },
    ],
    mainWithoutKeystore: [
      {
        name: 'Create New Account',
        value: 'create_account',
        description: 'Create New Account',
      },
      {
        name: 'Import Seed Phrase',
        value: 'import_seed_phrase',
        description: 'Import Seed Phrase',
      },
      {
        name: 'Import Private Key',
        value: 'import_private_key',
        description: 'Import Private Key',
      },
      new Separator(),
      { name: 'Quit', value: '99', description: 'Quit' },
    ],
  };

  const actions: { [key: string]: () => Promise<any> } = {
    manager_account: async () => await bootstrap('manageAccount'),
    launch_client: async () => await bootstrap('launch_client'),
    set_btc_node: async () => await bootstrap('set_btc_node'),
    create_account: async () => await initializeAccount('Synchronizer'),
    import_seed_phrase: async () => await importFromMnemonic(),
    import_private_key: async () => await importFromPrivateKey(),
  };

  let action: string | undefined;
  do {
    init = existKeystore(); // Suppose this function checks if Keystore exists
    const mainMenu = init ? menus.mainWithKeystore : menus.mainWithoutKeystore;
    action = await select({ message: 'Select action', choices: mainMenu });
    if (action && actions[action]) {
      await actions[action]();
    }
  } while (!['launch_client', '99'].includes(action));
}

// Determine whether a file with the suffix _keystore.json exists in root_dir. If it exists, return true, otherwise return false.
function existKeystore(): boolean {
  reloadEnv();
  const file = process.env.KEYSTORE_FILE;
  if (file && fs.existsSync(file)) {
    return true;
  }
  return false;
  const dir = path.resolve(__dirname, '..');
  const files = fs.readdirSync(dir);
  for (let i = 0; i < files.length; i++) {
    if (files[i].endsWith('_keystore.json')) return true;
  }

  return false;
}

main().then(() => function () {});
