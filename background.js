// Drift — Background Service Worker
// Tracks browsing behavior and maintains the calm score (0–100).
// All data stays local. Nothing leaves your device.

'use strict';

// ─── DOMAIN CLASSIFICATION ────────────────────────────────
const PRODUCTIVE = new Set([
  // Docs & writing
  'docs.google.com', 'sheets.google.com', 'slides.google.com',
  'notion.so', 'notion.com', 'obsidian.md', 'roamresearch.com',
  'coda.io', 'airtable.com', 'dropbox.com',
  // Dev & code
  'github.com', 'gitlab.com', 'bitbucket.org',
  'stackoverflow.com', 'developer.mozilla.org',
  'replit.com', 'codepen.io', 'jsfiddle.net', 'codesandbox.io',
  'vercel.com', 'netlify.com', 'heroku.com',
  // Project management
  'linear.app', 'asana.com', 'trello.com', 'jira.atlassian.com',
  'basecamp.com', 'clickup.com', 'monday.com',
  // Design
  'figma.com', 'sketch.com', 'framer.com',
  // Learning
  'coursera.org', 'udemy.com', 'khanacademy.org', 'edx.org',
  'arxiv.org', 'scholar.google.com', 'pubmed.ncbi.nlm.nih.gov',
  'wikipedia.org', 'britannica.com',
  // Communication (work)
  'mail.google.com', 'outlook.live.com', 'outlook.office.com',
  'slack.com', 'teams.microsoft.com',
  'zoom.us', 'meet.google.com', 'whereby.com',
  // Finance / focus
  'calendar.google.com', 'todoist.com', 'things3.com',
]);

const DISTRACTING = new Set([
  'reddit.com', 'old.reddit.com',
  'twitter.com', 'x.com',
  'facebook.com', 'instagram.com', 'threads.net',
  'tiktok.com', 'snapchat.com',
  'youtube.com',       // can be productive but often isn't
  'twitch.tv',
  'netflix.com', 'hulu.com', 'disneyplus.com', 'hbomax.com',
  'primevideo.com',
  'buzzfeed.com', 'dailymail.co.uk', 'tmz.com',
  'imgur.com', '9gag.com', 'ifunny.co',
  'pinterest.com', 'tumblr.com',
  'news.ycombinator.com', // debatable, but often a distraction
]);

// ─── STATE ────────────────────────────────────────────────
let state = {
  calmScore: 70,
  tabSwitches: [],   // timestamps of recent switches
  openTabCount: 0,
  currentDomain: '',
  isIdle: false,
  lastActivity: Date.now(),
};

// ─── HELPERS ──────────────────────────────────────────────
function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function classifyDomain(domain) {
  if (PRODUCTIVE.has(domain)) return 'productive';
  for (const d of DISTRACTING) {
    if (domain === d || domain.endsWith('.' + d)) return 'distracting';
  }
  return 'neutral';
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ─── CALM SCORE CALCULATION ───────────────────────────────
function recalcCalmScore() {
  const now = Date.now();
  const WINDOW = 10 * 60 * 1000; // 10-minute sliding window

  // Prune old tab switches
  state.tabSwitches = state.tabSwitches.filter(ts => now - ts < WINDOW);
  const switchCount = state.tabSwitches.length;

  let delta = 0;

  // Tab switching rate (main distraction signal)
  if      (switchCount < 3)  delta += 1.2;
  else if (switchCount < 6)  delta += 0;
  else if (switchCount < 12) delta -= 2.5;
  else if (switchCount < 20) delta -= 4.5;
  else                       delta -= 7;

  // Number of open tabs (cognitive load)
  if      (state.openTabCount <= 4)  delta += 0.8;
  else if (state.openTabCount <= 8)  delta += 0;
  else if (state.openTabCount <= 15) delta -= 1.2;
  else if (state.openTabCount <= 25) delta -= 2.5;
  else                               delta -= 4;

  // Idle state (focused reading or stepped away)
  if (state.isIdle) delta += 1.5;

  // Current domain quality
  const domainType = classifyDomain(state.currentDomain);
  if      (domainType === 'productive')   delta += 2.2;
  else if (domainType === 'distracting')  delta -= 3.8;

  // Gentle mean-reversion toward 65 (neutral)
  const neutral = 65;
  state.calmScore += (neutral - state.calmScore) * 0.04;

  // Apply delta at reduced rate (smooth changes)
  state.calmScore += delta * 0.28;

  // Hard clamp
  state.calmScore = clamp(state.calmScore, 8, 96);

  // Persist
  chrome.storage.local.set({
    calmScore: Math.round(state.calmScore),
    lastUpdated: now,
  });
}

// ─── EVENT LISTENERS ──────────────────────────────────────

// Tab switches
chrome.tabs.onActivated.addListener(async (info) => {
  state.tabSwitches.push(Date.now());
  state.lastActivity = Date.now();

  try {
    const tab = await chrome.tabs.get(info.tabId);
    if (tab.url) state.currentDomain = getDomain(tab.url);
  } catch (_) {}

  try {
    const all = await chrome.tabs.query({});
    state.openTabCount = all.length;
  } catch (_) {}

  recalcCalmScore();
});

// New tabs opened (burst of new tabs = distraction signal)
chrome.tabs.onCreated.addListener(async () => {
  try {
    const all = await chrome.tabs.query({});
    state.openTabCount = all.length;
  } catch (_) {}
  recalcCalmScore();
});

// Tabs closed
chrome.tabs.onRemoved.addListener(async () => {
  try {
    const all = await chrome.tabs.query({});
    state.openTabCount = all.length;
  } catch (_) {}
  recalcCalmScore();
});

// URL changes within tabs
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.active) return;
  if (tab.url) state.currentDomain = getDomain(tab.url);
  recalcCalmScore();
});

// Idle detection
chrome.idle.setDetectionInterval(90); // 90s of no input = idle
chrome.idle.onStateChanged.addListener((newState) => {
  state.isIdle = (newState === 'idle');
  recalcCalmScore();
});

// Periodic tick (every 30s)
chrome.alarms.create('drift-tick', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'drift-tick') recalcCalmScore();
});

// ─── INIT ─────────────────────────────────────────────────
async function init() {
  // Restore persisted score
  const stored = await chrome.storage.local.get(['calmScore']);
  if (stored.calmScore !== undefined) {
    state.calmScore = stored.calmScore;
  }

  // Snapshot current tabs
  try {
    const all = await chrome.tabs.query({});
    state.openTabCount = all.length;
    const active = all.find(t => t.active);
    if (active && active.url) state.currentDomain = getDomain(active.url);
  } catch (_) {}

  recalcCalmScore();
}

init();
