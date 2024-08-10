import simpleGit, { SimpleGit } from 'simple-git';
import axios from 'axios';
import semver from 'semver';
import fs from 'fs-extra';
import path from 'path';

const git: SimpleGit = simpleGit();

async function getLocalVersion(): Promise<string> {
  try {
    const tags = await git.tags();
    if (tags.all.length === 0) {
      throw new Error('No tags found in the local repository.');
    }
    return tags.latest || '';
  } catch (error) {
    console.error('Error getting local version:', error);
    throw error;
  }
}

async function getRemoteUrl(): Promise<string> {
  try {
    const configPath = path.join(process.cwd(), '.git', 'config');
    const config = await fs.readFile(configPath, 'utf8');
    const match = config.match(/\[remote "origin"\][\s\S]*?url = (.+)/);
    if (!match) {
      throw new Error('No remote origin URL found in Git config.');
    }
    return match[1];
  } catch (error) {
    console.error('Error getting remote URL:', error);
    throw error;
  }
}

async function getRemoteVersion(remoteUrl: string): Promise<string> {
  try {
    const response = await axios.get(remoteUrl);
    if (response.status !== 200) {
      throw new Error(
        `Failed to fetch remote version, status code: ${response.status}`,
      );
    }
    return response.data.version;
  } catch (error) {
    console.error('Error getting remote version:', error);
    throw error;
  }
}

export async function checkForUpdates() {
  try {
    const localVersion = await getLocalVersion();
    const remoteUrl = await getRemoteUrl();

    // 假设远程版本信息存储在某个固定路径，例如：remoteUrl + '/version.json'
    const remoteVersionUrl = `${remoteUrl}/version.json`;
    const remoteVersion = await getRemoteVersion(remoteVersionUrl);

    console.log(`Local version: ${localVersion}`);
    console.log(`Remote version: ${remoteVersion}`);

    if (semver.lt(localVersion, remoteVersion)) {
      console.log(
        `A new version (${remoteVersion}) is available. Please update.`,
      );
    } else {
      console.log('You are using the latest version.');
    }
  } catch (error) {
    console.error('Error checking for updates:', error);
  }
}
