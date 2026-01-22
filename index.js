import axios from 'axios';
import cfonts from 'cfonts';
import gradient from 'gradient-string';
import chalk from 'chalk';
import fs from 'fs/promises';
import readline from 'readline';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import ProgressBar from 'progress';
import ora from 'ora';
import boxen from 'boxen';
import Table from 'cli-table3';
import { runAllMapBattles } from './battle-browser.js';

const logger = {
  info: (msg, options = {}) => {
    const context = options.context ? `[${options.context}] ` : '';
    console.log(chalk.white(`[Acc ${context.trim() || 'Main'}] ${msg}`)); // Standard Sipal Log
  },
  success: (msg, options = {}) => {
    const context = options.context ? `[${options.context}] ` : '';
    console.log(chalk.green(`[Acc ${context.trim() || 'Main'}] ${msg}`)); // Standard Sipal Log
  },
  warn: (msg, options = {}) => {
    const context = options.context ? `[${options.context}] ` : '';
    console.log(chalk.yellow(`[Acc ${context.trim() || 'Main'}] ${msg}`)); // Standard Sipal Log
  },
  error: (msg, options = {}) => {
    const context = options.context ? `[${options.context}] ` : '';
    console.log(chalk.red(`[Acc ${context.trim() || 'Main'}] ${msg}`)); // Standard Sipal Log
  },
  debug: (msg, options = {}) => {
    const context = options.context ? `[${options.context}] ` : '';
    console.log(chalk.cyan(`[Acc ${context.trim() || 'Main'}] ${msg}`)); // Standard Sipal Log
  }
};

function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

// ==================== SCHEDULER HELPERS ====================

function getNextScheduledTime(hour = 7, minute = 30) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (now >= next) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
}

async function displayCountdown(msUntilNextRun, targetTime) {
  const targetTimeStr = targetTime.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  console.log(chalk.bold.cyan(`⏰ Next cycle scheduled at: ${targetTimeStr} WIB`));
  console.log('');

  return new Promise((resolve) => {
    const startTime = Date.now();
    const endTime = targetTime.getTime();

    if (endTime <= startTime) {
      resolve();
      return;
    }

    let intervalId = null;
    let timeoutId = null;
    let hourlyCheckId = null;

    const finish = () => {
      if (intervalId) clearInterval(intervalId);
      if (timeoutId) clearTimeout(timeoutId);
      if (hourlyCheckId) clearInterval(hourlyCheckId);
      process.stdout.clearLine?.();
      process.stdout.cursorTo?.(0);
      console.log(chalk.green('🚀 Starting new cycle...'));
      console.log('');
      resolve();
    };

    const waitMs = endTime - Date.now();
    timeoutId = setTimeout(finish, waitMs);

    const updateCountdown = () => {
      const now = Date.now();
      const remaining = endTime - now;
      if (remaining <= 0) {
        finish();
        return;
      }
      try {
        process.stdout.clearLine?.();
        process.stdout.cursorTo?.(0);
        process.stdout.write(chalk.yellow(`⏳ Countdown: ${formatTime(remaining)} remaining...`));
      } catch (e) { }
    };

    updateCountdown();
    intervalId = setInterval(updateCountdown, 1000);

    hourlyCheckId = setInterval(() => {
      const remaining = endTime - Date.now();
      if (remaining > 0) {
        logger.info(`Bot still waiting... ${formatTime(remaining)} until next cycle`, { emoji: '⏰ ' });
      }
    }, 3600000);
  });
}

async function waitUntilScheduledTime(hour = 7, minute = 30) {
  const nextRun = getNextScheduledTime(hour, minute);
  const msUntilNextRun = nextRun.getTime() - Date.now();
  await displayCountdown(msUntilNextRun, nextRun);
}

// ==================== SESSION SUMMARY ====================

function parseTokenExpiry(token) {
  try {
    // JWT token has 3 parts separated by dots
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Decode the payload (second part)
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

    if (payload.exp) {
      const expiryDate = new Date(payload.exp * 1000);
      const now = new Date();
      const diffMs = expiryDate - now;

      if (diffMs <= 0) {
        return { expired: true, date: expiryDate, remaining: 'EXPIRED' };
      }

      const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      let remaining = '';
      if (days > 0) remaining += `${days}d `;
      if (hours > 0) remaining += `${hours}h `;
      if (days === 0 && mins > 0) remaining += `${mins}m`;

      return { expired: false, date: expiryDate, remaining: remaining.trim() };
    }
    return null;
  } catch (e) {
    return null;
  }
}

