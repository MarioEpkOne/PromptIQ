import * as http from 'http';
import { readTodayEntries, ensureDirectories } from './logger.js';
import { getDrmSummary, getWeeklyDetail, getMonthlyDetail, getDayDetail, findLastAnalysisDate } from './drm.js';
import type { WeeklyRecord, WeeklyRecordDaily, WeeklyRecordCompressed, MonthlyRecord } from './types.js';

// ---------------------------------------------------------------------------
// Inline HTML dashboard (D2, D7: embedded template literal, no file I/O)
// ---------------------------------------------------------------------------
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PromptIQ</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #1a1a1a;
      color: #e0e0e0;
      font-family: 'Nunito', sans-serif;
      font-size: 14px;
      padding: 24px;
    }
    h1 { color: #5bc8f5; margin-bottom: 20px; font-size: 1.4em; letter-spacing: 0.05em; }
    .tabs { display: flex; gap: 8px; margin-bottom: 24px; }
    .tab-btn {
      background: #2a2a2a;
      border: 1px solid #444;
      color: #aaa;
      padding: 6px 18px;
      cursor: pointer;
      border-radius: 3px;
      font-family: inherit;
      font-size: 13px;
    }
    .tab-btn.active { background: #5bc8f5; color: #1a1a1a; border-color: #5bc8f5; font-weight: bold; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #333; }
    th { color: #888; font-weight: normal; font-size: 12px; }
    .badge { padding: 2px 8px; border-radius: 3px; font-size: 12px; }
    .badge-green { background: #1a3d1a; color: #4caf50; }
    .badge-yellow { background: #3d3000; color: #ffc107; }
    .badge-red { background: #3d1a1a; color: #f44336; }
    .warn { color: #ffc107; }
    .empty { color: #666; font-style: italic; margin-top: 12px; }
    .stat-row { margin-bottom: 10px; }
    .stat-label { color: #888; display: inline-block; width: 200px; }
    .stat-value { color: #e0e0e0; font-weight: bold; }
    pre { white-space: pre-wrap; word-break: break-all; }
    .prompt-item { padding: 8px 0; border-bottom: 1px solid #2a2a2a; }
    .prompt-num { color: #5bc8f5; margin-right: 8px; }
    tr.clickable { cursor: pointer; }
    tr.clickable:hover td { background: #252525; }
    tr.selected td { background: #1e2d35 !important; }
    .detail-panel {
      margin-top: 16px;
      background: #222;
      border: 1px solid #3a3a3a;
      border-radius: 4px;
      padding: 16px;
    }
    .detail-panel h4 { color: #5bc8f5; margin-bottom: 12px; font-size: 13px; letter-spacing: 0.05em; }
    .detail-close { float: right; cursor: pointer; color: #666; font-size: 16px; line-height: 1; }
    .detail-close:hover { color: #aaa; }
    .detail-day { margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid #2a2a2a; }
    .detail-day:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
    .detail-day-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .detail-day-date { color: #aaa; font-size: 12px; }
    .detail-summary { color: #ccc; font-size: 12px; line-height: 1.6; margin-top: 6px; }
    .detail-patterns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .detail-pattern-tag { background: #1e2d35; color: #5bc8f5; border-radius: 3px; padding: 2px 8px; font-size: 11px; }
    .detail-section { margin-bottom: 12px; }
    .detail-section-label { color: #666; font-size: 11px; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.08em; }
  </style>
</head>
<body>
  <h1>PromptIQ</h1>
  <div class="tabs">
    <button class="tab-btn active" onclick="switchTab('status')">Status</button>
    <button class="tab-btn" onclick="switchTab('patterns')">Patterns</button>
    <button class="tab-btn" onclick="switchTab('last')">Last Prompts</button>
  </div>

  <div id="tab-status" class="tab-content active"><p class="empty">Loading...</p></div>
  <div id="tab-patterns" class="tab-content">
    <p class="empty">Loading...</p>
    <div id="detail-panel" style="display:none;"></div>
  </div>
  <div id="tab-last" class="tab-content"><p class="empty">Loading...</p></div>

  <script>
    let currentTab = 'status';
    let statusInterval = null;

    function scoreBadge(score) {
      const pct = (score * 100).toFixed(0);
      const cls = score >= 0.75 ? 'badge-green' : score >= 0.5 ? 'badge-yellow' : 'badge-red';
      return '<span class="badge ' + cls + '">' + pct + '</span>';
    }

    async function loadStatus() {
      const el = document.getElementById('tab-status');
      try {
        const data = await fetch('/api/status').then(r => r.json());
        let html = '';
        if (data.error) {
          html = '<p class="empty">No data yet \u2014 run <code>promptiq analyze</code> to get started.</p>';
        } else {
          html += '<div class="stat-row"><span class="stat-label">Today&#39;s prompts logged:</span><span class="stat-value">' + data.todayCount + '</span></div>';
          html += '<div class="stat-row"><span class="stat-label">Last analysis date:</span><span class="stat-value">' + (data.lastAnalysisDate || 'never') + '</span></div>';
          html += '<div class="stat-row"><span class="stat-label">Weekly summaries stored:</span><span class="stat-value">' + data.weeklyCount + '</span></div>';
          html += '<div class="stat-row"><span class="stat-label">Monthly summaries stored:</span><span class="stat-value">' + data.monthlyCount + '</span></div>';
          if (data.failedDates && data.failedDates.length > 0) {
            html += '<div class="stat-row warn">&#9888; ' + data.failedDates.length + ' day(s) failed to analyze: ' + data.failedDates.join(', ') + '</div>';
          }
        }
        el.innerHTML = html || '<p class="empty">No data yet \u2014 run <code>promptiq analyze</code> to get started.</p>';
      } catch (e) {
        el.innerHTML = '<p class="empty">Failed to load status.</p>';
      }
    }

    let selectedDetailKey = null;

    // Delegated click handler on stable parent — avoids inline onclick escaping issues
    document.getElementById('tab-patterns').addEventListener('click', function(e) {
      const row = e.target.closest('tr.clickable');
      if (row) { toggleDetail(row.dataset.type, row.dataset.id, row); return; }
      if (e.target.closest('.detail-close')) { closeDetail(); }
    });

    async function loadPatterns() {
      const el = document.getElementById('tab-patterns');
      try {
        const data = await fetch('/api/patterns').then(r => r.json());
        let html = '';
        const hasDays = data.days && data.days.length > 0;
        const hasWeekly = data.weekly && data.weekly.length > 0;
        const hasMonthly = data.monthly && data.monthly.length > 0;

        if (!hasDays && !hasWeekly && !hasMonthly) {
          html = '<p class="empty">No historical data yet. Run <code>promptiq analyze</code> to start building memory.</p>';
        } else {
          // DAYS section
          html += '<h3 style="color:#888;font-size:12px;margin-bottom:8px;">DAYS</h3>';
          if (!hasDays) {
            html += '<p class="empty" style="margin-bottom:16px;">No analyzed days yet. Run <code>promptiq analyze</code> to get started.</p>';
          } else {
            html += '<table><tr><th>Date</th><th>Score</th><th>Prompts</th><th style="color:#5bc8f5;font-size:11px;">&#9654; view</th></tr>';
            for (const d of data.days) {
              if (d.error) {
                html += '<tr class="clickable" data-type="day" data-id="' + d.date + '">'
                  + '<td>' + d.date + '</td>'
                  + '<td><span style="color:#f44336;font-size:12px;">failed</span></td>'
                  + '<td>' + (d.promptCount || '\u2014') + '</td>'
                  + '<td style="color:#5bc8f5;font-size:12px;">&#9654;</td></tr>';
              } else {
                html += '<tr class="clickable" data-type="day" data-id="' + d.date + '">'
                  + '<td>' + d.date + '</td>'
                  + '<td>' + scoreBadge(d.avgScore || 0) + '</td>'
                  + '<td>' + (d.promptCount || '\u2014') + '</td>'
                  + '<td style="color:#5bc8f5;font-size:12px;">&#9654;</td></tr>';
              }
            }
            html += '</table><br/>';
          }

          // WEEKLY section (compressed records only)
          if (hasWeekly) {
            html += '<h3 style="color:#888;font-size:12px;margin-bottom:8px;">WEEKLY</h3><table><tr><th>Week</th><th>Score</th><th>Prompts</th><th style="color:#5bc8f5;font-size:11px;">&#9654; view</th></tr>';
            for (const w of data.weekly.slice().reverse()) {
              html += '<tr class="clickable" data-type="week" data-id="' + w.week + '">'
                + '<td>' + w.week + '</td><td>' + scoreBadge(w.avgScore || 0) + '</td><td>' + (w.promptCount || '\u2014') + '</td>'
                + '<td style="color:#5bc8f5;font-size:12px;">&#9654;</td></tr>';
            }
            html += '</table><br/>';
          }

          // MONTHLY section
          if (hasMonthly) {
            html += '<h3 style="color:#888;font-size:12px;margin-bottom:8px;">MONTHLY</h3><table><tr><th>Month</th><th>Score</th><th>Prompts</th><th>Weeks</th><th style="color:#5bc8f5;font-size:11px;">&#9654; view</th></tr>';
            for (const m of data.monthly.slice().reverse()) {
              html += '<tr class="clickable" data-type="month" data-id="' + m.month + '">'
                + '<td>' + m.month + '</td><td>' + scoreBadge(m.avgScore) + '</td><td>' + m.promptCount + '</td><td>' + m.weekCount + '</td>'
                + '<td style="color:#5bc8f5;font-size:12px;">&#9654;</td></tr>';
            }
            html += '</table>';
          }
        }
        el.innerHTML = html + '<div id="detail-panel" style="display:none;"></div>';
        // re-highlight selected row and restore panel if open
        if (selectedDetailKey) {
          const [type, ...rest] = selectedDetailKey.split(':');
          const id = rest.join(':');
          const row = el.querySelector('[data-type="' + type + '"][data-id="' + id + '"]');
          if (row) row.classList.add('selected');
        }
      } catch (e) {
        el.innerHTML = '<p class="empty">Failed to load patterns.</p>';
      }
    }

    async function toggleDetail(type, id, row) {
      const key = type + ':' + id;
      const panel = document.getElementById('detail-panel');
      document.querySelectorAll('#tab-patterns tr.selected').forEach(r => r.classList.remove('selected'));
      if (selectedDetailKey === key) {
        selectedDetailKey = null;
        panel.style.display = 'none';
        panel.innerHTML = '';
        return;
      }
      selectedDetailKey = key;
      row.classList.add('selected');
      panel.style.display = 'block';
      panel.innerHTML = '<div class="detail-panel"><span class="detail-close">&#x2715;</span><h4>Loading\u2026</h4></div>';
      try {
        const data = await fetch('/api/detail?type=' + type + '&id=' + encodeURIComponent(id)).then(r => r.json());
        if (data.error) {
          panel.innerHTML = '<div class="detail-panel"><span class="detail-close">&#x2715;</span><p class="empty">No detail available.</p></div>';
          return;
        }
        panel.innerHTML = '<div class="detail-panel">' + renderDetail(type, id, data) + '</div>';
      } catch (e) {
        panel.innerHTML = '<div class="detail-panel"><span class="detail-close">&#x2715;</span><p class="empty">Failed to load detail.</p></div>';
      }
    }

    function closeDetail() {
      selectedDetailKey = null;
      const panel = document.getElementById('detail-panel');
      if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
      document.querySelectorAll('#tab-patterns tr.selected').forEach(r => r.classList.remove('selected'));
    }

    function renderPatternTags(patterns) {
      if (!patterns || patterns.length === 0) return '<span style="color:#555;font-size:12px;">none</span>';
      return '<div class="detail-patterns">' + patterns.map(p => '<span class="detail-pattern-tag">' + escHtml(p) + '</span>').join('') + '</div>';
    }

    function renderDetail(type, id, data) {
      let html = '<span class="detail-close">&#x2715;</span>';
      html += '<h4>' + escHtml(id) + ' &mdash; Top Findings</h4>';
      if (type === 'week') {
        if (data.detail === 'compressed') {
          html += '<div class="detail-section"><div class="detail-section-label">Top Patterns</div>' + renderPatternTags(data.topPatterns) + '</div>';
          if (data.summary) html += '<div class="detail-section"><div class="detail-section-label">Summary</div><div class="detail-summary">' + escHtml(data.summary) + '</div></div>';
        } else {
          // daily breakdown
          const days = Object.entries(data.days || {}).sort((a, b) => a[0].localeCompare(b[0]));
          if (days.length === 0) {
            html += '<p class="empty">No daily records.</p>';
          } else {
            for (const [date, day] of days) {
              if (day.error) {
                html += '<div class="detail-day"><div class="detail-day-header"><span class="detail-day-date">' + escHtml(date) + '</span><span style="color:#f44336;font-size:12px;">analysis failed</span></div></div>';
                continue;
              }
              html += '<div class="detail-day">';
              html += '<div class="detail-day-header"><span class="detail-day-date">' + escHtml(date) + '</span>' + scoreBadge(day.avgScore || 0) + '<span style="color:#666;font-size:11px;">' + day.promptCount + ' prompts</span></div>';
              if (day.topPatterns && day.topPatterns.length > 0) {
                html += renderPatternTags(day.topPatterns);
              }
              if (day.summary) html += '<div class="detail-summary">' + escHtml(day.summary) + '</div>';
              html += '</div>';
            }
          }
        }
      } else if (type === 'day') {
        if (data.error) {
          html += '<p style="color:#f44336;">Analysis failed for this day.</p>';
          if (data.errorMessage) html += '<p class="detail-summary">' + escHtml(data.errorMessage) + '</p>';
        } else {
          html += '<div class="detail-section">';
          html += '<div class="detail-section-label">Score</div>';
          html += '<span>' + scoreBadge(data.avgScore || 0) + '</span>';
          html += ' <span style="color:#666;font-size:11px;">' + data.promptCount + ' prompts</span>';
          html += '</div>';

          html += '<div class="detail-section"><div class="detail-section-label">Top Patterns</div>';
          html += renderPatternTags(data.topPatterns);
          html += '</div>';

          if (data.summary) {
            html += '<div class="detail-section"><div class="detail-section-label">Summary</div>';
            html += '<div class="detail-summary">' + escHtml(data.summary) + '</div></div>';
          }

          if (data.suggestions && data.suggestions.length > 0) {
            html += '<div class="detail-section"><div class="detail-section-label">Suggestions</div>';
            for (const s of data.suggestions) {
              html += '<div style="margin-bottom:10px;">';
              html += '<div style="color:#ccc;font-size:12px;margin-bottom:4px;">' + escHtml(s.text) + '</div>';
              if (s.before) html += '<div style="color:#f44336;font-size:11px;margin-bottom:2px;">&#x2716; ' + escHtml(s.before) + '</div>';
              if (s.after) html += '<div style="color:#4caf50;font-size:11px;">&#x2714; ' + escHtml(s.after) + '</div>';
              html += '</div>';
            }
            html += '</div>';
          }
        }
      } else {
        // monthly
        html += '<div class="detail-section"><div class="detail-section-label">Persistent Patterns</div>' + renderPatternTags(data.persistentPatterns) + '</div>';
        if (data.summary) html += '<div class="detail-section"><div class="detail-section-label">Summary</div><div class="detail-summary">' + escHtml(data.summary) + '</div></div>';
        html += '<div class="detail-section"><div class="detail-section-label">Stats</div><div style="color:#aaa;font-size:12px;">' + data.weekCount + ' weeks &bull; ' + data.promptCount + ' prompts</div></div>';
      }
      return html;
    }

    async function loadLast() {
      const el = document.getElementById('tab-last');
      try {
        const data = await fetch('/api/last').then(r => r.json());
        if (!data.prompts || data.prompts.length === 0) {
          el.innerHTML = '<p class="empty">No prompts logged today.</p>';
          return;
        }
        let html = '';
        data.prompts.forEach((p, i) => {
          html += '<div class="prompt-item"><span class="prompt-num">' + (i + 1) + '.</span><span>' + escHtml(p) + '</span></div>';
        });
        el.innerHTML = html;
      } catch (e) {
        el.innerHTML = '<p class="empty">Failed to load prompts.</p>';
      }
    }

    function escHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab-btn').forEach((b, i) => {
        b.classList.toggle('active', ['status','patterns','last'][i] === tab);
      });
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');
      if (tab === 'status') loadStatus();
      else if (tab === 'patterns') loadPatterns();
      else if (tab === 'last') loadLast();

      if (statusInterval) clearInterval(statusInterval);
      if (tab === 'status') {
        statusInterval = setInterval(loadStatus, 60000);
      }
    }

    // Initial load
    loadStatus();
    statusInterval = setInterval(loadStatus, 60000);
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// API response builders
// ---------------------------------------------------------------------------

function buildStatusResponse(): object {
  ensureDirectories();
  const entries = readTodayEntries();
  const { weeklyFiles, monthlyFiles } = getDrmSummary();

  const lastAnalysisDate = findLastAnalysisDate(weeklyFiles);
  const failedDates: string[] = [];

  for (const w of weeklyFiles) {
    if (w.detail === 'daily') {
      for (const [date, d] of Object.entries((w as WeeklyRecordDaily).days)) {
        if (d.error) failedDates.push(date);
      }
    }
  }
  failedDates.sort();

  return {
    todayCount: entries.length,
    lastAnalysisDate,
    weeklyCount: weeklyFiles.length,
    monthlyCount: monthlyFiles.length,
    failedDates,
  };
}

function buildPatternsResponse(): object {
  ensureDirectories();
  const { weeklyFiles, monthlyFiles } = getDrmSummary();

  // Collect individual day records from daily-detail weekly files (DAYS section)
  const allDays: Array<{ date: string; avgScore: number; promptCount: number; error?: boolean }> = [];
  for (const w of weeklyFiles) {
    if (w.detail !== 'daily') continue;
    for (const [date, d] of Object.entries((w as WeeklyRecordDaily).days)) {
      allDays.push({ date, avgScore: d.avgScore, promptCount: d.promptCount, error: d.error });
    }
  }
  // Sort descending by date, take last 7 analyzed days
  allDays.sort((a, b) => b.date.localeCompare(a.date));
  const days = allDays.slice(0, 7);

  // WEEKLY section: compressed records only (daily-detail days are surfaced in DAYS)
  const weekly = weeklyFiles
    .filter(w => w.detail === 'compressed')
    .map(w => ({
      week: w.week,
      detail: 'compressed',
      avgScore: (w as WeeklyRecordCompressed).avgScore,
      promptCount: (w as WeeklyRecordCompressed).promptCount,
      topPatterns: (w as WeeklyRecordCompressed).topPatterns,
    }));

  const monthly: MonthlyRecord[] = monthlyFiles;
  return { days, weekly, monthly };
}

function buildLastResponse(): object {
  ensureDirectories();
  const entries = readTodayEntries();
  const prompts = entries.slice(-10).map(e => e.prompt);
  return { prompts };
}

function buildDetailResponse(type: string, id: string): object {
  ensureDirectories();
  if (type === 'week') {
    const record = getWeeklyDetail(id);
    if (!record) return { error: 'Not found' };
    return record;
  } else if (type === 'month') {
    const record = getMonthlyDetail(id);
    if (!record) return { error: 'Not found' };
    return record;
  } else if (type === 'day') {
    const record = getDayDetail(id);
    if (!record) return { error: 'Not found' };
    return record;
  }
  return { error: 'Invalid type' };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function sendJson(res: http.ServerResponse, status: number, data: object): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
}

/**
 * Starts the PromptIQ HTTP dashboard server on the given port.
 * Binding is asynchronous; listen for the 'listening' event before printing the URL.
 *
 * Throws EADDRINUSE error (caught by caller in cli.ts via the 'error' event).
 */
export function startServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    if (method !== 'GET') {
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    try {
      if (url === '/' || url === '/index.html') {
        return sendHtml(res, DASHBOARD_HTML);
      } else if (url === '/api/status') {
        return sendJson(res, 200, buildStatusResponse());
      } else if (url === '/api/patterns') {
        return sendJson(res, 200, buildPatternsResponse());
      } else if (url === '/api/last') {
        return sendJson(res, 200, buildLastResponse());
      } else if (url.startsWith('/api/detail')) {
        const qs = new URL(url, 'http://localhost').searchParams;
        const type = qs.get('type') ?? '';
        const id = qs.get('id') ?? '';
        return sendJson(res, 200, buildDetailResponse(type, id));
      } else {
        return sendJson(res, 404, { error: 'Not found' });
      }
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  });

  server.listen(port);
  return server;
}
