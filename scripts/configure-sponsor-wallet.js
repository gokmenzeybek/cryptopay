#!/usr/bin/env node

/**
 * Configure the XRPL testnet sponsor wallet in the local .env file.
 * The seed is read without terminal echo and is never printed.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const xrpl = require('xrpl');

const envPath = path.resolve(process.cwd(), '.env');

function askHidden(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run this utility from an interactive terminal');
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const stdin = process.stdin;
    let input = '';

    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (chunk) => {
      if (chunk === '\u0003') {
        stdin.setRawMode(false);
        rl.close();
        process.stdout.write('\n');
        process.exit(130);
      }
      if (chunk === '\r' || chunk === '\n') {
        stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        rl.close();
        process.stdout.write('\n');
        resolve(input);
        return;
      }
      if (chunk === '\u007f') {
        input = input.slice(0, -1);
        return;
      }
      input += chunk;
    };

    stdin.on('data', onData);
  });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

function setEnvValue(contents, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}\n`;
}

async function main() {
  const suppliedAddress = process.argv[2] || await ask('Sponsor wallet address: ');
  const seed = await askHidden('Sponsor wallet seed (hidden): ');

  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(suppliedAddress)) {
    throw new Error('Invalid XRPL address');
  }

  const wallet = xrpl.Wallet.fromSeed(seed);
  if (wallet.classicAddress !== suppliedAddress) {
    throw new Error('The seed does not match the supplied wallet address');
  }

  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const updated = setEnvValue(setEnvValue(current, 'SPONSOR_SEED', seed), 'SPONSOR_ADDRESS', suppliedAddress);
  fs.writeFileSync(envPath, updated, { mode: 0o600 });

  console.log(`Configured SPONSOR_ADDRESS=${suppliedAddress} in ${envPath}`);
  console.log('SPONSOR_SEED was written locally but not displayed. Copy both values to Render Environment settings.');
}

main().catch((error) => {
  console.error(`Configuration failed: ${error.message}`);
  process.exitCode = 1;
});
