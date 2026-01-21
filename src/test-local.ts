import { mkdirSync, writeFileSync, unlinkSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { launch } from 'puppeteer-core';
import puppeteer from 'puppeteer';
import yaml from 'js-yaml';
import type puppeteerTypes from 'puppeteer';

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

interface BrowserProfile {
  profile: string;
  pid: string;
  instance: number;
  browser: puppeteer.Browser | null;
  usedSince: Date | null;
}

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

  findProfileByBrowser(browser: puppeteer.Browser): BrowserProfile | null {
    const profile = this.used.find(p => p.browser === browser);
    return profile || null;
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
}

let browserPool: BrowserPool;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

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

  const timestamp = `[${dateStr} ${timeStr}]`;
  const levelFormatted = `[${level}]`;

  let logEntry;

  if (process.stdout.isTTY && !process.env.NO_COLOR) {
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

  if (level === 'ERROR') {
    console.error(logEntry);
  } else if (level === 'WARNING') {
    console.warn(logEntry);
  } else {
    console.log(logEntry);
  }
}

/**
 * Detect Chrome executable path automatically based on OS
 */
function detectChromePath(): string | null {
  const platform = process.platform;
  const possiblePaths: string[] = [];

  if (platform === 'win32') {
    // Windows paths
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || path.join(process.env['USERPROFILE'] || '', 'AppData', 'Local');
    
    possiblePaths.push(
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    );
  } else if (platform === 'darwin') {
    // macOS paths
    possiblePaths.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    // Linux paths
    possiblePaths.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/local/bin/google-chrome'
    );
  }

  // Check each path
  for (const chromePath of possiblePaths) {
    if (fileExists(chromePath)) {
      logMessage(`Chrome detected at: ${chromePath}`);
      return chromePath;
    }
  }

  // Try to use puppeteer's default
  try {
    const chromePath = puppeteer.executablePath();
    if (chromePath && fileExists(chromePath)) {
      logMessage(`Chrome detected via Puppeteer at: ${chromePath}`);
      return chromePath;
    }
  } catch (error) {
    // Ignore error
  }

  return null;
}

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

    // Auto-detect Chrome path if configured path doesn't exist
    if (!fileExists(config.browser.executablePath)) {
      logMessage(`Configured Chrome path not found: ${config.browser.executablePath}`, 'WARNING');
      const detectedPath = detectChromePath();
      if (detectedPath) {
        logMessage(`Using auto-detected Chrome path: ${detectedPath}`);
        config.browser.executablePath = detectedPath;
      } else {
        logMessage('Could not auto-detect Chrome. Please update executablePath in config file.', 'ERROR');
        throw new Error(`Chrome executable not found at ${config.browser.executablePath} and auto-detection failed. Please update the executablePath in config/ezcater_web_driver_bot.yaml`);
      }
    }

    return config;
  } catch (error) {
    logMessage('Error loading configuration: ' + error, 'ERROR');
    throw error;
  }
}

function fileExists(filePath: string): boolean {
  try {
    statSync(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

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
 * Parse time string like "12:00 PM EST" and convert to Date object
 * For testing, uses 12:00 PM as current time by default
 */
function parseDeliveryTime(timeString: string, currentTimeForTest?: string): { parsed: Date | null, current: Date } {
  // Default current time for testing: 12:00 PM
  const testCurrentTime = currentTimeForTest || '12:00 PM';
  
  // Parse test current time
  const now = new Date();
  const [testTime, testPeriod] = testCurrentTime.split(' ');
  const [testHours, testMinutes] = testTime.split(':').map(Number);
  const testHours24 = testPeriod === 'PM' && testHours !== 12 ? testHours + 12 : 
                      testPeriod === 'AM' && testHours === 12 ? 0 : testHours;
  
  const currentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), testHours24, testMinutes || 0);
  
  // Parse delivery time string (e.g., "12:00 PM EST")
  const timeMatch = timeString.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!timeMatch) {
    return { parsed: null, current: currentDate };
  }
  
  const [, hoursStr, minutesStr, period] = timeMatch;
  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);
  const hours24 = period.toUpperCase() === 'PM' && hours !== 12 ? hours + 12 : 
                  period.toUpperCase() === 'AM' && hours === 12 ? 0 : hours;
  
  const deliveryDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours24, minutes);
  
  return { parsed: deliveryDate, current: currentDate };
}

/**
 * Process delivery times from "Today" section
 * Finds h2 with "Today", then finds sibling divs with delivery items
 * Extracts time spans and compares with current time
 */
