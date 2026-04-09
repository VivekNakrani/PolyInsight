// PolyInsight — Frontend Application Logic v2

// ── Markdown renderer setup ────────────────────────────────────────────────────
const renderer = new marked.Renderer();
marked.setOptions({ renderer, breaks: true, gfm: true });

// ── State ─────────────────────────────────────────────────────────────────────
let allMarkets = [];
let filteredMarkets = [];
let selectedMarket = null;
let activeCategory = 'All';
let analysisStartTime = null;
let timerInterval = null;
let analysisRawText = '';

// ── DOM ───────────────────────────────────────────────────────────────────────
const marketList = document.getElementById('marketList');
const marketCount = document.getElementById('marketCount');
const searchInput = document.getElementById('searchInput');
const urlHint = document.getElementById('urlHint');
const filterRow = document.getElementById('filterRow');
const sortSelect = document.getElementById('sortSelect');
const emptyState = document.getElementById('emptyState');
const analysisPanel = document.getElementById('analysisPanel');
const analyzeBtn = document.getElementById('analyzeBtn');
const researchQuestion = document.getElementById('researchQuestion');
const useToolsToggle = document.getElementById('useToolsToggle');
const toggleText = document.getElementById('toggleText');
const toggleDesc = document.getElementById('toggleDesc');
const analysisOutput = document.getElementById('analysisOutput');
const analysisLoading = document.getElementById('analysisLoading');
const analysisText = document.getElementById('analysisText');
const toolCallsInfo = document.getElementById('toolCallsInfo');
const selectedImage = document.getElementById('selectedImage');
const promptChips = document.getElementById('promptChips');
const copyBtn = document.getElementById('copyBtn');
const loadingTitle = document.getElementById('loadingTitle');
const loadingTimer = document.getElementById('loadingTimer');
const outputTime = document.getElementById('outputTime');

// ── API Key ───────────────────────────────────────────────────────────────────
function getApiKey() {
  return localStorage.getItem('solrouter_api_key') || '';
}

async function checkApiKey() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    return data.hasServerKey || !!getApiKey();
  } catch {
    return false;
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.textContent = msg;
  const color = type === 'error' ? '#ef4444' : '#34d399';
  const bg = type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(52,211,153,0.1)';
  el.style.cssText = `
    position:fixed; bottom:64px; right:24px; z-index:9999;
    background:#1a2235; border:1px solid ${color}4d; color:${color};
    padding:10px 18px; border-radius:8px; font-size:13px; font-weight:500;
    box-shadow:0 4px 20px rgba(0,0,0,0.6); animation:fade-in 0.2s ease;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmtMoney(n) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtChange(v) {
  if (v == null || isNaN(v)) return 'UNCHANGED';
  const pct = (v * 100).toFixed(1);
  return v > 0 ? `+${pct}%` : `${pct}%`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Toggle behavior ───────────────────────────────────────────────────────────
useToolsToggle.addEventListener('change', () => {
  if (useToolsToggle.checked) {
    toggleText.textContent = 'Deep Research';
    toggleDesc.textContent = 'Web + on-chain signals';
  } else {
    toggleText.textContent = 'Encrypted SDK';
    toggleDesc.textContent = 'E2E private inference';
  }
});

// ── Market Card ───────────────────────────────────────────────────────────────
function createMarketCard(market) {
  const card = document.createElement('div');
  card.className = 'market-card';
  card.dataset.id = market.id;
  card.setAttribute('role', 'listitem');

  const yesPct = market.yesPercent;
  const imageUrl = market.image || market.icon || '';

  card.innerHTML = `
    <div class="card-img-container">
      ${imageUrl ? `<img src="${imageUrl}" alt="" class="card-img" loading="lazy" />` : ''}
    </div>
    <div class="card-content">
      <div class="card-question">${escapeHtml(market.question)}</div>
      <div class="card-meta-row">
        <div class="card-meta">${market.category} | ${fmtMoney(market.volume24h)} VOL</div>
        <div class="card-pcts">${yesPct}% YES</div>
      </div>
    </div>
  `;

  card.addEventListener('click', () => selectMarket(market));
  return card;
}

// ── Render markets ────────────────────────────────────────────────────────────
function renderMarkets(markets) {
  marketList.innerHTML = '';
  if (markets.length === 0) {
    marketList.innerHTML = '<div class="no-results" style="color:var(--text-muted);text-align:center;padding:32px 0">No markets found.</div>';
    marketCount.textContent = '0';
    return;
  }
  marketCount.textContent = markets.length;
  markets.forEach(m => marketList.appendChild(createMarketCard(m)));

  if (selectedMarket) {
    const card = marketList.querySelector(`[data-id="${selectedMarket.id}"]`);
    if (card) card.classList.add('selected');
  }
}

function applyFilters() {
  const search = searchInput.value.toLowerCase().trim();
  // Don't filter if it looks like a URL
  if (isPolymarketUrl(search)) return;
  filteredMarkets = allMarkets.filter(m => {
    const matchCat = activeCategory === 'All' || m.category === activeCategory;
    const matchSearch = !search || m.question.toLowerCase().includes(search);
    return matchCat && matchSearch;
  });
  renderMarkets(filteredMarkets);
}

// ── Polymarket URL detection & resolution ─────────────────────────────────────
function isPolymarketUrl(val) {
  return val.includes('polymarket.com/event/');
}

function extractSlugFromUrl(url) {
  try {
    const u = new URL(url.trim().startsWith('http') ? url.trim() : 'https://' + url.trim());
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('event');
    return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
  } catch {
    return null;
  }
}

async function loadMarketBySlug(slug) {
  showToast(`Looking up market: ${slug}...`);
  try {
    // First try the direct Gamma API slug lookup
    const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}&active=true&limit=10`);
    const raw = await res.json();
    if (raw && raw.length > 0) {
      // Find best match by slug
      const match = raw.find(r => r.slug === slug || r.groupItemTitle === slug) || raw[0];
      const formatted = await fetchAndFormatMarket(match.id);
      if (formatted) {
        selectMarket(formatted);
        // Make sure it appears highlighted in the list if visible
        const card = marketList.querySelector(`[data-id="${formatted.id}"]`);
        if (card) card.classList.add('selected');
        return;
      }
    }
    showToast('Market not found for that URL', 'error');
  } catch (err) {
    showToast('Failed to load market from URL', 'error');
    console.error(err);
  }
}