function printSessionSummary(results) {
  // --- GRAND SUMMARY ---
  console.log('\n' + chalk.bold.cyan('================================================================================'));
  console.log(chalk.bold.cyan(`                          🤖 SIPAL NEURA_KNIGHT V1.0 🤖`));
  console.log(chalk.bold.cyan('================================================================================'));

  const table = new Table({
    head: ['Account', 'Gold', 'Status', 'Tasks', 'Battles'],
    style: { head: ['cyan'], border: ['grey'] },
    colWidths: [10, 15, 10, 15, 15] // Adjust as needed
  });

  results.forEach((res, index) => {
    const status = res.status === 'Success' ? chalk.green('Success') : chalk.red('Failed');
    const tasks = `${res.tasks?.completed || 0}/${res.tasks?.total || 0}`;
    const battles = `${res.battles?.won || 0}/${res.battles?.executed || 0}`;

    table.push([
      `Acc ${index + 1}`,
      res.points || '0',
      status,
      tasks,
      battles
    ]);
  });

  console.log(table.toString());
  console.log(chalk.bold.cyan('================================================================================\n'));
}


function centerText(text, width) {
  const cleanText = stripAnsi(text);
  const textLength = cleanText.length;
  const totalPadding = Math.max(0, width - textLength);
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  return `${' '.repeat(leftPadding)}${text}${' '.repeat(rightPadding)}`;
}

function printHeader(title) {
  const width = 80;
  console.log(gradient.morning(`┬${'─'.repeat(width - 2)}┬`));
  console.log(gradient.morning(`│ ${title.padEnd(width - 4)} │`));
  console.log(gradient.morning(`┴${'─'.repeat(width - 2)}┴`));
}

function printInfo(label, value, context) {
  logger.info(`${label.padEnd(15)}: ${chalk.cyan(value)}`, { emoji: '📍 ', context });
}

function printProfileInfo(email, totalGold, context) {
  printHeader(`Profile Info ${context}`);
  printInfo('Email', email || 'N/A', context);
  printInfo('Total Gold', totalGold.toString(), context);
  console.log('\n');
}

async function formatTaskTable(tasks, context) {
  console.log('\n');
  logger.info('Task List:', { context, emoji: '📋 ' });
  console.log('\n');

  const spinner = ora('Rendering tasks...').start();
  await new Promise(resolve => setTimeout(resolve, 1000));
  spinner.stop();

  const header = chalk.cyanBright('+----------------------+----------+-------+---------+\n| Task Name            | Freq     | Point | Status  |\n+----------------------+----------+-------+---------+');
  const rows = tasks.map(task => {
    const displayName = task.title && typeof task.title === 'string'
      ? (task.title.length > 20 ? task.title.slice(0, 17) + '...' : task.title)
      : 'Unknown Task';

    // Status logic:
    // - userQuest !== null AND claimed_at !== null = Claimed (fully done)
    // - userQuest !== null AND claimed_at === null = Completed (needs claim)
    // - userQuest === null = Pending (not started)
    let status;
    if (task.userQuest !== null) {
      if (task.userQuest?.claimed_at || task.userQuest?.is_claimed) {
        status = chalk.greenBright('Claimed');
      } else {
        status = chalk.yellowBright('Claimbl'); // Completed but needs claim
      }
    } else {
      status = chalk.gray('Pending');
    }

    return `| ${displayName.padEnd(20)} | ${((task.is_daily ? 'DAILY' : 'ONCE') + '     ').slice(0, 8)} | ${((task.reward || 0).toString() + '    ').slice(0, 5)} | ${status.padEnd(6)} |`;
  }).join('\n');
  const footer = chalk.cyanBright('+----------------------+----------+-------+---------+');

  console.log(header + '\n' + rows + '\n' + footer);
  console.log('\n');
}

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/102.0'
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function getAxiosConfig(proxy, token = null, bearer = false, additionalHeaders = {}) {
  const headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-encoding': 'gzip, deflate, br',
    'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,id;q=0.7,fr;q=0.6,ru;q=0.5,zh-CN;q=0.4,zh;q=0.3',
    'cache-control': 'no-cache',
    'content-type': 'application/json',
    'origin': 'https://www.neuraknights.gg',
    'pragma': 'no-cache',
    'priority': 'u=1, i',
    'referer': 'https://www.neuraknights.gg/',
    'sec-ch-ua': '"Not;A=Brand";v="99", "Opera";v="123", "Chromium";v="139"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    'user-agent': getRandomUserAgent(),
    ...additionalHeaders
  };
  if (token) {
    headers['authorization'] = bearer ? `Bearer ${token}` : `${token}`;
  }
  const config = {
    headers,
    timeout: 60000
  };
  if (proxy) {
    config.httpsAgent = newAgent(proxy);
    config.proxy = false;
  }
  return config;
}

