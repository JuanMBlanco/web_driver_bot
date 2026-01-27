import { mkdirSync, writeFileSync, readFileSync, statSync, appendFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { launch } from 'puppeteer-core';
import puppeteer from 'puppeteer';
import yaml from 'js-yaml';
import type puppeteerTypes from 'puppeteer';

// API Response Interfaces
interface ApiOrderResponse {
  StatusCode: number;
  Code: string;
  Message: string;
  Mark: string;
  LogId: string | null;
  IsError: boolean;
  Errors: any[];
  Warnings: any[];
  Meta: {
    Server: {
      Date: string;
      Time: string;
      DateOffSet: string;
      TimeZone: string;
      TimeZoneAbbr: string;
    };
  };
  Count: number;
  Data: ApiOrder[];
}

interface ApiOrder {
  Id: string;
  ShortId: string;
  BusinessKindCode: number;
  SaleOrderId: string | null;
  DriverRouteId: string | null;
  PickupAt: string;
  DeliveryAt: string;
  DeliveryZoneId: string;
  OriginId: string;
  DestinationId: string;
  UserId: string;
  UserIdAt: string;
  StatusSequence: number;
  StatusCode: number;
  StatusDescription: string;
  RoutePriority: number;
  Latitude: string;
  Longitude: string;
  Comment: string;
  Tag: string;
  CanceledBy: string | null;
  CanceledAt: string | null;
  CreatedBy: string;
  CreatedAt: string;
  UpdatedBy: string;
  UpdatedAt: string;
  DisabledBy: string | null;
  DisabledAt: string | null;
  Business: {
    Ticket: string;
    Fixed?: any;
    EMailId?: string[];
  };
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
  // This creates a Date in local timezone but with EST time values
  // For comparison with delivery times (which are also in EST), this works correctly
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
 * Parse ISO datetime string (e.g., "2026-01-26T08:00:00.000-05:00") and convert to Date object
 */
function parseISODeliveryTime(isoString: string): Date | null {
  try {
    return new Date(isoString);
  } catch (error) {
    return null;
  }
}

/**
 * Format Date to time string like "12:00 PM"
 */
function formatDeliveryTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const minutesStr = String(minutes).padStart(2, '0');
  return `${hours12}:${minutesStr} ${period}`;
}

/**
 * Detect order tickets from the page DOM - ONLY from "Today" section
 */
async function detectOrderTicketsFromPage(page: puppeteer.Page): Promise<string[]> {
  try {
    const tickets = await page.evaluate(() => {
      // Find "Today" section first
      const h2Elements = Array.from(document.querySelectorAll('h2'));
      const todayH2 = h2Elements.find(h2 => {
        const text = h2.textContent?.trim();
        return text === 'Today';
      });
      
      if (!todayH2) {
        return [];
      }
      
      // Find the container for "Today" section
      let todayContainer: HTMLElement | null = null;
      let container = todayH2.parentElement;
      while (container && container !== document.body) {
        if (container.firstElementChild === todayH2) {
          todayContainer = container as HTMLElement;
          break;
        }
        container = container.parentElement;
      }
      
      if (!todayContainer) {
        return [];
      }
      
      // Only search for ticket elements within "Today" section
      const ticketElements = Array.from(todayContainer.querySelectorAll('div.ez-7crqac'));
      const foundTickets: string[] = [];
      
      for (const element of ticketElements) {
        const text = element.textContent?.trim();
        if (text && text.startsWith('#')) {
          // Extract ticket code (e.g., "#321-R4M" -> "321-R4M")
          const ticketCode = text.substring(1);
          if (ticketCode && !foundTickets.includes(ticketCode)) {
            foundTickets.push(ticketCode);
          }
        }
      }
      
      return foundTickets;
    });
    
    logMessage(`Detected ${tickets.length} order ticket(s) from "Today" section: ${tickets.join(', ')}`);
    return tickets;
  } catch (error: any) {
    logMessage(`Error detecting tickets from page: ${error.message}`, 'ERROR');
    return [];
  }
}

/**
 * Get order time from page for a specific order - ONLY search within "Today" section
 * Returns the time text (e.g., "11:30 AM EST") and parsed Date, or null if not found
 */
async function getOrderTimeFromPage(page: puppeteer.Page, orderNumber: string): Promise<{ timeText: string, parsedDate: Date } | null> {
  try {
    const result = await page.evaluate((orderNum) => {
      // Find "Today" section first
      const h2Elements = Array.from(document.querySelectorAll('h2'));
      const todayH2 = h2Elements.find(h2 => {
        const text = h2.textContent?.trim();
        return text === 'Today';
      });
      
      if (!todayH2) {
        return { timeText: '', found: false };
      }
      
      // Find the container for "Today" section
      let todayContainer: HTMLElement | null = null;
      let container = todayH2.parentElement;
      while (container && container !== document.body) {
        if (container.firstElementChild === todayH2) {
          todayContainer = container as HTMLElement;
          break;
        }
        container = container.parentElement;
      }
      
      if (!todayContainer) {
        return { timeText: '', found: false };
      }
      
      // Only search for order containers within "Today" section
      const allContainers = Array.from(todayContainer.querySelectorAll('div.ez-1h5x3dy'));
      for (const container of allContainers) {
        const orderDiv = container.querySelector('div.ez-7crqac');
        if (orderDiv && orderDiv.textContent?.trim() === orderNum) {
          // Look for time spans in this container
          const allSpans = container.querySelectorAll('span');
          for (const span of Array.from(allSpans)) {
            const timeText = span.textContent?.trim() || '';
            // Match time format like "11:30 AM EST" or "11:30 AM"
            if (timeText.match(/\d{1,2}:\d{2}\s*(AM|PM)/i)) {
              return { timeText: timeText, found: true };
            }
          }
        }
      }
      return { timeText: '', found: false };
    }, orderNumber);
    
    if (!result.found || !result.timeText) {
      logMessage(`  ⚠ Could not find time for order ${orderNumber} on page`, 'WARNING');
      return null;
    }
    
    // Parse the time text
    const parsed = parseDeliveryTime(result.timeText);
    if (!parsed.parsed) {
      logMessage(`  ⚠ Could not parse time "${result.timeText}" for order ${orderNumber}`, 'WARNING');
      return null;
    }
    
    return {
      timeText: result.timeText,
      parsedDate: parsed.parsed
    };
  } catch (error: any) {
    logMessage(`  ✗ Error getting time from page for order ${orderNumber}: ${error.message}`, 'ERROR');
    return null;
  }
}

/**
 * Get today's date in YYYY-MM-DD format (EST timezone)
 */
function getTodayDateEST(): string {
  const now = new Date();
  const estFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  return estFormatter.format(now);
}

/**
 * Split array into chunks of specified size
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Extract ticket from Business.Ticket field using regex
 * The field may contain: #XXX-XXX, XXX-XXX, or other text with the pattern
 * Returns the ticket code in format XXX-XXX (without #), or null if not found
 */
function extractTicketFromApiResponse(ticketField: string | null | undefined): string | null {
  if (!ticketField) {
    return null;
  }
  
  // Convert to string and trim
  const ticketStr = String(ticketField).trim();
  
  if (!ticketStr) {
    return null;
  }
  
  // Strategy 1: Try to match pattern with # at the beginning: #XXX-XXX
  // Example: #8AR-13R
  let match = ticketStr.match(/#([A-Z0-9]+-[A-Z0-9]+)/i);
  if (match && match[1]) {
    return match[1].toUpperCase(); // Return XXX-XXX in uppercase
  }
  
  // Strategy 2: Try to match pattern without #: XXX-XXX
  // Example: 8AR-13R
  match = ticketStr.match(/([A-Z0-9]+-[A-Z0-9]+)/i);
  if (match && match[1]) {
    return match[1].toUpperCase(); // Return XXX-XXX in uppercase
  }
  
  // Strategy 3: Try to find any pattern that looks like XXX-XXX anywhere in the string
  // This handles cases where there might be extra text before or after
  const allMatches = ticketStr.match(/([A-Z0-9]{2,}-[A-Z0-9]{2,})/gi);
  if (allMatches && allMatches.length > 0) {
    // Return the first match that looks like a valid ticket (at least 2 chars on each side of dash)
    return allMatches[0].toUpperCase();
  }
  
  return null;
}

/**
 * Escape special characters in ticket code for SQL LIKE clause
 * Escapes single quotes by doubling them (SQL standard)
 * Escapes LIKE wildcards (% and _) by prefixing with backslash
 * This prevents SQL reserved words and special characters from breaking the query
 * Note: We use ESCAPE '\\' in the LIKE clause to handle % and _ as literals
 */
function escapeTicketForSQL(ticket: string): string {
  let escaped = ticket;
  
  // Escape backslashes FIRST before escaping other characters
  escaped = escaped.replace(/\\/g, '\\\\');
  
  // Escape single quotes by doubling them (SQL standard)
  // This prevents SQL injection and syntax errors
  escaped = escaped.replace(/'/g, "''");
  
  // Escape LIKE wildcards (% and _) by prefixing with backslash
  // We use ESCAPE '\\' in the LIKE clause, so these will be treated as literals
  escaped = escaped.replace(/%/g, '\\%');
  escaped = escaped.replace(/_/g, '\\_');
  
  return escaped;
}

/**
 * Get order count from API with proper headers and parameters
 * Makes a single API call with all tickets
 */
async function getOrderCount(orderTickets: string[]): Promise<number | null> {
  try {
    const baseUrl = 'https://kk-usa-fl-prod01-odin-v2-op.odindt.com/api/v1/business/dev007/dispatcher/delivery/order/search/count';
    const todayDate = getTodayDateEST();
    
    logMessage(`Making single API call with ${orderTickets.length} ticket(s)`);
    
    // Build WHERE clause with all tickets in a single call
    // Use date range: >= today AND < tomorrow to include all deliveries for today
    let whereClause = `(A.DeliveryAt >= '${todayDate}') AND (A.DeliveryAt < '${todayDate}' + INTERVAL 1 day) AND E.Canceled = 0 AND A.BusinessKindCode = 300 AND E.Canceled = 0`;
    
    // Add ExtraData LIKE for each ticket (with % wildcards)
    // Escape special characters in tickets to prevent SQL syntax errors
    if (orderTickets.length > 0) {
      const extraDataConditions = orderTickets.map(ticket => {
        const escapedTicket = escapeTicketForSQL(ticket);
        // Use CONCAT to build the LIKE pattern to avoid % in the string itself
        // This prevents URL encoding issues with % characters
        return `A.ExtraData LIKE CONCAT('%', '${escapedTicket}', '%')`;
      }).join(' OR ');
      whereClause += ` AND (${extraDataConditions})`;
    }
    
    // Build query parameters manually to avoid URLSearchParams decoding issues
    // Use encodeURIComponent for where clause to properly encode %25 sequences
    const encodedWhere = encodeURIComponent(whereClause);
    const countUrl = `${baseUrl}?where=${encodedWhere}&offset=0&limit=200`;
    
    const response = await fetch(countUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'p:f6797849-d5df-43c4-8349-2326875571e7',
        'FrontendId': 'ccc1',
        'TimeZoneId': 'America/Los_Angeles',
        'Language': 'en_US'
      }
    });

    if (!response.ok) {
      let errorBody = '';
      try {
        const errorText = await response.text();
        errorBody = errorText;
        logMessage(`Failed to get order count: ${response.status} ${response.statusText}`, 'ERROR');
        logMessage(`Error response body: ${errorBody}`, 'ERROR');
      } catch (e) {
        logMessage(`Failed to get order count: ${response.status} ${response.statusText}`, 'ERROR');
      }
      return null;
    }

    const data = await response.json() as ApiOrderResponse;
    
    if (data.IsError) {
      logMessage(`API returned error: ${data.Message}`, 'ERROR');
      return null;
    }

    logMessage(`Order count: ${data.Count}`);
    return data.Count;
  } catch (error: any) {
    logMessage(`Error getting order count: ${error.message}`, 'ERROR');
    return null;
  }
}

/**
 * Get orders from API with pagination support and proper headers/parameters
 * Makes a single API call with all tickets
 */
async function getOrdersFromAPI(orderTickets: string[], offset: number = 0, limit: number = 200): Promise<ApiOrder[] | null> {
  try {
    const baseUrl = 'https://kk-usa-fl-prod01-odin-v2-op.odindt.com/api/v1/business/dev007/dispatcher/delivery/order/search';
    const todayDate = getTodayDateEST();
    
    logMessage(`Making single API call with ${orderTickets.length} ticket(s)`);
    
    // Build WHERE clause with all tickets in a single call
    // Use date range: >= today AND < tomorrow to include all deliveries for today
    let whereClause = `(A.DeliveryAt >= '${todayDate}') AND (A.DeliveryAt < '${todayDate}' + INTERVAL 1 day) AND E.Canceled = 0 AND A.BusinessKindCode = 300 AND E.Canceled = 0`;
    
    // Add ExtraData LIKE for each ticket (with % wildcards)
    // Escape special characters in tickets to prevent SQL syntax errors
    if (orderTickets.length > 0) {
      const extraDataConditions = orderTickets.map(ticket => {
        const escapedTicket = escapeTicketForSQL(ticket);
        // Use CONCAT to build the LIKE pattern to avoid % in the string itself
        // This prevents URL encoding issues with % characters
        return `A.ExtraData LIKE CONCAT('%', '${escapedTicket}', '%')`;
      }).join(' OR ');
      whereClause += ` AND (${extraDataConditions})`;
    }
    
    // Build query parameters manually to avoid URLSearchParams decoding issues
    // Use encodeURIComponent for where clause to properly encode %25 sequences
    const encodedWhere = encodeURIComponent(whereClause);
    const searchUrl = `${baseUrl}?where=${encodedWhere}&offset=${offset}&limit=${limit}`;
    
    const response = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'p:f6797849-d5df-43c4-8349-2326875571e7',
        'FrontendId': 'ccc1',
        'TimeZoneId': 'America/Los_Angeles',
        'Language': 'en_US'
      }
    });

    if (!response.ok) {
      let errorBody = '';
      try {
        const errorText = await response.text();
        errorBody = errorText;
        logMessage(`Failed to get orders: ${response.status} ${response.statusText}`, 'ERROR');
        logMessage(`Error response body: ${errorBody}`, 'ERROR');
      } catch (e) {
        logMessage(`Failed to get orders: ${response.status} ${response.statusText}`, 'ERROR');
      }
      return null;
    }

    const data = await response.json() as ApiOrderResponse;
    
    if (data.IsError) {
      logMessage(`API returned error: ${data.Message}`, 'ERROR');
      return null;
    }

    logMessage(`Retrieved ${data.Data.length} orders (total count: ${data.Count})`);
    
    // Remove duplicates based on order ID
    const uniqueOrders = new Map<string, ApiOrder>();
    for (const order of data.Data) {
      const orderId = order.Id || order.ShortId || '';
      if (orderId && !uniqueOrders.has(orderId)) {
        uniqueOrders.set(orderId, order);
      }
    }
    
    const finalOrders = Array.from(uniqueOrders.values());
    logMessage(`Total unique orders retrieved: ${finalOrders.length}`);
    return finalOrders;
  } catch (error: any) {
    logMessage(`Error getting orders from API: ${error.message}`, 'ERROR');
    return null;
  }
}

