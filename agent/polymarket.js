/**
 * Polymarket Gamma API client.
 *
 * Per Polymarket docs, the recommended approach is:
 *   1. Use /events as the primary source — events contain their nested markets.
 *   2. The event's own `slug` is what goes into polymarket.com/event/<slug> URLs.
 *   3. The /markets endpoint embeds a hollow event object with no slug, so
 *      we must NOT rely on m.events[0].slug for URL generation.
 *
 * Docs: https://docs.polymarket.com/market-data/fetching-markets
 */

const GAMMA_API = 'https://gamma-api.polymarket.com';

/**
 * Fetch active markets via the Events endpoint.
 * Each event contains its nested markets + its own slug (the shareable URL piece).
 * We pick the most liquid market from each event and flatten into a list.
 *
 * @param {Object} options
 * @param {number} [options.limit=80]         - Max events to fetch
 * @param {string} [options.search='']        - Keyword filter
 * @param {string} [options.order='volume24hr'] - Sort: volume24hr | volume | liquidity
 * @returns {Promise<Array>} Normalised market objects
 */
export async function fetchMarkets({ limit = 80, search = '', order = 'volume24hr' } = {}) {
  // If searching, we need a larger pool (500 is API max) since we filter client-side
  const fetchLimit = search && search.trim() ? 500 : Math.min(parseInt(limit) || 80, 100);

  const params = new URLSearchParams({
    active: 'true',
    closed: 'false',
    limit: String(fetchLimit),
  });

  const res = await fetch(`${GAMMA_API}/events?${params}`);
  if (!res.ok) throw new Error(`Polymarket API error: ${res.status} ${res.statusText}`);

  const events = await res.json();
  if (!Array.isArray(events)) {
    throw new Error(`Unexpected Polymarket API response: ${JSON.stringify(events).slice(0, 200)}`);
  }

  // For each event, pick the most liquid active market and format it
  let markets = [];
  for (const event of events) {
    if (!event.markets || event.markets.length === 0) continue;

    // Sort markets by liquidity to pick the primary one
    const sorted = [...event.markets].sort(
      (a, b) => parseFloat(b.liquidityNum || b.liquidity || 0) - parseFloat(a.liquidityNum || a.liquidity || 0)
    );

    const primary = sorted[0];
    if (!primary.active || primary.closed) continue;

    markets.push(formatMarketFromEvent(primary, event));
  }

  // Client-side keyword filter
  if (search && search.trim()) {
    const term = search.toLowerCase();
    markets = markets.filter(m =>
      m.question?.toLowerCase().includes(term) ||
      m.eventTitle?.toLowerCase().includes(term) ||
      m.description?.toLowerCase().includes(term)
    );
  }

  // Sort
  if (order === 'volume24hr') {
    markets.sort((a, b) => b.volume24h - a.volume24h);
  } else if (order === 'volume') {
    markets.sort((a, b) => b.volume - a.volume);
  } else if (order === 'liquidity') {
    markets.sort((a, b) => b.liquidity - a.liquidity);
  }

  return markets;
}

/**
 * Fetch a single market by its Gamma API market ID.
 * Because the /markets/:id response embeds an empty event object,
 * we make a separate call to /events to resolve the correct event slug.
 *
 * @param {string} id - Gamma API market ID
 * @returns {Promise<Object>} Normalised market object
 */
export async function fetchMarket(id) {
  const res = await fetch(`${GAMMA_API}/markets/${id}`);
  if (!res.ok) throw new Error(`Market not found: ${id}`);
  const m = await res.json();

  // The embedded events object is hollow (no slug). We need to get the event
  // separately. Try fetching the event that contains this market by market slug.
  let eventSlug = '';
  let event = null;
  try {
    const eventRes = await fetch(`${GAMMA_API}/events?slug=${encodeURIComponent(m.slug)}`);
    const events = await eventRes.json();
    if (Array.isArray(events) && events.length > 0) {
      event = events[0];
      eventSlug = event.slug || '';
    }
  } catch {
    // non-fatal — fall back to market slug
  }

  // If event lookup didn't work, strip the trailing numeric suffix from market
  // slug to guess the event slug (e.g. "will-btc-hit-100k-123" → "will-btc-hit-100k")
  if (!eventSlug) {
    eventSlug = m.slug?.replace(/-\d+$/, '') || m.slug || '';
  }

  return formatMarket(m, eventSlug, null, event);
}

