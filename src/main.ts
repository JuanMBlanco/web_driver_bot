import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';
import { mkdirSync, writeFileSync, unlinkSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import puppeteer from 'puppeteer';
import { launch } from 'puppeteer-core';
import yaml from 'js-yaml';
import { Bot, InputFile } from 'grammy';

interface ApiResponse {
  success: boolean;
  message: string;
  error: string | null;
  data?: undefined | string | any;
  [key: string]: any;
}

interface Token {
  token: string;
  role: string;
  description: string;
}

interface BotConfig {
  browser: {
    executablePath: string;
    userDataPath: string;
    args: string[];
    poolSize?: number;
    checkBrowserInterval?: number;
    browserAge?: number;
  };
  viewport?: {
    width?: number;
    height?: number;
  };
  task: {
    url: string;
    checkInterval: number;
    clickSelectors: string[];
    listSelector: string;
    maxItemsPerCycle?: number;
  };
  paths: {
    pidFile: string;
    dataPath: string;
  };
  server: {
    basePath: string;
    port: number;
  };
  cleanup?: {
    days?: number;
  };
  tokens?: Token[];
}

let validTokens: Token[] = [];
let telegramBot: Bot | null = null;
let telegramChatIds: string[] = [];
let taskInterval: NodeJS.Timeout | null = null;

/**
 * Custom logging function with timestamp and colored output
 */
function logMessage(message: string, level: string = 'INFO'): void {
  const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m'
  };

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const timeStr = `${hours}:${minutes}:${seconds}`;

  const isPM2 = typeof process.env.PM2_HOME !== 'undefined' ||
    process.env.PM2_JSON_PROCESSING === 'true' ||
    process.env.pm_id !== undefined;

  const supportsColor = !isPM2 && process.stdout.isTTY && !process.env.NO_COLOR;

  const timestamp = `[${dateStr} ${timeStr}]`;
  const levelFormatted = `[${level}]`;

  let logEntry;

  if (supportsColor) {
    let colorCode = '';
    switch (level) {
      case 'INFO':
        colorCode = colors.green;
        break;
      case 'ERROR':
        colorCode = colors.red;
        break;
      case 'WARNING':
        colorCode = colors.yellow;
        break;
      default:
        colorCode = colors.reset;
    }
    logEntry = `${timestamp} ${colorCode}${levelFormatted}${colors.reset} ${message}`;
  } else {
    logEntry = `${timestamp} ${levelFormatted} ${message}`;
  }

  if (isPM2) {
    if (level === 'ERROR') {
      process.stderr.write(logEntry + '\n');
    } else {
      process.stdout.write(logEntry + '\n');
    }
  } else {
    if (level === 'ERROR') {
      console.error(logEntry);
    } else if (level === 'WARNING') {
      console.warn(logEntry);
    } else {
      console.log(logEntry);
    }
  }
}

/**
 * Interface representing a browser profile in the pool
 */
interface BrowserProfile {
  profile: string;
  pid: string;
  instance: number;
  browser: puppeteer.Browser | null;
  usedSince: Date | null;
}

/**
 * Class to manage a pool of browser profiles
 */
class BrowserPool {
  private available: BrowserProfile[] = [];
  private used: BrowserProfile[] = [];
  private config: BotConfig;

  constructor(config: BotConfig) {
    this.config = config;
    this.initPool();
  }

  private initPool(): void {
    const poolSize = this.config.browser.poolSize || 3;

    for (let i = 1; i <= poolSize; i++) {
      const instanceNum = i.toString().padStart(2, '0');
      const profile: BrowserProfile = {
        instance: i,
        profile: this.getProfilePath(instanceNum),
        pid: this.getPidFilePath(instanceNum),
        browser: null,
        usedSince: null
      };
      this.available.push(profile);
    }

    logMessage(`Initialized browser pool with ${poolSize} profiles`);
  }

  private getProfilePath(instanceNum: string): string {
    return this.config.browser.userDataPath.replaceAll('{__instance__}', instanceNum);
  }

