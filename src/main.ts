import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';
import { mkdirSync, writeFileSync, unlinkSync, readFileSync, statSync, appendFileSync } from 'fs';
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
    clickSelectors?: string[];
    listSelector?: string;
    maxItemsPerCycle?: number;
    phoneNumber?: string;
    maxReloadAttempts?: number;
    reloadWaitTime?: number;
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
 * Convert current time to EST (Eastern Standard Time)
 * Uses 'America/New_York' timezone which automatically handles EST/EDT
 * Returns a Date object representing the current time in EST
 */
function getCurrentTimeEST(): Date {
  const now = new Date();
  
  // Get current time components in EST timezone
  const estFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const parts = estFormatter.formatToParts(now);
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '0', 10);
  const month = parseInt(parts.find(p => p.type === 'month')?.value || '0', 10);
  const day = parseInt(parts.find(p => p.type === 'day')?.value || '0', 10);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const second = parseInt(parts.find(p => p.type === 'second')?.value || '0', 10);
  
  // Create a Date object with EST time components
  const estDate = new Date(year, month - 1, day, hour, minute, second);
  
  return estDate;
}

/**
 * Parse time string like "12:00 PM EST" and convert to Date object
 */
function parseDeliveryTime(timeString: string): { parsed: Date | null } {
  const now = new Date();
  
  // Parse delivery time string (e.g., "12:00 PM EST")
  const timeMatch = timeString.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!timeMatch) {
    return { parsed: null };
  }
  
  const [, hoursStr, minutesStr, period] = timeMatch;
  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);
  const hours24 = period.toUpperCase() === 'PM' && hours !== 12 ? hours + 12 : 
                  period.toUpperCase() === 'AM' && hours === 12 ? 0 : hours;
  
  const deliveryDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours24, minutes);
  
  return { parsed: deliveryDate };
}

/**
 * Check if page contains "No Deliveries available" text
 */
async function checkNoDeliveries(page: puppeteer.Page): Promise<boolean> {
  try {
    const hasNoDeliveries = await page.evaluate(() => {
      const allText = document.body.innerText.toLowerCase();
      return allText.includes('no deliveries available');
    });
    return hasNoDeliveries;
  } catch (error) {
    return false;
  }
}

/**
 * Check if page contains "expired" or "Delivering an order?" text anywhere
 */
async function checkExpired(page: puppeteer.Page): Promise<boolean> {
  try {
    const isExpired = await page.evaluate(() => {
      const h3Elements = Array.from(document.querySelectorAll('h3'));
      const exactMatch = h3Elements.find(h3 => {
        const text = h3.textContent?.trim();
        return text === "Expired Link";
      });
      
      if (exactMatch) return true;
      
      const allText = document.body.innerText;
      const allTextLower = allText.toLowerCase();
      
      if (allTextLower.includes('delivering an order?')) return true;
      
      const bodyClone = document.body.cloneNode(true) as HTMLElement;
      const chipLabels = bodyClone.querySelectorAll('span.MuiChip-label');
      chipLabels.forEach(chip => chip.remove());
      
      const textWithoutChips = bodyClone.innerText.toLowerCase();
      if (textWithoutChips.includes('expired')) return true;
      
      return false;
    });
    return isExpired;
  } catch (error) {
    return false;
  }
}

/**
 * Request new delivery link when expired
 */
async function requestNewLink(page: puppeteer.Page, phoneNumber: string): Promise<boolean> {
  try {
    logMessage('Requesting new delivery link...');
    
    await waitRandomTime(1000, 2000);
    
    let inputHandle: puppeteer.ElementHandle<HTMLInputElement> | null = null;
    
    try {
      inputHandle = await page.waitForSelector(
        'input[type="text"][placeholder="Enter your phone number"][name^="radix-"]',
        { timeout: 5000 }
      ) as puppeteer.ElementHandle<HTMLInputElement> | null;
    } catch (e) {
      // Try strategy 2
    }
    
    if (!inputHandle) {
      try {
        inputHandle = await page.waitForSelector(
          'input[type="text"][placeholder="Enter your phone number"][id^="radix-"]',
          { timeout: 5000 }
        ) as puppeteer.ElementHandle<HTMLInputElement> | null;
      } catch (e) {
        // Try strategy 3
      }
    }
    
    if (!inputHandle) {
      try {
        inputHandle = await page.waitForSelector(
          'input[type="text"][placeholder="Enter your phone number"]',
          { timeout: 5000 }
        ) as puppeteer.ElementHandle<HTMLInputElement> | null;
      } catch (e) {
        logMessage('Could not find phone number input field', 'ERROR');
        return false;
      }
    }
    
    if (!inputHandle) {
      logMessage('Phone number input field not found', 'ERROR');
      return false;
    }
    
    await inputHandle.focus();
    await waitRandomTime(500, 1000);
    await page.type('input[type="text"][placeholder="Enter your phone number"]', phoneNumber, { delay: 50 });
    logMessage(`Entered phone number: ${phoneNumber}`);
    
    return true;
  } catch (error: any) {
    logMessage(`Error requesting new link: ${error.message}`, 'ERROR');
    return false;
  }
}

/**
 * Get delivery status by searching the entire page for the order
 */