async function fetchAndFormatMarket(id) {
  try {
    const res = await fetch(`/api/markets/${id}`);
    const data = await res.json();
    return data.success ? data.market : null;
  } catch {
    return null;
  }
}

// Search input handler — URL or text
searchInput.addEventListener('input', () => {
  const val = searchInput.value;
  if (isPolymarketUrl(val)) {
    searchInput.classList.add('url-mode');
    urlHint.style.display = 'flex';
  } else {
    searchInput.classList.remove('url-mode');
    urlHint.style.display = 'none';
    applyFilters();
  }
});

searchInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const val = searchInput.value.trim();
    if (isPolymarketUrl(val)) {
      const slug = extractSlugFromUrl(val);
      if (slug) {
        await loadMarketBySlug(slug);
        searchInput.value = '';
        searchInput.classList.remove('url-mode');
        urlHint.style.display = 'none';
      }
    }
  }
});

filterRow.addEventListener('click', (e) => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  activeCategory = chip.dataset.category;
  applyFilters();
});

sortSelect.addEventListener('change', () => {
  loadMarkets(sortSelect.value);
});

async function loadMarkets(order = 'volume24hr') {
  try {
    const res = await fetch(`/api/markets?limit=80&order=${order}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    allMarkets = data.markets;
    applyFilters();
  } catch (err) {
    console.error(err);
  }
}

// ── AI Suggested Prompts ──────────────────────────────────────────────────────
function generateSuggestedPrompts(market) {
  const prompts = [];
  const yes = market.yesPercent;
  const change = market.oneDayPriceChange;

  // Always include
  prompts.push('Is this market mispriced?');

  // Odds-based
  if (yes >= 80) prompts.push(`Why is YES priced so high at ${yes}%?`);
  else if (yes <= 20) prompts.push(`Why is YES priced so low at ${yes}%?`);
  else if (yes >= 55 && yes < 80) prompts.push(`What's driving the YES edge here?`);
  else if (yes <= 45) prompts.push(`What could push this above 50%?`);
  else prompts.push('Where is the edge close to 50/50?');

  // Momentum
  if (Math.abs(change) > 0.05) {
    const dir = change > 0 ? 'surged' : 'dropped';
    prompts.push(`Why has YES ${dir} ${Math.abs(change * 100).toFixed(0)}% today?`);
  } else {
    prompts.push('What are the key catalysts this week?');
  }

  // Category-specific
  const cat = market.category;
  if (cat === 'Crypto') prompts.push('What on-chain signals matter here?');
  else if (cat === 'Politics') prompts.push('What polls or events are driving this?');
  else if (cat === 'Geopolitics') prompts.push('How would a surprise escalation affect this?');
  else if (cat === 'Economy') prompts.push('What macro data should I watch?');
  else if (cat === 'Sports') prompts.push('What injury reports or odds movements matter?');
  else prompts.push('What risk factors could flip the outcome?');

  // Liquidity-based
  if (market.liquidity > 500000) prompts.push('Is this market efficient given its liquidity?');

  return prompts.slice(0, 4);
}

function renderPromptChips(market) {
  const suggestions = generateSuggestedPrompts(market);
  promptChips.innerHTML = '';
  suggestions.forEach(text => {
    const chip = document.createElement('button');
    chip.className = 'prompt-chip';
    chip.textContent = text;
    chip.addEventListener('click', () => {
      researchQuestion.value = text;
      researchQuestion.focus();
    });
    promptChips.appendChild(chip);
  });
}

// ── Select Market ─────────────────────────────────────────────────────────────
function selectMarket(market) {
  selectedMarket = market;
  document.querySelectorAll('.market-card').forEach(c => c.classList.remove('selected'));
  const card = marketList.querySelector(`[data-id="${market.id}"]`);
  if (card) card.classList.add('selected');

  emptyState.classList.add('hidden');
  analysisPanel.classList.remove('hidden');

  const imageUrl = market.image || market.icon || '';
  if (imageUrl) {
    selectedImage.src = imageUrl;
    selectedImage.classList.remove('hidden');
  } else {
    selectedImage.classList.add('hidden');
  }

  document.getElementById('selectedCategory').textContent = market.category;
  document.getElementById('selectedQuestion').textContent = market.question;
  document.getElementById('selectedClose').textContent = `CLOSES ${market.endDate || 'N/A'}`;
  document.getElementById('polymarketLink').href = market.polymarketUrl;

  document.getElementById('yesPct').textContent = `${market.yesPercent}%`;
  document.getElementById('noPct').textContent = `${market.noPercent}%`;
  document.getElementById('oddsBarYes').style.width = `${market.yesPercent}%`;
  document.getElementById('oddsBarNo').style.width = `${market.noPercent}%`;

  document.getElementById('stat24hVol').textContent = fmtMoney(market.volume24h);
  document.getElementById('statLiquidity').textContent = fmtMoney(market.liquidity);
  document.getElementById('stat7dVol').textContent = fmtMoney(market.volume7d);
  document.getElementById('statTotalVol').textContent = fmtMoney(market.volume);
  document.getElementById('statSpread').textContent = `${(market.spread * 100).toFixed(2)}%`;

  const changeEl = document.getElementById('stat24hChange');
  const change = market.oneDayPriceChange;
  changeEl.textContent = fmtChange(change);
  changeEl.style.color = change > 0 ? 'var(--yes)' : change < 0 ? 'var(--no)' : 'var(--text-muted)';

  analysisOutput.classList.add('hidden');
  analysisLoading.classList.add('hidden');
  researchQuestion.value = '';
  analysisRawText = '';

  // Generate AI prompt suggestions
  renderPromptChips(market);

  // Re-render Lucide icons injected dynamically
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Scroll the right panel to top
  document.querySelector('.panel-right').scrollTop = 0;
}

// ── Animated Loading ──────────────────────────────────────────────────────────
const STEPS = [
  { id: 'step1', title: 'Encrypting prompt via Arcium RescueCipher...' },
  { id: 'step2', title: 'Routing to TEE Secure Enclave...' },
  { id: 'step3', title: 'AI synthesizing market analysis...' },
  { id: 'step4', title: 'Decrypting response...' },
];

let stepTimeouts = [];

function clearStepTimeouts() {
  stepTimeouts.forEach(t => clearTimeout(t));
  stepTimeouts = [];
}

function startLoadingAnimation(useTools) {
  // Update step 3 label if deep research
  document.getElementById('step3Name').textContent = useTools
    ? 'Deep Research Agent running...'
    : 'Processing with AI';
  document.getElementById('step3Detail').textContent = useTools
    ? 'Web search + on-chain signals + synthesis'
    : 'Synthesizing market intelligence...';

  // Reset all steps
  STEPS.forEach(s => {
    const el = document.getElementById(s.id);
    el.classList.remove('active', 'done');
  });

  loadingTitle.textContent = STEPS[0].title;

  // Step activation timing (staggered, steps 1-2 fast, step 3 slow for deep research)
  const timings = useTools
    ? [0, 1200, 2800, null]    // step 4 fires on API return
    : [0, 800, 1800, null];

  timings.forEach((delay, i) => {
    if (delay === null) return;
    const t = setTimeout(() => {
      // Mark previous step done
      if (i > 0) {
        document.getElementById(STEPS[i - 1].id).classList.remove('active');
        document.getElementById(STEPS[i - 1].id).classList.add('done');
      }
      document.getElementById(STEPS[i].id).classList.add('active');
      loadingTitle.textContent = STEPS[i].title;
    }, delay);
    stepTimeouts.push(t);
  });
}

function finalizeLoadingAnimation() {
  clearStepTimeouts();
  // Mark all remaining active steps as done, activate step 4
  STEPS.forEach((s, i) => {
    const el = document.getElementById(s.id);
    if (i < 3) {
      el.classList.remove('active');
      el.classList.add('done');
    } else {
      el.classList.add('active');
    }
  });
  loadingTitle.textContent = STEPS[3].title;
  document.getElementById('step3').classList.add('done');
  document.getElementById('step3').classList.remove('active');
  document.getElementById('step4').classList.add('active');
}

function startTimer() {
  analysisStartTime = Date.now();
  loadingTimer.textContent = '0.0s';
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsed = ((Date.now() - analysisStartTime) / 1000).toFixed(1);
    loadingTimer.textContent = `${elapsed}s`;
  }, 100);
}

