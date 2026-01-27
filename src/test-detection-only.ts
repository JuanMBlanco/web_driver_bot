import { mkdirSync, writeFileSync, readFileSync, statSync, appendFileSync } from 'fs';
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
    profile.usedSince = new Date();
    this.used.push(profile);
    logMessage(`Browser profile ${profile.instance} acquired for context: ${context}`);
    return profile;
  }

  returnBrowserProfile(profile: BrowserProfile, closeBrowser: boolean): void {
    const index = this.used.indexOf(profile);
    if (index === -1) {
      logMessage(`Profile ${profile.instance} not found in used list`, 'WARNING');
      return;
    }

    this.used.splice(index, 1);
    profile.usedSince = null;

    if (closeBrowser && profile.browser) {
      profile.browser.close();
      profile.browser = null;
    }

    this.available.push(profile);
    logMessage(`Browser profile ${profile.instance} returned to pool`);
  }

  async manageBrowserTabs(browser: puppeteer.Browser, instance: number): Promise<puppeteer.Page> {
    const pages = await browser.pages();
    if (pages.length > 0) {
      return pages[0];
    }
    return await browser.newPage();
  }

  async closeBrowser(profile: BrowserProfile): Promise<void> {
    if (profile.browser) {
      try {
        await profile.browser.close();
      } catch (error) {
        logMessage(`Error closing browser for profile ${profile.instance}: ${error}`, 'ERROR');
      }
      profile.browser = null;
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

let browserPool: BrowserPool;
let currentLogFile: string | null = null;

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
};

function logMessage(message: string, level: 'INFO' | 'ERROR' | 'WARNING' = 'INFO'): void {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  const dateStr = `${year}-${month}-${day}`;
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

function detectChromePath(): string | null {
  const platform = process.platform;
  const possiblePaths: string[] = [];

  if (platform === 'win32') {
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
    possiblePaths.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    possiblePaths.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/local/bin/google-chrome'
    );
  }

  for (const chromePath of possiblePaths) {
    if (fileExists(chromePath)) {
      logMessage(`Chrome detected at: ${chromePath}`);
      return chromePath;
    }
  }

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

    if (!fileExists(config.browser.executablePath)) {
      logMessage(`Configured Chrome path not found: ${config.browser.executablePath}`, 'WARNING');
      const detectedPath = detectChromePath();
      if (detectedPath) {
        logMessage(`Using auto-detected Chrome path: ${detectedPath}`);
        config.browser.executablePath = detectedPath;
      } else {
        logMessage('Could not auto-detect Chrome. Please update executablePath in config file.', 'ERROR');
        throw new Error(`Chrome executable not found at ${config.browser.executablePath} and auto-detection failed.`);
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

    const config = loadConfig();

    const browser = await launch({
      executablePath: config.browser.executablePath,
      headless: false,
      devtools: false,
      userDataDir: profile.profile,
      args: config.browser.args,
    });

    profile.browser = browser;

    await waitRandomTime(1000, 2000);

    let page = await browserPool.manageBrowserTabs(browser, profile.instance);

    await waitRandomTime(1000, 2000);

    await page.setViewport({
      width: config.viewport?.width || 1920,
      height: config.viewport?.height || 1080,
      deviceScaleFactor: 1
    });

    await page.goto(url);

    const title = await page.title();
    logMessage('Page title: ' + title);

    await waitRandomTime(1000, 2000);

    result.browser = browser;
    result.page = page;
    result.profile = profile;

    return result;
  } catch (error: any) {
    result.error = error.message || String(error);
    logMessage(`Error initializing browser: ${result.error}`, 'ERROR');
    return result;
  }
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
 * Handle "No Deliveries available" by reloading page up to maxAttempts times
 * Returns true if deliveries are now available, false if still no deliveries after all attempts
 */
async function handleNoDeliveriesWithReload(page: puppeteer.Page, maxAttempts: number = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const hasNoDeliveries = await checkNoDeliveries(page);
    
    if (!hasNoDeliveries) {
      logMessage(`✓ Deliveries are now available (after ${attempt - 1} reload attempt(s))`);
      return true;
    }
    
    if (attempt < maxAttempts) {
      logMessage(`"No Deliveries available" detected (attempt ${attempt}/${maxAttempts}), reloading page...`);
      await page.reload({ waitUntil: 'networkidle2' });
      await waitRandomTime(2000, 3000);
    } else {
      logMessage(`"No Deliveries available" still present after ${maxAttempts} reload attempt(s)`);
    }
  }
  
  return false;
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
    
    let inputHandle: puppeteerTypes.ElementHandle<HTMLInputElement> | null = null;
    
    try {
      inputHandle = await page.waitForSelector(
        'input[type="text"][placeholder="Enter your phone number"][name^="radix-"]',
        { timeout: 5000 }
      ) as puppeteerTypes.ElementHandle<HTMLInputElement> | null;
    } catch (e) {
      // Try strategy 2
    }
    
    if (!inputHandle) {
      try {
        inputHandle = await page.waitForSelector(
          'input[type="text"][placeholder="Enter your phone number"][id^="radix-"]',
          { timeout: 5000 }
        ) as puppeteerTypes.ElementHandle<HTMLInputElement> | null;
      } catch (e) {
        // Try strategy 3
      }
    }
    
    if (!inputHandle) {
      try {
        inputHandle = await page.waitForSelector(
          'input[type="text"][placeholder="Enter your phone number"]',
          { timeout: 5000 }
        ) as puppeteerTypes.ElementHandle<HTMLInputElement> | null;
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
 * Ensure we're on the deliveries page, click link if not
 * Uses the same navigation logic as test-continuous-v2.ts
 */
async function ensureOnDeliveriesPage(page: puppeteer.Page): Promise<boolean> {
  try {
    const currentUrl = page.url();
    
    if (currentUrl.includes('/deliveries')) {
      logMessage('Already on deliveries page');
      return true;
    }
    
    logMessage(`Not on deliveries page (current URL: ${currentUrl}), clicking href="/deliveries" link...`);
    
    // Find and click the deliveries link
    const deliveriesLink = await page.evaluateHandle(() => {
      const links = Array.from(document.querySelectorAll('a'));
      return links.find(link => {
        const href = link.getAttribute('href');
        return href === '/deliveries' || href === '/deliveries/';
      });
    });
    
    const linkValue = await deliveriesLink.jsonValue();
    if (linkValue) {
      // Scroll to link
      await page.evaluate((handle) => {
        const element = handle as HTMLAnchorElement;
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, deliveriesLink);
      
      await waitRandomTime(500, 1000);
      
      const linkBox = await (deliveriesLink as puppeteerTypes.ElementHandle<HTMLAnchorElement>).boundingBox();
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
      
      // Verify we're on deliveries page
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
      
      // Fallback: navigate directly to deliveries URL
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
      
      const allChips = container.querySelectorAll('span.MuiChip-label.EzChip-label');
      for (let chip of Array.from(allChips)) {
        const chipText = chip.textContent?.trim();
        const hasAllClasses = chip.classList.contains('MuiChip-label') && 
                            chip.classList.contains('EzChip-label') &&
                            chip.classList.contains('MuiChip-labelMedium') &&
                            chip.classList.contains('ez-14vsv3w');
        if (hasAllClasses && (chipText === 'En Route to Customer' || chipText === 'Delivery Scheduled' || chipText === 'Expired')) {
          return chipText;
        }
      }
      
      const allSpans = container.querySelectorAll('span');
      for (let span of Array.from(allSpans)) {
        const spanText = span.textContent?.trim();
        if (spanText === 'En Route to Customer' || spanText === 'Delivery Scheduled' || spanText === 'Expired') {
          if (span.classList.contains('MuiChip-label')) {
            return spanText;
          }
        }
      }
      
      return null;
    }, deliveryContainer, orderNumber);
    
    if (!status) {
      logMessage(`  ⚠ Could not find status chip for order ${orderNumber} in container, trying page-level search...`, 'WARNING');
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
 * Process delivery orders - DETECTION ONLY (no clicking)
 * Returns array of detected orders with: orderNumber, timeText, status
 * Uses the same extraction logic as processContinuousDeliveries
 */
async function detectDeliveries(page: puppeteer.Page): Promise<Array<{ orderNumber: string, timeText: string, status: string | null }>> {
  const results: Array<{ orderNumber: string, timeText: string, status: string | null }> = [];
  
  try {
    logMessage('Detecting deliveries (detection only, no clicking)...');
    
    // Mark and extract delivery data - same logic as processContinuousDeliveries
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
    
    // Extract delivery data - same logic as processContinuousDeliveries
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
    
    // Process each delivery to get status
    for (let i = 0; i < deliveryData.length; i++) {
      const delivery = deliveryData[i];
      if (!delivery || !delivery.timeText || !delivery.orderNumber) {
        logMessage(`Skipping delivery ${i + 1}/${deliveryData.length}: missing data`, 'WARNING');
        continue;
      }
      
      logMessage(`Detecting order ${i + 1}/${deliveryData.length}: ${delivery.orderNumber} (${delivery.timeText})`);
      
      try {
        // Get delivery status
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
        
        results.push({
          orderNumber: delivery.orderNumber,
          timeText: delivery.timeText,
          status: status
        });
        
        logMessage(`  ✓ Detected order ${delivery.orderNumber} (${delivery.timeText}, status: ${status || 'N/A'})`);
      } catch (error: any) {
        logMessage(`  ✗ Error processing order ${delivery.orderNumber}: ${error.message}`, 'ERROR');
        // Still add to results with null status
        results.push({
          orderNumber: delivery.orderNumber,
          timeText: delivery.timeText,
          status: null
        });
      }
    }
    
    logMessage(`\n✓ Finished detecting all ${deliveryData.length} order(s) in "Today" section`);
    
  } catch (error: any) {
    logMessage(`Error detecting deliveries: ${error.message}`, 'ERROR');
  }
  
  return results;
}

/**
 * Initialize log file for current execution
 * Creates a unique log file with timestamp for each execution
 */
function initializeLogFile(): string {
  try {
    const logDir = path.join(projectRoot, 'logs');
    
    if (!fileExists(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    
    const now = new Date();
    // Format: YYYY-MM-DD_HH-MM-SS
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
    const logFile = path.join(logDir, `detected_orders_${dateStr}_${timeStr}.log`);
    
    // Write header to log file
    const header = `# Detection session started: ${now.toISOString()}\n`;
    writeFileSync(logFile, header, 'utf8');
    
    logMessage(`Log file initialized: ${path.basename(logFile)}`);
    return logFile;
  } catch (error: any) {
    logMessage(`Error initializing log file: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Log detection cycle header with total count and separator
 */
function logDetectionCycleHeader(totalOrders: number): void {
  try {
    if (!currentLogFile) {
      logMessage('Log file not initialized, initializing now...', 'WARNING');
      currentLogFile = initializeLogFile();
    }
    
    const timestamp = new Date().toISOString();
    const separator = '='.repeat(80);
    
    // Write separator, total count, and another separator
    const header = `\n${separator}\n# Total orders detected: ${totalOrders} | Timestamp: ${timestamp}\n${separator}\n`;
    
    appendFileSync(currentLogFile, header, 'utf8');
  } catch (error: any) {
    logMessage(`Error logging detection cycle header: ${error.message}`, 'ERROR');
  }
}

/**
 * Log detected order to file
 * Format: código, hora, estado actual
 */
function logDetectedOrder(orderNumber: string, timeText: string, status: string | null): void {
  try {
    if (!currentLogFile) {
      logMessage('Log file not initialized, initializing now...', 'WARNING');
      currentLogFile = initializeLogFile();
    }
    
    const timestamp = new Date().toISOString();
    const statusText = status || 'N/A';
    
    // Format: timestamp | código | hora | estado
    const logLine = `${timestamp} | ${orderNumber} | ${timeText} | ${statusText}\n`;
    
    appendFileSync(currentLogFile, logLine, 'utf8');
    
    logMessage(`  Logged order to file: ${orderNumber} | ${timeText} | ${statusText}`);
  } catch (error: any) {
    logMessage(`Error logging detected order ${orderNumber}: ${error.message}`, 'ERROR');
  }
}

/**
 * Main detection-only function
 */
async function testDetectionOnly(): Promise<void> {
  const config = loadConfig();
  browserPool = new BrowserPool(config);
  
  // Initialize log file for this execution
  currentLogFile = initializeLogFile();
  
  logMessage('Starting continuous delivery detection (detection only, no clicking)...');
  logMessage(`Check interval: 60 seconds (1 minute)`);
  
  // Initialize browser
  const browserResult = await initBrowser(config.task.url, 'detection-only');
  
  if (browserResult.error || !browserResult.browser || !browserResult.page || !browserResult.profile) {
    logMessage(`Failed to initialize browser: ${browserResult.error}`, 'ERROR');
    return;
  }
  
  const browser = browserResult.browser;
  const page = browserResult.page;
  const profile = browserResult.profile;
  
  try {
    // Main loop - check every minute
    while (true) {
      logMessage('\n=== Starting new detection cycle ===');
      
      // Step 1: Navigate to /deliveries page
      logMessage('Navigating to /deliveries page...');
      const onDeliveriesPage = await ensureOnDeliveriesPage(page);
      if (!onDeliveriesPage) {
        logMessage('Could not navigate to deliveries page, skipping this cycle', 'WARNING');
        logMessage('Waiting 60 seconds before next check...');
        await new Promise(resolve => setTimeout(resolve, 60000));
        continue;
      }
      logMessage('✓ Successfully navigated to /deliveries page');
      
      // Step 2: Check for "No Deliveries available" and reload up to 3 times if needed
      logMessage('Checking for "No Deliveries available"...');
      const hasNoDeliveries = await checkNoDeliveries(page);
      if (hasNoDeliveries) {
        logMessage('"No Deliveries available" detected, attempting to reload page (max 3 attempts)...');
        const deliveriesAvailable = await handleNoDeliveriesWithReload(page, 3);
        if (!deliveriesAvailable) {
          logMessage('No deliveries available after 3 reload attempts, skipping this cycle');
          logMessage('Waiting 60 seconds before next check...');
          await new Promise(resolve => setTimeout(resolve, 60000));
          continue;
        }
        logMessage('✓ Deliveries are now available after reload');
      } else {
        logMessage('✓ Deliveries are available');
      }
      
      // Step 3: Check for expired link
      const isExpired = await checkExpired(page);
      if (isExpired) {
        logMessage('Expired link detected, requesting new link...');
        if (config.task.phoneNumber) {
          await requestNewLink(page, config.task.phoneNumber);
          await waitRandomTime(1000, 2000);
          // After requesting new link, navigate back to deliveries page
          await ensureOnDeliveriesPage(page);
          await waitRandomTime(2000, 3000);
        }
      }
      
      // Step 4: Detect deliveries (no clicking)
      logMessage('Starting delivery detection...');
      const detectedOrders = await detectDeliveries(page);
      
      logMessage(`\n📊 Summary: Detected ${detectedOrders.length} order(s) in "Today" section`);
      
      // Log detection cycle header with total count and separator
      logDetectionCycleHeader(detectedOrders.length);
      
      // Log all detected orders
      for (const order of detectedOrders) {
        logDetectedOrder(order.orderNumber, order.timeText, order.status);
      }
      
      logMessage(`\n✓ Detection cycle completed. Logged ${detectedOrders.length} order(s) to log file.`);
      logMessage('Waiting 60 seconds before next detection cycle...');
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
  } catch (error: any) {
    logMessage(`Error in detection loop: ${error.message}`, 'ERROR');
    logMessage('Browser will remain open for inspection...', 'WARNING');
  }
  // Browser remains open - do not close automatically
  logMessage('Detection loop ended. Browser will remain open.');
}

// Run the test
testDetectionOnly().catch((error) => {
  logMessage(`Fatal error: ${error.message}`, 'ERROR');
  process.exit(1);
});

export { testDetectionOnly };
