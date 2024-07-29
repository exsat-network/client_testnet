import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '~/common/logger/logger';
import { readdirSync, readFileSync } from 'fs';
import {
  chargeBtcForResource,
  chargeForRegistry,
  decryptKeystore,
} from 'account-initializer';
import { password, confirm, input } from '@inquirer/prompts';
import { SynchronizerSerivce } from '~/service/synchronizer.serivce';
import { ExsatService } from '~/service/exsat.service';
import { retry } from '~/utils/http';
import * as fs from 'node:fs';
import { BtcService } from '~/service/btc.service';
import select, { Separator } from '@inquirer/select';
import { checkUsernameWithBackend } from 'account-initializer/dist/accountInitializer';
import * as path from 'node:path';
import process from 'node:process';
import { inputWithCancel } from '~/utils/input';
import { updateEnvFile } from '~/utils/env';
import { commandOptions } from '~/main';

@Injectable()
export class InteractiveService {
  private encFile;
  constructor(
    private configService: ConfigService,
    private exsatService: ExsatService,
    private btcService: BtcService,
    private logger: Logger,
    private synchronizerService: SynchronizerSerivce,
  ) {
    if (configService.get<string>('KEYSTORE_FILE')) {
      this.encFile = configService.get<string>('KEYSTORE_FILE');
    } else {
      const rootDir = configService.get<string>('app.root_dir');
      const files = readdirSync(rootDir).filter((file) =>
        file.endsWith('_keystore.json'),
      );

      if (files.length > 0) {
        this.encFile = path.resolve(rootDir, files[0]);
      } else {
        throw new Error('Keystore file not found');
      }
    }
  }

  async beforeCheck() {
    await this.decryptKeystore();
    const synchronizer =
      await this.synchronizerService.getSynchronizersByAccount(
        this.configService.get<string>('exsat_account'),
      );
    if (!synchronizer) {
      throw new Error('Unvailable account');
    }
    if (!synchronizer.reward_recipient) {
      await this.setRewardAddress();
    }
    await this.checkAndSetBtcRpcUrl();
    this.btcService.init();
  }

  async decryptKeystore() {
    if (!this.configService.get('exsat_privatekey')) {
      try {
        if (commandOptions.pwd) {
          await this.decryptKeystoreWithPassword(commandOptions.pwd);
        } else if (commandOptions.pwdfile) {
          const password = readFileSync(commandOptions.pwdfile, 'utf-8');

          await this.decryptKeystoreWithPassword(password);
        } else {
          await retry(async () => {
            const passwordInput = await password({
              message:
                'Enter your password (5 incorrect passwords will exit the program)',
            });
            await this.decryptKeystoreWithPassword(passwordInput);
          }, 5);
        }
        await this.exsatService.init();
      } catch (e) {
        console.log(path.resolve(commandOptions.pwdfile));
        const password = readFileSync(commandOptions.pwdfile, 'utf-8');
        console.log(password);
        this.logger.error('Invaild Password');
        process.exit();
      }
    }
  }
  private async decryptKeystoreWithPassword(password: string) {
    const keystore = readFileSync(this.encFile, 'utf-8');
    const keystoreInfo = JSON.parse(keystore);
    const data = await decryptKeystore(keystore, password);

    this.configService.set('exsat_privatekey', data);
    this.configService.set('exsat_publickey', keystoreInfo.address);
    this.configService.set(
      'exsat_account',
      keystoreInfo.username.endsWith('.sat')
        ? keystoreInfo.username
        : keystoreInfo.username + '.sat',
    );
  }
  /**
   *  set finance account
   *
   */
  async setRewardAddress() {
    if (!this.configService.get('exsat_privatekey')) {
      await this.decryptKeystore();
    }
    const financialAccount = await inputWithCancel(
      'Enter Reward Address(Input "q" to return):',
      (input: string) => {
        if (!/^0x[a-fA-F0-9]{40}$/.test(input)) {
          return 'Please enter a valid account name.';
        }
        return true;
      },
    );
    if (!financialAccount) {
      return false;
    }
    await this.synchronizerService.resetRewardAddress(financialAccount);
    this.logger.log(`Set Reward Account:${financialAccount} successfully`);
  }