  private getPidFilePath(instanceNum: string): string {
    const profilePath = this.getProfilePath(instanceNum);
    return `${profilePath}/pid.txt`;
  }

  getBrowserProfile(context: string): BrowserProfile | null {
    if (this.available.length === 0) {
      logMessage("No available browser profiles in pool");
      return null;
    }

    const profile = this.available.shift()!;
    profile.profile = profile.profile.replaceAll('{__context__}', context);
    profile.pid = profile.pid.replaceAll('{__context__}', context);
    profile.usedSince = new Date();
    this.used.push(profile);

    logMessage(`Allocated browser profile: ${profile.profile}, remaining: ${this.available.length}`);
    return profile;
  }

  returnBrowserProfile(profile: BrowserProfile, deleteFile: boolean = true): void {
    const index = this.used.findIndex(p => p.instance === profile.instance);

    if (index !== -1) {
      this.used.splice(index, 1);

      if (deleteFile && fileExists(profile.pid)) {
        try {
          unlinkSync(profile.pid);
          logMessage(`Deleted PID file: ${profile.pid}`);
        } catch (error) {
          logMessage(`Failed to delete PID file: ${profile.pid}: ${error}`, 'ERROR');
        }
      }

      const instanceNum = profile.instance.toString().padStart(2, '0');
      profile.profile = this.getProfilePath(instanceNum);
      profile.pid = this.getPidFilePath(instanceNum);
      profile.browser = null;
      profile.usedSince = null;

      this.available.push(profile);
      logMessage(`Returned browser profile to pool: ${profile.instance}, available: ${this.available.length}`);
    } else {
      logMessage(`Attempted to return unknown browser profile: ${profile.instance}`, 'WARNING');
    }
  }

  get availableCount(): number {
    return this.available.length;
  }

  get usedCount(): number {
    return this.used.length;
  }

  findProfileByBrowser(browser: puppeteer.Browser): BrowserProfile | null {
    const profile = this.used.find(p => p.browser === browser);
    return profile || null;
  }

  getProfileAgeInSeconds(profile: BrowserProfile): number {
    if (!profile.usedSince) {
      return 0;
    }
    const now = new Date();
    const diffMs = now.getTime() - profile.usedSince.getTime();
    return Math.floor(diffMs / 1000);
  }

  async manageBrowserTabs(browser: puppeteer.Browser, instanceId: string | number): Promise<puppeteer.Page> {
    try {
      let pages = await browser.pages();
      let blankTabToKeep = pages.find(p => p.url() === 'about:blank' || p.url() === '');

      if (!blankTabToKeep) {
        logMessage(`No about:blank tab found for profile ${instanceId}, creating one`);
        blankTabToKeep = await browser.newPage();
      } else {
        logMessage(`Found existing about:blank tab to keep for profile ${instanceId}`);
      }

      pages = await browser.pages();

      for (const page of pages) {
        if (page !== blankTabToKeep) {
          try {
            await page.close();
            logMessage(`Closed a tab for profile ${instanceId}`);
          } catch (closeError) {
            logMessage(`Error closing tab for profile ${instanceId}: ${closeError}`, 'ERROR');
          }
        }
      }

      logMessage(`Tab cleanup completed for profile ${instanceId}`);
      return await browser.newPage();
    } catch (error) {
      logMessage(`Error managing tabs for profile ${instanceId}: ${error}`, 'ERROR');
      return await browser.newPage();
    }
  }