/**
 * Format a market that came embedded inside an Event object.
 * The event provides the correct slug and tags.
 *
 * @param {Object} m      - Raw market object (nested inside event)
 * @param {Object} event  - Parent event object from /events response
 * @returns {Object} Normalised market
 */
function formatMarketFromEvent(m, event) {
  // The event's own slug is the correct one for polymarket.com/event/<slug> URLs
  const eventSlug = event.slug || m.slug || '';
  const category = inferCategoryFromTags(event.tags || []) || inferCategory(m.question || '');
  return formatMarket(m, eventSlug, category, event);
}

/**
 * Core formatter — normalise a raw market object into a clean, consistent shape.
 *
 * @param {Object} m          - Raw market
 * @param {string} eventSlug  - The parent event slug (for building the URL)
 * @param {string|null} category
 * @param {Object|null} event - Parent event (for image fallback, context, etc.)
 * @returns {Object} Normalised market
 */
function formatMarket(m, eventSlug = '', category = null, event = null) {
  let outcomes = [];
  let prices = [];

  try { outcomes = JSON.parse(m.outcomes || '[]'); } catch { /* malformed — leave empty */ }
  try { prices = JSON.parse(m.outcomePrices || '[]'); } catch { /* malformed — leave empty */ }

  const yesPrice = parseFloat(prices[0] || 0);
  const noPrice  = parseFloat(prices[1] || (1 - yesPrice).toFixed(3));

  const resolvedCategory = category || inferCategory(m.question || '');

  // Build the URL — always use the event slug (the market slug is too granular)
  const polymarketUrl = eventSlug
    ? `https://polymarket.com/event/${eventSlug}`
    : 'https://polymarket.com';

  return {
    id:            m.id,
    question:      m.question || 'Unknown Market',
    description:   (m.description || '').slice(0, 2000),
    slug:          m.slug,
    eventSlug,
    eventTitle:    event?.title || null,
    image:         m.image  || event?.image  || null,
    icon:          m.icon   || event?.icon   || null,
    endDate:       m.endDateIso || m.endDate?.split('T')[0],
    active:        m.active,
    closed:        m.closed,
    outcomes,
    prices:        prices.map(p => parseFloat(p)),
    yesPrice,
    noPrice,
    yesPercent:    Math.round(yesPrice * 100),
    noPercent:     Math.round(noPrice * 100),
    liquidity:     parseFloat(m.liquidityNum || m.liquidity || 0),
    volume:        parseFloat(m.volumeNum    || m.volume    || 0),
    volume24h:     parseFloat(m.volume24hr   || 0),
    volume7d:      parseFloat(m.volume1wk    || 0),
    volume30d:     parseFloat(m.volume1mo    || 0),
    oneDayPriceChange:  parseFloat(m.oneDayPriceChange  || 0),
    oneWeekPriceChange: parseFloat(m.oneWeekPriceChange || 0),
    bestBid:       parseFloat(m.bestBid       || 0),
    bestAsk:       parseFloat(m.bestAsk       || 0),
    spread:        parseFloat(m.spread        || 0),
    competitive:   parseFloat(m.competitive   || 0),
    lastTradePrice: parseFloat(m.lastTradePrice || yesPrice),
    enableOrderBook: m.enableOrderBook,
    category:      resolvedCategory,
    polymarketUrl,
    eventContext:  event?.eventMetadata?.context_description || null,
  };
}

/**
 * Infer a display category from Polymarket's tag array.
 * This is more accurate than keyword matching on the question text.
 *
 * @param {Array} tags - Tag objects from the event ({ slug, label })
 * @returns {string|null}
 */
