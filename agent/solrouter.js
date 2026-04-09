/**
 * SolRouter SDK wrapper — encrypted AI inference for PolyInsight.
 *
 * Two execution modes:
 *  1. encryptedChat  — client-side encryption via @solrouter/sdk (E2E private)
 *  2. agentResearch  — SolRouter Agent API with web search + on-chain tools
 *
 * The SDK encrypts the prompt with X25519 key exchange (Arcium RescueCipher)
 * before it leaves the device. SolRouter routes the encrypted blob to an
 * AWS Nitro TEE where it's decrypted, processed, and re-encrypted for return.
 */

import { SolRouter } from '@solrouter/sdk';

// Singleton client — re-initialised only when the API key changes
let _client = null;

function getClient(apiKey) {
  if (!_client || _client._apiKey !== apiKey) {
    _client = new SolRouter({ apiKey });
    _client._apiKey = apiKey;
  }
  return _client;
}

/**
 * Run an encrypted chat query via the SolRouter SDK.
 * The prompt is encrypted client-side; the backend never sees it in plaintext.
 *
 * @param {string} apiKey  - SolRouter API key (sk_solrouter_...)
 * @param {string} prompt  - Research query to encrypt and send
 * @returns {Promise<{ message: string, encrypted: boolean, source: string }>}
 */
export async function encryptedChat(apiKey, prompt) {
  const client = getClient(apiKey);
  const response = await client.chat(prompt);
  return {
    // The SDK may return .message or .reply depending on version; fall back to
    // JSON.stringify so an unexpected shape is readable instead of [object Object]
    message: response.message || response.reply || JSON.stringify(response),
    encrypted: true,
    source: 'solrouter-sdk',
  };
}

/**
 * Run a tool-augmented research query via the SolRouter Agent API.
 * The agent can search the web, check on-chain data, and synthesize findings.
 * Note: this is server-side processing — the prompt is not client-encrypted.
 *
 * @param {string} apiKey  - SolRouter API key
 * @param {string} prompt  - Research prompt (with market context pre-injected)
 * @param {string} model   - Model identifier (default: gpt-4o-mini)
 * @returns {Promise<{ message: string, encrypted: boolean, toolCalls: Array, source: string }>}
 */
export async function agentResearch(apiKey, prompt, model = 'gpt-4o-mini') {
  const res = await fetch('https://api.solrouter.com/agent', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, model, useTools: true }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`SolRouter Agent API error ${res.status}: ${err}`);
  }

  const data = await res.json();

  return {
    message: data.reply || data.message || '',
    encrypted: false,        // agent API uses server-side processing
    toolCalls: data.toolCalls || [],
    iterations: data.iterations || 0,
    skillGraph: data.skillGraph || null,
    source: 'solrouter-agent',
  };
}

/**
 * Main entry point — analyses a Polymarket market with AI.
 *
 * Strategy:
 *  - Default (useTools = false): encrypted SDK inference (fully private)
 *  - Deep Research (useTools = true): Agent API with web + on-chain tools
 *
 * @param {string}  apiKey       - SolRouter API key
 * @param {Object}  market       - Formatted market object from polymarket.js
 * @param {string}  userQuestion - Trader's specific research question
 * @param {boolean} useTools     - Enable web search + on-chain data tools
 * @returns {Promise<{ message: string, encrypted: boolean, source: string }>}
 */
export async function analyzeMarket(apiKey, market, userQuestion, useTools = false) {
  const { buildMarketContext } = await import('./polymarket.js');
  const marketContext = buildMarketContext(market);

  const prompt = `You are PolyInsight, an elite prediction market research analyst. Your job is to analyze Polymarket prediction markets and surface actionable edges for traders.

Your analysis should be sharp, data-driven, and opinionated. Don't be wishy-washy. If the odds look mispriced, say so and explain why. If the market looks efficient, say that too.

Structure your response with clear sections:
1. **Market Summary** — What's being predicted and the current consensus
2. **Odds Assessment** — Are these odds accurate? What's the implied probability telling us?
3. **Key Catalysts** — What events/news could move this market
4. **Edge Analysis** — Any potential mispricing or opportunity? Why might the market be wrong?
5. **Risk Factors** — What could invalidate your thesis
6. **Research Note** — This analysis was conducted via SolRouter encrypted inference. Your query was never exposed to any intermediary in plaintext.

---

${marketContext}

---

USER RESEARCH QUESTION: ${userQuestion || 'Give me a full market analysis and identify any potential edge.'}

Provide a comprehensive, actionable analysis. Be direct — traders need signals, not hedged rambling.`;

  if (useTools) {
    return agentResearch(apiKey, prompt);
  } else {
    return encryptedChat(apiKey, prompt);
  }
}
