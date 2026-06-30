import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = process.env.AUTH_TOKEN;
if (!TOKEN) {
  console.error('❌ AUTH_TOKEN 환경변수를 설정해야 합니다.');
  process.exit(1);
}
const BASE_URL = 'http://localhost:9876';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runAcceptanceTest() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const results = {
    timestamp: new Date().toISOString(),
    checks: [],
    screenshots: [],
    issues: []
  };

  try {
    console.log('🚀 Starting UI Acceptance Test...\n');

    // ============================================
    // Desktop View Testing (1280x800)
    // ============================================
    console.log('📱 Testing Desktop View (1280x800)...');
    const desktopPage = await browser.newPage();
    await desktopPage.setViewport({ width: 1280, height: 800 });

    // Set token in localStorage
    await desktopPage.evaluateOnNewDocument((token) => {
      localStorage.setItem('authToken', token);
    }, TOKEN);

    await desktopPage.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // 1. Check Staff Board
    console.log('  ✓ Checking Staff Board...');
    const staffBoardExists = await desktopPage.$('.staff-board, [data-testid="staff-board"], .agent-list');
    if (staffBoardExists) {
      results.checks.push({ name: 'Staff Board - Visible', status: 'PASS' });

      // Check for source badges (C/X)
      const badges = await desktopPage.$$eval('[class*="badge"], [class*="source"]', elements =>
        elements.map(el => ({
          text: el.textContent,
          className: el.className,
          color: window.getComputedStyle(el).color,
          backgroundColor: window.getComputedStyle(el).backgroundColor
        }))
      );

      const hasCBadge = badges.some(b => b.text.includes('C'));
      const hasXBadge = badges.some(b => b.text.includes('X'));

      if (hasCBadge || hasXBadge) {
        results.checks.push({
          name: 'Source Badges (C/X)',
          status: 'PASS',
          details: `Found ${hasCBadge ? 'C' : ''}${hasXBadge ? 'X' : ''} badges`
        });
      } else {
        results.issues.push('Source badges (C/X) not found');
        results.checks.push({ name: 'Source Badges (C/X)', status: 'FAIL' });
      }
    } else {
      results.issues.push('Staff Board not found');
      results.checks.push({ name: 'Staff Board - Visible', status: 'FAIL' });
    }

    // Screenshot: Desktop - Main View
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '01-desktop-main-view.png'),
      fullPage: false
    });
    results.screenshots.push('01-desktop-main-view.png');
    console.log('    📸 Screenshot: 01-desktop-main-view.png');

    // 2. Check PixelOffice Canvas
    console.log('  ✓ Checking PixelOffice Canvas...');
    const canvasExists = await desktopPage.$('canvas, [class*="pixel-office"], [class*="canvas"]');
    if (canvasExists) {
      results.checks.push({ name: 'PixelOffice Canvas - Visible', status: 'PASS' });

      // Try to find avatars
      const avatars = await desktopPage.$$('[class*="avatar"], [class*="agent-icon"]');
      if (avatars.length > 0) {
        results.checks.push({
          name: 'Agent Avatars',
          status: 'PASS',
          details: `Found ${avatars.length} avatars`
        });
      }
    } else {
      results.issues.push('PixelOffice Canvas not found');
      results.checks.push({ name: 'PixelOffice Canvas - Visible', status: 'FAIL' });
    }

    // 3. Check Inspector Panel
    console.log('  ✓ Checking Inspector Panel...');

    // Try to click on an agent to open inspector
    const agentElement = await desktopPage.$('[class*="agent"], [class*="avatar"], .agent-card');
    if (agentElement) {
      await agentElement.click();
      await sleep(1000);

      const inspectorExists = await desktopPage.$('[class*="inspector"], [class*="detail"], [class*="panel"]');
      if (inspectorExists) {
        results.checks.push({ name: 'Inspector Panel - Opens', status: 'PASS' });

        // Screenshot: Inspector Open
        await desktopPage.screenshot({
          path: path.join(SCREENSHOTS_DIR, '02-desktop-inspector-open.png'),
          fullPage: false
        });
        results.screenshots.push('02-desktop-inspector-open.png');
        console.log('    📸 Screenshot: 02-desktop-inspector-open.png');
      } else {
        results.issues.push('Inspector panel not found after click');
        results.checks.push({ name: 'Inspector Panel - Opens', status: 'FAIL' });
      }
    }

    // 4. Check for tooltip on hover
    console.log('  ✓ Checking Tooltips...');
    const avatarForTooltip = await desktopPage.$('[class*="avatar"], [class*="agent-icon"]');
    if (avatarForTooltip) {
      await avatarForTooltip.hover();
      await sleep(500);

      const tooltipExists = await desktopPage.$('[class*="tooltip"], [role="tooltip"]');
      if (tooltipExists) {
        results.checks.push({ name: 'Tooltip - Shows on Hover', status: 'PASS' });

        // Screenshot: Tooltip Visible
        await desktopPage.screenshot({
          path: path.join(SCREENSHOTS_DIR, '03-desktop-tooltip.png'),
          fullPage: false
        });
        results.screenshots.push('03-desktop-tooltip.png');
        console.log('    📸 Screenshot: 03-desktop-tooltip.png');
      } else {
        results.issues.push('Tooltip not found on hover');
        results.checks.push({ name: 'Tooltip - Shows on Hover', status: 'FAIL' });
      }
    }

    // 5. Check Event Stream
    console.log('  ✓ Checking Event Stream...');
    const eventStreamExists = await desktopPage.$('[class*="event"], [class*="stream"], [class*="log"]');
    if (eventStreamExists) {
      results.checks.push({ name: 'Event Stream - Visible', status: 'PASS' });
    } else {
      results.issues.push('Event Stream not found');
      results.checks.push({ name: 'Event Stream - Visible', status: 'FAIL' });
    }

    // 6. Check Reports Screen
    console.log('  ✓ Checking Reports Screen...');
    const reportsLink = await desktopPage.$('a[href*="report"], button[class*="report"]');
    if (reportsLink) {
      await reportsLink.click();
      await sleep(1500);

      const reportsView = await desktopPage.$('[class*="report"]');
      if (reportsView) {
        results.checks.push({ name: 'Reports Screen - Navigation', status: 'PASS' });

        // Screenshot: Reports View
        await desktopPage.screenshot({
          path: path.join(SCREENSHOTS_DIR, '04-desktop-reports.png'),
          fullPage: false
        });
        results.screenshots.push('04-desktop-reports.png');
        console.log('    📸 Screenshot: 04-desktop-reports.png');
      } else {
        results.issues.push('Reports view not found after navigation');
        results.checks.push({ name: 'Reports Screen - Navigation', status: 'FAIL' });
      }
    }

    // Check for layout issues
    console.log('  ✓ Checking for Layout Issues...');
    const layoutIssues = await desktopPage.evaluate(() => {
      const issues = [];

      // Check for text overflow
      const allElements = document.querySelectorAll('*');
      allElements.forEach(el => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();

        // Check if element overflows viewport
        if (rect.right > window.innerWidth) {
          issues.push(`Element overflows horizontally: ${el.className}`);
        }

        // Check for overlapping text
        if (style.overflow === 'visible' && rect.width > 0 && rect.height > 0) {
          const textContent = el.textContent?.trim();
          if (textContent && textContent.length > 100 && !style.whiteSpace?.includes('wrap')) {
            issues.push(`Potential text overflow: ${el.className}`);
          }
        }
      });

      return issues.slice(0, 5); // Limit to top 5 issues
    });

    if (layoutIssues.length > 0) {
      results.issues.push(...layoutIssues);
      results.checks.push({
        name: 'Desktop Layout Check',
        status: 'WARNING',
        details: `Found ${layoutIssues.length} potential issues`
      });
    } else {
      results.checks.push({ name: 'Desktop Layout Check', status: 'PASS' });
    }

    await desktopPage.close();

    // ============================================
    // Mobile View Testing (390x844)
    // ============================================
    console.log('\n📱 Testing Mobile View (390x844)...');
    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({ width: 390, height: 844 });

    await mobilePage.evaluateOnNewDocument((token) => {
      localStorage.setItem('authToken', token);
    }, TOKEN);

    await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Screenshot: Mobile - Main View
    await mobilePage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '05-mobile-main-view.png'),
      fullPage: false
    });
    results.screenshots.push('05-mobile-main-view.png');
    console.log('  📸 Screenshot: 05-mobile-main-view.png');

    // Check mobile responsiveness
    console.log('  ✓ Checking Mobile Responsiveness...');
    const mobileLayoutIssues = await mobilePage.evaluate(() => {
      const issues = [];

      // Check for horizontal scrolling
      if (document.documentElement.scrollWidth > window.innerWidth) {
        issues.push('Horizontal scrolling detected on mobile');
      }

      // Check for clickable elements too small
      const clickables = document.querySelectorAll('button, a, [onclick]');
      clickables.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
          issues.push(`Clickable element too small: ${el.className} (${rect.width}x${rect.height})`);
        }
      });

      return issues.slice(0, 5);
    });

    if (mobileLayoutIssues.length > 0) {
      results.issues.push(...mobileLayoutIssues);
      results.checks.push({
        name: 'Mobile Layout Check',
        status: 'WARNING',
        details: `Found ${mobileLayoutIssues.length} potential issues`
      });
    } else {
      results.checks.push({ name: 'Mobile Layout Check', status: 'PASS' });
    }

    // Try to interact with mobile UI
    const mobileAgent = await mobilePage.$('[class*="agent"], [class*="avatar"]');
    if (mobileAgent) {
      await mobileAgent.click();
      await sleep(1000);

      await mobilePage.screenshot({
        path: path.join(SCREENSHOTS_DIR, '06-mobile-inspector.png'),
        fullPage: false
      });
      results.screenshots.push('06-mobile-inspector.png');
      console.log('  📸 Screenshot: 06-mobile-inspector.png');
    }

    await mobilePage.close();

    console.log('\n✅ UI Acceptance Test Complete!\n');

  } catch (error) {
    console.error('❌ Error during testing:', error);
    results.issues.push(`Test execution error: ${error.message}`);
  } finally {
    await browser.close();
  }

  // Save results
  fs.writeFileSync(
    path.join(__dirname, 'test-results.json'),
    JSON.stringify(results, null, 2)
  );

  // Print summary
  console.log('='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));

  const passed = results.checks.filter(c => c.status === 'PASS').length;
  const failed = results.checks.filter(c => c.status === 'FAIL').length;
  const warnings = results.checks.filter(c => c.status === 'WARNING').length;

  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`⚠ Warnings: ${warnings}`);
  console.log(`📸 Screenshots: ${results.screenshots.length}`);
  console.log(`⚠️ Issues: ${results.issues.length}`);

  if (results.issues.length > 0) {
    console.log('\nIssues Found:');
    results.issues.forEach((issue, i) => {
      console.log(`  ${i + 1}. ${issue}`);
    });
  }

  console.log('\n' + '='.repeat(60));

  return results;
}

runAcceptanceTest()
  .then(results => {
    process.exit(results.checks.some(c => c.status === 'FAIL') ? 1 : 0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