  async forceCloseBrowsersOlderThan(maxTimeSeconds: number): Promise<{ processed: number, closed: number }> {
    const result = { processed: 0, closed: 0 };

    if (this.used.length === 0) {
      logMessage("No used browser profiles to check");
      return result;
    }

    logMessage(`Checking for browsers used for ${maxTimeSeconds} seconds or more`);

    const usedProfilesToCheck = [...this.used];

    for (const profile of usedProfilesToCheck) {
      const ageInSeconds = this.getProfileAgeInSeconds(profile);
      result.processed++;

      if (ageInSeconds >= maxTimeSeconds) {
        logMessage(`Profile ${profile.instance} has been used for ${ageInSeconds} seconds, which exceeds the limit of ${maxTimeSeconds} seconds`);

        try {
          if (profile.browser) {
            try {
              await this.manageBrowserTabs(profile.browser, profile.instance);
            } catch (tabError) {
              logMessage(`Error managing tabs for profile ${profile.instance}: ${tabError}`, 'ERROR');
            }

            try {
              logMessage(`Attempting to close browser for profile ${profile.instance}`);
              await profile.browser.close();
            } finally {
              // Avoid the error
            }
          }

          await waitRandomTime(2000, 2000);

          if (fileExists(profile.pid)) {
            try {
              const pidData = readFileSync(profile.pid, { encoding: 'utf8' });
              const pid = parseInt(pidData.trim(), 10);

              if (isRunning(pid)) {
                logMessage(`Process ${pid} for profile ${profile.instance} is still running after browser.close(), forcefully terminating`);

                try {
                  process.kill(pid);
                } catch (killError) {
                  logMessage(`Error terminating process ${pid}: ${killError}`, 'ERROR');
                }
              }
            } catch (pidError) {
              logMessage(`Error reading PID file for profile ${profile.instance}: ${pidError}`, 'ERROR');
            }
          }

          this.returnBrowserProfile(profile, true);
          result.closed++;
        } catch (error) {
          logMessage(`Error closing browser for profile ${profile.instance}: ${error}`, 'ERROR');
        }
      } else {
        logMessage(`Profile ${profile.instance} has been used for ${ageInSeconds} seconds, which is within the limit of ${maxTimeSeconds} seconds`);
      }
    }

    logMessage(`Force close operation completed. Processed: ${result.processed}, Closed: ${result.closed}`);
    return result;
  }
}

let browserPool: BrowserPool;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

/**
 * Load configuration from YAML file
 */
function loadConfig(): BotConfig {
  try {
    const fileContents = readFileSync(path.join(projectRoot, 'config', 'ezcater_web_driver_bot.yaml'), 'utf8');
    const config = yaml.load(fileContents) as BotConfig;

    if (config.browser.userDataPath.endsWith('/') || config.browser.userDataPath.endsWith('\\')) {
      config.browser.userDataPath = config.browser.userDataPath.slice(0, -1);
    }

    if (config.paths.dataPath.endsWith('/') || config.paths.dataPath.endsWith('\\')) {
      config.paths.dataPath = config.paths.dataPath.slice(0, -1);
    }

    if (config.paths.pidFile) {
      const pidDir = path.dirname(config.paths.pidFile);
      if (!fileExists(pidDir)) {
        logMessage(`Creating directory for PID file: ${pidDir}`);
        mkdirSync(pidDir, { recursive: true });
      }
    }

    return config;
  } catch (error) {
    logMessage('Error loading configuration: ' + error, 'ERROR');
    throw error;
  }
}

/**
 * Initialize the Telegram bot
 */
function initTelegramBot(): Bot | null {
  try {
    const envPath = path.join(projectRoot, 'config', '.env.secrets');
    const envContent = readFileSync(envPath, 'utf8');

    const tokenMatch = envContent.match(/TELEGRAM_API_TOKEN=(.+)/);

    if (!tokenMatch) {
      logMessage('TELEGRAM_API_TOKEN not found in .env.secrets');
      return null;
    }

    const chatIdsMatch = envContent.match(/TELEGRAM_CHAT_IDS=(.+)/);

    if (chatIdsMatch) {
      telegramChatIds = chatIdsMatch[1].trim().split(',').map(id => id.trim());
      logMessage(`Loaded ${telegramChatIds.length} Telegram chat IDs successfully`);
    } else {
      logMessage('TELEGRAM_CHAT_IDS not found in .env.secrets, notifications will be disabled', 'WARNING');
    }

    const token = tokenMatch[1].trim();
    logMessage('Initializing Telegram bot...');

    return new Bot(token);
  } catch (error) {
    logMessage('Error initializing Telegram bot: ' + error, 'ERROR');
  }

  return null;
}

