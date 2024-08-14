import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import axios from 'axios';
import process from 'node:process';
const git = simpleGit(path.resolve(process.cwd(), '../'));

export class Version {
  private static gitConfigPath = path.join(process.cwd(), '../.git', 'config');

  // Read the .git/config file and resolve the remote warehouse address
  static getRepoUrl(): string | null {
    if (!fs.existsSync(this.gitConfigPath)) {
      return null;
    }

    const configContent = fs.readFileSync(this.gitConfigPath, 'utf-8');
    const match = configContent.match(
      /\[remote "origin"\][\s\S]*?url\s*=\s*(.+)/,
    );
    return match ? match[1].trim() : null;
  }

  //Get the latest version number of the remote warehouse
  static async getLatestVersion(): Promise<string | null> {
    try {
      const repoUrl = this.getRepoUrl();
      if (!repoUrl) {
        throw new Error('Repository URL not found in .git/config');
      }
      const repoMatch = repoUrl.match(/github\.com[:/](.+)\.git/);
      if (!repoMatch) {
        throw new Error('Unsupported repository URL');
      }

      const repo = repoMatch[1];
      const response = await axios.get(
        `https://api.github.com/repos/${repo}/releases/latest`,
      );
      return response.data.tag_name;
    } catch (error) {
      throw new Error('Failed to fetch latest version:');
    }
  }
  static async pullLatestChanges(): Promise<void> {
    try {
      await git.pull(); // Assuming 'main' is the branch you want to pull from
      console.log('Successfully pulled the latest changes.');
    } catch (error) {
      if (error.message.includes('CONFLICT')) {
        throw new Error(
          'Merge conflict detected. Please resolve the conflicts manually.',
        );
      } else {
        throw new Error(error.message, error.stack);
      }
    }
  }

  static async checkoutTag(tag: string): Promise<void> {
    try {
      await git.checkout(tag);
      console.log(`Successfully checked out to tag ${tag}.`);
    } catch (error) {
      console.error(`Error checking out to tag ${tag}:`, error);
    }
  }
  // Get the current version number of the local warehouse
  static async getLocalVersion(): Promise<string | null> {
    try {
      const tags = await git.tags();
      return tags.latest;
    } catch (error) {
      throw new Error('Failed to fetch local version:');
    }
  }

  // Check if the code needs to be updated
  static async checkForUpdates(action?) {
    const [latestVersion, localVersion] = await Promise.all([
      this.getLatestVersion(),
      this.getLocalVersion(),
    ]);

    if (!latestVersion || !localVersion) {
      throw new Error('Failed to determine versions');
    }

    if (latestVersion !== localVersion) {
      if (action === 'update') {
        await this.checkoutTag('.');
        await this.pullLatestChanges();
        await this.checkoutTag(latestVersion);
      }
      return { latest: latestVersion, current: localVersion, new: true };
    } else {
      return { latest: latestVersion, current: localVersion, new: false };
    }
  }
}
