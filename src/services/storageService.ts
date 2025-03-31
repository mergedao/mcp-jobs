import fs from 'fs';
import path from 'path';

export class StorageService {
  private dataDir: string;

  constructor() {
    this.dataDir = path.join(process.cwd(), 'data');
    this.ensureDataDirectory();
  }

  private ensureDataDirectory() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  async saveData(siteName: string, data: any): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${siteName}_${timestamp}.json`;
    const filePath = path.join(this.dataDir, fileName);

    try {
      await fs.promises.writeFile(
        filePath,
        JSON.stringify(data, null, 2),
        'utf-8'
      );
      console.log(`Data saved to ${filePath}`);
    } catch (error) {
      console.error(`Error saving data to ${filePath}:`, error);
      throw error;
    }
  }

  async loadLatestData(siteName: string): Promise<any | null> {
    try {
      const files = await fs.promises.readdir(this.dataDir);
      const siteFiles = files.filter(file => file.startsWith(siteName));
      
      if (siteFiles.length === 0) {
        return null;
      }

      // 按文件名排序，获取最新的文件
      siteFiles.sort().reverse();
      const latestFile = siteFiles[0];
      const filePath = path.join(this.dataDir, latestFile);

      const data = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error loading data for ${siteName}:`, error);
      return null;
    }
  }
} 