async function processDeliveryTimes(page: puppeteer.Page, currentTimeForTest?: string): Promise<Array<{ timeText: string, orderNumber: string, timeSpanHandle: puppeteerTypes.ElementHandle<HTMLElement> | null, deliveryItemHandle: puppeteerTypes.ElementHandle<HTMLElement> | null, timeDiffMinutes: number, isExpired: boolean, filterReason?: string }>> {
  const results: Array<{ timeText: string, orderNumber: string, timeSpanHandle: puppeteerTypes.ElementHandle<HTMLElement> | null, deliveryItemHandle: puppeteerTypes.ElementHandle<HTMLElement> | null, timeDiffMinutes: number, isExpired: boolean, filterReason?: string }> = [];
  
  try {
    logMessage('Searching for "Today" section...');
    
    // First, find "Upcoming" section to exclude it, then mark time spans only in "Today" section
    await page.evaluate(() => {
      // Find h2 with "Upcoming" text to identify what to exclude
      const h2Elements = Array.from(document.querySelectorAll('h2'));
      const upcomingH2 = h2Elements.find(h2 => {
        const text = h2.textContent?.trim();
        return text === 'Upcoming';
      });
      
      // Find the container for "Upcoming" to exclude
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
      
      // Find h2 with "Today" text
      const todayH2 = h2Elements.find(h2 => {
        const text = h2.textContent?.trim();
        return text === 'Today';
      });
      
      if (!todayH2) return;
      
      // Find the parent container that has the h2 as first element
      let container = todayH2.parentElement;
      while (container && container !== document.body) {
        if (container.firstElementChild === todayH2) {
          const parent = container.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children);
            let spanIndex = 0;
            
            siblings.forEach((sibling) => {
              // Skip if this sibling is part of the "Upcoming" section
              if (upcomingContainer && (sibling === upcomingContainer || upcomingContainer.contains(sibling))) {
                return;
              }
              
              const timeSpans = Array.from(sibling.querySelectorAll('span.c-AsWAM'));
              timeSpans.forEach((span) => {
                // Skip if span is inside "Upcoming" section
                if (upcomingContainer && upcomingContainer.contains(span)) {
                  return;
                }
                
                const timeText = span.textContent?.trim() || '';
                if (timeText.match(/\d{1,2}:\d{2}\s*(AM|PM)/i)) {
                  span.setAttribute('data-delivery-time-id', spanIndex.toString());
                  
                  // Find the clickable delivery item container and mark it
                  let deliveryItem = span.parentElement;
                  while (deliveryItem && deliveryItem !== document.body) {
                    // Look for the main delivery container (usually has the order number)
                    const orderDiv = deliveryItem.querySelector('div.ez-7crqac');
                    if (orderDiv) {
                      // Mark the parent container as clickable
                      deliveryItem.setAttribute('data-delivery-item-id', spanIndex.toString());
                      break;
                    }
                    deliveryItem = deliveryItem.parentElement;
                  }
                  
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
    
    // Now get all the delivery data, excluding "Upcoming" section
    const deliveryData = await page.evaluate(() => {
      // Find "Upcoming" section to exclude
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
      
      // Find h2 with "Today" text
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
            const deliveryItems: Array<{ timeText: string, orderNumber: string, spanId: string, isExpired: boolean }> = [];
            
            siblings.forEach((sibling) => {
              // Skip if this sibling is part of the "Upcoming" section
              if (upcomingContainer && (sibling === upcomingContainer || upcomingContainer.contains(sibling))) {
                return;
              }
              
              const timeSpans = Array.from(sibling.querySelectorAll('span.c-AsWAM[data-delivery-time-id]'));
              
              timeSpans.forEach((span) => {
                // Skip if span is inside "Upcoming" section
                if (upcomingContainer && upcomingContainer.contains(span)) {
                  return;
                }
                
                const timeText = span.textContent?.trim() || '';
                if (timeText.match(/\d{1,2}:\d{2}\s*(AM|PM)/i)) {
                  const spanId = span.getAttribute('data-delivery-time-id') || '';
                  
                  // Find order number from div with class "ez-7crqac" - extract only the text, no additional values
                  // Also find the delivery item container to check for expired status
                  let deliveryItem = span.parentElement;
                  let orderNumber = '';
                  let deliveryContainer: HTMLElement | null = null;
                  
                  // First, find the delivery container (the main div that contains this delivery item)
                  while (deliveryItem && deliveryItem !== document.body) {
                    // Look for div with class "ez-7crqac" that contains the order number
                    const orderDiv = deliveryItem.querySelector('div.ez-7crqac');
                    if (orderDiv) {
                      // Extract only the text content, no additional values
                      orderNumber = orderDiv.textContent?.trim() || '';
                      // This is likely the delivery container
                      deliveryContainer = deliveryItem;
                      break;
                    }
                    deliveryItem = deliveryItem.parentElement;
                  }
                  
                  // If not found via div.ez-7crqac, try regex as fallback
                  if (!orderNumber) {
                    let fallbackItem = span.parentElement;
                    while (fallbackItem && fallbackItem !== document.body) {
                      const orderMatch = fallbackItem.textContent?.match(/#[A-Z0-9-]+/);
                      if (orderMatch) {
                        orderNumber = orderMatch[0];
                        deliveryContainer = fallbackItem;
                        break;
                      }
                      fallbackItem = fallbackItem.parentElement;
                    }
                  }
                  
                  // Check if THIS SPECIFIC delivery item contains the expired chip
                  // Look for: <span class="MuiChip-label EzChip-label MuiChip-labelMedium ez-14vsv3w">Expired</span>
                  let isExpired = false;
                  if (deliveryContainer) {
                    // Search within this specific delivery container only
                    const expiredChips = deliveryContainer.querySelectorAll('span.MuiChip-label.EzChip-label.MuiChip-labelMedium.ez-14vsv3w');
                    for (let chip of Array.from(expiredChips)) {
                      if (chip.textContent?.trim() === 'Expired') {
                        isExpired = true;
                        break;
                      }
                    }
                    
                    // Also check with more flexible selector in case classes vary slightly
                    if (!isExpired) {
                      const allChips = deliveryContainer.querySelectorAll('span.MuiChip-label.EzChip-label');
                      for (let chip of Array.from(allChips)) {
                        const chipText = chip.textContent?.trim();
                        const hasAllClasses = chip.classList.contains('MuiChip-label') && 
                                            chip.classList.contains('EzChip-label') &&
                                            chip.classList.contains('MuiChip-labelMedium') &&
                                            chip.classList.contains('ez-14vsv3w');
                        if (chipText === 'Expired' && hasAllClasses) {
                          isExpired = true;
                          break;
                        }
                      }
                    }
                  }
                  
                  deliveryItems.push({
                    timeText: timeText,
                    orderNumber: orderNumber,
                    spanId: spanId,
                    isExpired: isExpired
                  });
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
      logMessage('"Today" section or delivery items not found', 'WARNING');
      return results;
    }
    
    logMessage(`Found ${deliveryData.length} delivery time span(s) in "Today" section`);
    
    // Process each delivery time
    for (let i = 0; i < deliveryData.length; i++) {
      const delivery = deliveryData[i];
      if (!delivery || !delivery.timeText) continue;
      
      logMessage(`Processing delivery ${i + 1}: ${delivery.timeText}${delivery.orderNumber ? ` (${delivery.orderNumber})` : ''}`);
      
      const { parsed: deliveryTime, current: currentTime } = parseDeliveryTime(delivery.timeText, currentTimeForTest);
      
      if (!deliveryTime) {
        logMessage(`Could not parse time: ${delivery.timeText}`, 'WARNING');
        continue;
      }
      
      // Compare times
      const timeDiff = deliveryTime.getTime() - currentTime.getTime();
      const timeDiffMinutes = Math.floor(timeDiff / (1000 * 60));
      
      logMessage(`  Current time (test): ${currentTime.toLocaleTimeString()}`);
      logMessage(`  Delivery time: ${deliveryTime.toLocaleTimeString()}`);
      logMessage(`  Time difference: ${timeDiffMinutes} minutes`);
      
      // Check if delivery is expired
      const isExpired = delivery.isExpired || false;
      if (isExpired) {
        logMessage(`  ⚠️  Delivery ${delivery.orderNumber || 'Unknown'} is EXPIRED - will be skipped`, 'WARNING');
      }
      
      // Filter: include deliveries with time >= current time AND <= current time + 15 minutes
      // This includes deliveries at the current test time and up to 15 minutes after
      const maxAllowedTime = new Date(currentTime.getTime() + 15 * 60 * 1000); // +15 minutes
      
      // Determine filter reason
      let filterReason: string | null = null;
      if (deliveryTime.getTime() < currentTime.getTime()) {
        filterReason = 'TIME_BEFORE_TEST_TIME';
        logMessage(`  Skipping delivery: time is before test time`, 'INFO');
      } else if (deliveryTime.getTime() > maxAllowedTime.getTime()) {
        filterReason = 'TIME_MORE_THAN_15_MIN_AFTER';
        logMessage(`  Skipping delivery: time is more than 15 minutes after test time`, 'INFO');
      }
      
      // Get the span element handle using the data attribute (only if not filtered)
      let timeSpanHandle: puppeteerTypes.ElementHandle<HTMLElement> | null = null;
      let deliveryItemHandle: puppeteerTypes.ElementHandle<HTMLElement> | null = null;
      let spanValue = null;
      let itemValue = null;
      
      // Only get handles if delivery is within time range (not filtered)
      if (!filterReason) {
        const timeSpanHandleResult = await page.evaluateHandle((spanId) => {
          const span = document.querySelector(`span.c-AsWAM[data-delivery-time-id="${spanId}"]`) as HTMLElement;
          return span;
        }, delivery.spanId);
        
        // Get the clickable delivery item handle - find the div with class "ez-1h5x3dy" that contains the specific ticket
        const deliveryItemHandleResult = await page.evaluateHandle((orderNum) => {
          // Find the div with class "ez-1h5x3dy" that contains the specific order number
          const allDeliveryContainers = Array.from(document.querySelectorAll('div.ez-1h5x3dy'));
          
          for (const container of allDeliveryContainers) {
            // Check if this container contains the order number
            const orderDiv = container.querySelector('div.ez-7crqac');
            if (orderDiv && orderDiv.textContent?.trim() === orderNum) {
              return container as HTMLElement;
            }
          }
          
          return null;
        }, delivery.orderNumber);
        
        const spanValue = await timeSpanHandleResult.jsonValue();
        const itemValue = await deliveryItemHandleResult.jsonValue();
        
        if (spanValue) {
          timeSpanHandle = timeSpanHandleResult as puppeteerTypes.ElementHandle<HTMLElement>;
          logMessage(`  Found time span element for delivery ${i + 1}`);
        }
        
        if (itemValue) {
          deliveryItemHandle = deliveryItemHandleResult as puppeteerTypes.ElementHandle<HTMLElement>;
        }
      }
      
      // Add ALL deliveries to results, including filtered ones
      results.push({
        timeText: delivery.timeText,
        orderNumber: delivery.orderNumber,
        timeSpanHandle: spanValue ? (timeSpanHandle as puppeteerTypes.ElementHandle<HTMLElement>) : null,
        deliveryItemHandle: itemValue ? (deliveryItemHandle as puppeteerTypes.ElementHandle<HTMLElement>) : null,
        timeDiffMinutes: timeDiffMinutes,
        isExpired: isExpired,
        filterReason: filterReason || undefined
      });
    }
    
  } catch (error: any) {
    logMessage(`Error processing delivery times: ${error.message}`, 'ERROR');
  }
  
  return results;
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
 * Ignores "Expired" text in MuiChip-label elements (span.MuiChip-label.EzChip-label)
 */
async function checkExpired(page: puppeteer.Page): Promise<boolean> {
  try {
    const isExpired = await page.evaluate(() => {
      // Check for exact "Expired Link" in h3
      const h3Elements = Array.from(document.querySelectorAll('h3'));
      const exactMatch = h3Elements.find(h3 => {
        const text = h3.textContent?.trim();
        return text === "Expired Link";
      });
      
      if (exactMatch) return true;
      
      // Check for "Delivering an order?" text (case insensitive)
      const allText = document.body.innerText;
      const allTextLower = allText.toLowerCase();
      
      if (allTextLower.includes('delivering an order?')) return true;
      
      // Check for "expired" text, but ignore MuiChip-label elements
      // Create a clone of the body to check text without the chip labels
      const bodyClone = document.body.cloneNode(true) as HTMLElement;
      
      // Remove all MuiChip-label spans from the clone
      const chipLabels = bodyClone.querySelectorAll('span.MuiChip-label');
      chipLabels.forEach(chip => chip.remove());
      
      // Check if "expired" exists in the remaining text
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
    logMessage('Link expired. Attempting to enter phone number...');
    
    // Wait a bit for the page to be ready, but don't wait for specific h3
    // The page might already be loaded when we detect expired
    await waitRandomTime(2000, 3000);
    
    logMessage('Searching for phone number input...');
    
    // Find and fill the phone number input using multiple flexible strategies
    // Note: NOT using CSS classes to maintain flexibility
    let inputFound = false;
    let inputSelector: string | null = null;
    
    // Strategy 1: Find by placeholder and radix- attributes (most reliable)
    try {
      logMessage('Trying to find input by placeholder and radix- attributes...');
      await page.waitForFunction(() => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
        return inputs.some(input => {
          const placeholder = input.getAttribute('placeholder');
          const name = input.getAttribute('name');
          const id = input.getAttribute('id');
          
          return placeholder === "Enter your phone number" && 
                 ((name && name.startsWith("radix-")) || (id && id.startsWith("radix-")));
        });
      }, { timeout: 8000 });
      
      logMessage('Found input by placeholder and radix- attributes');
      inputFound = true;
    } catch (error) {
      logMessage('Input with radix- attributes not found, trying label association...', 'WARNING');
    }
    
    // Strategy 2: Find by label "Verify Phone Number" and its association with input
    if (!inputFound) {
      try {
        logMessage('Trying to find input by label association...');
        await page.waitForFunction(() => {
          // Find label with text "Verify Phone Number"
          const labels = Array.from(document.querySelectorAll('label'));
          const verifyLabel = labels.find(label => {
            const text = label.textContent?.trim();
            return text === "Verify Phone Number";
          });
          
          if (!verifyLabel) return false;
          
          // Get the label's id (for aria-labelledby) or for attribute
          const labelId = verifyLabel.getAttribute('id');
          const labelFor = verifyLabel.getAttribute('for');
          
          // Find input associated with this label
          const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
          return inputs.some(input => {
            const placeholder = input.getAttribute('placeholder');
            const inputId = input.getAttribute('id');
            const ariaLabelledBy = input.getAttribute('aria-labelledby');
            
            // Check if input is associated with the label
            const isAssociated = (labelId && ariaLabelledBy === labelId) || 
                                (labelFor && inputId === labelFor) ||
                                (inputId && labelFor === inputId);
            
            return placeholder === "Enter your phone number" && isAssociated;
          });
        }, { timeout: 8000 });
        
        logMessage('Found input associated with "Verify Phone Number" label');
        inputFound = true;
      } catch (error) {
        logMessage('Input with label association not found, trying placeholder only...', 'WARNING');
      }
    }
    
    // Strategy 3: Final fallback - just search by placeholder
    if (!inputFound) {
      try {
        logMessage('Trying to find input by placeholder only...');
        await page.waitForFunction(() => {
          const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
          return inputs.some(input => {
            const placeholder = input.getAttribute('placeholder');
            return placeholder === "Enter your phone number";
          });
        }, { timeout: 8000 });
        
        logMessage('Found input by placeholder only');
        inputFound = true;
      } catch (error) {
        logMessage('Could not find input by any method', 'ERROR');
        logMessage('Taking screenshot for debugging...', 'WARNING');
        try {
          const screenshotPath = path.join(projectRoot, 'data', `input_not_found_${Date.now()}.png`);
          mkdirSync(path.join(projectRoot, 'data'), { recursive: true });
          await page.screenshot({ path: screenshotPath, fullPage: true });
          logMessage(`Screenshot saved to: ${screenshotPath}`);
        } catch (screenshotError) {
          logMessage(`Failed to take screenshot: ${screenshotError}`, 'ERROR');
        }
        return false;
      }
    }
    
    // Find the input using a selector and type the phone number
    inputSelector = await page.evaluate(() => {
      // Strategy 1: Find by label association
      const labels = Array.from(document.querySelectorAll('label'));
      const verifyLabel = labels.find(label => {
        const text = label.textContent?.trim();
        return text === "Verify Phone Number";
      });
      
      if (verifyLabel) {
        const labelId = verifyLabel.getAttribute('id');
        const labelFor = verifyLabel.getAttribute('for');
        
        const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
        let input = inputs.find(input => {
          const placeholder = input.getAttribute('placeholder');
          const inputId = input.getAttribute('id');
          const ariaLabelledBy = input.getAttribute('aria-labelledby');
          
          const isAssociated = (labelId && ariaLabelledBy === labelId) || 
                              (labelFor && inputId === labelFor) ||
                              (inputId && labelFor === inputId);
          
          return placeholder === "Enter your phone number" && isAssociated;
        });
        
        if (input) {
          const id = input.getAttribute('id');
          if (id) return `input#${id}`;
          const name = input.getAttribute('name');
          if (name) return `input[name="${name}"]`;
        }
      }
      
      // Strategy 2: Fallback - by placeholder and radix-
      const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
      let input = inputs.find(input => {
        const placeholder = input.getAttribute('placeholder');
        const name = input.getAttribute('name');
        const id = input.getAttribute('id');
        
        return placeholder === "Enter your phone number" && 
               ((name && name.startsWith("radix-")) || (id && id.startsWith("radix-")));
      });
      
      // Strategy 3: Final fallback - just by placeholder
      if (!input) {
        input = inputs.find(input => {
          const placeholder = input.getAttribute('placeholder');
          return placeholder === "Enter your phone number";
        });
      }
      
      if (!input) return null;
      
      // Try to use id first, then name, then fallback to placeholder
      // All selectors use attributes, NOT classes
      const id = input.getAttribute('id');
      if (id) return `input#${id}`;
      
      const name = input.getAttribute('name');
      if (name) return `input[name="${name}"]`;
      
      return 'input[placeholder="Enter your phone number"]';
    });
    
    if (inputSelector) {
      logMessage(`Found input selector: ${inputSelector}`);
      try {
        await page.waitForSelector(inputSelector, { timeout: 10000 });
        logMessage('Input selector found, focusing...');
        
        // Scroll into view and focus
        await page.evaluate((selector) => {
          const input = document.querySelector(selector) as HTMLInputElement;
          if (input) {
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, inputSelector);
        
          await waitRandomTime(1000, 1500); // Delay between actions
        
        // Click first to ensure the input is active
        await page.click(inputSelector);
        await waitRandomTime(1000, 1500); // Delay between actions
        
        // Then focus
        await page.focus(inputSelector);
        await waitRandomTime(1000, 1500); // Delay between actions
        
        // Verify focus
        const isFocused = await page.evaluate((selector) => {
          const input = document.querySelector(selector) as HTMLInputElement;
          return input === document.activeElement;
        }, inputSelector);
        
        if (isFocused) {
          logMessage('Input is focused successfully');
        } else {
          logMessage('Warning: Input may not be focused, continuing anyway...', 'WARNING');
        }
        
        // Clear any existing value first
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await waitRandomTime(1000, 1500); // Delay between actions
        
        // Type the phone number
        logMessage(`Typing phone number: ${phoneNumber}`);
        await page.type(inputSelector, phoneNumber, { delay: 100 + Math.random() * 100 });
        
        // Verify the value was entered
        const enteredValue = await page.evaluate((selector) => {
          const input = document.querySelector(selector) as HTMLInputElement;
          return input ? input.value : null;
        }, inputSelector);
        
        if (enteredValue === phoneNumber) {
          logMessage('Phone number entered successfully via selector method');
        } else {
          logMessage(`Warning: Expected "${phoneNumber}" but got "${enteredValue}"`, 'WARNING');
        }
      } catch (error: any) {
        logMessage(`Error typing in input with selector: ${error.message}`, 'WARNING');
        logMessage('Trying fallback method with evaluateHandle...', 'WARNING');
        
        // Fallback: use evaluateHandle and focus + type
        // Use same flexible search strategy: label association, then radix-, then placeholder
        const inputHandle = await page.evaluateHandle(() => {
          // Strategy 1: Find by label association
          const labels = Array.from(document.querySelectorAll('label'));
          const verifyLabel = labels.find(label => {
            const text = label.textContent?.trim();
            return text === "Verify Phone Number";
          });
          
          if (verifyLabel) {
            const labelId = verifyLabel.getAttribute('id');
            const labelFor = verifyLabel.getAttribute('for');
            
            const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
            let input = inputs.find(input => {
              const placeholder = input.getAttribute('placeholder');
              const inputId = input.getAttribute('id');
              const ariaLabelledBy = input.getAttribute('aria-labelledby');
              
              const isAssociated = (labelId && ariaLabelledBy === labelId) || 
                                  (labelFor && inputId === labelFor) ||
                                  (inputId && labelFor === inputId);
              
              return placeholder === "Enter your phone number" && isAssociated;
            });
            
            if (input) return input;
          }
          
          // Strategy 2: Fallback - by placeholder and radix-
          const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
          let input = inputs.find(input => {
            const placeholder = input.getAttribute('placeholder');
            const name = input.getAttribute('name');
            const id = input.getAttribute('id');
            
            return placeholder === "Enter your phone number" && 
                   ((name && name.startsWith("radix-")) || (id && id.startsWith("radix-")));
          });
          
          // Strategy 3: Final fallback - just by placeholder
          if (!input) {
            input = inputs.find(input => {
              const placeholder = input.getAttribute('placeholder');
              return placeholder === "Enter your phone number";
            });
          }
          
          return input || null;
        });
        
        if (inputHandle) {
          const handleValue = await inputHandle.jsonValue();
          if (!handleValue) {
            logMessage('Input handle is null or undefined', 'ERROR');
            return false;
          }
          
          logMessage('Input handle found, focusing and typing...');
          
          // Scroll into view
          await page.evaluate((handle) => {
            const element = handle as HTMLInputElement;
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, inputHandle);
          
          await waitRandomTime(1000, 1500); // Delay between actions
          
          // Click first
          await page.evaluate((handle) => {
            const element = handle as HTMLInputElement;
            if (element) {
              element.click();
            }
          }, inputHandle);
          
          await waitRandomTime(1000, 1500); // Delay between actions
          
          // Then focus
          await page.evaluate((handle) => {
            const element = handle as HTMLInputElement;
            if (element) {
              element.focus();
              // Clear existing value
              element.value = '';
            }
          }, inputHandle);
          
          await waitRandomTime(1000, 1500); // Delay between actions
          
          // Verify focus
          const isFocused = await page.evaluate((handle) => {
            const element = handle as HTMLInputElement;
            return element === document.activeElement;
          }, inputHandle);
          
          if (isFocused) {
            logMessage('Input is focused successfully via fallback method');
          } else {
            logMessage('Warning: Input may not be focused, continuing anyway...', 'WARNING');
          }
          
          await page.keyboard.type(phoneNumber, { delay: 100 + Math.random() * 100 });
          
          // Verify the value was entered
          const enteredValue = await page.evaluate((handle) => {
            const element = handle as HTMLInputElement;
            return element ? element.value : null;
          }, inputHandle);
          
          if (enteredValue === phoneNumber) {
            logMessage('Phone number entered successfully via fallback method');
          } else {
            logMessage(`Warning: Expected "${phoneNumber}" but got "${enteredValue}"`, 'WARNING');
          }
        } else {
          logMessage('Could not find phone number input with evaluateHandle', 'ERROR');
          return false;
        }
      }
    } else {
      logMessage('Could not find phone number input with specified attributes', 'ERROR');
      return false;
    }
    
    await waitRandomTime(500, 1000);
    
    logMessage('Phone number entered successfully. Button click skipped - manual action required.');
    
    return true;
  } catch (error: any) {
    logMessage(`Error requesting new link: ${error}`, 'ERROR');
    return false;
  }
}

async function checkListAndClick(config: BotConfig): Promise<{ processed: number, clicked: number, error?: string }> {
  const result = { processed: 0, clicked: 0, error: undefined as string | undefined };

  let browserResult: InitBrowserResult | null = null;

  try {
    logMessage('Starting EZCater deliveries check...');

    browserResult = await initBrowser(config.task.url, 'test');

    if (!browserResult.page || !browserResult.browser) {
      result.error = browserResult.error || 'Failed to initialize browser';
      logMessage(result.error, 'ERROR');
      return result;
    }

    const page = browserResult.page;
    const maxReloadAttempts = config.task.maxReloadAttempts || 10;
    const reloadWaitTime = (config.task.reloadWaitTime || 5) * 1000;
    let reloadCount = 0;

    logMessage('Waiting for page to load...');
    await waitRandomTime(3000, 5000);

    // Main loop: check for "No Deliveries available" and reload if needed
    while (reloadCount < maxReloadAttempts) {
      logMessage(`Checking page (attempt ${reloadCount + 1}/${maxReloadAttempts})...`);
      
      // Wait for page to be fully loaded
      try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
      } catch (e) {
        // Navigation might not be needed if already loaded
      }
      await waitRandomTime(2000, 3000);
      
      // Check for "No Deliveries available"
      const hasNoDeliveries = await checkNoDeliveries(page);
      
      if (hasNoDeliveries) {
        logMessage('"No Deliveries available" detected. Reloading page...');
        reloadCount++;
        await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
        await waitRandomTime(reloadWaitTime, reloadWaitTime);
        continue;
      }
      
      // Verify there are elements on the page before proceeding
      const hasElements = await page.evaluate(() => {
        return document.body.children.length > 0;
      });
      
      if (!hasElements) {
        logMessage('No elements found on page, reloading...', 'WARNING');
        reloadCount++;
        await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
        await waitRandomTime(reloadWaitTime, reloadWaitTime);
        continue;
      }
      
      logMessage('Page has elements, proceeding with delivery link click...');
      
      // Look for link with href containing "/deliveries" and click it
      try {
        logMessage('Searching for link with href containing "/deliveries"...');
        const deliveriesLink = await page.evaluateHandle(() => {
          const links = Array.from(document.querySelectorAll('a'));
          return links.find(link => {
            const href = link.getAttribute('href');
            return href && href.includes('/deliveries');
          });
        });
        
        const linkValue = await deliveriesLink.jsonValue();
        if (linkValue) {
          logMessage('Found deliveries link, clicking...');
          
          // Get bounding box and click
          const box = await (deliveriesLink as puppeteerTypes.ElementHandle<HTMLAnchorElement>).boundingBox();
          if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await waitRandomTime(1000, 1500); // Delay between actions
            await page.mouse.down();
            await page.mouse.up();
            logMessage('Clicked on deliveries link');
          } else {
            // Fallback: use evaluate to click
            await page.evaluate((handle) => {
              const element = handle as HTMLAnchorElement;
              if (element) {
                element.click();
              }
            }, deliveriesLink);
            logMessage('Clicked on deliveries link (fallback method)');
          }
          
          // Wait for navigation
          await waitRandomTime(2000, 3000);
          try {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
          } catch (navError) {
            logMessage('Navigation may have completed or timed out, continuing...', 'WARNING');
          }
          
          await waitRandomTime(2000, 3000);
          
          // Process delivery times from "Today" section
          // Default current time for test: 12:00 PM
          logMessage('Processing delivery times from "Today" section...');
          const deliveryTimes = await processDeliveryTimes(page, '12:00 PM');
          
          logMessage(`Processed ${deliveryTimes.length} delivery time(s) with time comparisons`);
          
          // Filter out expired deliveries and show list of orders to process
          const validDeliveries = deliveryTimes.filter(d => !d.isExpired);
          const expiredDeliveries = deliveryTimes.filter(d => d.isExpired);
          
          // Log all detected order tickets
          logMessage(`\n🎫 ============================================================`);
          logMessage(`🎫 DETECTED ORDER TICKETS SUMMARY`);
          logMessage(`🎫 ============================================================`);
          logMessage(`🎫 Total orders detected: ${deliveryTimes.length}`);
          
          // Build content for file
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          let fileContent = `============================================================\n`;
          fileContent += `DETECTED ORDER TICKETS SUMMARY\n`;
          fileContent += `Generated: ${new Date().toLocaleString()}\n`;
          fileContent += `============================================================\n\n`;
          fileContent += `Total orders detected: ${deliveryTimes.length}\n\n`;
          
          if (deliveryTimes.length > 0) {
            logMessage(`🎫 All detected tickets:`);
            fileContent += `ALL DETECTED TICKETS:\n`;
            fileContent += `----------------------------------------\n`;
            deliveryTimes.forEach((delivery, idx) => {
              let status = 'VALID';
              if (delivery.isExpired) {
                status = 'EXPIRED';
              } else if (delivery.filterReason === 'TIME_BEFORE_TEST_TIME') {
                status = 'FILTERED (Time before test time)';
              } else if (delivery.filterReason === 'TIME_MORE_THAN_15_MIN_AFTER') {
                status = 'FILTERED (Time more than 15 min after)';
              }
              
              const timeDiffInfo = delivery.timeDiffMinutes !== undefined ? ` | Time diff: ${delivery.timeDiffMinutes} min` : '';
              const logLine = `🎫   ${idx + 1}. Ticket: ${delivery.orderNumber || 'Unknown'} | Time: ${delivery.timeText} | Status: ${status}${timeDiffInfo}`;
              logMessage(logLine);
              fileContent += `${idx + 1}. Ticket: ${delivery.orderNumber || 'Unknown'} | Time: ${delivery.timeText} | Status: ${status}${timeDiffInfo}\n`;
            });
            fileContent += `\n`;
          }
          
          if (expiredDeliveries.length > 0) {
            logMessage(`🎫 Expired tickets (${expiredDeliveries.length}):`);
            fileContent += `EXPIRED TICKETS (${expiredDeliveries.length}):\n`;
            fileContent += `----------------------------------------\n`;
            expiredDeliveries.forEach((delivery, idx) => {
              const logLine = `🎫   - ${delivery.orderNumber || 'Unknown'}`;
              logMessage(logLine);
              fileContent += `- ${delivery.orderNumber || 'Unknown'} | Time: ${delivery.timeText}\n`;
            });
            fileContent += `\n`;
          }
          
          if (validDeliveries.length > 0) {
            logMessage(`🎫 Valid tickets to process (${validDeliveries.length}):`);
            fileContent += `VALID TICKETS TO PROCESS (${validDeliveries.length}):\n`;
            fileContent += `----------------------------------------\n`;
            validDeliveries.forEach((delivery, idx) => {
              const logLine = `🎫   - ${delivery.orderNumber || 'Unknown'} (Time diff: ${delivery.timeDiffMinutes} min)`;
              logMessage(logLine);
              fileContent += `- ${delivery.orderNumber || 'Unknown'} | Time: ${delivery.timeText} | Time diff: ${delivery.timeDiffMinutes} min\n`;
            });
            fileContent += `\n`;
          }
          
          fileContent += `============================================================\n`;
          
          logMessage(`🎫 ============================================================\n`);
          
          // Save to file
          try {
            mkdirSync(config.paths.dataPath, { recursive: true });
            const fileName = `tickets_summary_${timestamp}.txt`;
            const filePath = path.join(config.paths.dataPath, fileName);
            writeFileSync(filePath, fileContent, 'utf-8');
            logMessage(`📄 Tickets summary saved to: ${filePath}`);
          } catch (fileError: any) {
            logMessage(`Error saving tickets summary to file: ${fileError.message}`, 'ERROR');
          }
          
          // Show expired deliveries
          if (expiredDeliveries.length > 0) {
            logMessage(`\n⚠️  Found ${expiredDeliveries.length} EXPIRED delivery(ies) that will be skipped:`);
            expiredDeliveries.forEach((delivery, idx) => {
              logMessage(`  ${idx + 1}. ${delivery.orderNumber || 'Unknown'} - ${delivery.timeText} (EXPIRED)`);
            });
          }
          
          // Show list of orders that will be clicked
          if (validDeliveries.length > 0) {
            logMessage(`\n📋 List of orders to process (${validDeliveries.length} order(s)):`);
            validDeliveries.forEach((delivery, idx) => {
              logMessage(`  ${idx + 1}. ${delivery.orderNumber || 'Unknown'} - ${delivery.timeText} (Time diff: ${delivery.timeDiffMinutes} min)`);
            });
            logMessage('');
          } else {
            logMessage('No valid deliveries to process (all expired or filtered out)', 'WARNING');
          }
          
          // Process each delivery item: click, check code, return to list
          if (validDeliveries.length > 0) {
            logMessage(`Starting to process ${validDeliveries.length} delivery item(s)...`);
            
            for (let i = 0; i < validDeliveries.length; i++) {
              const delivery = validDeliveries[i];
              logMessage(`\n=== Processing delivery ${i + 1}/${validDeliveries.length}: ${delivery.orderNumber || 'Unknown'} ===`);
              
              // Skip if expired (should not happen due to filter, but double-check)
              if (delivery.isExpired) {
                logMessage(`⚠️  Delivery ${delivery.orderNumber || 'Unknown'} is EXPIRED - skipping`, 'WARNING');
                continue;
              }
              
              // Step 1: Click on the delivery item element (with retry logic)
              // Find the element with class "ez-1h5x3dy" that contains this specific ticket
              let deliveryItemHandle = await page.evaluateHandle((orderNum) => {
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
              if (itemValue && deliveryItemHandle) {
                try {
                  const maxClickAttempts = 3;
                  let clickSuccess = false;
                  let currentUrl = '';
                  
                  for (let clickAttempt = 1; clickAttempt <= maxClickAttempts; clickAttempt++) {
                    logMessage(`Step 1: Clicking on delivery item ${i + 1} (attempt ${clickAttempt}/${maxClickAttempts})...`);
                    
                    // Click the element with class "ez-1h5x3dy"
                    const box = await (deliveryItemHandle as puppeteerTypes.ElementHandle<HTMLElement>).boundingBox();
                    if (box) {
                      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                      await waitRandomTime(1000, 1500); // Delay between actions
                      await page.mouse.down();
                      await page.mouse.up();
                      logMessage(`Clicked on delivery item ${i + 1}`);
                    } else {
                      // Fallback: use evaluate to click
                      await page.evaluate((handle) => {
                        const element = handle as HTMLElement;
                        if (element) {
                          element.click();
                        }
                      }, deliveryItemHandle as puppeteerTypes.ElementHandle<HTMLElement>);
                      logMessage(`Clicked on delivery item ${i + 1} (fallback method)`);
                    }
                    
                    await waitRandomTime(1000, 3000);
                    
                    // Wait for navigation
                    try {
                      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
                    } catch (navError) {
                      logMessage('Navigation may have completed or timed out, continuing...', 'WARNING');
                    }
                    
                    await waitRandomTime(1000, 3000);
                    
                    // Check current URL - it should NOT contain "/deliveries"
                    currentUrl = page.url();
                    logMessage(`Current URL after click: ${currentUrl}`);
                    
                    if (!currentUrl.includes('/deliveries')) {
                      logMessage(`Successfully navigated away from deliveries page (attempt ${clickAttempt})`);
                      clickSuccess = true;
                      break;
                    } else {
                      logMessage(`URL still contains "/deliveries" (attempt ${clickAttempt}/${maxClickAttempts}), will retry...`, 'WARNING');
                      if (clickAttempt < maxClickAttempts) {
                        // Wait before retrying
                        await waitRandomTime(1000, 3000);
                        // Re-find the delivery item handle in case page reloaded
                        const retryDeliveryItemHandle = await page.evaluateHandle((orderNum) => {
                          const allDeliveryContainers = Array.from(document.querySelectorAll('div.ez-1h5x3dy'));
                          for (const container of allDeliveryContainers) {
                            const orderDiv = container.querySelector('div.ez-7crqac');
                            if (orderDiv && orderDiv.textContent?.trim() === orderNum) {
                              return container as HTMLElement;
                            }
                          }
                          return null;
                        }, delivery.orderNumber);
                        
                        const retryItemValue = await retryDeliveryItemHandle.jsonValue();
                        if (retryItemValue) {
                          // Dispose old handle and update with new one
                          deliveryItemHandle.dispose();
                          deliveryItemHandle = retryDeliveryItemHandle as puppeteerTypes.ElementHandle<HTMLElement>;
                        }
                      }
                    }
                  }
                  
                  if (!clickSuccess) {
                    logMessage(`Failed to navigate away from deliveries page after ${maxClickAttempts} attempts`, 'ERROR');
                    // Skip to next delivery
                    continue;
                  }
                  
                  // Step 2: Search for the order code in the new interface (only if we successfully navigated)
                  logMessage(`Step 2: Searching for order code in the new interface...`);
                  
                  // Search for the order code in the new interface
                  const orderCodeFound = await page.evaluate((orderNumber) => {
                    // Search for the order number in the page
                    const allText = document.body.innerText;
                    return allText.includes(orderNumber);
                  }, delivery.orderNumber);
                  
                  if (orderCodeFound) {
                    logMessage(`Order code "${delivery.orderNumber}" found in the new interface`);
                  } else {
                    logMessage(`Order code "${delivery.orderNumber}" not found in the new interface`, 'WARNING');
                  }
                  
                  await waitRandomTime(1000, 3000);
                  
                  // Step 3: Return to the deliveries list by clicking the link with href="/deliveries"
                  logMessage(`Step 3: Returning to deliveries list...`);
                  const deliveriesLink = await page.evaluateHandle(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    return links.find(link => {
                      const href = link.getAttribute('href');
                      return href === '/deliveries' || href === '/deliveries/';
                    });
                  });
                  
                  const linkValue = await deliveriesLink.jsonValue();
                  if (linkValue) {
                    const linkBox = await (deliveriesLink as puppeteerTypes.ElementHandle<HTMLAnchorElement>).boundingBox();
                    if (linkBox) {
                      await page.mouse.move(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2);
                      await waitRandomTime(1000, 1500); // Delay between actions
                      await page.mouse.down();
                      await page.mouse.up();
                      logMessage(`Clicked on deliveries link to return to list`);
                    } else {
                      await page.evaluate((handle) => {
                        const element = handle as HTMLAnchorElement;
                        if (element) {
                          element.click();
                        }
                      }, deliveriesLink);
                      logMessage(`Clicked on deliveries link (fallback method)`);
                    }
                  } else {
                    logMessage('Deliveries link not found, trying to navigate back', 'WARNING');
                    // Try to go back
                    await page.goBack();
                  }
                  
                  await waitRandomTime(1000, 3000);
                  
                  // Wait for the list to load again
                  try {
                    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
                  } catch (navError) {
                    logMessage('Navigation back may have completed or timed out, continuing...', 'WARNING');
                  }
                  
                  await waitRandomTime(1000, 3000);
                  
                  logMessage(`Completed processing delivery ${i + 1}/${deliveryTimes.length}`);
                  result.clicked++;
                  
                } catch (itemError: any) {
                  logMessage(`Error processing delivery item ${i + 1}: ${itemError.message}`, 'ERROR');
                  // Try to return to list even if there was an error
                  try {
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
                          element.click();
                        }
                      }, deliveriesLink);
                      await waitRandomTime(2000, 3000);
                    }
                  } catch (recoveryError) {
                    logMessage('Could not recover to deliveries list', 'ERROR');
                  }
                }
              } else {
                logMessage(`Delivery item ${i + 1} (ez-1h5x3dy) not found for order ${delivery.orderNumber}, skipping...`, 'WARNING');
              }
            }
            
            logMessage(`\nCompleted processing all ${deliveryTimes.length} delivery item(s)`);
          }
          
          result.processed = deliveryTimes.length;
        } else {
          logMessage('Link with href containing "/deliveries" not found', 'WARNING');
        }
      } catch (linkError: any) {
        logMessage(`Error clicking deliveries link: ${linkError.message}`, 'WARNING');
      }
      
      // Check for expired link or "Delivering an order?"
      const isExpired = await checkExpired(page);
      
      if (isExpired) {
        logMessage('Expired link or "Delivering an order?" detected!');
        
        if (config.task.phoneNumber) {
          logMessage(`Attempting to enter phone number: ${config.task.phoneNumber}`);
          const success = await requestNewLink(page, config.task.phoneNumber);
          if (success) {
            logMessage('Phone number entered successfully.');
            result.processed = 1;
            result.clicked = 1;
          } else {
            const errorMsg = 'Failed to enter phone number - input field may not be available or accessible';
            logMessage(errorMsg, 'ERROR');
            result.error = errorMsg;
            // Take screenshot for debugging
            try {
              const screenshotPath = path.join(config.paths.dataPath, `phone_input_error_${Date.now()}.png`);
              mkdirSync(config.paths.dataPath, { recursive: true });
              await page.screenshot({ path: screenshotPath, fullPage: true });
              logMessage(`Debug screenshot saved to: ${screenshotPath}`);
            } catch (screenshotError) {
              logMessage(`Failed to take screenshot: ${screenshotError}`, 'ERROR');
            }
          }
        } else {
          logMessage('No phone number configured. Cannot enter phone number.', 'WARNING');
          result.error = 'Expired link or "Delivering an order?" detected but no phone number configured';
        }
        break;
      }
      
      // If we get here, page is loaded and has deliveries (or no expired link)
      logMessage('Page loaded successfully. No "No Deliveries available", expired link, or "Delivering an order?" detected.');
      result.processed = 1;
      break;
    }

    if (reloadCount >= maxReloadAttempts) {
      result.error = `Reached maximum reload attempts (${maxReloadAttempts}) without finding deliveries or expired link`;
      logMessage(result.error, 'ERROR');
    }

    logMessage(`Task completed. Processed: ${result.processed}, Actions: ${result.clicked}`);

  } catch (error: any) {
    result.error = (error as Error).message;
    logMessage('Error during deliveries check: ' + error, 'ERROR');
  }
  // Note: Browser is NOT closed here - it remains open for manual inspection

  return result;
}

/**
 * Test function - Main entry point for local testing
 */
async function testLocal(): Promise<void> {
  try {
    logMessage("=".repeat(60));
    logMessage("EZCater Web Driver Bot - Local Test Mode");
    logMessage("=".repeat(60));
    logMessage("");

    // Load configuration
    logMessage("Loading configuration...");
    const config = loadConfig();
    logMessage("Configuration loaded successfully");
    logMessage("");

    // Display test configuration
    logMessage("Test Configuration:");
    logMessage(`  URL: ${config.task.url}`);
    logMessage(`  Phone Number: ${config.task.phoneNumber || 'Not configured'}`);
    logMessage(`  Max Reload Attempts: ${config.task.maxReloadAttempts || 10}`);
    logMessage(`  Reload Wait Time: ${config.task.reloadWaitTime || 5} seconds`);
    logMessage("");

    // Initialize browser pool
    logMessage("Initializing browser pool...");
    browserPool = new BrowserPool(config);
    logMessage(`Browser pool initialized with size: ${config.browser.poolSize || 3}`);
    logMessage("");

    // Create data directory
    mkdirSync(config.paths.dataPath, { recursive: true });

    // Run the test
    logMessage("Starting test execution...");
    logMessage("");

    const result = await checkListAndClick(config);

    logMessage("");
    logMessage("=".repeat(60));
    logMessage("Test Results:");
    logMessage("=".repeat(60));
    logMessage(`  Processed Items: ${result.processed}`);
    logMessage(`  Clicked Elements: ${result.clicked}`);
    
    if (result.error) {
      logMessage(`  Error: ${result.error}`, 'ERROR');
      logMessage("");
      logMessage("Check the screenshot in the data/ directory for debugging");
    } else {
      logMessage("  Status: SUCCESS");
    }
    
    logMessage("=".repeat(60));
    logMessage("");
    logMessage("⚠️  Browser will remain open for manual inspection");
    logMessage("⚠️  Close the browser window manually when you're done reviewing");
    logMessage("⚠️  Press Ctrl+C to exit this process");
    logMessage("");

    // Keep the process running so the browser stays open
    // The user can manually close the browser and then press Ctrl+C to exit
    process.on('SIGINT', () => {
      logMessage("");
      logMessage("Shutting down...");
      process.exit(result.error ? 1 : 0);
    });

    // Keep process alive - wait indefinitely until user presses Ctrl+C
    await new Promise(() => {
      // This promise never resolves, keeping the process alive
    });

  } catch (error: any) {
    logMessage("An error occurred during testing: " + error, 'ERROR');
    process.exit(1);
  }
}

// Execute the test
testLocal().catch(error => {
  logMessage("Unhandled error in test: " + error, 'ERROR');
  process.exit(1);
});