async function getDeliveryStatusFromPage(page: puppeteer.Page, orderNumber: string): Promise<string | null> {
  try {
    const status = await page.evaluate((orderNum) => {
      const allContainers = Array.from(document.querySelectorAll('div.ez-1h5x3dy'));
      for (const container of allContainers) {
        const orderDiv = container.querySelector('div.ez-7crqac');
        if (orderDiv && orderDiv.textContent?.trim() === orderNum) {
          const statusDiv = container.querySelector('div[data-testid="delivery-status-text"]');
          if (statusDiv) {
            const chip = statusDiv.querySelector('span.MuiChip-label.EzChip-label.MuiChip-labelMedium.ez-14vsv3w');
            if (chip) {
              const chipText = chip.textContent?.trim();
              if (chipText === 'En Route to Customer' || chipText === 'Delivery Scheduled' || chipText === 'Expired') {
                return chipText;
              }
            }
            
            const allChipsInStatus = statusDiv.querySelectorAll('span.MuiChip-label');
            for (let chip of Array.from(allChipsInStatus)) {
              const chipText = chip.textContent?.trim();
              if (chipText === 'En Route to Customer' || chipText === 'Delivery Scheduled' || chipText === 'Expired') {
                return chipText;
              }
            }
          }
          
          const chips = container.querySelectorAll('span.MuiChip-label.EzChip-label.MuiChip-labelMedium.ez-14vsv3w');
          for (let chip of Array.from(chips)) {
            const chipText = chip.textContent?.trim();
            if (chipText === 'En Route to Customer' || chipText === 'Delivery Scheduled' || chipText === 'Expired') {
              return chipText;
            }
          }
          
          const allChips = container.querySelectorAll('span.MuiChip-label');
          for (let chip of Array.from(allChips)) {
            const chipText = chip.textContent?.trim();
            if (chipText === 'En Route to Customer' || chipText === 'Delivery Scheduled' || chipText === 'Expired') {
              return chipText;
            }
          }
        }
      }
      return null;
    }, orderNumber);
    
    if (status) {
      logMessage(`  ✓ Found status "${status}" for order ${orderNumber} using page-level search`);
    }
    
    return status;
  } catch (error: any) {
    logMessage(`  ✗ Error in page-level status search for order ${orderNumber}: ${error.message}`, 'ERROR');
    return null;
  }
}

/**
 * Get delivery status for a specific order container
 */
async function getDeliveryStatus(page: puppeteer.Page, deliveryContainer: HTMLElement, orderNumber: string): Promise<string | null> {
  try {
    const isValidContainer = await page.evaluate((container) => {
      return container && typeof container.querySelectorAll === 'function';
    }, deliveryContainer);
    
    if (!isValidContainer) {
      logMessage(`  ⚠ Container for order ${orderNumber} is not a valid DOM element, using page-level search`, 'WARNING');
      return await getDeliveryStatusFromPage(page, orderNumber);
    }
    
    const status = await page.evaluate((container, orderNum) => {
      if (!container || typeof container.querySelectorAll !== 'function') {
        return null;
      }
      
      const statusDiv = container.querySelector('div[data-testid="delivery-status-text"]');
      if (statusDiv) {
        const chip = statusDiv.querySelector('span.MuiChip-label.EzChip-label.MuiChip-labelMedium.ez-14vsv3w');
        if (chip) {
          const chipText = chip.textContent?.trim();
          if (chipText === 'En Route to Customer' || chipText === 'Delivery Scheduled' || chipText === 'Expired') {
            return chipText;
          }
        }
        
        const allChipsInStatus = statusDiv.querySelectorAll('span.MuiChip-label');
        for (let chip of Array.from(allChipsInStatus)) {
          const chipText = chip.textContent?.trim();
          if (chipText === 'En Route to Customer' || chipText === 'Delivery Scheduled' || chipText === 'Expired') {
            return chipText;
          }
        }
      }
      
      const chips = container.querySelectorAll('span.MuiChip-label.EzChip-label.MuiChip-labelMedium.ez-14vsv3w');
      for (let chip of Array.from(chips)) {
        const chipText = chip.textContent?.trim();
        if (chipText === 'En Route to Customer' || chipText === 'Delivery Scheduled' || chipText === 'Expired') {
          return chipText;
        }
      }
      
      const allChips = container.querySelectorAll('span.MuiChip-label');
      for (let chip of Array.from(allChips)) {
        const chipText = chip.textContent?.trim();
        if (chipText === 'En Route to Customer' || chipText === 'Delivery Scheduled' || chipText === 'Expired') {
          return chipText;
        }
      }
      
      return null;
    }, deliveryContainer, orderNumber);
    
    if (!status) {
      const broaderStatus = await getDeliveryStatusFromPage(page, orderNumber);
      if (broaderStatus) {
        return broaderStatus;
      }
    }
    
    return status;
  } catch (error: any) {
    logMessage(`  ✗ Error getting status for order ${orderNumber}: ${error.message}`, 'ERROR');
    return await getDeliveryStatusFromPage(page, orderNumber);
  }
}

/**
 * Process delivery orders with continuous monitoring logic
 */