/**
 * Send a text message to all configured Telegram chats
 */
async function sendMessageToTelegram(message: string): Promise<void> {
  try {
    if (!telegramBot) {
      logMessage('Telegram bot not initialized');
      return;
    }

    if (telegramChatIds.length === 0) {
      logMessage('No Telegram chat IDs configured');
      return;
    }

    logMessage(`Sending message to ${telegramChatIds.length} Telegram chat(s): "${message}"`);

    for (const chatId of telegramChatIds) {
      try {
        await telegramBot.api.sendMessage(chatId, message);
        logMessage(`Message sent to Telegram chat ${chatId} successfully`);
      } catch (chatError) {
        logMessage(`Error sending message to Telegram chat ${chatId}: ${chatError}`, 'ERROR');
      }
    }
  } catch (error) {
    logMessage('Error sending message to Telegram: ' + error, 'ERROR');
  }
}

/**
 * Send an image to all configured Telegram chats
 */
async function sendImageToTelegram(imagePath: string, caption: string = 'Screenshot'): Promise<void> {
  try {
    if (!telegramBot) {
      logMessage('Telegram bot not initialized');
      return;
    }

    if (telegramChatIds.length === 0) {
      logMessage('No Telegram chat IDs configured');
      return;
    }

    logMessage(`Sending image to ${telegramChatIds.length} Telegram chat(s): ${imagePath}`);

    for (const chatId of telegramChatIds) {
      try {
        if (!fileExists(imagePath)) {
          logMessage(`Error: Image file does not exist: ${imagePath}`, 'ERROR');
          continue;
        }

        const photo = new InputFile(imagePath);
        await telegramBot.api.sendPhoto(chatId, photo, { caption });
        logMessage(`Image sent to Telegram chat ${chatId} successfully`);
      } catch (chatError) {
        logMessage(`Error sending to Telegram chat ${chatId}: ${chatError}`, 'ERROR');
      }
    }
  } catch (error) {
    logMessage('Error sending image to Telegram: ' + error, 'ERROR');
  }
}

/**
 * Load tokens from config
 */
async function loadTokens(): Promise<void> {
  try {
    const config = loadConfig();

    if (config.tokens && Array.isArray(config.tokens)) {
      validTokens = config.tokens.filter(token => token.token && token.token.trim() !== '');
      logMessage(`Loaded ${validTokens.length} valid tokens from config`);
    } else {
      logMessage("No tokens found in configuration", 'WARNING');
      validTokens = [];
    }
  } catch (error: any) {
    logMessage('Error loading tokens: ' + error, 'ERROR');
    throw error;
  }
}

/**
 * Create a standardized API response
 */
function createApiResponse(
  success: boolean,
  message: string,
  error: string | null = null,
  additionalData: Record<string, any> = {}
): ApiResponse {
  return {
    success,
    message,
    error,
    ...additionalData
  };
}

/**
 * Token authentication middleware
 */
function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json(
      createApiResponse(
        false,
        'Authentication failed',
        'Missing authentication token'
      )
    );
    return;
  }

  const validToken = validTokens.find(t => t.token === token);

  if (!validToken) {
    res.status(403).json(
      createApiResponse(
        false,
        'Authentication failed',
        'Invalid token'
      )
    );
    return;
  }

  next();
}

/**
 * Check if a file exists
 */
function fileExists(filePath: string): boolean {
  try {
    statSync(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Check if a process with the given PID is running
 */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error.code === 'ESRCH') {
      return false;
    } else if (error.code === 'EPERM') {
      return true;
    } else {
      logMessage(`Error checking PID ${pid}: ${error.message}`, 'ERROR');
      return false;
    }
  }
}

function checkFilePidIsRunning(filePathPid: string, deleteFile: boolean): boolean {
  let result = false;

  if (fileExists(filePathPid)) {
    const data = readFileSync(filePathPid, { encoding: 'utf8' });
    const pidString = data.trim();
    const pid = parseInt(pidString, 10);

    if (isRunning(pid)) {
      result = true;
    } else if (deleteFile) {
      if (fileExists(filePathPid)) {
        unlinkSync(filePathPid);
      }
    }
  }

  return result;
}

