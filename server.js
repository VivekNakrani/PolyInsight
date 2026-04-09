/**
 * PolyInsight Express Server
 *
 * Provides two sets of routes:
 *  - /api/markets* — proxies the Polymarket Gamma API (public, no auth needed)
 *  - /api/analyze  — runs encrypted AI inference via SolRouter and returns the result
 *
 * The SOLROUTER_API_KEY can be set server-side in .env, or passed per-request
 * from the frontend (stored in localStorage by the user).
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fetchMarkets, fetchMarket } from './agent/polymarket.js';
import { analyzeMarket } from './agent/solrouter.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// ── Health check ──────────────────────────────────────────────────────────────
// Used by the frontend to determine whether a server-side API key is configured.
app.get('/api/health', (req, res) => {
  const hasServerKey =
    !!process.env.SOLROUTER_API_KEY &&
    !process.env.SOLROUTER_API_KEY.startsWith('sk_solrouter_your');
  res.json({ status: 'ok', hasServerKey, timestamp: new Date().toISOString() });
});

// ── Markets ───────────────────────────────────────────────────────────────────

// List active markets, sorted and filtered by query params.
app.get('/api/markets', async (req, res) => {
  try {
    const { search = '', limit = '50', order = 'volume24hr' } = req.query;
    const markets = await fetchMarkets({
      search,
      limit: Math.min(parseInt(limit) || 50, 100),
      order,
      active: true,
    });
    res.json({ success: true, markets, count: markets.length });
  } catch (err) {
    console.error('[markets]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch a single market by its Gamma API market ID.
app.get('/api/markets/:id', async (req, res) => {
  try {
    const market = await fetchMarket(req.params.id);
    res.json({ success: true, market });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// Lookup a market by its event slug (from a pasted polymarket.com/event/<slug> URL).
// Queries the Gamma API events endpoint first, then normalises via fetchMarket().
app.get('/api/markets/by-slug/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;

    // 1. Try events endpoint first since most shareable links are events
    const eventRes = await fetch(
      `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`
    );
    const events = await eventRes.json();

    let targetMarketId = null;

    if (events && events.length > 0 && events[0].markets && events[0].markets.length > 0) {
      // Pick the most liquid market from the event
      const sortedMarkets = events[0].markets.sort((a, b) => parseFloat(b.liquidity || 0) - parseFloat(a.liquidity || 0));
      targetMarketId = sortedMarkets[0].id;
    } else {
      // 2. Fallback to markets endpoint
      const raw = await fetch(
        `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}&active=true`
      );
      const markets = await raw.json();

      if (markets && markets.length > 0) {
        const match =
          markets.find(m => m.slug === slug) ||
          markets[0];
        targetMarketId = match.id;
      }
    }

    if (!targetMarketId) {
      return res.status(404).json({ success: false, error: 'Market not found for that slug' });
    }

    // Parse with fetchMarket() to apply normalisation (formatMarket)
    const market = await fetchMarket(targetMarketId);
    res.json({ success: true, market });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Analysis ──────────────────────────────────────────────────────────────────

// Run AI analysis on a market via SolRouter (encrypted SDK or agent API).
// Accepts an optional `apiKey` in the request body so the user can supply
// their own key from the frontend without it being stored server-side.
app.post('/api/analyze', async (req, res) => {
  const { marketId, question, useTools = false, apiKey } = req.body;

  // Server-side key takes priority; fall back to user-supplied key
  const resolvedKey = process.env.SOLROUTER_API_KEY || apiKey;

  if (!resolvedKey || resolvedKey.startsWith('sk_solrouter_your')) {
    return res.status(401).json({
      success: false,
      error: 'SolRouter API key required. Add it to .env or enter it in the UI.',
    });
  }

  if (!marketId) {
    return res.status(400).json({ success: false, error: 'marketId is required' });
  }

  try {
    const market = await fetchMarket(marketId);
    const result = await analyzeMarket(resolvedKey, market, question || '', useTools);

    res.json({
      success: true,
      market: { id: market.id, question: market.question },
      analysis: result.message,
      encrypted: result.encrypted,
      source: result.source,
      toolCalls: result.toolCalls || [],
      iterations: result.iterations || null,
      skillGraph: result.skillGraph || null,
    });
  } catch (err) {
    console.error('[analyze]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const keyStatus = process.env.SOLROUTER_API_KEY
    ? 'Loaded from .env ✓'
    : 'Not found — users must supply their own key';
  console.log(`
PolyInsight SERVER
================
URL:     http://localhost:${PORT}
API KEY: ${keyStatus}
`);
});

export default app;