function inferCategoryFromTags(tags) {
  if (!tags || tags.length === 0) return null;

  const map = {
    politics: 'Politics', elections: 'Politics', 'us-politics': 'Politics', 'us politics': 'Politics',
    crypto: 'Crypto', bitcoin: 'Crypto', ethereum: 'Crypto', nft: 'Crypto', defi: 'Crypto', solana: 'Crypto',
    ai: 'Tech', technology: 'Tech', tech: 'Tech', science: 'Tech',
    sports: 'Sports', nba: 'Sports', nfl: 'Sports', soccer: 'Sports', tennis: 'Sports', baseball: 'Sports',
    economy: 'Economy', finance: 'Economy', stocks: 'Economy', business: 'Economy', economics: 'Economy',
    geopolitics: 'Geopolitics', world: 'Geopolitics', international: 'Geopolitics', war: 'Geopolitics',
    entertainment: 'Other', culture: 'Other', science: 'Other',
  };

  for (const tag of tags) {
    const slug  = (tag.slug  || '').toLowerCase().trim();
    const label = (tag.label || '').toLowerCase().trim();
    if (map[slug])  return map[slug];
    if (map[label]) return map[label];
  }
  return null;
}

/**
 * Fallback keyword-based category inference from question text.
 *
 * @param {string} question
 * @returns {string}
 */
function inferCategory(question) {
  const q = question.toLowerCase();
  if (q.includes('bitcoin') || q.includes('btc') || q.includes('eth') || q.includes('crypto') || q.includes('sol') || q.includes('token')) return 'Crypto';
  if (q.includes('trump') || q.includes('president') || q.includes('congress') || q.includes('senate') || q.includes('election') || q.includes('vote') || q.includes('democrat') || q.includes('republican')) return 'Politics';
  if (q.includes('ai') || q.includes('openai') || q.includes('gpt') || q.includes('gemini') || q.includes('apple') || q.includes('google') || q.includes('microsoft')) return 'Tech';
  if (q.includes('war') || q.includes('ceasefire') || q.includes('russia') || q.includes('ukraine') || q.includes('nato') || q.includes('china') || q.includes('iran')) return 'Geopolitics';
  if (q.includes('nba') || q.includes('nfl') || q.includes('world cup') || q.includes('championship') || q.includes('super bowl') || q.includes('playoff')) return 'Sports';
  if (q.includes('fed') || q.includes('interest rate') || q.includes('inflation') || q.includes('recession') || q.includes('gdp') || q.includes('stock') || q.includes('market cap')) return 'Economy';
  return 'Other';
}

/**
 * Build a structured text block describing a market for the AI prompt.
 *
 * @param {Object} market - Normalised market object
 * @returns {string}
 */
export function buildMarketContext(market) {
  const fmt = (n) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`;
  const changeText = (v) => v > 0 ? `up +${(v * 100).toFixed(1)}%` : v < 0 ? `down ${(v * 100).toFixed(1)}%` : 'unchanged';

  return `
POLYMARKET MARKET INTELLIGENCE BRIEF
=====================================
Question: ${market.question}
Category: ${market.category}
Closes: ${market.endDate}
Polymarket URL: ${market.polymarketUrl}

CURRENT ODDS
------------
YES: ${market.yesPercent}% (price: $${market.yesPrice.toFixed(3)})
NO:  ${market.noPercent}% (price: $${market.noPrice.toFixed(3)})
Last trade: $${market.lastTradePrice.toFixed(3)}
Spread: ${(market.spread * 100).toFixed(2)}%

MARKET ACTIVITY
---------------
Liquidity:    ${fmt(market.liquidity)}
24h Volume:   ${fmt(market.volume24h)}
7d Volume:    ${fmt(market.volume7d)}
30d Volume:   ${fmt(market.volume30d)}
Total Volume: ${fmt(market.volume)}

PRICE MOVEMENTS
---------------
24h change: ${changeText(market.oneDayPriceChange)}
7d change:  ${changeText(market.oneWeekPriceChange)}

RESOLUTION DETAILS
------------------
${market.description}

${market.eventContext ? `POLYMARKET ANALYST CONTEXT\n--------------------------\n${market.eventContext}` : ''}
`.trim();
}