/**
 * Get all orders from API with automatic pagination
 * Requires orderTickets to build the WHERE clause
 */
async function getAllOrdersFromAPI(orderTickets: string[]): Promise<ApiOrder[]> {
  const allOrders: ApiOrder[] = [];
  
  try {
    // First, get the count
    const count = await getOrderCount(orderTickets);
    
    if (count === null) {
      logMessage('Could not get order count, attempting to fetch orders anyway...', 'WARNING');
    } else {
      logMessage(`Total orders to fetch: ${count}`);
    }
    
    const limit = 200;
    let currentOffset = 0;
    let hasMore = true;
    
    while (hasMore) {
      const orders = await getOrdersFromAPI(orderTickets, currentOffset, limit);
      
      if (!orders || orders.length === 0) {
        hasMore = false;
        break;
      }
      
      allOrders.push(...orders);
      logMessage(`Fetched offset ${currentOffset}: ${orders.length} orders (total so far: ${allOrders.length})`);
      
      // If we got fewer orders than limit, we've reached the end
      if (orders.length < limit) {
        hasMore = false;
      } else {
        currentOffset += limit;
        // Small delay between requests to avoid overwhelming the API
        await waitRandomTime(500, 1000);
      }
      
      // Safety check: if count was provided and we've fetched that many, stop
      if (count !== null && allOrders.length >= count) {
        hasMore = false;
      }
    }
    
    logMessage(`Total orders fetched from API: ${allOrders.length}`);
    return allOrders;
  } catch (error: any) {
    logMessage(`Error fetching all orders from API: ${error.message}`, 'ERROR');
    return allOrders; // Return what we have so far
  }
}

