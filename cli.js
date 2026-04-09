#!/usr/bin/env node
/**
 * PolyInsight CLI — Private Polymarket research via SolRouter encrypted inference.
 *
 * Usage:
 *   node cli.js "<search query>"          # encrypted SDK (E2E private)
 *   node cli.js "<search query>" --deep   # deep research (web + on-chain tools)
 *   node cli.js "<search query>" --tools  # alias for --deep
 *
 * Requires SOLROUTER_API_KEY in .env
 */

import 'dotenv/config';
import { fetchMarkets } from './agent/polymarket.js';
import { analyzeMarket } from './agent/solrouter.js';

const args = process.argv.slice(2);
const useTools = args.includes('--tools') || args.includes('--deep');
const query = args.filter(a => !a.startsWith('-')).join(' ');

const apiKey = process.env.SOLROUTER_API_KEY;

if (!apiKey || apiKey.startsWith('sk_solrouter_your')) {
  console.error('\nSOLROUTER_API_KEY not set. Add your key to .env.\n');
  process.exit(1);
}

async function run() {
  console.log('\nPolyInsight CLI');
  console.log('------------\n');

  if (!query) {
    console.log('Usage: node cli.js "<search query>" [--deep | --tools]\n');
    process.exit(0);
  }

  console.log(`Searching: "${query}"\n`);

  const markets = await fetchMarkets({ search: query, limit: 50 });

  if (markets.length === 0) {
    console.log('No markets found.');
    process.exit(0);
  }

  // Use the top result (sorted by 24h volume by default)
  const market = markets[0];

  console.log(`Market: ${market.question}`);
  console.log(`YES: ${market.yesPercent}% | NO: ${market.noPercent}%`);
  console.log(`Volume: $${(market.volume / 1e6).toFixed(2)}M`);
  console.log(`URL: ${market.polymarketUrl}\n`);
  console.log(`Mode: ${useTools ? 'Deep Research Agent (Web + On-chain)' : 'Encrypted SDK (E2E encrypted)'}`);
  console.log('\nAnalyzing via SolRouter...\n');

  try {
    const result = await analyzeMarket(apiKey, market, query, useTools);

    console.log('------------------------------------------------------------');
    console.log('ANALYSIS');
    console.log('------------------------------------------------------------');
    console.log(result.message);
    console.log('------------------------------------------------------------');

    if (result.encrypted) {
      console.log('\n[Encrypted via SolRouter]');
    }
    if (result.toolCalls?.length) {
      console.log(`\nTools used: ${result.toolCalls.map(t => t.tool).join(', ')}`);
    }

    console.log('\nDone.\n');
  } catch (err) {
    console.error(`\nError: ${err.message}\n`);
    process.exit(1);
  }
}

run().catch(console.error);
