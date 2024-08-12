import config from 'config';
import cron from 'node-cron';
import {getblockcount, getblockhash} from "./utils/bitcoin";
import {Exsat} from "./utils/exsat";
import {logger} from './utils/logger';
import {inputWithCancel, isEndorserQualified, parseCurrency, reloadEnv, retry, sleep, updateEnvFile} from './utils/util';
import {readdirSync, readFileSync} from "fs";
import path from "node:path";
import {confirm, input, password, select, Separator} from "@inquirer/prompts";
import {
  chargeBtcForResource, chargeForRegistry, checkUsernameWithBackend,
  decryptKeystore,
  importFromMnemonic,
  importFromPrivateKey,
  initializeAccount,
} from "@exsat/account-initializer";
import fs from "node:fs";
import * as dotenv from 'dotenv';
import process from 'process';
import { program } from 'commander';
import {RETRY_INTERVAL_MS} from "./utils/constants";
const commandOptions = program
    .option('--pwd <password>', 'Set password for keystore')
    .option('--pwdfile <passwordFile>', 'Set password for keystore')
    .option('--run', 'Run synchronizer')
    .parse(process.argv)
    .opts();

let exsat:Exsat;
let accountInfo: any;
let encFile;
let [endorseRunning, endorseCheckRunning] = [false, false];


async function checkKeystoreAndParse(){
  if(process.env.KEYSTORE_FILE){
    encFile = process.env.KEYSTORE_FILE;
  }else{
    const rootDir = path.resolve(__dirname);
    const files = readdirSync(rootDir).filter((file) =>
        file.endsWith('_keystore.json'),
    );
    if (files.length > 0) {
      encFile = path.resolve(rootDir, files[0]);
    }else{
      console.log('No keystore file found, please create one first');
      process.exit();
    }
  }
  if(commandOptions.pwd){
    return decryptKeystoreWithPassword(commandOptions.pwd)
  } else if(commandOptions.pwdfile) {
    const password = readFileSync(commandOptions.pwdfile, 'utf-8').trim();
    await decryptKeystoreWithPassword(password);
  }else{
    try {
      return await retry(async () => {
        const passwordInput = await password({message: 'Enter your password(5 incorrect passwords will exit the program)'});

        return decryptKeystoreWithPassword(passwordInput)
      },5);
    }catch (error) {
      console.log('Error:Invaild Password');
      process.exit();
    }
  }

}
async function decryptKeystoreWithPassword(password: string) {
  const keystore = readFileSync(encFile, 'utf-8');

  const keystoreInfo = JSON.parse(keystore);
  const accountName = keystoreInfo.username.endsWith('.sat') ? keystoreInfo.username : `${keystoreInfo.username}.sat`;
  const data = await decryptKeystore(keystore, password);
  accountInfo = {...keystoreInfo, privateKey: data, accountName}
  await checkExsatInstance()
  return {account: accountName, privateKey: data};
}
async function submitEndorsement(validator: string, height: number, hash: string) {
  try {
    const result = await exsat.transact('blkendt.xsat', 'endorse', { validator, height, hash });
    logger.info(`Transaction was successfully broadcast! accountName: ${validator}, height: ${height}, hash: ${hash}, transaction_id: ${result.response!.transaction_id}`);
  } catch (error) {
    logger.error(`submit endorsement error, accountName: ${validator}, height: ${height}, hash: ${hash}`, error);
  }
}
async function checkExsatInstance(){
  if(!exsat){
    exsat=new Exsat();
    await exsat.init(accountInfo.privateKey, accountInfo.accountName);
  }

}
async function setValidatorConfig() {
  if(!accountInfo) await checkKeystoreAndParse()

  const accountName = accountInfo.accountName;
  const commissionRate = await input({
    message: 'Enter commission rate (0-10000, Input "q" to return):',
    validate: (input) => {
      if(input.toLowerCase() === 'q'){return true}
      const number = Number(input);
      if (!Number.isInteger(number) || number < 0 || number > 10000) {
        return 'Please enter a valid integer between 0 and 10000.';
      }
      return true;
    }
  });
  if(commissionRate.toLowerCase() === 'q'){return false}
  const financialAccount = await input({
    message: 'Enter Reward Address(Input "q" to return):',
    validate: (input: string) => {
      if(input.toLowerCase() === 'q'){return true}
      if (!/^0x[a-fA-F0-9]{40}$/.test(input)) {
        return 'Please enter a valid account name.';
      }
      return true;
    }
  });
  if(financialAccount.toLowerCase() === 'q'){return false}

  try {
    const result = await exsat.transact('endrmng.xsat', 'config', { validator:accountName, commission_rate:commissionRate, financial_account:financialAccount });
    logger.info(`Transaction was successfully broadcast! accountName: ${accountName}, commission_rate: ${commissionRate}, financial_account: ${financialAccount}, transaction_id: ${result.response!.transaction_id}`);
  } catch (error) {
    logger.error(`set config error, accountName: ${accountName}, commission_rate: ${commissionRate}, financial_account: ${financialAccount}`, error);
  }
}

