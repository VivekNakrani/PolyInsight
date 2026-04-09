/**
 * SolRouter connection test script.
 *
 * Verifies that the SOLROUTER_API_KEY in .env is valid by:
 *  1. Fetching the account balance
 *  2. Running a test encrypted chat
 *
 * Usage: node test-balance.js
 */

import 'dotenv/config';
import { SolRouter } from '@solrouter/sdk';

const apiKey = process.env.SOLROUTER_API_KEY;

if (!apiKey || apiKey.startsWith('sk_solrouter_your')) {
  console.error('SOLROUTER_API_KEY not set in .env');
  process.exit(1);
}

const client = new SolRouter({ apiKey });

async function main() {
  try {
    console.log('--- Verifying API key ---');
    const balance = await client.getBalance();
    console.log('API key valid.');
    console.log('Balance:', balance.balanceFormatted);

    if (balance.balance <= 0) {
      console.log('\nBalance is zero — fund your account at https://app.solrouter.com');
    }

    console.log('\n--- Testing encrypted chat ---');
    const response = await client.chat('Hello, are you functional?');
    console.log('Response:', response.message || response.reply);

    console.log('\nAll checks passed ✓\n');
  } catch (err) {
    console.error('Connection error:', err.message);
    process.exit(1);
  }
}

main();