/**
 * Map API order status to our status format
 */
function mapApiStatusToDeliveryStatus(apiOrder: ApiOrder): string | null {
  // Map StatusDescription to our expected statuses
  const statusDescription = apiOrder.StatusDescription || '';
  
  if (statusDescription === 'En Route to Customer') {
    return 'En Route to Customer';
  } else if (statusDescription === 'Delivery Scheduled') {
    return 'Delivery Scheduled';
  } else if (statusDescription === 'Finished' || statusDescription === 'Expired') {
    return 'Expired';
  }
  
  // Return the status description as-is if it doesn't match known statuses
  return statusDescription || null;
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
    
    // Wait a bit for page to be ready
    await waitRandomTime(1000, 2000);
    
    // Find input field with multiple strategies
    let inputHandle: puppeteerTypes.ElementHandle<HTMLInputElement> | null = null;
    
    // Strategy 1: Find by placeholder and radix- attributes
    try {
      inputHandle = await page.waitForSelector(
        'input[type="text"][placeholder="Enter your phone number"][name^="radix-"]',
        { timeout: 5000 }
      ) as puppeteerTypes.ElementHandle<HTMLInputElement> | null;
    } catch (e) {
      // Try strategy 2
    }
    
    // Strategy 2: Find by placeholder and id with radix-
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
    
    // Strategy 3: Find by placeholder only (fallback)
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
    
    // Focus and type phone number
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
 * Get delivery status for a specific order container
 * Specifically looks for:
 * - <span class="MuiChip-label EzChip-label MuiChip-labelMedium ez-14vsv3w">En Route to Customer</span>
 * - <span class="MuiChip-label EzChip-label MuiChip-labelMedium ez-14vsv3w">Delivery Scheduled</span>
 * - <span class="MuiChip-label EzChip-label MuiChip-labelMedium ez-14vsv3w">Expired</span>
 * All within: <div data-testid="delivery-status-text">
 */
async function getDeliveryStatus(page: puppeteer.Page, deliveryContainer: HTMLElement, orderNumber: string): Promise<string | null> {
  try {
    // First, verify the container is valid by checking if it's an element
    const isValidContainer = await page.evaluate((container) => {
      return container && typeof container.querySelectorAll === 'function';
    }, deliveryContainer);
    
    if (!isValidContainer) {
      logMessage(`  ⚠ Container for order ${orderNumber} is not a valid DOM element, using page-level search`, 'WARNING');
      // Fall back to page-level search
      return await getDeliveryStatusFromPage(page, orderNumber);
    }
    
    const status = await page.evaluate((container, orderNum) => {
      // Verify container is valid
      if (!container || typeof container.querySelectorAll !== 'function') {
        return null;
      }
      
      // Strategy 1: Look for status in data-testid="delivery-status-text" div (most reliable)
      const statusDiv = container.querySelector('div[data-testid="delivery-status-text"]');
      if (statusDiv) {
        const chip = statusDiv.querySelector('span.MuiChip-label.EzChip-label.MuiChip-labelMedium.ez-14vsv3w');
        if (chip) {
          const chipText = chip.textContent?.trim();
          if (chipText === 'En Route to Customer' || chipText === 'Delivery Scheduled' || chipText === 'Expired') {
            return chipText;
          }
        }
        
        // Try with more flexible selector in status div
        const allChipsInStatus = statusDiv.querySelectorAll('span.MuiChip-label');
        for (let chip of Array.from(allChipsInStatus)) {
          const chipText = chip.textContent?.trim();
          if (chipText === 'En Route to Customer' || chipText === 'Delivery Scheduled' || chipText === 'Expired') {
            return chipText;
          }
        }
      }
      
      // Strategy 2: Find status chips within this container
      // Specifically looking for: <span class="MuiChip-label EzChip-label MuiChip-labelMedium ez-14vsv3w">
      const chips = container.querySelectorAll('span.MuiChip-label.EzChip-label.MuiChip-labelMedium.ez-14vsv3w');
      
      for (let chip of Array.from(chips)) {
        const chipText = chip.textContent?.trim();
        // Check for specific statuses, especially "Delivery Scheduled" for parameter 2
        if (chipText === 'En Route to Customer' || chipText === 'Delivery Scheduled' || chipText === 'Expired') {
          return chipText;
        }
      }
      
      // Strategy 3: Also try with more flexible selector in case classes vary slightly
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
      
      // Strategy 4: Try even more flexible: search for any span with MuiChip-label that contains the status text
      const allSpans = container.querySelectorAll('span');
      for (let span of Array.from(allSpans)) {
        const spanText = span.textContent?.trim();
        if (spanText === 'En Route to Customer' || spanText === 'Delivery Scheduled' || spanText === 'Expired') {
          // Check if it has MuiChip-label class
          if (span.classList.contains('MuiChip-label')) {
            return spanText;
          }
        }
      }
      
      return null;
    }, deliveryContainer, orderNumber);
    
    if (!status) {
      logMessage(`  ⚠ Could not find status chip for order ${orderNumber} in container, trying page-level search...`, 'WARNING');
      // Try page-level search
      const broaderStatus = await getDeliveryStatusFromPage(page, orderNumber);
      if (broaderStatus) {
        return broaderStatus;
      }
    }
    
    return status;
  } catch (error: any) {
    logMessage(`  ✗ Error getting status for order ${orderNumber}: ${error.message}`, 'ERROR');
    // Fall back to page-level search on error
    return await getDeliveryStatusFromPage(page, orderNumber);
  }
}

/**
 * Get delivery status by searching the entire page for the order
 */
async function getDeliveryStatusFromPage(page: puppeteer.Page, orderNumber: string): Promise<string | null> {
  try {
    const status = await page.evaluate((orderNum) => {
      // Find the order container by order number
      const allContainers = Array.from(document.querySelectorAll('div.ez-1h5x3dy'));
      for (const container of allContainers) {
        const orderDiv = container.querySelector('div.ez-7crqac');
        if (orderDiv && orderDiv.textContent?.trim() === orderNum) {
          // Strategy 1: Look for status in data-testid="delivery-status-text" div
          const statusDiv = container.querySelector('div[data-testid="delivery-status-text"]');
          if (statusDiv) {
            const chip = statusDiv.querySelector('span.MuiChip-label.EzChip-label.MuiChip-labelMedium.ez-14vsv3w');
            if (chip) {
              const chipText = chip.textContent?.trim();
              if (chipText === 'En Route to Customer' || chipText === 'Delivery Scheduled' || chipText === 'Expired') {
                return chipText;
              }
            }
            
            // Try with more flexible selector in status div
            const allChipsInStatus = statusDiv.querySelectorAll('span.MuiChip-label');
            for (let chip of Array.from(allChipsInStatus)) {
              const chipText = chip.textContent?.trim();
              if (chipText === 'En Route to Customer' || chipText === 'Delivery Scheduled' || chipText === 'Expired') {
                return chipText;
              }
            }
          }
          
          // Strategy 2: Search for status chips in the entire container
          const chips = container.querySelectorAll('span.MuiChip-label.EzChip-label.MuiChip-labelMedium.ez-14vsv3w');
          for (let chip of Array.from(chips)) {
            const chipText = chip.textContent?.trim();
            if (chipText === 'En Route to Customer' || chipText === 'Delivery Scheduled' || chipText === 'Expired') {
              return chipText;
            }
          }
          
          // Strategy 3: Try with more flexible selector
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
 * Process delivery orders with continuous monitoring logic
 * V3: Uses API instead of DOM extraction
 */
async function processContinuousDeliveries(page: puppeteer.Page): Promise<Array<{ orderNumber: string, timeText: string, status: string | null, shouldClick: boolean, reason: string, actionType: 'param1' | 'param2' | 'rule3' | null }>> {
  const results: Array<{ orderNumber: string, timeText: string, status: string | null, shouldClick: boolean, reason: string, actionType: 'param1' | 'param2' | 'rule3' | null }> = [];
  
  try {
    logMessage('Processing deliveries for continuous monitoring (using API)...');
    
    // Get current time - convert to EST (this is the time used for all comparisons)
    const currentTime = getCurrentTimeEST();
    const currentTimeMs = currentTime.getTime();
    
    logMessage(`Current time (EST - used for comparisons): ${currentTime.toLocaleTimeString()}`);
    logMessage(`Current time (EST) in milliseconds: ${currentTimeMs}`);
    logMessage(`Note: Both Param1 and Param2 will be calculated per order based on each order's delivery time`);
    
    // First, detect order tickets from the page
    logMessage('Detecting order tickets from page...');
    const orderTickets = await detectOrderTicketsFromPage(page);
    
    if (orderTickets.length === 0) {
      logMessage('No order tickets detected from page, skipping API call', 'WARNING');
      return results;
    }
    
    // Get all orders from API using detected tickets
    const apiOrders = await getAllOrdersFromAPI(orderTickets);
    
    if (!apiOrders || apiOrders.length === 0) {
      logMessage('No orders found from API', 'WARNING');
      return results;
    }
    
    logMessage(`Found ${apiOrders.length} order(s) from API`);
    
    // Create a Set of order tickets found in API for quick lookup
    const apiOrderTickets = new Set<string>();
    for (const apiOrder of apiOrders) {
      const ticket = extractTicketFromApiResponse(apiOrder.Business?.Ticket);
      if (ticket) {
        apiOrderTickets.add(ticket);
      }
    }
    
    // Find orders that are on the page but not in the API
    const missingOrders: string[] = [];
    for (const ticket of orderTickets) {
      if (!apiOrderTickets.has(ticket)) {
        missingOrders.push(ticket);
      }
    }
    
    if (missingOrders.length > 0) {
      logMessage(`Found ${missingOrders.length} order(s) on page but not in API: ${missingOrders.map(t => `#${t}`).join(', ')}`);
      logMessage(`  Processing missing orders with fallback (using page time)...`);
    }
    
    // Process each order from API
    for (let i = 0; i < apiOrders.length; i++) {
      const apiOrder = apiOrders[i];
      
      try {
        // Extract ticket from Business.Ticket field using regex (returns XXX-XXX format)
        const extractedTicket = extractTicketFromApiResponse(apiOrder.Business?.Ticket);
        // Add # prefix to create orderNumber (format: #XXX-XXX)
        const orderNumber = extractedTicket ? `#${extractedTicket}` : `#${apiOrder.ShortId || apiOrder.Id}`;
        
        // Parse DeliveryAt and PickupAt times
        const deliveryAtDate = parseISODeliveryTime(apiOrder.DeliveryAt);
        const pickupAtDate = parseISODeliveryTime(apiOrder.PickupAt);
        
        if (!deliveryAtDate) {
          logMessage(`  Could not parse DeliveryAt time: ${apiOrder.DeliveryAt}`, 'WARNING');
          results.push({
            orderNumber: orderNumber,
            timeText: apiOrder.DeliveryAt,
            status: null,
            shouldClick: false,
            reason: 'Could not parse DeliveryAt time',
            actionType: null
          });
          continue;
        }
        
        if (!pickupAtDate) {
          logMessage(`  Could not parse PickupAt time: ${apiOrder.PickupAt}`, 'WARNING');
          results.push({
            orderNumber: orderNumber,
            timeText: apiOrder.DeliveryAt,
            status: null,
            shouldClick: false,
            reason: 'Could not parse PickupAt time',
            actionType: null
          });
          continue;
        }
        
        // Format time text using DeliveryAt
        const timeText = formatDeliveryTime(deliveryAtDate);
        
        logMessage(`Reviewing order ${i + 1}/${apiOrders.length}: ${orderNumber} (${timeText})`);
        logMessage(`  📡 Using API data for this order`);
        logMessage(`  DeliveryAt: ${deliveryAtDate.toLocaleTimeString()}`);
        logMessage(`  PickupAt: ${pickupAtDate.toLocaleTimeString()}`);
        
        // Get delivery status from page - ONLY search within "Today" section
        // TEMPORARILY: Status check is disabled for testing
        let status: string | null = null;
        try {
          const deliveryItemHandle = await page.evaluateHandle((orderNum) => {
            // Find "Today" section first
            const h2Elements = Array.from(document.querySelectorAll('h2'));
            const todayH2 = h2Elements.find(h2 => {
              const text = h2.textContent?.trim();
              return text === 'Today';
            });
            
            if (!todayH2) return null;
            
            // Find the container for "Today" section
            let todayContainer: HTMLElement | null = null;
            let container = todayH2.parentElement;
            while (container && container !== document.body) {
              if (container.firstElementChild === todayH2) {
                todayContainer = container as HTMLElement;
                break;
              }
              container = container.parentElement;
            }
            
            if (!todayContainer) return null;
            
            // Only search for order containers within "Today" section
            const allDeliveryContainers = Array.from(todayContainer.querySelectorAll('div.ez-1h5x3dy'));
            for (const container of allDeliveryContainers) {
              const orderDiv = container.querySelector('div.ez-7crqac');
              if (orderDiv && orderDiv.textContent?.trim() === orderNum) {
                return container as HTMLElement;
              }
            }
            return null;
          }, orderNumber);
          
          const itemValue = await deliveryItemHandle.jsonValue();
          
          if (itemValue) {
            status = await getDeliveryStatus(page, itemValue as HTMLElement, orderNumber);
            if (status) {
              logMessage(`  ✓ Found status "${status}" for order ${orderNumber}`);
            } else {
              logMessage(`  ⚠ Status not found for order ${orderNumber}`, 'WARNING');
            }
          } else {
            logMessage(`  ⚠ Could not find delivery container for order ${orderNumber}`, 'WARNING');
          }
          
          await deliveryItemHandle.dispose();
        } catch (statusError: any) {
          logMessage(`  Error getting status for ${orderNumber}: ${statusError.message}`, 'WARNING');
          // Continue processing even if status couldn't be retrieved
        }
        
        // SKIP if status is not "Delivery Scheduled" or "En Route to Customer"
        if (status !== 'Delivery Scheduled' && status !== 'En Route to Customer') {
          logMessage(`  ⏭ SKIPPING order ${orderNumber} - Status is "${status || 'Unknown'}" (must be "Delivery Scheduled" or "En Route to Customer")`);
          results.push({
            orderNumber: orderNumber,
            timeText: timeText,
            status: status,
            shouldClick: false,
            reason: `Status is "${status || 'Unknown'}" (must be "Delivery Scheduled" or "En Route to Customer")`,
            actionType: null
          });
          continue;
        }
        
        // Parse times for comparison
        const deliveryTime = deliveryAtDate;
        const deliveryTimeMs = deliveryTime.getTime();
        const pickupTime = pickupAtDate;
        const pickupTimeMs = pickupTime.getTime();
        
        // Calculate time comparisons
        const currentTimeMs = currentTime.getTime();
        
        // Log time comparison details for debugging (using EST time)
        const timeDiffMs = deliveryTimeMs - currentTimeMs;
        const timeDiffMinutes = Math.floor(timeDiffMs / (1000 * 60));
        logMessage(`  Time comparison (EST): Delivery=${deliveryTime.toLocaleTimeString()}, Current=${currentTime.toLocaleTimeString()}, Diff=${timeDiffMinutes} min`);
        
        // Check if should click based on rules (with status checks)
        let shouldClick = false;
        let reason = '';
        let actionType: 'param1' | 'param2' | 'rule3' | null = null;
        
        // Calculate parameter 1 based on DeliveryAt time
        // Parameter 1: (deliveryTime - 3 minutes) to (deliveryTime + 3 minutes)
        // Then check if current time is within this range
        const param1Start = new Date(deliveryTimeMs - 3 * 60 * 1000);
        const param1End = new Date(deliveryTimeMs + 3 * 60 * 1000);
        const inParam1 = currentTimeMs >= param1Start.getTime() && currentTimeMs <= param1End.getTime();
        
        // Calculate parameter 2 based on PickupAt time
        // Parameter 2: (pickupTime - 3 minutes) to (pickupTime + 3 minutes)
        // Then check if current time is within this range
        const param2Start = new Date(pickupTimeMs - 3 * 60 * 1000);
        const param2End = new Date(pickupTimeMs + 3 * 60 * 1000);
        const inParam2 = currentTimeMs >= param2Start.getTime() && currentTimeMs <= param2End.getTime();
        
        const currentTimeGreater = currentTimeMs > deliveryTimeMs;
        
        logMessage(`  InParam1: ${inParam1}, InParam2: ${inParam2}, CurrentTimeGreater: ${currentTimeGreater}`);
        logMessage(`  Current time (EST): ${currentTime.toLocaleTimeString()} (${currentTimeMs})`);
        logMessage(`  Delivery time: ${deliveryTime.toLocaleTimeString()} (${deliveryTimeMs})`);
        logMessage(`  Pickup time: ${pickupTime.toLocaleTimeString()} (${pickupTimeMs})`);
        logMessage(`  Status: ${status}, InParam1: ${inParam1}, InParam2: ${inParam2}, CurrentTimeGreater: ${currentTimeGreater}`);
        logMessage(`  Param1 range (based on DeliveryAt): ${param1Start.toLocaleTimeString()} to ${param1End.toLocaleTimeString()}`);
        logMessage(`  Param2 range (based on PickupAt): ${param2Start.toLocaleTimeString()} to ${param2End.toLocaleTimeString()}`);
        
        // Rule 1: Orders in param1 range AND status is "En Route to Customer"
        if (inParam1 && status === 'En Route to Customer') {
          shouldClick = true;
          actionType = 'param1';
          reason = 'Param1 range AND En Route to Customer (verified element)';
          logMessage(`  ✓ Rule 1 matched: Order ${orderNumber} is in param1 range with "En Route to Customer" status`);
        }
        
        // Rule 2: Orders in param2 range AND status is "Delivery Scheduled"
        if (inParam2 && status === 'Delivery Scheduled') {
          shouldClick = true;
          actionType = 'param2';
          reason = 'Param2 range AND Delivery Scheduled (verified element)';
          logMessage(`  ✓ Rule 2 matched: Order ${orderNumber} is in param2 range with "Delivery Scheduled" status`);
        }
        
        // Rule 3: If order is in specified status AND delivery time < current time, mark for click
        // This applies to both "En Route to Customer" and "Delivery Scheduled"
        if ((status === 'En Route to Customer' || status === 'Delivery Scheduled') && currentTimeGreater) {
          // Only set rule3 if not already set by param1 or param2
          if (!shouldClick) {
            shouldClick = true;
            actionType = 'rule3';
            reason = `Delivery time < current time AND status is ${status}`;
            logMessage(`  ✓ Rule 3 matched: Order ${orderNumber} has passed current time with status "${status}"`);
          }
        }
        
        results.push({
          orderNumber: orderNumber,
          timeText: timeText,
          status: status, // Status from page
          shouldClick: shouldClick,
          reason: reason,
          actionType: actionType
        });
        
        if (shouldClick) {
          logMessage(`  ✓ Order ${orderNumber} (${timeText}) - WILL CLICK: ${reason}`);
        } else {
          logMessage(`  - Order ${orderNumber} (${timeText}) - SKIP: ${reason}`);
        }
      } catch (error: any) {
        logMessage(`  ✗ Error processing order from API: ${error.message}`, 'ERROR');
        // Still add to results so we know we reviewed it
        // Extract ticket from Business.Ticket field using regex (returns XXX-XXX format)
        const extractedTicket = extractTicketFromApiResponse(apiOrder.Business?.Ticket);
        // Add # prefix to create orderNumber (format: #XXX-XXX)
        const orderNumber = extractedTicket ? `#${extractedTicket}` : `#${apiOrder.ShortId || apiOrder.Id}`;
        results.push({
          orderNumber: orderNumber,
          timeText: apiOrder.DeliveryAt || 'Unknown',
          status: null,
          shouldClick: false,
          reason: `Error: ${error.message}`,
          actionType: null
        });
        // Continue with next order
      }
    }
    
    // Process orders that are on the page but not in the API (fallback)
    for (const missingTicket of missingOrders) {
      try {
        const orderNumber = `#${missingTicket}`;
        logMessage(`Processing missing order ${orderNumber} with fallback (using page time)...`);
        logMessage(`  🔄 Using FALLBACK (page data) for this order`);
        
        // Get time from page
        const pageTimeData = await getOrderTimeFromPage(page, orderNumber);
        if (!pageTimeData) {
          logMessage(`  ⚠ Could not get time from page for order ${orderNumber}, skipping`, 'WARNING');
          results.push({
            orderNumber: orderNumber,
            timeText: 'Unknown',
            status: null,
            shouldClick: false,
            reason: 'Could not get time from page',
            actionType: null
          });
          continue;
        }
        
        const pageTime = pageTimeData.parsedDate;
        const pageTimeMs = pageTime.getTime();
        const timeText = formatDeliveryTime(pageTime);
        
        logMessage(`  Order ${orderNumber} - Page time: ${timeText} (${pageTime.toLocaleTimeString()})`);
        
        // Get delivery status from page - ONLY search within "Today" section
        let status: string | null = null;
        try {
          const deliveryItemHandle = await page.evaluateHandle((orderNum) => {
            // Find "Today" section first
            const h2Elements = Array.from(document.querySelectorAll('h2'));
            const todayH2 = h2Elements.find(h2 => {
              const text = h2.textContent?.trim();
              return text === 'Today';
            });
            
            if (!todayH2) return null;
            
            // Find the container for "Today" section
            let todayContainer: HTMLElement | null = null;
            let container = todayH2.parentElement;
            while (container && container !== document.body) {
              if (container.firstElementChild === todayH2) {
                todayContainer = container as HTMLElement;
                break;
              }
              container = container.parentElement;
            }
            
            if (!todayContainer) return null;
            
            // Only search for order containers within "Today" section
            const allDeliveryContainers = Array.from(todayContainer.querySelectorAll('div.ez-1h5x3dy'));
            for (const container of allDeliveryContainers) {
              const orderDiv = container.querySelector('div.ez-7crqac');
              if (orderDiv && orderDiv.textContent?.trim() === orderNum) {
                return container as HTMLElement;
              }
            }
            return null;
          }, orderNumber);
          
          const itemValue = await deliveryItemHandle.jsonValue();
          
          if (itemValue) {
            status = await getDeliveryStatus(page, itemValue as HTMLElement, orderNumber);
            if (status) {
              logMessage(`  ✓ Found status "${status}" for order ${orderNumber}`);
            } else {
              logMessage(`  ⚠ Status not found for order ${orderNumber}`, 'WARNING');
            }
          } else {
            logMessage(`  ⚠ Could not find delivery container for order ${orderNumber}`, 'WARNING');
          }
          
          await deliveryItemHandle.dispose();
        } catch (statusError: any) {
          logMessage(`  Error getting status for ${orderNumber}: ${statusError.message}`, 'WARNING');
        }
        
        // SKIP if status is not "Delivery Scheduled" or "En Route to Customer"
        if (status !== 'Delivery Scheduled' && status !== 'En Route to Customer') {
          logMessage(`  ⏭ SKIPPING order ${orderNumber} - Status is "${status || 'Unknown'}" (must be "Delivery Scheduled" or "En Route to Customer")`);
          results.push({
            orderNumber: orderNumber,
            timeText: timeText,
            status: status,
            shouldClick: false,
            reason: `Status is "${status || 'Unknown'}" (must be "Delivery Scheduled" or "En Route to Customer")`,
            actionType: null
          });
          continue;
        }
        
        // Calculate time comparisons
        const currentTimeMs = currentTime.getTime();
        
        // Param1: Use the page time (hora marcada)
        const param1Start = new Date(pageTimeMs - 3 * 60 * 1000);
        const param1End = new Date(pageTimeMs + 3 * 60 * 1000);
        const inParam1 = currentTimeMs >= param1Start.getTime() && currentTimeMs <= param1End.getTime();
        
        // Param2: Use page time - 20 minutes
        const param2Base = new Date(pageTimeMs - 20 * 60 * 1000);
        const param2Start = new Date(param2Base.getTime() - 3 * 60 * 1000);
        const param2End = new Date(param2Base.getTime() + 3 * 60 * 1000);
        const inParam2 = currentTimeMs >= param2Start.getTime() && currentTimeMs <= param2End.getTime();
        
        const currentTimeGreater = currentTimeMs > pageTimeMs;
        
        logMessage(`  Status: ${status}, InParam1: ${inParam1}, InParam2: ${inParam2}, CurrentTimeGreater: ${currentTimeGreater}`);
        logMessage(`  Current time (EST): ${currentTime.toLocaleTimeString()} (${currentTimeMs})`);
        logMessage(`  Page time: ${pageTime.toLocaleTimeString()} (${pageTimeMs})`);
        logMessage(`  Param1 range (based on page time): ${param1Start.toLocaleTimeString()} to ${param1End.toLocaleTimeString()}`);
        logMessage(`  Param2 range (based on page time - 20 min): ${param2Start.toLocaleTimeString()} to ${param2End.toLocaleTimeString()}`);
        
        // Check if should click based on rules (with status checks)
        let shouldClick = false;
        let reason = '';
        let actionType: 'param1' | 'param2' | 'rule3' | null = null;
        
        // Rule 1: Orders in param1 range AND status is "En Route to Customer"
        if (inParam1 && status === 'En Route to Customer') {
          shouldClick = true;
          actionType = 'param1';
          reason = 'Param1 range AND En Route to Customer (verified element - fallback)';
          logMessage(`  ✓ Rule 1 matched: Order ${orderNumber} is in param1 range with "En Route to Customer" status`);
        }
        
        // Rule 2: Orders in param2 range AND status is "Delivery Scheduled"
        if (inParam2 && status === 'Delivery Scheduled') {
          shouldClick = true;
          actionType = 'param2';
          reason = 'Param2 range AND Delivery Scheduled (verified element - fallback)';
          logMessage(`  ✓ Rule 2 matched: Order ${orderNumber} is in param2 range with "Delivery Scheduled" status`);
        }
        
        // Rule 3: If order is in specified status AND page time < current time, mark for click
        if ((status === 'En Route to Customer' || status === 'Delivery Scheduled') && currentTimeGreater) {
          if (!shouldClick) {
            shouldClick = true;
            actionType = 'rule3';
            reason = `Page time < current time AND status is ${status} (fallback)`;
            logMessage(`  ✓ Rule 3 matched: Order ${orderNumber} has passed page time with status "${status}"`);
          }
        }
        
        results.push({
          orderNumber: orderNumber,
          timeText: timeText,
          status: status, // Status from page
          shouldClick: shouldClick,
          reason: reason || 'No rules matched',
          actionType: actionType
        });
        
        if (shouldClick) {
          logMessage(`  ✓ Order ${orderNumber} (${timeText}) - WILL CLICK: ${reason}`);
        } else {
          logMessage(`  - Order ${orderNumber} (${timeText}) - SKIP: ${reason}`);
        }
      } catch (error: any) {
        logMessage(`  ✗ Error processing missing order ${missingTicket}: ${error.message}`, 'ERROR');
        results.push({
          orderNumber: `#${missingTicket}`,
          timeText: 'Unknown',
          status: null,
          shouldClick: false,
          reason: `Error: ${error.message}`,
          actionType: null
        });
      }
    }
    
    logMessage(`\n✓ Finished reviewing ${apiOrders.length} order(s) from API and ${missingOrders.length} missing order(s) with fallback`);
    
  } catch (error: any) {
    logMessage(`Error processing continuous deliveries: ${error.message}`, 'ERROR');
  }
  
  return results;
}

/**
 * Click a button by its text content
 * Based on test.js and test (1).js implementations
 * For "Delivery is done" button, uses specific selector: div.ez-7xofcs > button
 */
async function clickButtonByText(page: puppeteer.Page, buttonText: string, timeout: number = 10000): Promise<boolean> {
  try {
    logMessage(`  Looking for button: "${buttonText}"`);
    
    // Special handling for "I'm on my way" button with specific selector
    if (buttonText === "I'm on my way") {
      try {
        // Wait for the specific container and button
        await page.waitForSelector('div.ez-7xofcs button', { timeout });
        
        // Get the button handle using the specific selector
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
          // Get the bounding box
          const box = await (btnHandle as puppeteerTypes.ElementHandle<HTMLButtonElement>).boundingBox();
          
          if (box) {
            // Natural pause before clicking
            await waitRandomTime(1000, 1500);
            
            // Move mouse and click
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await waitRandomTime(500, 1000);
            await page.mouse.down();
            await page.mouse.up();
            
            logMessage(`  ✓ Successfully clicked button: "${buttonText}" (using specific selector)`);
            await btnHandle.dispose();
            return true;
          } else {
            // Fallback: click directly
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
        // Fall through to generic method below
      }
    }
    
    // Special handling for "Delivery is done" button with specific selector
    if (buttonText === "Delivery is done") {
      try {
        // Wait for the specific container and button
        await page.waitForSelector('div.ez-7xofcs button', { timeout });
        
        // Get the button handle using the specific selector
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
          // Get the bounding box
          const box = await (btnHandle as puppeteerTypes.ElementHandle<HTMLButtonElement>).boundingBox();
          
          if (box) {
            // Natural pause before clicking
            await waitRandomTime(1000, 1500);
            
            // Move mouse and click
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await waitRandomTime(500, 1000);
            await page.mouse.down();
            await page.mouse.up();
            
            logMessage(`  ✓ Successfully clicked button: "${buttonText}" (using specific selector)`);
            await btnHandle.dispose();
            return true;
          } else {
            // Fallback: click directly
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
        // Fall through to generic method below
      }
    }
    
    // Generic method for all buttons (including fallback for "Delivery is done")
    // Wait for button to appear
    await page.waitForFunction((text) => {
      return Array.from(document.querySelectorAll('button'))
        .some(btn => btn.textContent?.trim() === text);
    }, { timeout }, buttonText);
    
    // Get the button handle
    const btnHandle = await page.evaluateHandle((text) => {
      return Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent?.trim() === text);
    }, buttonText);
    
    const btnValue = await btnHandle.jsonValue();
    if (!btnValue) {
      logMessage(`  Button "${buttonText}" not found`, 'WARNING');
      return false;
    }
    
    // Get the bounding box
    const box = await (btnHandle as puppeteerTypes.ElementHandle<HTMLButtonElement>).boundingBox();
    
    if (box) {
      // Natural pause before clicking
      await waitRandomTime(1000, 1500);
      
      // Move mouse and click
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await waitRandomTime(500, 1000);
      await page.mouse.down();
      await page.mouse.up();
      
      logMessage(`  ✓ Successfully clicked button: "${buttonText}"`);
      await btnHandle.dispose();
      return true;
    } else {
      // Fallback: click directly
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
    
    // Natural pause to "read" the page
    await waitRandomTime(1000, 1500);
    
    return true;
  } catch (error: any) {
    logMessage(`  ⚠ Order ticket ${orderNumber} not found on page`, 'WARNING');
    return false;
  }
}

/**
 * Perform button actions on order page
 * Based on test.js and test (1).js implementations
 * @param fullProcess - If true, performs full process (I'm on my way, Delivery is done, Confirm)
 *                      If false, only clicks "I'm on my way"
 */
async function performOrderActions(page: puppeteer.Page, orderNumber: string, fullProcess: boolean = true): Promise<boolean> {
  try {
    logMessage(`  Performing actions for order ${orderNumber}...`);
    logMessage(`  Action type: ${fullProcess ? 'Full process' : 'Only "I\'m on my way"'}`);
    
    // Wait for order ticket to appear
    await waitForOrderTicket(page, orderNumber);
    
    // Step 1: Click "I'm on my way" button (always required)
    const onMyWayClicked = await clickButtonByText(page, "I'm on my way");
    if (!onMyWayClicked) {
      logMessage(`  Could not click "I'm on my way" button, continuing anyway...`, 'WARNING');
    }
    
    // If only param2 (not full process), stop here - DO NOT continue with "Delivery is done" or "Confirm"
    if (!fullProcess) {
      logMessage(`  ✓ Completed actions for order ${orderNumber} (param2 - ONLY clicked "I'm on my way", skipping "Delivery is done" and "Confirm")`);
      return true;
    }
    
    // Wait for page to update after first button click
    await waitRandomTime(500, 1000);
    
    // Step 2: Try to click "Delivery is done" button (if it exists) - only for full process
    const deliveryDoneClicked = await clickButtonByText(page, "Delivery is done", 5000);
    if (deliveryDoneClicked) {
      logMessage(`  ✓ Clicked "Delivery is done" button`);
      // Wait for page to update
      await waitRandomTime(2000, 3000);
    } else {
      logMessage(`  "Delivery is done" button not found (may not be available for this order)`, 'INFO');
    }
    
    // Step 3: Try to click "Confirm" button (if it exists) - only for full process
    const confirmClicked = await clickButtonByText(page, "Confirm", 5000);
    if (confirmClicked) {
      logMessage(`  ✓ Clicked "Confirm" button`);
      // Wait for page to update
      await waitRandomTime(2000, 3000);
    } else {
      logMessage(`  "Confirm" button not found (may not be available for this order)`, 'INFO');
    }
    
    logMessage(`  ✓ Completed actions for order ${orderNumber} (full process)`);
    return true;
  } catch (error: any) {
    logMessage(`  ✗ Error performing actions for order ${orderNumber}: ${error.message}`, 'ERROR');
    return false;
  }
}

/**
 * Click on a delivery order, perform button actions, and return to list
 * @param fullProcess - If true, performs full process (I'm on my way, Delivery is done, Confirm)
 *                      If false, only clicks "I'm on my way" (for param2 orders)
 */
async function clickDeliveryAndReturn(page: puppeteer.Page, orderNumber: string, fullProcess: boolean = true): Promise<boolean> {
  try {
    logMessage(`Clicking on order ${orderNumber}...`);
    
    // Find the delivery item
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
    
    // Click the element
    const box = await (deliveryItemHandle as puppeteerTypes.ElementHandle<HTMLElement>).boundingBox();
    if (box) {
      // Click on delivery item
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await waitRandomTime(500, 1000);
      await page.mouse.down();
      await page.mouse.up();
    } else {
      // Fallback click
      await page.evaluate((handle) => {
        const element = handle as HTMLElement;
        if (element) {
          element.click();
        }
      }, deliveryItemHandle as puppeteerTypes.ElementHandle<HTMLElement>);
    }
    
    await waitRandomTime(1000, 2000);
    
    // Wait for navigation
    try {
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    } catch (navError) {
      logMessage('Navigation may have completed or timed out, continuing...', 'WARNING');
    }
    
    await waitRandomTime(1000, 2000);
    
    // Check if navigation was successful
    const currentUrl = page.url();
    if (currentUrl.includes('/deliveries')) {
      logMessage(`Navigation failed, still on deliveries page`, 'WARNING');
      await deliveryItemHandle.dispose();
      return false;
    }
    
    logMessage(`Successfully navigated to order details`);
    
    // Perform button actions on the order page
    await performOrderActions(page, orderNumber, fullProcess);
    
    // Return to deliveries list
    logMessage(`Returning to deliveries list...`);
    
    // Check if we're already on deliveries page
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
        logMessage('Navigation back may have completed or timed out, continuing...', 'WARNING');
      }
      
      await waitRandomTime(1000, 2000);
      
      // Verify we're back on deliveries page
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
    
    // Fallback: try to go back or navigate directly
    try {
      await page.goBack();
      await waitRandomTime(1000, 2000);
      
      // Verify we're on deliveries page
      const finalUrl = page.url();
      if (finalUrl.includes('/deliveries')) {
        logMessage(`✓ Successfully returned to deliveries list (via goBack)`);
        await deliveryItemHandle.dispose();
        return true;
      }
    } catch (backError) {
      logMessage('goBack failed, trying direct navigation...', 'WARNING');
    }
    
    // Last resort: navigate directly to deliveries URL
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
 * Main continuous test function
 */
async function testContinuous(): Promise<void> {
  const config = loadConfig();
  browserPool = new BrowserPool(config);
  
  // Initialize log file for this execution
  currentLogFile = initializeLogFile();
  
  logMessage('Starting continuous delivery monitoring with button actions (V3 - API-based)...');
  logMessage(`Check interval: 60 seconds (1 minute)`);
  
  // Initialize browser
  const browserResult = await initBrowser(config.task.url, 'continuous-test-v3');
  
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
      logMessage('\n=== Starting new check cycle ===');
      
      // IMPORTANT: Reload page at the start of each cycle to ensure fresh data
      logMessage('Reloading page to get latest data...');
      await page.reload({ waitUntil: 'networkidle2' });
      await waitRandomTime(2000, 3000);
      logMessage('Page reloaded, starting checks...');
      
      // Check for "No Deliveries available" and reload up to 3 times if needed
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
        // Deliveries are now available, continue with processing
      }
      
      // Check for expired link
      const isExpired = await checkExpired(page);
      if (isExpired) {
        logMessage('Expired link detected, requesting new link...');
        if (config.task.phoneNumber) {
          await requestNewLink(page, config.task.phoneNumber);
          await waitRandomTime(1000, 2000);
        }
        continue;
      }
      
      // Ensure we're on the deliveries page before processing orders
      const onDeliveriesPage = await ensureOnDeliveriesPage(page);
      if (!onDeliveriesPage) {
        logMessage('Could not navigate to deliveries page, skipping this cycle', 'WARNING');
        await new Promise(resolve => setTimeout(resolve, 60000));
        continue;
      }
      
      // IMPORTANT: Check for "No Deliveries available" AFTER ensuring we're on deliveries page
      // This must be done BEFORE processing the list
      // Reload up to 3 times if "No Deliveries available" is detected
      const hasNoDeliveriesAfterNav = await checkNoDeliveries(page);
      if (hasNoDeliveriesAfterNav) {
        logMessage('"No Deliveries available" detected after navigation, attempting to reload page (max 3 attempts)...');
        const deliveriesAvailable = await handleNoDeliveriesWithReload(page, 3);
        if (!deliveriesAvailable) {
          logMessage('No deliveries available after 3 reload attempts, skipping list processing...');
          logMessage('Waiting 60 seconds before next check...');
          await new Promise(resolve => setTimeout(resolve, 60000));
          continue;
        }
        // Deliveries are now available, continue with processing
      }
      
      // Process deliveries - V3: Uses API instead of DOM extraction
      const deliveries = await processContinuousDeliveries(page);
      
      logMessage(`\n📊 Summary: Found ${deliveries.length} total order(s) from API`);
      
      // Log detection cycle header with total count and separator
      logDetectionCycleHeader(deliveries.length);
      
      // Log all detected orders
      for (const delivery of deliveries) {
        logDetectedOrder(delivery.orderNumber, delivery.timeText, delivery.status);
      }
      
      // Separate orders into categories
      const eligibleToClick = deliveries.filter(d => d.shouldClick);
      const notEligible = deliveries.filter(d => !d.shouldClick);
      
      logMessage(`  - Eligible to click: ${eligibleToClick.length}`);
      logMessage(`  - Not eligible (${notEligible.length}): ${notEligible.map(d => `${d.orderNumber} (${d.reason})`).join(', ')}`);
      
      // IMPORTANT: Process eligible orders, but limit to 1 click per order per cycle
      // Track which orders have been clicked in this cycle
      const clickedOrdersThisCycle = new Set<string>();
      let clickedCount = 0;
      let failedCount = 0;
      
      for (let i = 0; i < eligibleToClick.length; i++) {
        const delivery = eligibleToClick[i];
        logMessage(`\n>>> Processing order ${i + 1}/${eligibleToClick.length}: ${delivery.orderNumber} <<<`);
        
        // Skip if this order was already clicked in this cycle
        if (clickedOrdersThisCycle.has(delivery.orderNumber)) {
          logMessage(`  ⏭ Skipping order ${delivery.orderNumber} - already clicked in this cycle`);
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
            logClickedOrder(delivery.orderNumber, delivery.timeText, delivery.status, delivery.reason);
            logMessage(`✓ Successfully clicked order ${delivery.orderNumber} (${i + 1}/${eligibleToClick.length})`);
            clickedOrdersThisCycle.add(delivery.orderNumber);
            clickedCount++;
            
            // Verify we're back on the deliveries list before continuing
            const currentUrl = page.url();
            if (!currentUrl.includes('/deliveries')) {
              logMessage('Not on deliveries page after return, navigating back...', 'WARNING');
              // Try to navigate to deliveries page
              try {
                await page.goto(config.task.url, { waitUntil: 'networkidle2' });
                await waitRandomTime(1000, 2000);
              } catch (navError) {
                logMessage('Failed to navigate back to deliveries page, but continuing with next order...', 'WARNING');
                // Don't break - continue with next order
              }
            }
            
            // Wait a bit before processing next order to ensure list is loaded
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
                // Don't break - continue with next order
              }
            }
            
            // Wait before trying next order
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
          
          // Continue with next order even if this one failed
          await waitRandomTime(500, 1000);
        }
      }
      
      // Log final summary of this cycle
      logMessage(`\n📊 Cycle processing complete:`);
      logMessage(`  - Total orders reviewed: ${deliveries.length}`);
      logMessage(`  - Clicked successfully: ${clickedCount}`);
      logMessage(`  - Failed to click: ${failedCount}`);
      logMessage(`  - Not eligible (skipped): ${notEligible.length}`);
      
      logMessage(`\n=== Check cycle completed ===`);
      logMessage(`Waiting 60 seconds before next check...`);
      
      // Wait 60 seconds (1 minute) before next check
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
    
  } catch (error: any) {
    logMessage(`Error in continuous test: ${error.message}`, 'ERROR');
  } finally {
    // Keep browser open
    logMessage("\nBrowser remains open. Press Ctrl+C to stop monitoring.");
  }
}

// Run the test
testContinuous().catch(error => {
  logMessage(`Fatal error: ${error.message}`, 'ERROR');
  process.exit(1);
});