async function processContinuousDeliveries(page: puppeteer.Page): Promise<Array<{ orderNumber: string, timeText: string, status: string | null, shouldClick: boolean, reason: string, actionType: 'param1' | 'param2' | 'rule3' | null }>> {
  const results: Array<{ orderNumber: string, timeText: string, status: string | null, shouldClick: boolean, reason: string, actionType: 'param1' | 'param2' | 'rule3' | null }> = [];
  
  try {
    logMessage('Processing deliveries for continuous monitoring...');
    
    const currentTime = getCurrentTimeEST();
    const currentTimeMs = currentTime.getTime();
    
    logMessage(`Current time (EST - used for comparisons): ${currentTime.toLocaleTimeString()}`);
    
    await page.evaluate(() => {
      const h2Elements = Array.from(document.querySelectorAll('h2'));
      const upcomingH2 = h2Elements.find(h2 => {
        const text = h2.textContent?.trim();
        return text === 'Upcoming';
      });
      
      let upcomingContainer: HTMLElement | null = null;
      if (upcomingH2) {
        let container = upcomingH2.parentElement;
        while (container && container !== document.body) {
          if (container.firstElementChild === upcomingH2) {
            upcomingContainer = container;
            break;
          }
          container = container.parentElement;
        }
      }
      
      const todayH2 = h2Elements.find(h2 => {
        const text = h2.textContent?.trim();
        return text === 'Today';
      });
      
      if (!todayH2) return;
      
      let container = todayH2.parentElement;
      while (container && container !== document.body) {
        if (container.firstElementChild === todayH2) {
          const parent = container.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children);
            let spanIndex = 0;
            
            siblings.forEach((sibling) => {
              if (upcomingContainer && (sibling === upcomingContainer || upcomingContainer.contains(sibling))) {
                return;
              }
              
              const timeSpans = Array.from(sibling.querySelectorAll('span.c-AsWAM'));
              timeSpans.forEach((span) => {
                if (upcomingContainer && upcomingContainer.contains(span)) {
                  return;
                }
                
                const timeText = span.textContent?.trim() || '';
                if (timeText.match(/\d{1,2}:\d{2}\s*(AM|PM)/i)) {
                  span.setAttribute('data-delivery-time-id', spanIndex.toString());
                  spanIndex++;
                }
              });
            });
            break;
          }
        }
        container = container.parentElement;
      }
    });
    
    const deliveryData = await page.evaluate(() => {
      const h2Elements = Array.from(document.querySelectorAll('h2'));
      const upcomingH2 = h2Elements.find(h2 => {
        const text = h2.textContent?.trim();
        return text === 'Upcoming';
      });
      
      let upcomingContainer: HTMLElement | null = null;
      if (upcomingH2) {
        let container = upcomingH2.parentElement;
        while (container && container !== document.body) {
          if (container.firstElementChild === upcomingH2) {
            upcomingContainer = container;
            break;
          }
          container = container.parentElement;
        }
      }
      
      const todayH2 = h2Elements.find(h2 => {
        const text = h2.textContent?.trim();
        return text === 'Today';
      });
      
      if (!todayH2) return null;
      
      let container = todayH2.parentElement;
      while (container && container !== document.body) {
        if (container.firstElementChild === todayH2) {
          const parent = container.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children);
            const deliveryItems: Array<{ timeText: string, orderNumber: string, spanId: string }> = [];
            
            siblings.forEach((sibling) => {
              if (upcomingContainer && (sibling === upcomingContainer || upcomingContainer.contains(sibling))) {
                return;
              }
              
              const timeSpans = Array.from(sibling.querySelectorAll('span.c-AsWAM[data-delivery-time-id]'));
              
              timeSpans.forEach((span) => {
                if (upcomingContainer && upcomingContainer.contains(span)) {
                  return;
                }
                
                const timeText = span.textContent?.trim() || '';
                if (timeText.match(/\d{1,2}:\d{2}\s*(AM|PM)/i)) {
                  const spanId = span.getAttribute('data-delivery-time-id') || '';
                  
                  let deliveryItem = span.parentElement;
                  let orderNumber = '';
                  
                  while (deliveryItem && deliveryItem !== document.body) {
                    const orderDiv = deliveryItem.querySelector('div.ez-7crqac');
                    if (orderDiv) {
                      orderNumber = orderDiv.textContent?.trim() || '';
                      break;
                    }
                    deliveryItem = deliveryItem.parentElement;
                  }
                  
                  if (!orderNumber) {
                    let fallbackItem = span.parentElement;
                    while (fallbackItem && fallbackItem !== document.body) {
                      const orderMatch = fallbackItem.textContent?.match(/#[A-Z0-9-]+/);
                      if (orderMatch) {
                        orderNumber = orderMatch[0];
                        break;
                      }
                      fallbackItem = fallbackItem.parentElement;
                    }
                  }
                  
                  if (orderNumber) {
                    deliveryItems.push({
                      timeText: timeText,
                      orderNumber: orderNumber,
                      spanId: spanId
                    });
                  }
                }
              });
            });
            
            return deliveryItems;
          }
        }
        container = container.parentElement;
      }
      
      return null;
    });
    
    if (!deliveryData || deliveryData.length === 0) {
      logMessage('No delivery items found in "Today" section', 'WARNING');
      return results;
    }
    
    logMessage(`Found ${deliveryData.length} delivery item(s) in "Today" section`);
    
    for (let i = 0; i < deliveryData.length; i++) {
      const delivery = deliveryData[i];
      if (!delivery || !delivery.timeText || !delivery.orderNumber) {
        logMessage(`Skipping delivery ${i + 1}/${deliveryData.length}: missing data`, 'WARNING');
        continue;
      }
      
      logMessage(`Reviewing order ${i + 1}/${deliveryData.length}: ${delivery.orderNumber} (${delivery.timeText})`);
      
      try {
        const { parsed: deliveryTime } = parseDeliveryTime(delivery.timeText);
        if (!deliveryTime) {
          logMessage(`  Could not parse time: ${delivery.timeText}`, 'WARNING');
          results.push({
            orderNumber: delivery.orderNumber,
            timeText: delivery.timeText,
            status: null,
            shouldClick: false,
            reason: 'Could not parse time',
            actionType: null
          });
          continue;
        }
        
        const timeDiffMs = deliveryTime.getTime() - currentTime.getTime();
        const timeDiffMinutes = Math.floor(timeDiffMs / (1000 * 60));
        logMessage(`  Time comparison (EST): Delivery=${deliveryTime.toLocaleTimeString()}, Current=${currentTime.toLocaleTimeString()}, Diff=${timeDiffMinutes} min`);
        
        let status: string | null = null;
        try {
          const deliveryItemHandle = await page.evaluateHandle((orderNum) => {
            const allDeliveryContainers = Array.from(document.querySelectorAll('div.ez-1h5x3dy'));
            for (const container of allDeliveryContainers) {
              const orderDiv = container.querySelector('div.ez-7crqac');
              if (orderDiv && orderDiv.textContent?.trim() === orderNum) {
                return container as HTMLElement;
              }
            }
            return null;
          }, delivery.orderNumber);
          
          const itemValue = await deliveryItemHandle.jsonValue();
          
          if (itemValue) {
            status = await getDeliveryStatus(page, itemValue as HTMLElement, delivery.orderNumber);
            if (status) {
              logMessage(`  ✓ Found status "${status}" for order ${delivery.orderNumber}`);
            } else {
              logMessage(`  ⚠ Status not found for order ${delivery.orderNumber}`, 'WARNING');
            }
          } else {
            logMessage(`  ⚠ Could not find delivery container for order ${delivery.orderNumber}`, 'WARNING');
          }
          
          await deliveryItemHandle.dispose();
        } catch (statusError: any) {
          logMessage(`  Error getting status for ${delivery.orderNumber}: ${statusError.message}`, 'WARNING');
        }
        
        let shouldClick = false;
        let reason = '';
        let actionType: 'param1' | 'param2' | 'rule3' | null = null;
        
        if (status === 'Expired') {
          shouldClick = false;
          reason = 'Expired';
        } else if (status) {
          const deliveryTimeMs = deliveryTime.getTime();
          const currentTimeMs = currentTime.getTime();
          
          const param1Start = new Date(deliveryTimeMs - 3 * 60 * 1000);
          const param1End = new Date(deliveryTimeMs + 3 * 60 * 1000);
          const inParam1 = currentTimeMs >= param1Start.getTime() && currentTimeMs <= param1End.getTime();
          
          const param2Base = new Date(deliveryTimeMs - 15 * 60 * 1000);
          const param2Start = new Date(param2Base.getTime() - 3 * 60 * 1000);
          const param2End = new Date(param2Base.getTime() + 3 * 60 * 1000);
          const inParam2 = currentTimeMs >= param2Start.getTime() && currentTimeMs <= param2End.getTime();
          
          const currentTimeGreater = currentTimeMs > deliveryTimeMs;
          
          logMessage(`  Status: ${status}, InParam1: ${inParam1}, InParam2: ${inParam2}, CurrentTimeGreater: ${currentTimeGreater}`);
          
          if (inParam1 && status === 'En Route to Customer') {
            shouldClick = true;
            actionType = 'param1';
            reason = 'Param1 range AND En Route to Customer';
            logMessage(`  ✓ Rule 1 matched: Order ${delivery.orderNumber} is in param1 range with "En Route to Customer" status`);
          }
          
          if (inParam2 && status === 'Delivery Scheduled') {
            shouldClick = true;
            actionType = 'param2';
            reason = 'Param2 range AND Delivery Scheduled';
            logMessage(`  ✓ Rule 2 matched: Order ${delivery.orderNumber} is in param2 range with "Delivery Scheduled" status`);
          }
          
          if ((status === 'En Route to Customer' || status === 'Delivery Scheduled') && currentTimeGreater) {
            if (!shouldClick) {
              shouldClick = true;
              actionType = 'rule3';
              reason = `Delivery time < current time AND status is ${status}`;
              logMessage(`  ✓ Rule 3 matched: Order ${delivery.orderNumber} has passed current time with status "${status}"`);
            }
          }
        } else {
          logMessage(`  No status found for order ${delivery.orderNumber}`, 'WARNING');
        }
        
        results.push({
          orderNumber: delivery.orderNumber,
          timeText: delivery.timeText,
          status: status,
          shouldClick: shouldClick,
          reason: reason,
          actionType: actionType
        });
        
        if (shouldClick) {
          logMessage(`  ✓ Order ${delivery.orderNumber} (${delivery.timeText}, status: ${status}) - WILL CLICK: ${reason}`);
        } else {
          logMessage(`  - Order ${delivery.orderNumber} (${delivery.timeText}, status: ${status}) - SKIP: ${reason}`);
        }
      } catch (error: any) {
        logMessage(`  ✗ Error processing order ${delivery.orderNumber}: ${error.message}`, 'ERROR');
        results.push({
          orderNumber: delivery.orderNumber,
          timeText: delivery.timeText,
          status: null,
          shouldClick: false,
          reason: `Error: ${error.message}`,
          actionType: null
        });
      }
    }
    
    logMessage(`\n✓ Finished reviewing all ${deliveryData.length} order(s) in "Today" section`);
    
  } catch (error: any) {
    logMessage(`Error processing continuous deliveries: ${error.message}`, 'ERROR');
  }
  
  return results;
}