/**
 * Wait for a random amount of time between min and max milliseconds
 */
async function waitRandomTime(minMs: number, maxMs: number): Promise<void> {
  let waitTime = minMs;

  if (minMs > maxMs) {
    [minMs, maxMs] = [maxMs, minMs];
    waitTime = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  }

  return new Promise(resolve => setTimeout(resolve, waitTime));
}

interface InitBrowserResult {
  browser?: puppeteer.Browser | null,
  page?: puppeteer.Page | null,
  profile?: BrowserProfile | null,
  error?: string | null
}

/**
 * Initialize Puppeteer browser using the browser pool
 */
async function initBrowser(url: string, context: string): Promise<InitBrowserResult> {
  const result: InitBrowserResult = { browser: null, page: null, profile: null, error: null };

  try {
    const profile = browserPool.getBrowserProfile(context);

    if (!profile) {
      result.error = "No browser profiles available in the pool";
      logMessage("No browser profiles available in the pool", "ERROR");
      return result;
    }

    mkdirSync(profile.profile, { recursive: true });

    if (checkFilePidIsRunning(profile.pid, true)) {
      result.error = `Browser process for profile ${profile.profile} is already running`;
      logMessage(`Browser process for profile ${profile.profile} is already running`, "ERROR");
      browserPool.returnBrowserProfile(profile, false);
      return result;
    }

    const config = loadConfig();

    const browser = await launch({
      executablePath: config.browser.executablePath,
      headless: false,
      devtools: false,
      userDataDir: profile.profile,
      args: config.browser.args,
    });

    profile.browser = browser;

    const pid = browser.process()!.pid;
    writeFileSync(profile.pid, pid + "");

    await waitRandomTime(1500, 1500);

    let page = await browserPool.manageBrowserTabs(browser, profile.instance);

    await waitRandomTime(2000, 2000);

    await page.setViewport({
      width: config.viewport?.width || 1920,
      height: config.viewport?.height || 1080,
      deviceScaleFactor: 1
    });

    await page.goto(url);

    const title = await page.title();
    logMessage('Page title: ' + title);

    await waitRandomTime(1500, 1500);

    result.browser = browser;
    result.page = page;
    result.profile = profile;

  } catch (error: any) {
    result.error = (error as Error).message;
  }

  return result;
}

/**
 * Check list and click elements
 */