async function checkAndSubmitEndorsement(accountName: string, height: number, hash: string) {
  const endorsement = await exsat.getEndorsementByBlockId(height,hash);

  if (endorsement) {
    let isQualified = isEndorserQualified(endorsement.requested_validators, accountName);
    if (isQualified && !isEndorserQualified(endorsement.provider_validators, accountName)) {
      await submitEndorsement(accountName, height, hash);
    }
  } else {
    await submitEndorsement(accountName, height, hash);
  }
}

async function validatorWork() {
  if(!accountInfo) await checkKeystoreAndParse()

  await checkAndSetBtcRpcUrl()
  const accountName = accountInfo.accountName;
  exsat = new Exsat();
  await exsat.init(accountInfo.privateKey, accountName);

  try {
    const res = await getClientStatus(accountName);
    const result = res.response.processed.action_traces[0].return_value_data;
    if (!result.has_auth || !result.is_exists) {
      logger.error(`Unvailable account:${accountName}`);
      return;
    }
    const balance = parseCurrency(result.balance);
    if (balance.amount < 0.0001) {
      logger.error('Insufficient balance');
      return;
    }
  } catch (e) {
    logger.error(`Unvailable account:${accountName}`);
    return;
  }

  cron.schedule(config.get('cron.endorseSchedule'), async () => {
    try {
      if (endorseRunning) {
        logger.info('Endorse task is already running. Skipping this round.');
        return;
      }
      endorseRunning = true;
      logger.info('Endorse task is running.');
      const blockcountInfo = await getblockcount();
      const blockhashInfo = await getblockhash(blockcountInfo.result);
      await checkAndSubmitEndorsement(accountName, blockcountInfo.result, blockhashInfo.result);
    } catch (e) {
      console.error('Endorse task error', e);
      await sleep(RETRY_INTERVAL_MS)
    } finally {
      endorseRunning = false;
    }
  });

  cron.schedule(config.get('cron.endorseCheckSchedule'), async () => {
    if (endorseCheckRunning) {
      logger.info('Endorse check task is already running. Skipping this round.');
      return;
    }
    endorseCheckRunning = true
    try {
      logger.info('Endorse check task is running.');
      const latestRewardHeight = await exsat.getLatestRewardHeight();
      if (latestRewardHeight === 0) {
        logger.info('No reward height found.');
        return;
      }
      const blockcount = await getblockcount();
      for (let i = latestRewardHeight+1; i <= blockcount.result; i++) {
        const blockhash = await getblockhash(i+800);
        logger.info(`Checking endorsement for block ${i}/${blockcount.result}`);
        await checkAndSubmitEndorsement(accountName, i, blockhash.result);
        await sleep(RETRY_INTERVAL_MS)
      }
    } catch (e) {
      console.error('Endorse check task error', e);
      await sleep(RETRY_INTERVAL_MS)
    } finally {
      endorseCheckRunning = false;
    }
  });

}

async function getClientStatus(accountName) {
  const data = {
    client: accountName,
    type: 2,
  };
  return await  exsat.transact(
      'rescmng.xsat',
      'checkclient',
      data,
  );
}

function existKeystore(): boolean {
  reloadEnv()
  const file = process.env.KEYSTORE_FILE;
  if (file && fs.existsSync(file)) {
    return true;
  }
  const dir = path.resolve(__dirname);
  const files = fs.readdirSync(dir);
  for (let i = 0; i < files.length; i++) {
    if (files[i].endsWith('_keystore.json')) return true;
  }

  return false;
}

/**
 *  set local btc rpc url
 */
async function checkAndSetBtcRpcUrl() {
  dotenv.config();
  // Check if .env file exists
  const envFilePath = '.env';
  if (!fs.existsSync(envFilePath)) {
    fs.writeFileSync(envFilePath, '');
  }

  // Reload .env file contents
  const envConfig = dotenv.parse(fs.readFileSync(envFilePath));

  if (!envConfig.BTC_RPC_URL || !isValidUrl(envConfig.BTC_RPC_URL)) {
    logger.info('BTC_RPC_URL is not set or not in the correct format.');
    // Prompt user for new BTC_RPC_URL
    const res = await setBtcRpcUrl(envConfig, envFilePath);
    if(!res) return false;
  } else {
    logger.info('BTC_RPC_URL is already set correctly.');
  }
  return true;
}
async function resetBtcRpcUrl() {
  const rpcUrl = process.env.BTC_RPC_URL;
  if (rpcUrl) {
    if (
        !(await confirm({
          message: `Your BTC_RPC_URL:${rpcUrl}\nAre you sure to reset it?`,
        }))
    ) {
      return;
    }
  }
  return await setBtcRpcUrl();
}