/**
 * Click a button by its text content
 * TEMPORARILY COMMENTED: Button clicks are disabled for testing
 */
async function clickButtonByText(page: puppeteer.Page, buttonText: string, timeout: number = 10000): Promise<boolean> {
  try {
    logMessage(`  Looking for button: "${buttonText}"`);
    logMessage(`  [TEMPORARILY COMMENTED] Would click button: "${buttonText}"`);
    
    // TEMPORARILY COMMENTED: All button click functionality
    /*
    if (buttonText === "I'm on my way") {
      try {
        await page.waitForSelector('div.ez-7xofcs button', { timeout });
        
        const btnHandle = await page.evaluateHandle(() => {
          const container = document.querySelector('div.ez-7xofcs');
          if (container) {
            const button = container.querySelector('button');
            if (button && button.textContent?.trim() === "I'm on my way") {
              return button as HTMLButtonElement;
            }
          }
          return null;
        });
        
        const btnValue = await btnHandle.jsonValue();
        if (btnValue) {
          const box = await (btnHandle as puppeteer.ElementHandle<HTMLButtonElement>).boundingBox();
          
          if (box) {
            await waitRandomTime(1000, 1500);
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await waitRandomTime(500, 1000);
            await page.mouse.down();
            await page.mouse.up();
            logMessage(`  ✓ Successfully clicked button: "${buttonText}" (using specific selector)`);
            await btnHandle.dispose();
            return true;
          } else {
            await page.evaluate((handle) => {
              const element = handle as HTMLButtonElement;
              if (element) {
                element.click();
              }
            }, btnHandle);
            logMessage(`  ✓ Successfully clicked button: "${buttonText}" (fallback method, specific selector)`);
            await btnHandle.dispose();
            return true;
          }
        }
      } catch (specificError: any) {
        logMessage(`  Specific selector for "I'm on my way" failed, trying generic method...`, 'WARNING');
      }
    }
    
    if (buttonText === "Delivery is done") {
      try {
        await page.waitForSelector('div.ez-7xofcs button', { timeout });
        
        const btnHandle = await page.evaluateHandle(() => {
          const container = document.querySelector('div.ez-7xofcs');
          if (container) {
            const button = container.querySelector('button');
            if (button && button.textContent?.trim() === 'Delivery is done') {
              return button as HTMLButtonElement;
            }
          }
          return null;
        });
        
        const btnValue = await btnHandle.jsonValue();
        if (btnValue) {
          const box = await (btnHandle as puppeteer.ElementHandle<HTMLButtonElement>).boundingBox();
          
          if (box) {
            await waitRandomTime(1000, 1500);
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await waitRandomTime(500, 1000);
            await page.mouse.down();
            await page.mouse.up();
            logMessage(`  ✓ Successfully clicked button: "${buttonText}" (using specific selector)`);
            await btnHandle.dispose();
            return true;
          } else {
            await page.evaluate((handle) => {
              const element = handle as HTMLButtonElement;
              if (element) {
                element.click();
              }
            }, btnHandle);
            logMessage(`  ✓ Successfully clicked button: "${buttonText}" (fallback method, specific selector)`);
            await btnHandle.dispose();
            return true;
          }
        }
      } catch (specificError: any) {
        logMessage(`  Specific selector for "Delivery is done" failed, trying generic method...`, 'WARNING');
      }
    }
    
    await page.waitForFunction((text) => {
      return Array.from(document.querySelectorAll('button'))
        .some(btn => btn.textContent?.trim() === text);
    }, { timeout }, buttonText);
    
    const btnHandle = await page.evaluateHandle((text) => {
      return Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent?.trim() === text);
    }, buttonText);
    
    const btnValue = await btnHandle.jsonValue();
    if (!btnValue) {
      logMessage(`  Button "${buttonText}" not found`, 'WARNING');
      return false;
    }
    
    const box = await (btnHandle as puppeteer.ElementHandle<HTMLButtonElement>).boundingBox();
    
    if (box) {
      await waitRandomTime(1000, 1500);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await waitRandomTime(500, 1000);
      await page.mouse.down();
      await page.mouse.up();
      logMessage(`  ✓ Successfully clicked button: "${buttonText}"`);
      await btnHandle.dispose();
      return true;
    } else {
      await page.evaluate((handle) => {
        const element = handle as HTMLButtonElement;
        if (element) {
          element.click();
        }
      }, btnHandle);
      logMessage(`  ✓ Successfully clicked button: "${buttonText}" (fallback method)`);
      await btnHandle.dispose();
      return true;
    }
    */
    
    // Return true to simulate successful click (for testing)
    return true;
  } catch (error: any) {
    logMessage(`  ✗ Error clicking button "${buttonText}": ${error.message}`, 'WARNING');
    return false;
  }
}

