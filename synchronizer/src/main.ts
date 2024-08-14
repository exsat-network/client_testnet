import select, { Separator } from '@inquirer/select';
import 'dotenv/config';
import { bootstrap } from '~/bootstrap';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  importFromMnemonic,
  importFromPrivateKey,
  initializeAccount,
} from '@exsat/account-initializer';
import { program } from 'commander';
import { reloadEnv } from '~/utils/env';
import { Version } from '~/utils/version';
import { ColorUtils } from '~/utils/color';
const commandOptions = program
  .option('--pwd <password>', 'Set password for keystore')
  .option('--pwdfile <password>', 'Set password for keystore')
  .option('--run', 'Run synchronizer')
  .parse(process.argv)
  .opts();
export { commandOptions };
async function main() {
  if (commandOptions.pwd || commandOptions.pwdfile) {
    reloadEnv();
  }
  let init = existKeystore();
  if (init && commandOptions.run) {
    await bootstrap('launch_client');
    return;
  }
  console.log(
    '-------------------------------\nPlease note: It is highly recommended that you carefully read the user guide and follow the instructions precisely to avoid any unnecessary issues.\n' +
      'User Guide: https://docs.exsat.network/user-guide-for-testnet-hayek\n-------------------------------',
  );
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
    upgrade_client: async () => await Version.checkForUpdates('update'),
    check_client_version: async () => await checkClientMenu(),
  };

  let action: string | undefined;
  do {
    const versions = await Version.checkForUpdates('message');
    init = existKeystore(); // Suppose this function checks if Keystore exists
    let mainMenu = init ? menus.mainWithKeystore : menus.mainWithoutKeystore;
    if (versions.new) {
      mainMenu = [
        {
          name: `Upgrade Client(From ${versions.current} to ${versions.latest})`,
          value: 'upgrade_client',
          description: 'Upgrade Client',
        },
        ...mainMenu,
      ];
    } else {
      mainMenu = [
        ...mainMenu,
        {
          name: `Check Client Version`,
          value: 'check_client_version',
          description: 'Check Client Version',
        },
      ];
    }

    action = await select({ message: 'Select action', choices: mainMenu });
    if (action && actions[action]) {
      await actions[action]();
    }
  } while (!['launch_client', '99'].includes(action));
}
async function checkClientMenu() {
  const menus = [
    new Separator(),
    {
      name: 'Back to Main Menu',
      value: '99',
      description: 'Back to Main Menu',
    },
  ];
  let versionMessage;
  const versions = await Version.checkForUpdates('message');
  if (versions.new) {
    versionMessage =
      '-----------------------------------------------\n' +
      `Client Current Version: ${versions.current}\n` +
      ColorUtils.colorize(
        `Client Latest  Version: ${versions.latest}`,
        ColorUtils.fgYellow,
      ) +
      '\n-----------------------------------------------\n';
    menus.unshift({
      name: `Upgrade Client ( From ${versions.current} to ${versions.latest})`,
      value: 'upgrade_client',
      description: 'Upgrade Client',
    });
  } else {
    versionMessage =
      '-----------------------------------------------\n' +
      `Client Current Version: ${versions.current}\n` +
      `The Latest Version\n` +
      '-----------------------------------------------\n';
  }
  const actions: { [key: string]: () => Promise<any> } = {
    upgrade_client: async () => await Version.checkForUpdates('update'),
  };

  let action;
  do {
    action = await select({
      message: versionMessage,
      choices: menus,
    });
    if (action !== '99') {
      await (actions[action] || (() => {}))();
    }
  } while (action !== '99');
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