  /**
   *  buy slots
   */
  async purchaseSlots() {
    if (!this.configService.get('exsat_privatekey')) {
      await this.decryptKeystore();
    }

    const numberSlots = await inputWithCancel(
      'Enter number of slots(Input "q" to return)',
      (value) => {
        const num = Number(value);
        if (!Number.isInteger(num) || num < 1) {
          return 'Please enter a valid number more than 0';
        }
        return true;
      },
    );
    if (!numberSlots) {
      return;
    }

    await this.synchronizerService.buySlots(parseInt(numberSlots));
    this.logger.log(`Buy slots:${numberSlots} successfully`);
  }

  /**
   *  set local btc rpc url
   */
  async checkAndSetBtcRpcUrl() {
    const rpcUrl = this.configService.get('BTC_RPC_URL');

    if (!rpcUrl || !this.isValidUrl(rpcUrl)) {
      this.logger.log('BTC_RPC_URL is not set or not in the correct format.');
      // Prompt user for new BTC_RPC_URL
      const res = await this.setBtcRpcUrl();
      if (!res) {
        this.logger.log('Set BTC_RPC_URL failed.');
        process.exit();
      }
    } else {
      this.logger.log('BTC_RPC_URL is already set correctly.');
    }
  }
  async resetBtcRpcUrl() {
    const rpcUrl = this.configService.get('BTC_RPC_URL');
    if (rpcUrl) {
      if (
        !(await confirm({
          message: `Your BTC_RPC_URL:${rpcUrl}\nAre you sure to reset it?`,
        }))
      ) {
        return;
      }
    }
    return await this.setBtcRpcUrl();
  }

  async setBtcRpcUrl() {
    const btcRpcUrl = await inputWithCancel(
      'Please enter new BTC_RPC_URL(Input "q" to return): ',
      (input) => {
        if (!this.isValidUrl(input)) {
          return 'Please enter a valid URL';
        }
        return true;
      },
    );
    if (!btcRpcUrl) {
      return false;
    }
    const values = {};

    // Update .env file
    values['BTC_RPC_URL'] = btcRpcUrl;
    values['BTC_RPC_USERNAME'] = '';
    values['BTC_RPC_PASSWORD'] = '';
    let rpcUsername: boolean | string = '';
    let rpcPassword: boolean | string = '';
    if (
      await confirm({
        message: 'Do You need to configure the username and password?',
      })
    ) {
      rpcUsername = await inputWithCancel(
        'Please enter RPC username(Input "q" to return): ',
      );
      if (!rpcUsername) {
        return false;
      }
      rpcPassword = await inputWithCancel(
        'Please enter RPC password(Input "q" to return): ',
      );
      if (!rpcPassword) {
        return false;
      }
    }
    values['BTC_RPC_USERNAME'] = rpcUsername;
    values['BTC_RPC_PASSWORD'] = rpcPassword;

    updateEnvFile(values);
    this.configService.set('BTC_RPC_URL', btcRpcUrl);
    this.configService.set('BTC_RPC_USERNAME', rpcUsername);
    this.configService.set('BTC_RPC_PASSWORD', rpcPassword);

    this.logger.log('.env file has been updated successfully.');
    return true;
  }