/**
 * Wait for order ticket to appear on page
 */
async function waitForOrderTicket(page: puppeteer.Page, orderNumber: string, timeout: number = 10000): Promise<boolean> {
  try {
    await page.waitForFunction((searchValue) => {
      return Array.from(document.querySelectorAll('div')).some(div => 
        div.textContent?.trim().includes(searchValue)
      );
    }, { timeout }, orderNumber);
    
    await waitRandomTime(1000, 1500);
    
    return true;
  } catch (error: any) {
    logMessage(`  ⚠ Order ticket ${orderNumber} not found on page`, 'WARNING');
    return false;
  }
}

/**
 * Perform button actions on order page
 * TEMPORARILY COMMENTED: Button clicks are disabled for testing
 */
async function performOrderActions(page: puppeteer.Page, orderNumber: string, fullProcess: boolean = true): Promise<boolean> {
  try {
    logMessage(`  Performing actions for order ${orderNumber}...`);
    logMessage(`  Action type: ${fullProcess ? 'Full process' : 'Only "I\'m on my way"'}`);
    logMessage(`  [TEMPORARILY COMMENTED] Button clicks are disabled - would perform actions for order ${orderNumber}`);
    
    await waitForOrderTicket(page, orderNumber);
    
    // TEMPORARILY COMMENTED: Button click actions
    /*
    const onMyWayClicked = await clickButtonByText(page, "I'm on my way");
    if (!onMyWayClicked) {
      logMessage(`  Could not click "I'm on my way" button, continuing anyway...`, 'WARNING');
    }
    
    if (!fullProcess) {
      logMessage(`  ✓ Completed actions for order ${orderNumber} (param2 - only "I'm on my way")`);
      return true;
    }
    
    await waitRandomTime(500, 1000);
    
    const deliveryDoneClicked = await clickButtonByText(page, "Delivery is done", 5000);
    if (deliveryDoneClicked) {
      logMessage(`  ✓ Clicked "Delivery is done" button`);
      await waitRandomTime(2000, 3000);
    } else {
      logMessage(`  "Delivery is done" button not found (may not be available for this order)`, 'INFO');
    }
    
    const confirmClicked = await clickButtonByText(page, "Confirm", 5000);
    if (confirmClicked) {
      logMessage(`  ✓ Clicked "Confirm" button`);
      await waitRandomTime(2000, 3000);
    } else {
      logMessage(`  "Confirm" button not found (may not be available for this order)`, 'INFO');
    }
    */
    
    logMessage(`  ✓ Completed actions for order ${orderNumber} (simulated - buttons commented)`);
    return true;
  } catch (error: any) {
    logMessage(`  ✗ Error performing actions for order ${orderNumber}: ${error.message}`, 'ERROR');
    return false;
  }
}