async function checkListAndClick(config: BotConfig): Promise<{ processed: number, clicked: number, error?: string }> {
  const result = { processed: 0, clicked: 0, error: undefined as string | undefined };

  let browserResult: InitBrowserResult | null = null;

  try {
    logMessage('Starting list check and click task...');

    browserResult = await initBrowser(config.task.url, 'default');

    if (!browserResult.page || !browserResult.browser) {
      result.error = browserResult.error || 'Failed to initialize browser';
      logMessage(result.error, 'ERROR');
      return result;
    }

    const page = browserResult.page;

    logMessage('Waiting for page to load...');
    await waitRandomTime(2000, 3000);

    // Wait for list selector to appear
    logMessage(`Waiting for list selector: ${config.task.listSelector}`);
    try {
      await page.waitForSelector(config.task.listSelector, { timeout: 10000 });
      logMessage('List selector found');
    } catch (error) {
      result.error = `List selector not found: ${config.task.listSelector}`;
      logMessage(result.error, 'ERROR');

      // Take screenshot for debugging
      const screenshotPath = path.join(config.paths.dataPath, `error_${Date.now()}.png`);
      mkdirSync(config.paths.dataPath, { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await sendImageToTelegram(screenshotPath, `Error: List selector not found`);

      return result;
    }

    // Get list items
    const listItems = await page.$$(config.task.listSelector);
    logMessage(`Found ${listItems.length} items in list`);

    const maxItems = config.task.maxItemsPerCycle || listItems.length;
    const itemsToProcess = listItems.slice(0, maxItems);
    result.processed = itemsToProcess.length;

    // Process each item
    for (let i = 0; i < itemsToProcess.length; i++) {
      try {
        logMessage(`Processing item ${i + 1}/${itemsToProcess.length}`);

        // Try to click on each click selector within the item
        for (const clickSelector of config.task.clickSelectors) {
          try {
            // Find the clickable element within the current list item
            const clickableElement = await itemsToProcess[i].$(clickSelector);

            if (clickableElement) {
              logMessage(`Clicking element with selector: ${clickSelector}`);
              await clickableElement.click();
              result.clicked++;
              await waitRandomTime(1000, 2000);
              break; // Only click one element per item
            }
          } catch (clickError) {
            logMessage(`Error clicking selector ${clickSelector}: ${clickError}`, 'WARNING');
          }
        }

        await waitRandomTime(500, 1000);
      } catch (itemError) {
        logMessage(`Error processing item ${i + 1}: ${itemError}`, 'ERROR');
      }
    }

    logMessage(`Task completed. Processed: ${result.processed}, Clicked: ${result.clicked}`);

  } catch (error: any) {
    result.error = (error as Error).message;
    logMessage('Error during list check and click: ' + error, 'ERROR');
  } finally {
    if (browserResult?.browser) {
      try {
        await browserResult.page?.close();
        await waitRandomTime(1000, 1000);

        const profile = browserPool.findProfileByBrowser(browserResult.browser);
        await browserResult.browser.close();

        if (profile) {
          browserPool.returnBrowserProfile(profile, true);
        }
      } catch (error: any) {
        logMessage('Error closing browser: ' + error, 'ERROR');
      }
    }
  }

  return result;
}

/**
 * Start periodic task
 */
function startPeriodicTask(config: BotConfig): void {
  if (taskInterval) {
    logMessage('Task interval already running', 'WARNING');
    return;
  }

  const intervalMs = config.task.checkInterval * 1000;
  logMessage(`Starting periodic task. Interval: ${config.task.checkInterval} seconds`);

  // Run immediately on start
  checkListAndClick(config).then(async result => {
    if (result.error) {
      logMessage(`Task error: ${result.error}`, 'ERROR');
      await sendMessageToTelegram(`Task error: ${result.error}`);
    } else {
      logMessage(`Task completed: Processed ${result.processed} items, Clicked ${result.clicked} elements`);
    }
  });

  // Then run periodically
  taskInterval = setInterval(async () => {
    logMessage('Running periodic task...');
    const result = await checkListAndClick(config);

    if (result.error) {
      logMessage(`Task error: ${result.error}`, 'ERROR');
      await sendMessageToTelegram(`Task error: ${result.error}`);
    } else {
      logMessage(`Task completed: Processed ${result.processed} items, Clicked ${result.clicked} elements`);
    }
  }, intervalMs);
}

/**
 * Stop periodic task
 */
function stopPeriodicTask(): void {
  if (taskInterval) {
    clearInterval(taskInterval);
    taskInterval = null;
    logMessage('Periodic task stopped');
  }
}

/**
 * Start a timer to periodically check for browsers that have been used too long
 */
function startBrowserAgeCheckTimer(config: BotConfig): void {
  const interval = config.browser.checkBrowserInterval || 10;
  const maxAge = config.browser.browserAge || 15;

  logMessage(`Starting browser age check timer: interval=${interval}s, maxAge=${maxAge}s`);

  setInterval(async () => {
    if (browserPool) {
      logMessage("Running scheduled browser age check...");
      const result = await browserPool.forceCloseBrowsersOlderThan(maxAge);
      logMessage(`Age check completed. Processed: ${result.processed}, Closed: ${result.closed}`);
    }
  }, interval * 1000);
}

/**
 * Main function - Entry point for the application
 */
async function main(): Promise<void> {
  try {
    logMessage("Starting EZCater Web Driver Bot...");

    const config = loadConfig();
    logMessage("Configuration loaded successfully");

    browserPool = new BrowserPool(config);
    logMessage(`Browser pool initialized with size: ${config.browser.poolSize || 3}`);

    startBrowserAgeCheckTimer(config);

    mkdirSync(config.paths.dataPath, { recursive: true });

    telegramBot = initTelegramBot();

    if (telegramBot) {
      logMessage("Telegram bot initialized successfully");
      await sendMessageToTelegram("EZCater Web Driver Bot initiated");
    } else {
      logMessage("Telegram bot not initialized, continuing without notifications");
    }

    await loadTokens();

    const app = express();
    const PORT = config.server.port;

    app.use(bodyParser.json());

    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      if (err instanceof SyntaxError && 'body' in err) {
        return res.status(400).json(
          createApiResponse(
            false,
            'Request format error',
            'Invalid JSON'
          )
        );
      }
      next(err);
    });

    const apiRouter = express.Router();
    app.use(config.server.basePath, apiRouter);

    // Route to start periodic task
    apiRouter.post('/task/start', authenticateToken, async (req: Request, res: Response) => {
      try {
        if (taskInterval) {
          return res.status(400).json(
            createApiResponse(
              false,
              'Task already running',
              'Periodic task is already active'
            )
          );
        }

        startPeriodicTask(config);

        return res.status(200).json(
          createApiResponse(
            true,
            'Periodic task started successfully',
            null,
            { interval: config.task.checkInterval }
          )
        );
      } catch (error: any) {
        logMessage('Error in /task/start endpoint: ' + error, 'ERROR');
        return res.status(500).json(
          createApiResponse(
            false,
            'Failed to start task',
            (error as Error).message
          )
        );
      }
    });

    // Route to stop periodic task
    apiRouter.post('/task/stop', authenticateToken, async (req: Request, res: Response) => {
      try {
        stopPeriodicTask();

        return res.status(200).json(
          createApiResponse(
            true,
            'Periodic task stopped successfully'
          )
        );
      } catch (error: any) {
        logMessage('Error in /task/stop endpoint: ' + error, 'ERROR');
        return res.status(500).json(
          createApiResponse(
            false,
            'Failed to stop task',
            (error as Error).message
          )
        );
      }
    });

    // Route to run task once manually
    apiRouter.post('/task/run', authenticateToken, async (req: Request, res: Response) => {
      try {
        logMessage('Manual task execution requested');
        const result = await checkListAndClick(config);

        if (result.error) {
          return res.status(500).json(
            createApiResponse(
              false,
              'Task execution failed',
              result.error,
              { processed: result.processed, clicked: result.clicked }
            )
          );
        }

        return res.status(200).json(
          createApiResponse(
            true,
            'Task executed successfully',
            null,
            { processed: result.processed, clicked: result.clicked }
          )
        );
      } catch (error: any) {
        logMessage('Error in /task/run endpoint: ' + error, 'ERROR');
        return res.status(500).json(
          createApiResponse(
            false,
            'Failed to execute task',
            (error as Error).message
          )
        );
      }
    });

    // Global error handler
    apiRouter.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      logMessage('Unhandled error: ' + err, 'ERROR');
      res.status(500).json(createApiResponse(
        false,
        'Internal server error',
        err.message
      ));
    });

    // Start server
    const server = app.listen(PORT, () => {
      logMessage(`Server running on port ${PORT}`);
      logMessage(`API base path: ${config.server.basePath}`);
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logMessage(`Port ${PORT} is already in use`, 'ERROR');
      } else {
        logMessage('Server error: ' + error, 'ERROR');
      }
    });

    // Handle process termination
    process.on('SIGINT', async () => {
      logMessage('Shutting down...');
      stopPeriodicTask();
      process.exit(0);
    });

  } catch (error: any) {
    logMessage("An error occurred: " + error, 'ERROR');
    process.exit(1);
  }
}

// Execute the main function
main().catch(error => {
  logMessage("Unhandled error in main: " + error, 'ERROR');
  process.exit(1);
});