function newAgent(proxy) {
  if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
    return new HttpsProxyAgent(proxy);
  } else if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
    return new SocksProxyAgent(proxy);
  } else {
    logger.warn(`Unsupported proxy: ${proxy}`);
    return null;
  }
}

async function requestWithRetry(method, url, payload = null, config = {}, retries = 3, backoff = 2000, context) {
  for (let i = 0; i < retries; i++) {
    try {
      let response;
      if (method.toLowerCase() === 'get') {
        response = await axios.get(url, config);
      } else if (method.toLowerCase() === 'post') {
        response = await axios.post(url, payload, config);
      } else {
        throw new Error(`Method ${method} not supported`);
      }
      return response;
    } catch (error) {
      if (error.response && error.response.status >= 500 && i < retries - 1) {
        logger.warn(`Retrying ${method.toUpperCase()} ${url} (${i + 1}/${retries}) due to server error`, { emoji: '🔄', context });
        await delay(backoff / 1000);
        backoff *= 1.5;
        continue;
      }
      if (i < retries - 1) {
        logger.warn(`Retrying ${method.toUpperCase()} ${url} (${i + 1}/${retries})`, { emoji: '🔄', context });
        await delay(backoff / 1000);
        backoff *= 1.5;
        continue;
      }
      throw error;
    }
  }
}

async function readAccounts() {
  try {
    const data = await fs.readFile('accounts.json', 'utf-8');
    const accounts = JSON.parse(data);
    logger.info(`Loaded ${accounts.length} accounts`, { emoji: '🔑 ' });
    return accounts;
  } catch (error) {
    logger.error(`Failed to read accounts.json: ${error.message}`, { emoji: '❌ ' });
    return [];
  }
}

async function fetchProfile(token, proxy, context) {
  const url = 'https://prod-api.novalinkapp.com/api/v1/profile';
  const spinner = ora({ text: 'Fetching profile...', spinner: 'dots' }).start();
  try {
    const config = getAxiosConfig(proxy, token, true);
    const response = await requestWithRetry('get', url, null, config, 3, 2000, context);
    spinner.stop();
    if (response.data.success) {
      const email = response.data.data.authentications[0]?.email || 'N/A';
      const novaLinkUserId = response.data.data.novaLinkUserId || null;
      return { email, novaLinkUserId };
    } else {
      throw new Error('Failed to fetch profile');
    }
  } catch (error) {
    spinner.fail(chalk.bold.redBright(` Failed to fetch profile: ${error.message}`));
    return { email: 'N/A', novaLinkUserId: null };
  }
}

async function fetchUserGold(state, context) {
  // Get gold from state data (from rank tab)
  if (!state) return '0';

  // Try different possible field names for gold
  const gold = state.gold || state.coins || state.currency || state.total_gold || 0;
  return gold.toString();
}

async function fetchActiveTasks(token, proxy, context) {
  const url = 'https://neura-knights-api-prod.anomalygames.ai/api/quests';
  const spinner = ora({ text: 'Fetching active tasks...', spinner: 'dots' }).start();
  try {
    const config = getAxiosConfig(proxy, token);
    const response = await requestWithRetry('get', url, null, config, 3, 2000, context);
    spinner.stop();
    if (response.data.success) {
      return response.data.data;
    } else {
      throw new Error('Failed to fetch tasks');
    }
  } catch (error) {
    spinner.fail(chalk.bold.redBright(` Failed to fetch active tasks: ${error.message}`));
    return [];
  }
}

