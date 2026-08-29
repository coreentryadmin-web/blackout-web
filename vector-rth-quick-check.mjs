#!/usr/bin/env node

/**
 * Quick Vector RTH validation — check walls, full-state fit, session
 */

import fetch from 'node-fetch';

const base = 'https://blackouttrades.com';
const tickers = ['SPX', 'SPY', 'QQQ', 'META'];

async function checkWalls() {
  console.log('🔄 Checking wall freshness...');
  for (const ticker of tickers) {
    try {
      const res = await fetch(`${base}/api/market/vector/walls?ticker=${ticker}`, {
        timeout: 5000,
      });
      if (!res.ok) {
        console.log(`  ⚠ ${ticker}: ${res.status}`);
        continue;
      }
      const data = await res.json();
      const hasCall = data.callWalls?.length > 0;
      const hasPut = data.putWalls?.length > 0;
      console.log(`  ✓ ${ticker}: call=${hasCall} put=${hasPut}`);
    } catch (e) {
      console.log(`  ❌ ${ticker}: ${e.message}`);
    }
  }
}

async function checkFullState() {
  console.log('\n🔄 Checking full-state fit...');
  try {
    const res = await fetch(`${base}/api/market/vector/full-state`, { timeout: 5000 });
    if (!res.ok) {
      console.log(`  ⚠ Endpoint: ${res.status}`);
      return;
    }
    const data = await res.json();
    const chars = JSON.stringify(data).length;
    const pct = ((chars / 16000) * 100).toFixed(1);
    console.log(`  ✓ Full-state: ${chars} chars (${pct}% of 16k)`);
  } catch (e) {
    console.log(`  ❌ Full-state: ${e.message}`);
  }
}

async function run() {
  console.log(`\n📊 Vector RTH Check — ${new Date().toISOString()}\n`);
  await checkWalls();
  await checkFullState();
  console.log('\n✓ Done.\n');
}

run().catch(e => console.error(e));
