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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function detailedUICheck() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const report = {
    timestamp: new Date().toISOString(),
    sections: {}
  };

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    await page.evaluateOnNewDocument((token) => {
      localStorage.setItem('authToken', token);
    }, TOKEN);

    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    console.log('='.repeat(60));
    console.log('UI 상세 검수 보고서');
    console.log('='.repeat(60));

    // 1. Staff Board 검사
    console.log('\n[1] STAFF BOARD - 직원 목록');
    console.log('-'.repeat(60));

    const staffBoard = await page.evaluate(() => {
      const staffBoardEl = document.querySelector('[class*="staff-board"], .staff-board');
      if (!staffBoardEl) {
        // Try alternative selectors
        const containers = Array.from(document.querySelectorAll('div'));
        const staffContainer = containers.find(el =>
          el.textContent.includes('STAFF BOARD') ||
          el.textContent.includes('직원 목록')
        );
        return staffContainer ? { found: true, html: staffContainer.outerHTML.substring(0, 500) } : { found: false };
      }

      // Get agent items
      const agents = Array.from(staffBoardEl.querySelectorAll('[class*="agent"]'));
      return {
        found: true,
        agentCount: agents.length,
        agents: agents.slice(0, 5).map(agent => ({
          text: agent.textContent.trim(),
          className: agent.className,
          badges: Array.from(agent.querySelectorAll('[class*="badge"], .badge')).map(b => ({
            text: b.textContent,
            className: b.className,
            style: {
              color: window.getComputedStyle(b).color,
              backgroundColor: window.getComputedStyle(b).backgroundColor
            }
          }))
        }))
      };
    });

    console.log('직원 목록:', staffBoard.found ? '✓ 발견' : '✗ 미발견');
    if (staffBoard.agents) {
      console.log(`에이전트 수: ${staffBoard.agentCount}`);
      staffBoard.agents.forEach((agent, i) => {
        console.log(`  - Agent ${i + 1}: ${agent.text.substring(0, 50)}`);
        if (agent.badges.length > 0) {
          agent.badges.forEach(badge => {
            console.log(`    배지: "${badge.text}" (${badge.style.backgroundColor})`);
          });
        }
      });
    }

    report.sections.staffBoard = staffBoard;

    // 2. Source 배지 검사 (C/X)
    console.log('\n[2] SOURCE 배지 (C/X)');
    console.log('-'.repeat(60));

    const badges = await page.evaluate(() => {
      const allBadges = Array.from(document.querySelectorAll('*')).filter(el => {
        const text = el.textContent.trim();
        return (text === 'C' || text === 'X') &&
               el.offsetWidth < 50 && el.offsetHeight < 50;
      });

      return allBadges.map(badge => ({
        text: badge.textContent.trim(),
        className: badge.className,
        tagName: badge.tagName,
        rect: badge.getBoundingClientRect(),
        style: {
          color: window.getComputedStyle(badge).color,
          backgroundColor: window.getComputedStyle(badge).backgroundColor,
          borderRadius: window.getComputedStyle(badge).borderRadius,
          padding: window.getComputedStyle(badge).padding,
          fontSize: window.getComputedStyle(badge).fontSize
        }
      }));
    });

    console.log(`발견된 배지 수: ${badges.length}`);
    const cBadges = badges.filter(b => b.text === 'C');
    const xBadges = badges.filter(b => b.text === 'X');

    console.log(`  - C 배지 (Claude): ${cBadges.length}개`);
    if (cBadges.length > 0) {
      console.log(`    색상: ${cBadges[0].style.backgroundColor}`);
      console.log(`    예상: 파랑 계열 (rgb)로 보임`);
    }

    console.log(`  - X 배지 (Codex): ${xBadges.length}개`);
    if (xBadges.length > 0) {
      console.log(`    색상: ${xBadges[0].style.backgroundColor}`);
      console.log(`    예상: 주황 계열 (rgb)로 보임`);
    }

    report.sections.sourceBadges = { total: badges.length, cBadges: cBadges.length, xBadges: xBadges.length, badges };

    // 3. PixelOffice 캔버스 검사
    console.log('\n[3] PIXELOFFICE 캔버스');
    console.log('-'.repeat(60));

    const pixelOffice = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const officeContainer = document.querySelector('[class*="pixel-office"], [class*="live-office"]');

      const avatars = Array.from(document.querySelectorAll('[class*="avatar"]')).map(av => ({
        className: av.className,
        rect: av.getBoundingClientRect(),
        visible: av.offsetWidth > 0 && av.offsetHeight > 0
      }));

      return {
        hasCanvas: !!canvas,
        canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null,
        hasOfficeContainer: !!officeContainer,
        avatarCount: avatars.length,
        visibleAvatars: avatars.filter(a => a.visible).length
      };
    });

    console.log('캔버스:', pixelOffice.hasCanvas ? '✓ 발견' : '✗ 미발견');
    if (pixelOffice.canvasSize) {
      console.log(`  크기: ${pixelOffice.canvasSize.width}x${pixelOffice.canvasSize.height}`);
    }
    console.log(`아바타 수: ${pixelOffice.avatarCount} (보이는 것: ${pixelOffice.visibleAvatars})`);

    report.sections.pixelOffice = pixelOffice;

    // 4. 툴팁 검사 (호버)
    console.log('\n[4] 툴팁 테스트 (호버 시)');
    console.log('-'.repeat(60));

    const tooltip = await page.evaluate(() => {
      const avatars = Array.from(document.querySelectorAll('[class*="avatar"]'));
      if (avatars.length === 0) return { found: false };

      return {
        found: true,
        avatarCount: avatars.length,
        firstAvatar: {
          className: avatars[0].className,
          rect: avatars[0].getBoundingClientRect()
        }
      };
    });

    if (tooltip.found && tooltip.firstAvatar) {
      // 아바타에 호버
      await page.mouse.move(
        tooltip.firstAvatar.rect.x + tooltip.firstAvatar.rect.width / 2,
        tooltip.firstAvatar.rect.y + tooltip.firstAvatar.rect.height / 2
      );
      await sleep(800);

      // 툴팁 찾기
      const tooltipInfo = await page.evaluate(() => {
        const tooltips = Array.from(document.querySelectorAll('[class*="tooltip"], [role="tooltip"]'));
        if (tooltips.length === 0) return { visible: false };

        const tooltip = tooltips[0];
        return {
          visible: true,
          text: tooltip.textContent,
          className: tooltip.className,
          rect: tooltip.getBoundingClientRect(),
          style: {
            backgroundColor: window.getComputedStyle(tooltip).backgroundColor,
            color: window.getComputedStyle(tooltip).color,
            zIndex: window.getComputedStyle(tooltip).zIndex
          }
        };
      });

      console.log('툴팁 표시:', tooltipInfo.visible ? '✓ 성공' : '✗ 실패');
      if (tooltipInfo.visible) {
        console.log(`  내용: ${tooltipInfo.text.substring(0, 100)}`);
        console.log('  포함 정보 확인:');
        console.log(`    - source: ${tooltipInfo.text.includes('source') || tooltipInfo.text.includes('C') || tooltipInfo.text.includes('X') ? '✓' : '✗'}`);
        console.log(`    - project: ${tooltipInfo.text.includes('project') || tooltipInfo.text.includes('지위') ? '✓' : '✗'}`);
        console.log(`    - status: ${tooltipInfo.text.includes('status') || tooltipInfo.text.includes('활성') || tooltipInfo.text.includes('작업') ? '✓' : '✗'}`);
      }

      report.sections.tooltip = tooltipInfo;

      // 툴팁이 보이는 상태로 스크린샷
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '03-desktop-tooltip.png'),
        fullPage: false
      });
      console.log('    📸 Screenshot: 03-desktop-tooltip.png');
    }

    // 5. Inspector 패널 검사
    console.log('\n[5] INSPECTOR 패널 - 상세 정보');
    console.log('-'.repeat(60));

    // Staff Board에서 첫 번째 에이전트 클릭
    const agentClicked = await page.evaluate(() => {
      const agents = Array.from(document.querySelectorAll('[class*="agent-item"], .agent-card, [class*="staff"] [class*="agent"]'));
      if (agents.length === 0) return false;

      agents[0].click();
      return true;
    });

    if (agentClicked) {
      await sleep(1000);

      const inspector = await page.evaluate(() => {
        const inspectorEl = document.querySelector('[class*="inspector"]');
        if (!inspectorEl) return { found: false };

        return {
          found: true,
          text: inspectorEl.textContent,
          hasAgentInfo: inspectorEl.textContent.includes('Agent') || inspectorEl.textContent.includes('직위'),
          hasMetrics: inspectorEl.textContent.includes('입력') || inspectorEl.textContent.includes('출력'),
          hasActivities: inspectorEl.textContent.includes('활동') || inspectorEl.textContent.includes('Success')
        };
      });

      console.log('Inspector 패널:', inspector.found ? '✓ 발견' : '✗ 미발견');
      if (inspector.found) {
        console.log(`  - 에이전트 정보: ${inspector.hasAgentInfo ? '✓' : '✗'}`);
        console.log(`  - 메트릭 정보: ${inspector.hasMetrics ? '✓' : '✗'}`);
        console.log(`  - 활동 정보: ${inspector.hasActivities ? '✓' : '✗'}`);
      }

      report.sections.inspector = inspector;
    }

    // 6. Event Stream 검사
    console.log('\n[6] EVENT STREAM - 이벤트 로그');
    console.log('-'.repeat(60));

    const eventStream = await page.evaluate(() => {
      const streamEl = document.querySelector('[class*="event"]');
      if (!streamEl) return { found: false };

      const events = Array.from(streamEl.querySelectorAll('[class*="event-item"], .event, li'));
      return {
        found: true,
        eventCount: events.length,
        events: events.slice(0, 3).map(e => ({
          text: e.textContent.trim().substring(0, 80),
          hasTimestamp: /\d{2}:\d{2}/.test(e.textContent),
          hasAgent: e.textContent.includes('Agent')
        }))
      };
    });

    console.log('Event Stream:', eventStream.found ? '✓ 발견' : '✗ 미발견');
    if (eventStream.found) {
      console.log(`  이벤트 수: ${eventStream.eventCount}`);
      eventStream.events.forEach((ev, i) => {
        console.log(`  - Event ${i + 1}: ${ev.text}`);
      });
    }

    report.sections.eventStream = eventStream;

    // 7. Reports 화면 검사
    console.log('\n[7] REPORTS 화면 - 보고서 목록');
    console.log('-'.repeat(60));

    // 보고서 탭 클릭
    const reportsClicked = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('button, a'));
      const reportsTab = tabs.find(t => t.textContent.includes('보고서') || t.textContent.includes('Reports'));
      if (reportsTab) {
        reportsTab.click();
        return true;
      }
      return false;
    });

    if (reportsClicked) {
      await sleep(1500);

      const reports = await page.evaluate(() => {
        const reportsList = document.querySelectorAll('[class*="report"]');
        return {
          found: reportsList.length > 0,
          count: reportsList.length,
          visible: Array.from(reportsList).some(r => r.offsetWidth > 0)
        };
      });

      console.log('Reports 화면:', reports.found ? '✓ 발견' : '✗ 미발견');
      console.log(`  보고서 요소 수: ${reports.count}`);

      // 스크린샷
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '04-desktop-reports.png'),
        fullPage: false
      });
      console.log('    📸 Screenshot: 04-desktop-reports.png');

      report.sections.reports = reports;
    }

    // 8. 레이아웃 이슈 검사
    console.log('\n[8] 레이아웃 이슈 검사');
    console.log('-'.repeat(60));

    const layoutIssues = await page.evaluate(() => {
      const issues = {
        textOverlap: [],
        horizontalScroll: document.documentElement.scrollWidth > window.innerWidth,
        unclickableAreas: [],
        brokenLayout: []
      };

      // 텍스트 겹침 검사
      const textElements = Array.from(document.querySelectorAll('p, span, div, h1, h2, h3, h4, h5, h6'));
      for (let i = 0; i < textElements.length - 1; i++) {
        const el1 = textElements[i].getBoundingClientRect();
        const el2 = textElements[i + 1].getBoundingClientRect();

        if (el1.bottom > el2.top && el1.right > el2.left && el1.left < el2.right) {
          issues.textOverlap.push(`${textElements[i].className} overlaps ${textElements[i + 1].className}`);
        }
      }

      return {
        ...issues,
        totalIssues: issues.textOverlap.length + (issues.horizontalScroll ? 1 : 0)
      };
    });

    console.log('수평 스크롤:', layoutIssues.horizontalScroll ? '⚠ 있음' : '✓ 없음');
    console.log(`텍스트 겹침: ${layoutIssues.textOverlap.length}건`);
    console.log(`총 이슈: ${layoutIssues.totalIssues}건`);

    report.sections.layoutIssues = layoutIssues;

    await page.close();

    console.log('\n' + '='.repeat(60));
    console.log('검수 완료');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('검수 중 오류:', error);
    report.error = error.message;
  } finally {
    await browser.close();
  }

  // 보고서 저장
  fs.writeFileSync(
    path.join(__dirname, 'detailed-check-results.json'),
    JSON.stringify(report, null, 2)
  );

  return report;
}

detailedUICheck()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