async function completeTask(token, taskId, taskTitle, proxy, context) {
  const taskContext = `${context}|T${taskId.toString().slice(-6)}`;
  const url = 'https://neura-knights-api-prod.anomalygames.ai/api/quests';
  const payload = { quest_id: taskId };
  const config = getAxiosConfig(proxy, token);
  config.validateStatus = (status) => status >= 200 && status < 500;
  const spinner = ora({ text: `Completing ${taskTitle}...`, spinner: 'dots' }).start();
  try {
    const response = await requestWithRetry('post', url, payload, config, 3, 2000, taskContext);
    if (response.data.success) {
      spinner.succeed(chalk.bold.greenBright(` Completed: ${taskTitle}`));
      return { success: true, message: `Completed: ${taskTitle}` };
    } else {
      spinner.warn(chalk.bold.yellowBright(` Failed to complete ${taskTitle}`));
      return { success: false, message: `Failed to complete ${taskTitle}` };
    }
  } catch (error) {
    spinner.fail(chalk.bold.redBright(` Failed to complete ${taskTitle}: ${error.message}`));
    return { success: false, message: `Failed: ${error.message}` };
  }
}

async function fetchState(novaLinkUserId, token, proxy, context) {
  const url = `https://neura-knights-api-prod.anomalygames.ai/api/state?novalink_user_id=${novaLinkUserId}`;
  const spinner = ora({ text: 'Fetching state...', spinner: 'dots' }).start();
  try {
    const config = getAxiosConfig(proxy, token, true);
    const response = await requestWithRetry('get', url, null, config, 3, 2000, context);
    spinner.stop();
    if (response.data.success) {
      return response.data.data;
    } else {
      throw new Error('Failed to fetch state');
    }
  } catch (error) {
    spinner.fail(chalk.bold.redBright(` Failed to fetch state: ${error.message}`));
    return null;
  }
}

async function claimPackage(novaLinkUserId, token, proxy, context) {
  const url = `https://neura-knights-api-prod.anomalygames.ai/api/package/claim?novalink_user_id=${novaLinkUserId}`;
  const payload = { novalink_user_id: novaLinkUserId };
  const config = getAxiosConfig(proxy, token, true);
  config.validateStatus = (status) => status >= 200 && status < 500;
  const spinner = ora({ text: 'Claiming package...', spinner: 'dots' }).start();
  try {
    const response = await requestWithRetry('post', url, payload, config, 3, 2000, context);
    if (response.data.success) {
      spinner.succeed(chalk.bold.greenBright(` Packs claimed successfully`));
      return { success: true };
    } else {
      spinner.warn(chalk.bold.yellowBright(` Failed to claim packs`));
      return { success: false };
    }
  } catch (error) {
    spinner.fail(chalk.bold.redBright(` Failed to claim packs: ${error.message}`));
    return { success: false };
  }
}

// ==================== AUTO OPEN PACKS ====================

async function fetchUserPackages(novaLinkUserId, token, proxy, context) {
  const url = `https://neura-knights-api-prod.anomalygames.ai/api/inventory/packages?novalink_user_id=${novaLinkUserId}`;
  const spinner = ora({ text: 'Fetching user packages...', spinner: 'dots' }).start();
  try {
    const config = getAxiosConfig(proxy, token, true);
    const response = await requestWithRetry('get', url, null, config, 3, 2000, context);
    spinner.stop();
    if (response.data.success) {
      return response.data.data || [];
    } else {
      throw new Error('Failed to fetch packages');
    }
  } catch (error) {
    spinner.fail(chalk.bold.redBright(` Failed to fetch packages: ${error.message}`));
    return [];
  }
}