async function setBtcRpcUrl(envConfig?, envFilePath?) {
  const btcRpcUrl = await inputWithCancel(
      'Please enter new BTC_RPC_URL(Input "q" to return): ',
      (input) => {
        if (!isValidUrl(input)) {
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

  process.env.BTC_RPC_URL = btcRpcUrl
  process.env.BTC_RPC_USERNAME = rpcUsername
  process.env.BTC_RPC_PASSWORD = rpcPassword

  logger.info('.env file has been updated successfully.');
  return true;
}


// Function to validate URL
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch (_) {
    return false;
  }
}
// Functions to validate JSON strings
function isValidJson(jsonString: string): boolean {
  try {
    JSON.parse(jsonString);
    return true;
  } catch (error) {
    return false;
  }
}

async function removeKeystore() {
  try {
    await retry(async () => {
      const passwordInput = await password({
        message:
            'Enter your password to Remove Account\n(5 incorrect passwords will exit the program,Enter "q" to return):',
      });
      if (passwordInput === 'q') {
        return false;
      }
      const keystore = readFileSync(encFile, 'utf-8');
      await decryptKeystore(keystore, passwordInput);
      fs.unlinkSync(encFile);
      logger.info('Remove Account successfully');
      process.exit();
    }, 5);
  } catch (e) {
    logger.error('Invaild Password');
    process.exit();
  }
}
async function main(){
  let init = existKeystore();
  if(init && commandOptions.run){
    await validatorWork();
    return;
  }

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
        name: `${process.env.BTC_RPC_URL?'Reset':'Set'} BTC RPC Node`,
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
    manager_account: async () => await manageAccount(),
    launch_client: async () => await  validatorWork(),
    set_btc_node: async () => await resetBtcRpcUrl(),
    create_account: async () => await initializeAccount('Validator'),
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
  } while (!['99','launch_client'].includes(action));
}
async function manageAccount() {
  if (!accountInfo) {
    await checkKeystoreAndParse();
  }

  const accountName = accountInfo.accountName;
  const btcBalance = await exsat.getBalance(accountName);
  const checkAccountInfo = await checkUsernameWithBackend(accountName);
  const validator =
      await exsat.getValidatorByAccount(accountName);
  let manageMessage = `-----------------------------------------------
   Account: ${accountName}
   Public Key: ${accountInfo.address}
   BTC Balance Used for Gas Fee: ${btcBalance} ${validator ? `\n   Reward Address: ${validator.memo ?? validator.reward_recipient}\n   Commission Rate: ${validator.commission_rate/100}%` : ''}
   Account Registration Status: ${checkAccountInfo.status === 'completed' ? 'Registered' : checkAccountInfo.status === 'initial' ? 'Unregistered. Please recharge Gas Fee (BTC) to register.' : checkAccountInfo.status === 'charging' ? 'Registering, this may take a moment. Please be patient' : 'Invalid'}
   Validator Registration Status: ${validator ? 'Registered' : 'Not Registered'}`;
  if(validator){
    manageMessage += `
   BTC Staking Status: ${validator.disabled_staking?'Not Accepting Staking':'Accepting Staking'}
   Amount of BTC Staked: ${validator.quantity}
  -----------------------------------------------`
  }else {
    manageMessage += `
  -----------------------------------------------`;
  }


  let menus = [];
  switch (checkAccountInfo.status) {
    case 'chain_exist':
    case 'completed':
      menus =[
        {
          name: 'Bridge BTC as GAS Fee',
          value: 'recharge_btc',
          description: 'Bridge BTC as GAS Fee',
        },
        {
          name: `${validator?.reward_recipient?'Reset':'Set'} Reward Address And Commission Rate`,
          value: 'set_reward_address',
          description: 'Set/Reset Reward Address',
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
          name: 'Bridge BTC as GAS Fee',
          value: 'recharge_btc_registry',
          description: 'Bridge BTC as GAS Fee',
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
    recharge_btc: async () => await chargeBtcForResource(encFile),
    recharge_btc_registry: async () => await chargeForRegistry(accountName,checkAccountInfo.btcAddress,checkAccountInfo.amount),
    set_reward_address: async () => await setValidatorConfig(),
    export_private_key: async () => {
      console.log(
          `Private Key:${accountInfo.privateKey}`,
      );
      await input({message:"Press [enter] to continue"});
    },
    remove_account: async () => await removeKeystore(),
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

main().then(() => {
}).catch((e) => {
  logger.error(e);
});