/**
 * Click on a delivery order, perform button actions, and return to list
 */
async function clickDeliveryAndReturn(page: puppeteer.Page, orderNumber: string, fullProcess: boolean = true): Promise<boolean> {
  try {
    logMessage(`Clicking on order ${orderNumber}...`);
    
    let deliveryItemHandle = await page.evaluateHandle((orderNum) => {
      const allDeliveryContainers = Array.from(document.querySelectorAll('div.ez-1h5x3dy'));
      for (const container of allDeliveryContainers) {
        const orderDiv = container.querySelector('div.ez-7crqac');
        if (orderDiv && orderDiv.textContent?.trim() === orderNum) {
          return container as HTMLElement;
        }
      }
      return null;
    }, orderNumber);
    
    const itemValue = await deliveryItemHandle.jsonValue();
    if (!itemValue) {
      logMessage(`Could not find delivery item for order ${orderNumber}`, 'ERROR');
      return false;
    }
    
    const box = await (deliveryItemHandle as puppeteer.ElementHandle<HTMLElement>).boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await waitRandomTime(500, 1000);
      await page.mouse.down();
      await page.mouse.up();
    } else {
      await page.evaluate((handle) => {
        const element = handle as HTMLElement;
        if (element) {
          element.click();
        }
      }, deliveryItemHandle as puppeteer.ElementHandle<HTMLElement>);
    }
    
    await waitRandomTime(1000, 2000);
    
    try {
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    } catch (navError) {
      logMessage('Navigation may have completed or timed out, continuing...', 'WARNING');
    }
    
    await waitRandomTime(1000, 2000);
    
    const currentUrl = page.url();
    if (currentUrl.includes('/deliveries')) {
      logMessage(`Navigation failed, still on deliveries page`, 'WARNING');
      await deliveryItemHandle.dispose();
      return false;
    }
    
    logMessage(`Successfully navigated to order details`);
    
    await performOrderActions(page, orderNumber, fullProcess);
    
    logMessage(`Returning to deliveries list...`);
    
    const currentUrlBeforeReturn = page.url();
    if (currentUrlBeforeReturn.includes('/deliveries')) {
      logMessage(`Already on deliveries page, no need to click link`);
      await deliveryItemHandle.dispose();
      return true;
    }
    
    const deliveriesLink = await page.evaluateHandle(() => {
      const links = Array.from(document.querySelectorAll('a'));
      return links.find(link => {
        const href = link.getAttribute('href');
        return href === '/deliveries' || href === '/deliveries/';
      });
    });
    
    const linkValue = await deliveriesLink.jsonValue();
    if (linkValue) {
      await page.evaluate((handle) => {
        const element = handle as HTMLAnchorElement;
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, deliveriesLink);
      
      await waitRandomTime(500, 1000);
      
      const linkBox = await (deliveriesLink as puppeteer.ElementHandle<HTMLAnchorElement>).boundingBox();
      if (linkBox) {
        await page.mouse.move(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2);
        await waitRandomTime(500, 1000);
        await page.mouse.down();
        await page.mouse.up();
      } else {
        await page.evaluate((handle) => {
          const element = handle as HTMLAnchorElement;
          if (element) {
            element.click();
          }
        }, deliveriesLink);
      }
      
      await waitRandomTime(1000, 2000);
      
      try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
      } catch (navError) {
        logMessage('Navigation back may have completed or timed out, continuing...', 'WARNING');
      }
      
      await waitRandomTime(1000, 2000);
      
      const finalUrl = page.url();
      if (finalUrl.includes('/deliveries')) {
        logMessage(`✓ Successfully returned to deliveries list`);
        await deliveryItemHandle.dispose();
        return true;
      } else {
        logMessage('Not on deliveries page after clicking link, trying alternative methods...', 'WARNING');
      }
    } else {
      logMessage('Deliveries link not found, trying to navigate back', 'WARNING');
    }
    
    try {
      await page.goBack();
      await waitRandomTime(1000, 2000);
      
      const finalUrl = page.url();
      if (finalUrl.includes('/deliveries')) {
        logMessage(`✓ Successfully returned to deliveries list (via goBack)`);
        await deliveryItemHandle.dispose();
        return true;
      }
    } catch (backError) {
      logMessage('goBack failed, trying direct navigation...', 'WARNING');
    }
    
    try {
      const config = loadConfig();
      await page.goto(config.task.url, { waitUntil: 'networkidle2' });
      await waitRandomTime(1000, 2000);
      logMessage(`✓ Successfully returned to deliveries list (via direct navigation)`);
      await deliveryItemHandle.dispose();
      return true;
    } catch (navError) {
      logMessage('Failed to return to deliveries list', 'ERROR');
      await deliveryItemHandle.dispose();
      return false;
    }
  } catch (error: any) {
    logMessage(`Error clicking delivery ${orderNumber}: ${error.message}`, 'ERROR');
    return false;
  }
}

/**
 * Ensure we're on the deliveries page, click link if not
 */