async function openPack(novaLinkUserId, token, packageType, packageCollection, proxy, context) {
  const url = 'https://neura-knights-api-prod.anomalygames.ai/api/package/open';
  const payload = {
    novalink_user_id: novaLinkUserId,
    package_type: packageType,
    package_collection: packageCollection
  };
  const config = getAxiosConfig(proxy, token, true);
  config.validateStatus = (status) => status >= 200 && status < 500;
  try {
    const response = await requestWithRetry('post', url, payload, config, 3, 2000, context);
    if (response.data.success) {
      return { success: true, cards: response.data.data?.cards || [] };
    } else {
      return { success: false, message: response.data.message || 'Failed to open pack' };
    }
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function autoOpenAllPacks(novaLinkUserId, token, proxy, context) {
  logger.info('Starting auto open packs...', { emoji: '🎴 ', context });

  const packages = await fetchUserPackages(novaLinkUserId, token, proxy, context);

  if (!packages || packages.length === 0) {
    logger.info('No packs available to open', { emoji: '📦 ', context });
    return { opened: 0, totalCards: 0 };
  }

  let totalOpened = 0;
  let totalCards = 0;

  for (const pack of packages) {
    const packCount = pack.count || 0;
    const packType = pack.package_type || 'base';
    const packCollection = pack.package_collection || 'ACT_1_PACK';
    const packName = pack.name || 'Unknown Pack';

    if (packCount <= 0) continue;

    logger.info(`Opening ${packCount}x ${packName}...`, { emoji: '📦 ', context });

    const bar = new ProgressBar(`Opening ${packName} [:bar] :current/:total`, {
      complete: '█',
      incomplete: '░',
      width: 20,
      total: packCount
    });

    for (let i = 0; i < packCount; i++) {
      const result = await openPack(novaLinkUserId, token, packType, packCollection, proxy, context);
      if (result.success) {
        totalOpened++;
        totalCards += result.cards.length;
      }
      bar.tick();
      await delay(1);
    }
    console.log();
  }

  logger.info(chalk.bold.greenBright(`Opened ${totalOpened} packs, received ${totalCards} cards!`), { emoji: '🎉 ', context });
  return { opened: totalOpened, totalCards };
}

// ==================== AUTO BATTLE ====================

async function fetchGameState(novaLinkUserId, token, proxy, context) {
  const url = `https://neura-knights-api-prod.anomalygames.ai/api/state?novalink_user_id=${novaLinkUserId}`;
  try {
    const config = getAxiosConfig(proxy, token, true);
    const response = await requestWithRetry('get', url, null, config, 3, 2000, context);
    if (response.data.success) {
      return response.data.data;
    } else {
      throw new Error('Failed to fetch game state');
    }
  } catch (error) {
    logger.error(`Failed to fetch game state: ${error.message}`, { emoji: '❌ ', context });
    return null;
  }
}

function checkBattleAvailability(state) {
  if (!state) {
    return { canBattle: false, reason: 'Failed to fetch game state' };
  }

  // Check if user has coins (energy) for battle
  const coins = state.coins || 0;
  if (coins <= 0) {
    return { canBattle: false, reason: 'No coins/energy available for battle' };
  }

  // Get available maps
  const unlockedMaps = [];
  const mapLocations = {
    'Training Grounds': state.training_unlocked !== false,
    'Forest': state.forest_unlocked || false,
    'Bridge': state.bridge_unlocked || false,
    'Caves': state.caves_unlocked || false,
    'Ghost Town': state.ghost_town_unlocked || false,
    'Mountain': state.mountain_unlocked || false,
    'Castle': state.castle_unlocked || false
  };

  for (const [location, unlocked] of Object.entries(mapLocations)) {
    if (unlocked) unlockedMaps.push(location);
  }

  if (unlockedMaps.length === 0) {
    return { canBattle: false, reason: 'No maps unlocked' };
  }

  return { canBattle: true, coins, unlockedMaps };
}

async function startBattle(novaLinkUserId, token, location, proxy, context) {
  const url = 'https://neura-knights-api-prod.anomalygames.ai/api/game/battle/start';
  const payload = {
    location: location,
    novalink_user_id: novaLinkUserId
  };
  const config = getAxiosConfig(proxy, token, true);
  config.validateStatus = (status) => status >= 200 && status < 500;
  const spinner = ora({ text: `Starting battle at ${location}...`, spinner: 'dots' }).start();
  try {
    const response = await requestWithRetry('post', url, payload, config, 3, 2000, context);
    if (response.data.success) {
      spinner.succeed(chalk.bold.greenBright(` Battle completed at ${location}!`));
      return {
        success: true,
        result: response.data.data,
        won: response.data.data?.won || false,
        rewards: response.data.data?.rewards || {}
      };
    } else {
      spinner.warn(chalk.bold.yellowBright(` Battle failed: ${response.data.message || 'Unknown error'}`));
      return { success: false, message: response.data.message };
    }
  } catch (error) {
    spinner.fail(chalk.bold.redBright(` Battle error: ${error.message}`));
    return { success: false, message: error.message };
  }
}

async function autoBattle(novaLinkUserId, token, proxy, context, maxBattles = 10) {
  // Use browser-based battle automation
  if (globalBrowserBattle) {
    logger.info('Starting browser-based auto battle...', { emoji: '⚔️  ', context });
    const result = await runAllMapBattles(token, context, false); // headless = false to see the browser
    return { completed: result.totalBattles || 0, won: 0 };
  }

  // Fallback to API-based battle (may not work for all maps)
  logger.info('Starting API-based auto battle...', { emoji: '⚔️  ', context });

  let battlesCompleted = 0;
  let battlesWon = 0;

  for (let i = 0; i < maxBattles; i++) {
    // Refresh game state before each battle
    const state = await fetchGameState(novaLinkUserId, token, proxy, context);
    const availability = checkBattleAvailability(state);

    if (!availability.canBattle) {
      logger.info(chalk.yellowBright(`Cannot continue battle: ${availability.reason}`), { emoji: '⚠️ ', context });
      break;
    }

    // Select best available map (prioritize Training Grounds for safety)
    const location = availability.unlockedMaps.includes('Training Grounds')
      ? 'Training Grounds'
      : availability.unlockedMaps[0];

    logger.info(`Battle ${i + 1}/${maxBattles} - Coins: ${availability.coins}`, { emoji: '🎮 ', context });

    const result = await startBattle(novaLinkUserId, token, location, proxy, context);

    if (result.success) {
      battlesCompleted++;
      if (result.won) battlesWon++;
    } else {
      // If battle fails, wait and try again or stop
      if (result.message?.includes('cooldown') || result.message?.includes('energy')) {
        logger.info('Battle on cooldown or no energy, stopping...', { emoji: '⏳ ', context });
        break;
      }
    }

    await delay(2);
  }

  logger.info(chalk.bold.greenBright(`Auto battle completed: ${battlesCompleted} battles, ${battlesWon} won!`), { emoji: '🏆 ', context });
  return { completed: battlesCompleted, won: battlesWon };
}

// ==================== GLOBAL CONFIG ====================

let globalAutoOpenPacks = false;
let globalAutoBattle = false;
let globalMaxBattles = 10;
let globalBrowserBattle = false;

async function processAccount(token, index, total, proxy) {
  const context = `Account ${index + 1}/${total}`;
  const accountResult = {
    email: 'Unknown',
    points: '0',
    tasks: { total: 0, completed: 0, pending: 0 },
    taskDetails: [], // NEW: detailed task list with status
    packs: { opened: 0, cards: 0 },
    battles: { executed: 0, won: 0 },
    hero: null, // NEW: hero info (class, level, hp)
    tokenExpiry: null, // NEW: token expiry info
    nextPackClaim: null, // NEW: next pack claim time
    status: 'Failed',
    error: null
  };

  // Parse token expiry
  accountResult.tokenExpiry = parseTokenExpiry(token);

  logger.info(chalk.bold.magentaBright(`Starting account processing`), { emoji: '🚀 ', context });

  try {
    const { email, novaLinkUserId } = await fetchProfile(token, proxy, context);
    accountResult.email = email;

    printHeader(`Account Info ${context}`);
    printInfo('Email', email, context);
    const ip = await getPublicIP(proxy, context);
    printInfo('IP', ip, context);
    console.log('\n');


    // Fetch state for pack claim and gold
    let state = await fetchState(novaLinkUserId, token, proxy, context);

    // Populate hero and account info from state
    if (state) {
      // Hero info
      accountResult.hero = {
        class: state.hero_class || state.class || 'Unknown',
        level: state.hero_level || state.level || 1,
        hp: state.hero_hp || state.hp || '?'
      };

      // Gold
      accountResult.points = (state.gold || state.coins || state.currency || 0).toString();

      // Next pack claim
      const nextClaim = state.next_package_claim_at;
      const currentTime = new Date();
      if (nextClaim === null || currentTime >= new Date(nextClaim)) {
        accountResult.nextPackClaim = 'Ready!';
      } else {
        const nextClaimDate = new Date(nextClaim);
        const diffMs = nextClaimDate - currentTime;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        accountResult.nextPackClaim = `${diffDays}d ${diffHours}h`;
      }
    }

    // Step 1: Claim daily packs if available
    logger.info('Checking for packs claim...', { emoji: '📦 ', context });
    if (state) {
      const nextClaim = state.next_package_claim_at;
      const currentTime = new Date();
      if (nextClaim === null || currentTime >= new Date(nextClaim)) {
        await claimPackage(novaLinkUserId, token, proxy, context);
      } else {
        const nextClaimDate = new Date(nextClaim);
        const diffMs = nextClaimDate - currentTime;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        logger.info(chalk.yellowBright(`Packs not ready to claim yet. Cooldown: ${diffDays} days and ${diffHours} hours`), { emoji: '⏳ ', context });
      }
    } else {
      logger.warn('Failed to fetch state, skipping pack claim', { emoji: '⚠️ ', context });
    }

    // Step 2: Auto Battle FIRST (before task claims)
    if (globalAutoBattle) {
      console.log();
      logger.info('Starting Auto Battle...', { emoji: '⚔️  ', context });
      const battleResult = await autoBattle(novaLinkUserId, token, proxy, context, globalMaxBattles);
      accountResult.battles = { executed: battleResult.completed, won: battleResult.won };
    }

    // Step 3: Auto Open Packs
    if (globalAutoOpenPacks) {
      console.log();
      const packResult = await autoOpenAllPacks(novaLinkUserId, token, proxy, context);
      accountResult.packs = packResult;
    }

    // Step 4: Claim tasks AFTER battles are done
    logger.info('Starting tasks processing...', { emoji: '📋 ', context });

    const activeTasks = await fetchActiveTasks(token, proxy, context);
    accountResult.tasks.total = activeTasks.length;

    // Find claimable tasks:
    // 1. Tasks with claimable=true and userQuest=null (can be completed and claimed)
    // 2. Tasks with userQuest !== null but not yet claimed (needs to claim rewards)
    const tasksToComplete = activeTasks.filter(task => task.claimable === true && task.userQuest === null);
    const tasksToClaimReward = activeTasks.filter(task => {
      if (task.userQuest === null) return false;
      // Check if already claimed
      const isClaimed = task.userQuest?.claimed_at || task.userQuest?.is_claimed;
      return !isClaimed;
    });

    accountResult.tasks.pending = tasksToComplete.length + tasksToClaimReward.length;

    // Build task details for session summary
    accountResult.taskDetails = activeTasks.map(task => {
      let status = 'pending';

      if (task.userQuest) {
        const isClaimed = task.userQuest?.claimed_at || task.userQuest?.is_claimed;
        status = isClaimed ? 'claimed' : 'claimable';
      } else if (task.claimable) {
        status = 'claimable';
      }

      return {
        id: task.id,
        title: task.title || 'Unknown Task',
        status,
        reward: task.reward || task.points || task.gold || null
      };
    });

    let completedCount = 0;

    // Complete tasks that haven't been started
    if (tasksToComplete.length > 0) {
      console.log();
      logger.info(`Completing ${tasksToComplete.length} pending task(s)...`, { emoji: '📝 ', context });

      const bar = new ProgressBar('Completing tasks [:bar] :percent :etas', {
        complete: '█',
        incomplete: '░',
        width: 30,
        total: tasksToComplete.length
      });

      for (const task of tasksToComplete) {
        try {
          const result = await completeTask(token, task.id, task.title || 'Unknown Task', proxy, context);
          if (result.success) {
            completedCount++;
          }
        } catch (error) {
          logger.error(`Error completing task ${task.id}: ${error.message}`, { context });
        }
        bar.tick();
        await delay(2);
      }
      console.log();
    }

    // Claim rewards for completed tasks
    if (tasksToClaimReward.length > 0) {
      console.log();
      logger.info(`Claiming rewards for ${tasksToClaimReward.length} completed task(s)...`, { emoji: '🎁 ', context });

      const bar = new ProgressBar('Claiming rewards [:bar] :percent :etas', {
        complete: '█',
        incomplete: '░',
        width: 30,
        total: tasksToClaimReward.length
      });

      for (const task of tasksToClaimReward) {
        try {
          const result = await completeTask(token, task.id, task.title || 'Unknown Task', proxy, context);
          if (result.success) {
            completedCount++;
          }
        } catch (error) {
          logger.error(`Error claiming task ${task.id}: ${error.message}`, { context });
        }
        bar.tick();
        await delay(2);
      }
      console.log();
    }

    accountResult.tasks.completed = completedCount;

    if (completedCount === 0 && tasksToComplete.length === 0 && tasksToClaimReward.length === 0) {
      logger.info('No tasks ready to complete or claim', { emoji: '⚠️ ', context });
    } else {
      logger.info(`Processed: ${completedCount} task(s) completed/claimed`, { emoji: '📊 ', context });
    }

    // Show task table
    const refreshedTasks = await fetchActiveTasks(token, proxy, context);
    await formatTaskTable(refreshedTasks, context);

    // Step 5: Get updated gold/points from state
    state = await fetchState(novaLinkUserId, token, proxy, context); // Refresh state
    const totalGold = await fetchUserGold(state, context);
    accountResult.points = totalGold;
    printProfileInfo(email, totalGold, context);

    logger.info(chalk.bold.greenBright(`Completed account processing`), { emoji: '🎉 ', context });
    console.log(chalk.cyanBright('________________________________________________________________________________'));

    accountResult.status = 'Success';
    return accountResult;

  } catch (error) {
    logger.error(`Error processing account: ${error.message}`, { emoji: '❌ ', context });
    accountResult.status = 'Failed';
    accountResult.error = error.message;
    return accountResult;
  }
}

async function getPublicIP(proxy, context) {
  try {
    const config = getAxiosConfig(proxy);
    const response = await requestWithRetry('get', 'https://api.ipify.org?format=json', null, config, 3, 2000, context);
    return response.data.ip || 'Unknown';
  } catch (error) {
    logger.error(`Failed to get IP: ${error.message}`, { emoji: '❌ ', context });
    return 'Error retrieving IP';
  }
}



async function initializeConfig() {
  // Auto-Start Configuration (All commands default to 'y')
  logger.info('Auto-configuring settings...', { emoji: '⚙️ ' });

  // Auto Open Packs Configuration
  globalAutoOpenPacks = true;
  logger.info('Auto open packs enabled.', { emoji: '✅ ' });

  // Auto Battle Configuration
  globalAutoBattle = true;
  globalBrowserBattle = true; // Default to Browser Mode
  logger.info('Auto battle enabled (Browser Mode).', { emoji: '✅ ' });
}

async function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

async function runCycle() {
  const accounts = await readAccounts();
  if (accounts.length === 0) {
    logger.error('No accounts found in accounts.json. Exiting cycle.', { emoji: '❌ ' });
    return;
  }

  const sessionResults = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const token = account.token;
    const proxy = account.proxy || null;

    try {
      const result = await processAccount(token, i, accounts.length, proxy);
      sessionResults.push(result);
    } catch (error) {
      logger.error(`Error processing account: ${error.message}`, { emoji: '❌ ', context: `Account ${i + 1}/${accounts.length}` });
      sessionResults.push({
        email: 'Unknown',
        points: '0',
        tasks: { total: 0, completed: 0, pending: 0 },
        packs: { opened: 0, cards: 0 },
        battles: { executed: 0, won: 0 },
        status: 'Failed',
        error: error.message
      });
    }
    if (i < accounts.length - 1) {
      console.log('\n\n');
    }
    await delay(5);
  }

  printSessionSummary(sessionResults);
}

async function run() {
  const terminalWidth = process.stdout.columns || 80;
  console.log(chalk.blue(`
               / \\
              /   \\
             |  |  |
             |  |  |
              \\  \\
             |  |  |
             |  |  |
              \\   /
               \\ /
`));
  console.log(chalk.bold.cyan('    ======SIPAL AIRDROP======'));
  console.log(chalk.bold.cyan('  =====SIPAL NEURA_KNIGHT V1.0====='));
  console.log('\n');
  await initializeConfig();

  // KONFIGURASI JAM LOOP
  const SCHEDULED_HOUR = 7;    // Jam (07:00)
  const SCHEDULED_MINUTE = 30; // Menit (07:30)

  while (true) {
    try {
      await runCycle();
      console.log();
      await waitUntilScheduledTime(SCHEDULED_HOUR, SCHEDULED_MINUTE);
    } catch (error) {
      logger.error(`Cycle error: ${error.message}`, { emoji: '❌ ' });
      // Retry logic or wait for next schedule
      await waitUntilScheduledTime(SCHEDULED_HOUR, SCHEDULED_MINUTE);
    }
  }
}


run().catch(error => logger.error(`Fatal error: ${error.message}`, { emoji: '❌' }));