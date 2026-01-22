const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const nodeFetch = require('node-fetch');

const urlOrder = process.env.URLS;
const orderTicket = process.env.TICKET;

let actions = 0;

puppeteer.use(StealthPlugin({
  enabledEvasions: [
    'chrome.runtime',
    'navigator.webdriver'
  ],
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}));

(async () => {
  let browser = null;
  let page = null;
  
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Clean the URL string - remove @ symbol if present
  const cleanUrlOrder = urlOrder.startsWith('@') ? urlOrder.substring(1) : urlOrder;
  const arrayUrl = cleanUrlOrder.split(',').map(url => url.trim());
  const length = arrayUrl?.length || 0;
  
  let count = 0;
  let flag = false;
  
  try {
    browser = await puppeteer.launch({ headless: false });
    
    // Loop through URLs to find a non-expired one
    while(count < length && !flag) {
      
      try {
        // Close previous page if it exists
        if (page) {
          await page.close();
        }
        
        page = await browser.newPage();
        
        await page.goto(arrayUrl[count], {
          waitUntil: 'networkidle2',
          timeout: 90000,
        });
        
        // Wait a bit for the page to load completely
        await delay(3000);
        
        // DEBUG: Let's see what's actually on the page
        const pageContent = await page.evaluate(() => {
          // Get all h3 elements
          const h3Elements = Array.from(document.querySelectorAll('h3'));
          const h3Texts = h3Elements.map(h3 => h3.textContent.trim());
          
          // Get all h1, h2 elements too
          const h1Elements = Array.from(document.querySelectorAll('h1'));
          const h1Texts = h1Elements.map(h1 => h1.textContent.trim());
          
          const h2Elements = Array.from(document.querySelectorAll('h2'));
          const h2Texts = h2Elements.map(h2 => h2.textContent.trim());
          
          // Get page title
          const pageTitle = document.title;
          
          // Get any text containing "expired" (case insensitive)
          const allText = document.body.innerText;
          const expiredMatches = allText.match(/expired/gi);
          
          return {
            title: pageTitle,
            h1Texts: h1Texts,
            h2Texts: h2Texts,
            h3Texts: h3Texts,
            hasExpiredText: expiredMatches ? expiredMatches.length > 0 : false,
            expiredMatches: expiredMatches
          };
        });
        
        
        // Check for expired link - let's make this more flexible
        const isExpired = await page.evaluate(() => {
          // Check for exact "Expired Link" in h3
          const exactMatch = Array.from(document.querySelectorAll('h3'))
            .find(h3 => h3.textContent.trim() === "Expired Link");
          
          if (exactMatch) return true;
          
          // Check for any text containing "expired" (case insensitive)
          const allText = document.body.innerText.toLowerCase();
          if (allText.includes('expired')) return true;
          
          // Check for common expired link indicators
          const expiredIndicators = [
            'link expired',
            'expired link',
            'this link has expired',
            'link is no longer valid',
            'link has expired',
            'expired'
          ];
          
          return expiredIndicators.some(indicator => 
            allText.includes(indicator.toLowerCase())
          );
        });
        
        
        if (isExpired) {
          await page.close();
          page = null;
          count++;
        } else {
          flag = true;
          break;
        }
        
      } catch(e) {
        if (page) {
          await page.close();
          page = null;
        }
        count++;
      }
    }
    
    // If no valid link found
    if (!flag) {
      if (browser) await browser.close();
      
      await nodeFetch('https://aiakk.app.n8n.cloud/webhook/84559bac-cc0c-4202-b86e-83432c30804e', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 7,
          event: "Delivered / Links Expired",
          ticket: orderTicket,
          url: urlOrder,
          timestamp: new Date().toISOString()
        })
      });
      return;
    }
    
  } catch(e) {
    if (browser) await browser.close();
    
    await nodeFetch('https://aiakk.app.n8n.cloud/webhook/84559bac-cc0c-4202-b86e-83432c30804e', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 8,
        event: "unexpected error checking links",
        ticket: orderTicket,
        url: urlOrder,
        timestamp: new Date().toISOString()
      })
    });
  }
      // Found a valid link, now proceed with the button click
    try {
      
      await delay(1000 + Math.random() * 500);
      
      // Wait for the ticket to appear on the page
      await page.waitForFunction((searchValue) => {
        return Array.from(document.querySelectorAll('div')).some(div => 
          div.textContent.trim().includes(searchValue)
        );
      }, {}, orderTicket);
      
      // Natural pause to "read" the page
      await delay(1000 + Math.random() * 500);
      
      // Wait for and click the "I'm on my way" button


      
    } catch(e) {
      //
    }
    
    try {
      
      await page.waitForFunction(() => {
        return Array.from(document.querySelectorAll('button'))
          .some(btn => btn.textContent.trim() === "I'm on my way");
      });
      

      
      const btnHandle = await page.evaluateHandle(() => {
        return Array.from(document.querySelectorAll('button'))
          .find(btn => btn.textContent.trim() === "I'm on my way");
      });
      
      const box = await btnHandle.boundingBox();
      
      await delay(1000 + Math.random() * 500);
      
      // Move mouse and click
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await delay(500 + Math.random() * 500);
      await page.mouse.down();
      await page.mouse.up();
      
      actions++;
      
    } catch(e) {
      
      //
    }
    
   try {

      await delay(500 + Math.random() * 500);
      
      await page.waitForFunction(() => {
        return Array.from(document.querySelectorAll('button'))
          .some(btn => btn.textContent.trim() === "Delivery is done");
      });
  
      // Get the button handle
      const btnHandle = await page.evaluateHandle(() => {
        return Array.from(document.querySelectorAll('button'))
          .find(btn => btn.textContent.trim() === "Delivery is done");
      });
      
      // Get the bounding box
      const box = await btnHandle.boundingBox();
      
      await delay(1000 + Math.random() * 500);
      
      // Move mouse and click
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      
      await delay(500 + Math.random() * 500);
      
      await page.mouse.down();
      await page.mouse.up();
      
      actions++;
      
    }catch(e) {
     // 
     browser.close();
      
      await nodeFetch('https://aiakk.app.n8n.cloud/webhook/84559bac-cc0c-4202-b86e-83432c30804e', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 3,
          event: 'Failed in Delivery is done Button Click',
          ticket: orderTicket,
          url: urlOrder,
          timestamp: new Date().toISOString()
        })
      });
      return;
    }
    
    try {
      
      await delay(2000 + Math.random() * 1000);
      
      await page.waitForFunction(() => {
        return Array.from(document.querySelectorAll('button'))
          .some(btn => btn.textContent.trim() === "Confirm");
      });
  
      // Get the button handle
      const btnHandle = await page.evaluateHandle(() => {
        return Array.from(document.querySelectorAll('button'))
          .find(btn => btn.textContent.trim() === "Confirm");
      });
      
      // Get the bounding box
      const box = await btnHandle.boundingBox();
      
      await delay(1000 + Math.random() * 500);
      
      // Move mouse and click
     await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      
      await delay(500 + Math.random() * 500);
      
      await page.mouse.down();
      await page.mouse.up();
      
      actions++;
      
    }catch(e) {
      
      browser.close();
      
      await nodeFetch('https://aiakk.app.n8n.cloud/webhook/84559bac-cc0c-4202-b86e-83432c30804e', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 2,
          event: 'Failed in Confirm Button Click',
          ticket: orderTicket,
          url: urlOrder,
          timestamp: new Date().toISOString()
        })
      });
      return;
      //
    }
    
    // Final delay and cleanup
    await delay(2000 + Math.random() * 1000);
    
    if (browser) await browser.close();
    
    // Send final status
    if ( (actions === 2 || actions === 3) && flag) {
      await nodeFetch('https://aiakk.app.n8n.cloud/webhook/84559bac-cc0c-4202-b86e-83432c30804e', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 1,
          event: 'Completed Delivered',
          ticket: orderTicket,
          url: urlOrder,
          timestamp: new Date().toISOString()
        })
      });
    } else {
      await nodeFetch('https://aiakk.app.n8n.cloud/webhook/84559bac-cc0c-4202-b86e-83432c30804e', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 8,
          event: 'Incomplete process finalization',
          ticket: orderTicket,
          url: urlOrder,
          timestamp: new Date().toISOString()
        })
      });
    }
})();