async function ensureOnDeliveriesPage(page: puppeteer.Page): Promise<boolean> {
  try {
    const currentUrl = page.url();
    
    if (currentUrl.includes('/deliveries')) {
      logMessage('Already on deliveries page');
      return true;
    }
    
    logMessage(`Not on deliveries page (current URL: ${currentUrl}), clicking href="/deliveries" link...`);
    
    const deliveriesLink = await page.evaluateHandle(() => {
      const links = Array.from(document.querySelectorAll('a'));
      return links.find(link => {
        const href = link.getAttribute('href');
        return href === '/deliveries' || href === '/deliveries/';
      });
    });
    
    const linkValue = await deliveriesLink.jsonValue();
    if (linkValue) {
      await page.evaluate((handle) => {
        const element = handle as HTMLAnchorElement;
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, deliveriesLink);
      
      await waitRandomTime(500, 1000);
      
      const linkBox = await (deliveriesLink as puppeteer.ElementHandle<HTMLAnchorElement>).boundingBox();
      if (linkBox) {
        await page.mouse.move(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2);
        await waitRandomTime(500, 1000);
        await page.mouse.down();
        await page.mouse.up();
      } else {
        await page.evaluate((handle) => {
          const element = handle as HTMLAnchorElement;
          if (element) {
            element.click();
          }
        }, deliveriesLink);
      }
      
      await waitRandomTime(1000, 2000);
      
      try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
      } catch (navError) {
        logMessage('Navigation may have completed or timed out, continuing...', 'WARNING');
      }
      
      await waitRandomTime(1000, 2000);
      
      const finalUrl = page.url();
      if (finalUrl.includes('/deliveries')) {
        logMessage('✓ Successfully navigated to deliveries page');
        return true;
      } else {
        logMessage(`Failed to navigate to deliveries page, current URL: ${finalUrl}`, 'WARNING');
        return false;
      }
    } else {
      logMessage('Deliveries link not found, trying direct navigation...', 'WARNING');
      
      try {
        const config = loadConfig();
        await page.goto(config.task.url, { waitUntil: 'networkidle2' });
        await waitRandomTime(1000, 2000);
        
        const finalUrl = page.url();
        if (finalUrl.includes('/deliveries')) {
          logMessage('✓ Successfully navigated to deliveries page (direct navigation)');
          return true;
        } else {
          logMessage(`Failed to navigate to deliveries page via direct navigation`, 'ERROR');
          return false;
        }
      } catch (navError: any) {
        logMessage(`Error navigating to deliveries page: ${navError.message}`, 'ERROR');
        return false;
      }
    }
  } catch (error: any) {
    logMessage(`Error ensuring on deliveries page: ${error.message}`, 'ERROR');
    return false;
  }
}

/**
 * Load clicked orders from file
 */
function loadClickedOrders(): Set<string> {
  const clickedOrders = new Set<string>();
  try {
    const config = loadConfig();
    const clickedOrdersFile = path.join(config.paths.dataPath, 'clicked_orders.json');
    
    if (fileExists(clickedOrdersFile)) {
      const fileContent = readFileSync(clickedOrdersFile, 'utf-8');
      const orders = JSON.parse(fileContent) as string[];
      orders.forEach(order => clickedOrders.add(order));
      logMessage(`Loaded ${clickedOrders.size} previously clicked orders from file`);
    }
  } catch (error: any) {
    logMessage(`Error loading clicked orders: ${error.message}`, 'WARNING');
  }
  return clickedOrders;
}

/**
 * Save clicked orders to file
 */
function saveClickedOrders(clickedOrders: Set<string>): void {
  try {
    const config = loadConfig();
    mkdirSync(config.paths.dataPath, { recursive: true });
    
    const clickedOrdersFile = path.join(config.paths.dataPath, 'clicked_orders.json');
    const ordersArray = Array.from(clickedOrders);
    writeFileSync(clickedOrdersFile, JSON.stringify(ordersArray, null, 2), 'utf-8');
  } catch (error: any) {
    logMessage(`Error saving clicked orders: ${error.message}`, 'ERROR');
  }
}

/**
 * Add order to clicked orders set and save to file
 */
function addClickedOrder(orderNumber: string, clickedOrders: Set<string>): void {
  clickedOrders.add(orderNumber);
  saveClickedOrders(clickedOrders);
  logMessage(`Added order ${orderNumber} to clicked orders list (total: ${clickedOrders.size})`);
}

/**
 * Log clicked orders to file
 */
function logClickedOrder(orderNumber: string, timeText: string, status: string | null, reason: string): void {
  try {
    const config = loadConfig();
    mkdirSync(config.paths.dataPath, { recursive: true });
    
    const timestamp = new Date().toISOString();
    const logLine = `${timestamp} | Order: ${orderNumber} | Time: ${timeText} | Status: ${status || 'Unknown'} | Reason: ${reason}\n`;
    
    const logFilePath = path.join(config.paths.dataPath, 'clicked_orders.log');
    appendFileSync(logFilePath, logLine, 'utf-8');
    
    logMessage(`Logged clicked order ${orderNumber} to file`);
  } catch (error: any) {
    logMessage(`Error logging clicked order: ${error.message}`, 'ERROR');
  }
}

/**
 * Check list and click elements - Updated with continuous monitoring logic
 */