function stopTimer() {
  clearInterval(timerInterval);
  const elapsed = ((Date.now() - analysisStartTime) / 1000).toFixed(1);
  return elapsed;
}

// ── Copy button ───────────────────────────────────────────────────────────────
copyBtn.addEventListener('click', () => {
  if (!analysisRawText) return;
  navigator.clipboard.writeText(analysisRawText).then(() => {
    copyBtn.classList.add('copied');
    copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied`;
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> Copy`;
    }, 2000);
  });
});

// ── Analyze ───────────────────────────────────────────────────────────────────
async function analyzeMarket() {
  if (!selectedMarket) return;
  const apiKey = getApiKey();
  const question = researchQuestion.value.trim();
  const useTools = useToolsToggle.checked;

  analyzeBtn.disabled = true;
  analyzeBtn.querySelector('.btn-text').textContent = 'Analyzing...';
  analysisOutput.classList.add('hidden');
  analysisLoading.classList.remove('hidden');

  // Scroll to loading
  analysisLoading.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  startTimer();
  startLoadingAnimation(useTools);

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketId: selectedMarket.id, question, useTools, apiKey }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    finalizeLoadingAnimation();

    // Short pause to show step 4 completing
    await new Promise(r => setTimeout(r, 600));

    const elapsed = stopTimer();

    analysisLoading.classList.add('hidden');
    analysisOutput.classList.remove('hidden');

    document.getElementById('encBadge').textContent = data.encrypted ? 'ENCRYPTED' : 'TEE SECURE';
    document.getElementById('sourceBadge').textContent = data.source === 'solrouter-sdk' ? 'SDK' : 'RESEARCH';
    outputTime.textContent = `${elapsed}s`;

    if (data.toolCalls?.length) {
      toolCallsInfo.classList.remove('hidden');
      toolCallsInfo.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px"><i data-lucide="search" width="11" height="11" style="display:inline"></i> TOOLS USED: ${data.toolCalls.map(t => escapeHtml(t.tool)).join(', ')}</span>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } else {
      toolCallsInfo.classList.add('hidden');
    }

    // Render markdown
    analysisRawText = data.analysis;
    const rendered = DOMPurify.sanitize(marked.parse(analysisRawText));
    analysisText.innerHTML = rendered;

    analysisOutput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch (err) {
    clearStepTimeouts();
    stopTimer();
    analysisLoading.classList.add('hidden');
    analysisOutput.classList.remove('hidden');
    toolCallsInfo.classList.add('hidden');
    analysisRawText = '';
    analysisText.innerHTML = `<p style="color:var(--no)">${escapeHtml(err.message)}</p>`;
    showToast(err.message, 'error');
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.querySelector('.btn-text').textContent = 'Analyze with SolRouter';
  }
}

analyzeBtn.addEventListener('click', analyzeMarket);

// Allow Ctrl+Enter to submit
researchQuestion.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') analyzeMarket();
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await checkApiKey();
  await loadMarkets();
}
init();