  async removeKeystore() {
    try {
      await retry(async () => {
        const passwordInput = await password({
          message:
            'Enter your password to Remove Account\n(5 incorrect passwords will exit the program,Enter "q" to return):',
        });
        if (passwordInput === 'q') {
          return false;
        }
        const keystore = readFileSync(this.encFile, 'utf-8');
        await decryptKeystore(keystore, passwordInput);
        fs.unlinkSync(this.encFile);
        this.logger.log('Remove Account successfully');
        process.exit();
      }, 5);
    } catch (e) {
      this.logger.error('Invaild Password');
      process.exit();
    }
  }
  async manageAccount() {
    if (!this.configService.get('exsat_privatekey')) {
      await this.decryptKeystore();
    }
    const accountName = this.configService.get<string>('exsat_account');
    const btcBalance = await this.synchronizerService.getBalance(accountName);
    const checkAccountInfo = await checkUsernameWithBackend(accountName);
    const synchronizer =
      await this.synchronizerService.getSynchronizersByAccount(accountName);
    const manageMessage = `-----------------------------------------------
   Account: ${accountName}
   Public Key: ${this.configService.get('exsat_publickey')}
   BTC Balance: ${btcBalance} ${synchronizer ? `\n   Reward Address: ${synchronizer.memo ?? synchronizer.reward_recipient}` : ''}
   Account Registration Status: ${checkAccountInfo.status === 'completed' ? 'Registered' : checkAccountInfo.status === 'initial' ? 'Unregistered. Please recharge Gas Fee (BTC) to register.' : checkAccountInfo.status === 'charging' ? 'Registering, this may take a moment. Please be patient' : 'Invalid'}
   Synchronizer Registration Status: ${synchronizer ? 'Registered' : 'Not Registered'}${synchronizer ? `\n   Memory Slot: ${synchronizer.num_slots}` : ''}
  -----------------------------------------------`;
    let menus = [];
    switch (checkAccountInfo.status) {
      case 'chain_exist':
      case 'completed':
        menus = [
          {
            name: 'Recharge BTC',
            value: 'recharge_btc',
            description: 'Recharge BTC',
          },
          {
            name: synchronizer?.reward_recipient
              ? 'Reset Reward Address'
              : 'Set Reward Address',
            value: 'set_reward_address',
            description: 'Set/Reset Reward Address',
            disabled: !synchronizer,
          },
          {
            name: 'Purchase Memory Slot',
            value: 'purchase_memory_slot',
            description: 'Purchase Memory Slot',
            disabled: !synchronizer,
          },
          {
            name: 'Export Private Key',
            value: 'export_private_key',
            description: 'Export Private Key',
          },
          {
            name: 'Remove Account',
            value: 'remove_account',
            description: 'Remove Account',
          },
          new Separator(),
          {
            name: 'Back to Main Menu',
            value: '99',
            description: 'Back to Main Menu',
          },
        ];
        break;
      case 'initial':
        menus = [
          {
            name: 'Recharge BTC',
            value: 'recharge_btc_registry',
            description: 'Recharge BTC',
          },
          {
            name: 'Export Private Key',
            value: 'export_private_key',
            description: 'Export Private Key',
          },
          {
            name: 'Remove Account',
            value: 'remove_account',
            description: 'Remove Account',
          },
          new Separator(),
          {
            name: 'Back to Main Menu',
            value: '99',
            description: 'Back to Main Menu',
          },
        ];
        break;
      case 'charging':
        menus = [
          {
            name: 'Export Private Key',
            value: 'export_private_key',
            description: 'Export Private Key',
          },
          {
            name: 'Remove Account',
            value: 'remove_account',
            description: 'Remove Account',
          },
          new Separator(),
          {
            name: 'Back to Main Menu',
            value: '99',
            description: 'Back to Main Menu',
          },
        ];
        break;
      default:
        return;
    }

    const actions: { [key: string]: () => Promise<any> } = {
      recharge_btc: async () => await chargeBtcForResource(this.encFile),
      recharge_btc_registry: async () =>
        await chargeForRegistry(
          accountName,
          checkAccountInfo.btcAddress,
          checkAccountInfo.amount,
        ),
      set_reward_address: async () => await this.setRewardAddress(),
      purchase_memory_slot: async () => await this.purchaseSlots(),
      export_private_key: async () => {
        console.log(
          `Private Key:${this.configService.get('exsat_privatekey')}`,
        );
        await input({ message: 'Press [enter] to continue' });
      },
      remove_account: async () => await this.removeKeystore(),
    };

    let action;
    do {
      action = await select({
        message: manageMessage,
        choices: menus,
      });
      if (action !== '99') {
        await (actions[action] || (() => {}))();
      }
    } while (action !== '99');
  }
  // Function to validate URL
  isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch (_) {
      return false;
    }
  }
  // Functions to validate JSON strings
  isValidJson(jsonString: string): boolean {
    try {
      JSON.parse(jsonString);
      return true;
    } catch (error) {
      return false;
    }
  }
}