async function checkListAndClick(config: BotConfig): Promise<{ processed: number, clicked: number, error?: string }> {
  const result = { processed: 0, clicked: 0, error: undefined as string | undefined };

  let browserResult: InitBrowserResult | null = null;

  try {
    logMessage('Starting continuous delivery monitoring task...');

    // Load previously clicked orders to ensure each order is clicked only once
    const clickedOrders = loadClickedOrders();
    logMessage(`Loaded ${clickedOrders.size} previously clicked orders`);

    browserResult = await initBrowser(config.task.url, 'default');

    if (!browserResult.page || !browserResult.browser) {
      result.error = browserResult.error || 'Failed to initialize browser';
      logMessage(result.error, 'ERROR');
      return result;
    }

    const page = browserResult.page;

    logMessage('Waiting for page to load...');
    await waitRandomTime(1000, 2000);

    // Check for "No Deliveries available"
    const hasNoDeliveries = await checkNoDeliveries(page);
    if (hasNoDeliveries) {
      logMessage('"No Deliveries available" detected, reloading page...');
      await page.reload({ waitUntil: 'networkidle2' });
      await waitRandomTime(1000, 2000);
    }

    // Check for expired link
    const isExpired = await checkExpired(page);
    if (isExpired) {
      logMessage('Expired link detected, requesting new link...');
      if (config.task.phoneNumber) {
        await requestNewLink(page, config.task.phoneNumber);
        await waitRandomTime(1000, 2000);
      }
    }

    // Ensure we're on the deliveries page before processing orders
    const onDeliveriesPage = await ensureOnDeliveriesPage(page);
    if (!onDeliveriesPage) {
      result.error = 'Could not navigate to deliveries page';
      logMessage(result.error, 'WARNING');
      return result;
    }

    // Process deliveries - this processes ALL orders in "Today" section
    const deliveries = await processContinuousDeliveries(page);

    logMessage(`\n📊 Summary: Found ${deliveries.length} total order(s) in "Today" section`);

    result.processed = deliveries.length;

    // Separate orders into categories
    const eligibleToClick = deliveries.filter(d => d.shouldClick);
    const notEligible = deliveries.filter(d => !d.shouldClick);

    logMessage(`  - Eligible to click: ${eligibleToClick.length}`);
    logMessage(`  - Not eligible (${notEligible.length}): ${notEligible.map(d => `${d.orderNumber} (${d.reason})`).join(', ')}`);

    // IMPORTANT: Process eligible orders, but skip orders that have already been clicked
    // Also limit to 1 click per cycle
    let clickedCount = 0;
    let failedCount = 0;
    let skippedAlreadyClicked = 0;

    for (let i = 0; i < eligibleToClick.length; i++) {
      const delivery = eligibleToClick[i];
      logMessage(`\n>>> Processing order ${i + 1}/${eligibleToClick.length}: ${delivery.orderNumber} <<<`);

      // Check if this order has already been clicked
      if (clickedOrders.has(delivery.orderNumber)) {
        logMessage(`  ⚠ Order ${delivery.orderNumber} has already been clicked previously. Skipping.`);
        skippedAlreadyClicked++;
        continue;
      }

      try {
        // Determine if full process is needed based on actionType
        // param2 = only "I'm on my way", param1 and rule3 = full process
        const fullProcess = delivery.actionType !== 'param2';
        const actionTypeDesc = delivery.actionType === 'param2' ? 'param2 (only "I\'m on my way")' : 
                               delivery.actionType === 'param1' ? 'param1 (full process)' :
                               delivery.actionType === 'rule3' ? 'rule3 (full process)' : 'unknown';
        logMessage(`  Action type: ${actionTypeDesc}`);

        const success = await clickDeliveryAndReturn(page, delivery.orderNumber, fullProcess);

        if (success) {
          // Add order to clicked orders set and save to file
          addClickedOrder(delivery.orderNumber, clickedOrders);
          logClickedOrder(delivery.orderNumber, delivery.timeText, delivery.status, delivery.reason);
          logMessage(`✓ Successfully clicked order ${delivery.orderNumber} (${i + 1}/${eligibleToClick.length})`);
          clickedCount++;
          result.clicked = clickedCount;

          // Limit: Only 1 click per cycle - stop processing after first successful click
          logMessage(`  Limit reached: 1 click per cycle. Stopping processing for this cycle.`);
          break;

          // Verify we're back on the deliveries list before continuing
          const currentUrl = page.url();
          if (!currentUrl.includes('/deliveries')) {
            logMessage('Not on deliveries page after return, navigating back...', 'WARNING');
            try {
              await page.goto(config.task.url, { waitUntil: 'networkidle2' });
              await waitRandomTime(1000, 2000);
            } catch (navError) {
              logMessage('Failed to navigate back to deliveries page, but continuing with next order...', 'WARNING');
            }
          }

          await waitRandomTime(500, 1000);
        } else {
          logMessage(`✗ Failed to click order ${delivery.orderNumber} (${i + 1}/${eligibleToClick.length})`, 'ERROR');
          failedCount++;

          // Even if click failed, try to ensure we're on deliveries page
          const currentUrl = page.url();
          if (!currentUrl.includes('/deliveries')) {
            logMessage('Not on deliveries page after failed click, navigating back...', 'WARNING');
            try {
              await page.goto(config.task.url, { waitUntil: 'networkidle2' });
              await waitRandomTime(1000, 2000);
            } catch (navError) {
              logMessage('Failed to navigate back to deliveries page, but continuing with next order...', 'WARNING');
            }
          }

          await waitRandomTime(500, 1000);
        }
      } catch (error: any) {
        logMessage(`✗ Error processing order ${delivery.orderNumber}: ${error.message}`, 'ERROR');
        failedCount++;

        // Try to get back to deliveries page
        try {
          const currentUrl = page.url();
          if (!currentUrl.includes('/deliveries')) {
            await page.goto(config.task.url, { waitUntil: 'networkidle2' });
            await waitRandomTime(1000, 2000);
          }
        } catch (recoveryError) {
          logMessage('Could not recover to deliveries page, but continuing...', 'WARNING');
        }

        await waitRandomTime(500, 1000);
      }
    }

    // Log final summary of this cycle
    logMessage(`\n📊 Cycle processing complete:`);
    logMessage(`  - Total orders reviewed: ${deliveries.length}`);
    logMessage(`  - Successfully clicked: ${clickedCount}`);
    logMessage(`  - Failed clicks: ${failedCount}`);
    logMessage(`  - Already clicked (skipped): ${skippedAlreadyClicked}`);
    logMessage(`  - Not eligible (skipped): ${notEligible.length}`);

    result.clicked = clickedCount;

  } catch (error: any) {
    result.error = (error as Error).message;
    logMessage('Error during continuous delivery monitoring: ' + error, 'ERROR');
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

