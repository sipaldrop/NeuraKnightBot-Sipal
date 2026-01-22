import puppeteer from 'puppeteer';
import chalk from 'chalk';
import ora from 'ora';

const logger = {
    info: (msg, options = {}) => {
        const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const emoji = options.emoji || 'ℹ️  ';
        const context = options.context ? `[${options.context}] ` : '';
        const level = chalk.green('INFO');
        console.log(`[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`);
    },
    warn: (msg, options = {}) => {
        const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const emoji = options.emoji || '⚠️ ';
        const context = options.context ? `[${options.context}] ` : '';
        const level = chalk.yellow('WARN');
        console.log(`[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`);
    },
    error: (msg, options = {}) => {
        const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const emoji = options.emoji || '❌ ';
        const context = options.context ? `[${options.context}] ` : '';
        const level = chalk.red('ERROR');
        console.log(`[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`);
    }
};

function delay(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * Launch browser with authenticated session
 */
export async function launchBrowser(token, headless = false) {
    const spinner = ora({ text: 'Launching browser...', spinner: 'dots' }).start();
    try {
        const browser = await puppeteer.launch({
            headless: headless,
            defaultViewport: { width: 500, height: 815 }, // Match actual game viewport
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        const page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');

        await page.goto('https://www.neuraknights.gg', { waitUntil: 'networkidle2', timeout: 60000 });
        await delay(1); // Minimal wait for page stability

        // Inject authentication token
        await page.evaluate((authToken) => {
            const existingKeys = Object.keys(localStorage).filter(k => k.includes('nova-link-auth-token'));
            if (existingKeys.length > 0) {
                const key = existingKeys[0];
                const existingValue = JSON.parse(localStorage.getItem(key));
                existingValue.token = authToken;
                localStorage.setItem(key, JSON.stringify(existingValue));
            } else {
                const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
                localStorage.setItem('nova-link-auth-token-5g7WL0v8820py9fB', JSON.stringify({
                    token: authToken,
                    expires: expires
                }));
            }
        }, token);

        await page.reload({ waitUntil: 'networkidle2' });

        // SMART LOGIN: Adaptive wait - poll every 1s for game ready state
        spinner.text = 'Waiting for game to load...';
        const maxWaitSeconds = 25;
        let isGameReady = false;

        for (let i = 0; i < maxWaitSeconds; i++) {
            try {
                isGameReady = await page.evaluate(() => {
                    const text = document.body.innerText.toUpperCase();
                    // Game is ready when we see these elements
                    return text.includes('MAP') ||
                        text.includes('HOME') ||
                        text.includes('PLAY') ||
                        text.includes('BATTLE') ||
                        text.includes('PROFILE');
                });

                if (isGameReady) {
                    spinner.text = `Game loaded in ${i + 1}s`;
                    break;
                }
            } catch (e) {
                // Page might be navigating, continue waiting
            }
            await delay(1);
        }

        if (!isGameReady) {
            spinner.text = 'Game not detected, continuing anyway...';
        }

        // Navigate to home - use networkidle0 for stricter wait
        await page.goto('https://www.neuraknights.gg/home', { waitUntil: 'networkidle0', timeout: 60000 });

        // Smart wait for home page - max 5s
        for (let i = 0; i < 5; i++) {
            const homeReady = await page.evaluate(() => {
                const text = document.body.innerText.toUpperCase();
                return text.includes('MAP') || text.includes('PROFILE');
            });
            if (homeReady) break;
            await delay(1);
        }

        spinner.succeed(chalk.green(' Browser launched and authenticated'));
        return { browser, page };
    } catch (error) {
        spinner.fail(chalk.red(` Failed to launch browser: ${error.message}`));
        throw error;
    }
}

/**
 * Navigate to the MAP tab by clicking the MAP button
 * Using coordinates since game uses bottom navigation bar
 */
export async function navigateToMap(page, context = '') {
    logger.info('Navigating to MAP tab...', { emoji: '🗺️  ', context });
    try {
        await delay(1);

        // MAP tab is in bottom navigation, center of screen
        // Based on 500x815 viewport, MAP button is around (250, 780)
        await page.mouse.click(250, 780);
        await delay(3);

        logger.info('Navigated to MAP tab', { emoji: '✅ ', context });
        return true;
    } catch (error) {
        logger.error(`Failed to navigate to MAP: ${error.message}`, { context });
        return false;
    }
}

/**
 * Close any open popup by clicking on the map header area
 */
export async function closePopup(page) {
    // Click on the map header area to close popup
    // Based on browser exploration, clicking at (250, 82) closes popup
    await page.mouse.click(250, 82);
    await delay(2); // Wait for popup to close
}

/**
 * Map positions on the screen (coordinates for 500x815 viewport)
 * Based on actual measurements from the game
 */
const mapPositions = {
    'TRAINING': { x: 314, y: 569 },
    'FOREST': { x: 94, y: 528 },
    'BRIDGE': { x: 80, y: 429 },
    'CAVES': { x: 39, y: 317 },
    'GHOST TOWN': { x: 165, y: 295 },
    'MOUNTAIN': { x: 38, y: 198 },
    'CASTLE': { x: 264, y: 159 }
};

/**
 * Click on a specific map location using mouse coordinates
 * Game uses canvas/image for map, so we must use coordinates
 */
export async function clickMap(page, mapName, context = '') {
    const pos = mapPositions[mapName];
    if (!pos) {
        logger.warn(`Unknown map: ${mapName}`, { context });
        return false;
    }

    logger.info(`Clicking on ${mapName} at (${pos.x}, ${pos.y})...`, { emoji: '📍 ', context });

    // Use mouse click at specific coordinates
    await page.mouse.click(pos.x, pos.y);
    await delay(3); // Wait for popup to fully open

    return true;
}

/**
 * Check if a popup is open and get its details
 * Returns: { isOpen: boolean, mapName: string, attempts: number, maxAttempts: number, canPlay: boolean, isLocked: boolean }
 */
export async function getPopupDetails(page, context = '') {
    try {
        const details = await page.evaluate(() => {
            const bodyText = document.body.innerText.toUpperCase();

            // Check if popup is open by looking for DAILY REWARD LIMIT
            if (!bodyText.includes('DAILY REWARD LIMIT')) {
                return { isOpen: false };
            }

            // Find map name (header of popup)
            const possibleMaps = ['TRAINING', 'FOREST', 'BRIDGE', 'CAVES', 'GHOST TOWN', 'MOUNTAIN', 'CASTLE'];
            let mapName = null;
            for (const map of possibleMaps) {
                // Check if map name appears as a standalone header
                if (bodyText.includes(map)) {
                    mapName = map;
                    break;
                }
            }

            // Find attempts (X / Y pattern)
            const attemptMatch = document.body.innerText.match(/(\d+)\s*\/\s*(\d+)/);
            let attempts = 0;
            let maxAttempts = 0;
            if (attemptMatch) {
                attempts = parseInt(attemptMatch[1]);
                maxAttempts = parseInt(attemptMatch[2]);
            }

            // Check if PLAY button exists and is not LOCKED
            const buttons = Array.from(document.querySelectorAll('button, div'));
            let canPlay = false;
            let isLocked = false;

            for (const btn of buttons) {
                const text = btn.textContent?.toUpperCase().trim() || '';
                if (text === 'PLAY') {
                    canPlay = true;
                }
                if (text === 'LOCKED') {
                    isLocked = true;
                }
            }

            // Check if rewards exhausted (red text or message)
            const exhausted = bodyText.includes('REWARDS WILL RETURN') || attempts === 0;

            return {
                isOpen: true,
                mapName,
                attempts,
                maxAttempts,
                canPlay: canPlay && !isLocked && attempts > 0,
                isLocked,
                exhausted
            };
        });

        return details;
    } catch (error) {
        logger.error(`Failed to get popup details: ${error.message}`, { context });
        return { isOpen: false };
    }
}

/**
 * Click the PLAY button in the popup
 * PLAY button is centered in popup, around Y=504
 */
export async function clickPlayButton(page, context = '') {
    try {
        // PLAY button is at center X (250), Y around 504
        logger.info('Clicking PLAY button at (250, 504)...', { emoji: '▶️  ', context });
        await page.mouse.click(250, 504);
        await delay(3); // Wait for battle to start loading

        logger.info('Clicked PLAY button', { emoji: '▶️  ', context });
        return true;
    } catch (error) {
        logger.error(`Failed to click PLAY: ${error.message}`, { context });
        return false;
    }
}
/**
 * Execute a battle turn - SMART BATTLE SYSTEM
 * 
 * FEATURES:
 * 1. Card count detection - Adjusts positions dynamically
 * 2. End Turn button click - Click when out of energy
 * 3. Energy tracking - Track energy spent (~5 per turn)
 * 4. Drag success verification - Check if monster HP changed
 * 5. Animation wait - Wait for animations to complete
 * 6. Smart retry - Skip unplayable positions after 2 fails
 */
export async function executeBattleTurn(page, context = '') {
    let mouseIsDown = false;
    let currentEnergy = 5; // Most battles start with 5 energy
    let lastMonsterHP = null;

    const safeMouseUp = async () => {
        if (mouseIsDown) {
            try {
                await page.mouse.up();
            } catch (e) { }
            mouseIsDown = false;
        }
    };

    const safeMouseDown = async () => {
        try {
            await page.mouse.down();
            mouseIsDown = true;
        } catch (e) {
            mouseIsDown = false;
        }
    };

    // Check if battle is still ongoing
    const isBattleActive = async () => {
        try {
            return await page.evaluate(() => {
                const text = document.body.innerText.toUpperCase();
                const hasEndTurn = text.includes('END TURN');
                const hasBattleEnd = text.includes('YOU WON') || text.includes('YOU LOST') ||
                    text.includes('VICTORY') || text.includes('DEFEAT') ||
                    text.includes('CONTINUE') || text.includes('YOUR DAMAGE');
                return hasEndTurn && !hasBattleEnd;
            });
        } catch (e) {
            return true;
        }
    };

    // ==================== SMART BATTLE HELPER FUNCTIONS ====================

    // Get current monster HP from page text
    const getMonsterHP = async () => {
        try {
            return await page.evaluate(() => {
                const text = document.body.innerText;
                // Look for HP patterns like "9500 / 10000" or just large numbers
                const patterns = [
                    /(\d{1,5})\s*\/\s*(\d{1,5})/g,  // Current / Max format
                    /HP[:\s]*(\d{1,5})/gi            // HP: 9500 format
                ];
                for (const pattern of patterns) {
                    const match = pattern.exec(text);
                    if (match) {
                        return parseInt(match[1]);
                    }
                }
                return null;
            });
        } catch (e) {
            return null;
        }
    };

    // Click End Turn button when out of energy
    const clickEndTurnInBattle = async () => {
        try {
            logger.info('Clicking END TURN...', { emoji: '⏩ ', context });

            // End Turn button is typically at bottom right area
            // Try multiple positions
            const positions = [
                { x: 400, y: 750 },
                { x: 420, y: 760 },
                { x: 380, y: 740 },
                { x: 250, y: 777 }, // Center bottom
            ];

            for (const pos of positions) {
                await page.mouse.click(pos.x, pos.y);
                await delay(0.2);
            }

            // Also try clicking via DOM
            await page.evaluate(() => {
                const elements = document.querySelectorAll('*');
                for (const el of elements) {
                    if (el.innerText && el.innerText.toUpperCase().includes('END TURN')) {
                        el.click();
                        return true;
                    }
                }
                return false;
            });

            await delay(2.5); // Wait for enemy turn animation
            currentEnergy = 5; // Energy refills after turn end
            logger.info('Turn ended. Energy refilled to 5.', { emoji: '⚡ ', context });
            return true;
        } catch (e) {
            return false;
        }
    };

    // Verify if drag was successful by checking HP change
    const verifyDragSuccess = async (hpBefore) => {
        await delay(0.5);
        const hpAfter = await getMonsterHP();
        if (hpBefore !== null && hpAfter !== null && hpAfter < hpBefore) {
            const damage = hpBefore - hpAfter;
            logger.info(`Damage dealt: ${damage}`, { emoji: '💥 ', context });
            return { success: true, damage };
        }
        return { success: false, damage: 0 };
    };

    // Wait for card animation to complete
    const waitForAnimation = async (seconds = 2) => {
        await delay(seconds);
    };

    // SAFETY: Reset any stuck drag state by clicking on safe areas
    const resetDragState = async () => {
        try {
            await safeMouseUp();
            // Click 2x on enemy area to cancel any stuck drag
            await page.mouse.click(250, 150); // Enemy area
            await delay(0.15);
            await page.mouse.click(250, 400); // Middle safe area (above cards)
            await delay(0.15);
        } catch (e) { }
    };

    // Perform a slow, deliberate drag from card to enemy
    const dragCardToEnemy = async (startX, startY, endX, endY) => {
        try {
            // SAFETY: Reset any stuck drag first
            await resetDragState();
            await delay(0.2);

            // Step 1: Move to card position
            await page.mouse.move(startX, startY);
            await delay(0.5);

            // Step 2: Press mouse button
            await safeMouseDown();
            await delay(0.3);

            // Step 3: Drag to enemy with smooth movement
            const totalSteps = 15;
            for (let step = 1; step <= totalSteps; step++) {
                const progress = step / totalSteps;
                const currentX = startX + (endX - startX) * progress;
                const currentY = startY + (endY - startY) * progress;
                await page.mouse.move(Math.round(currentX), Math.round(currentY));
                await delay(0.04);
            }

            // Step 4: Hold at final position
            await page.mouse.move(endX, endY);
            await delay(0.3);

            // Step 5: Release
            await safeMouseUp();
            await delay(1.5); // Wait for card play animation

            // SAFETY: Click to confirm release (prevents stuck state)
            await page.mouse.click(250, 300);
            await delay(0.5);

            return true;
        } catch (e) {
            // SAFETY: Always reset on error
            await resetDragState();
            return false;
        }
    };

    try {
        // Key positions for 500x815 viewport
        const enemyX = 250;  // Enemy is centered
        const enemyY = 150;  // Enemy target area (upper portion of screen)
        const cardY = 690;   // Cards are at BOTTOM of screen (700-690 range)

        // Card positions for different hand sizes (centered on X=250)
        const cardPositions = {
            1: [250],
            2: [210, 290],
            3: [185, 250, 315],
            4: [155, 215, 285, 345],
            5: [130, 190, 250, 310, 370],
        };

        // Start with neutral position
        await page.mouse.click(250, 500);
        await delay(0.5);

        // Get initial monster HP
        lastMonsterHP = await getMonsterHP();
        logger.info(`Battle started. Monster HP: ${lastMonsterHP || 'Unknown'}`, { emoji: '⚔️ ', context });

        let totalCardsDragged = 0;
        let totalDamageDealt = 0; // Track total damage for points
        const maxRounds = 20; // Many rounds to ensure we fight until monster dies
        let consecutiveFailedRounds = 0;
        let estimatedCardCount = 5;

        // Try to play cards for multiple rounds
        for (let round = 0; round < maxRounds; round++) {
            if (!await isBattleActive()) {
                logger.info('Battle ended!', { emoji: '🏆 ', context });
                break;
            }

            logger.info(`Round ${round + 1} | Energy: ~${currentEnergy} | Est. Cards: ${estimatedCardCount}`, { emoji: '🎯 ', context });

            let cardsDraggedThisRound = 0;

            // DYNAMIC: Get scan positions based on estimated card count
            // This ensures we scan the RIGHT positions after cards shift
            const getScanPositions = (count) => {
                const positions = {
                    1: [250],                    // 1 card: center
                    2: [220, 290],               // 2 cards: left-center, right-center
                    3: [185, 250, 315],          // 3 cards
                    4: [155, 215, 285, 345],     // 4 cards
                    5: [130, 190, 250, 310, 370] // 5 cards
                };
                return positions[Math.min(Math.max(count, 1), 5)] || positions[5];
            };

            const scanOrder = getScanPositions(estimatedCardCount);
            logger.info(`Scanning ${scanOrder.length} positions: [${scanOrder.join(', ')}]`, { emoji: '🔍 ', context });

            const maxRetryPerPosition = 1;
            const failedPositions = new Set();
            let totalFailedDrags = 0;

            for (const cardX of scanOrder) {
                if (!await isBattleActive()) break;
                if (failedPositions.has(cardX)) continue;
                if (currentEnergy <= 0) {
                    logger.info('Out of energy for this turn!', { emoji: '⚡ ', context });
                    break;
                }

                let attempts = 0;
                let success = false;

                while (attempts < maxRetryPerPosition && !success) {
                    attempts++;

                    if (attempts > 1) {
                        logger.info(`Retry ${attempts}/${maxRetryPerPosition} at X=${cardX}`, { emoji: '🔄 ', context });
                        await delay(0.3);
                    }

                    // Get HP before drag for verification
                    const hpBefore = await getMonsterHP();

                    // Try to drag
                    const dragResult = await dragCardToEnemy(cardX, cardY, enemyX, enemyY);

                    // Verify success by checking HP change
                    if (dragResult) {
                        const verification = await verifyDragSuccess(hpBefore);
                        success = verification.success;
                        if (success) {
                            currentEnergy--;
                            estimatedCardCount = Math.max(1, estimatedCardCount - 1);
                        }
                    }
                }

                if (success) {
                    cardsDraggedThisRound++;
                    totalCardsDragged++;
                    logger.info(`Card played from X=${cardX}! Cards left: ~${estimatedCardCount}`, { emoji: '✅ ', context });
                    // DON'T BREAK - keep playing more cards to maximize damage!
                    // Reset failed positions since card layout changed
                    failedPositions.clear();
                    totalFailedDrags = 0;
                } else {
                    failedPositions.add(cardX);
                    totalFailedDrags++;
                }
            }

            // Handle no cards played this round
            if (cardsDraggedThisRound === 0) {
                // If all scanned positions failed, cards are likely all gray
                // Click End Turn IMMEDIATELY - don't waste time with more retries
                logger.info(`All ${totalFailedDrags} positions failed - cards are gray. Clicking End Turn...`, { emoji: '⏩ ', context });
                await clickEndTurnInBattle();
                estimatedCardCount = 5; // Cards refresh

                // Wait for enemy attack animation
                await waitForAnimation(2.5);
            } else {
                consecutiveFailedRounds = 0;
            }

            await delay(0.5);
        }

        await safeMouseUp();

        // Final HP check and damage calculation
        const finalHP = await getMonsterHP();
        if (lastMonsterHP && finalHP !== null) {
            totalDamageDealt = lastMonsterHP - finalHP;
        }

        logger.info(`Battle complete! Cards: ${totalCardsDragged} | Total Damage: ${totalDamageDealt}`, { emoji: '🏆 ', context });

        return { cards: totalCardsDragged, damage: totalDamageDealt };

    } catch (error) {
        await safeMouseUp();
        logger.error(`Battle error: ${error.message}`, { context });
        return 0;
    }
}

/**
 * Click the END TURN button
 * END TURN is at bottom center: (250, 777) for 500x815 viewport
 */
export async function clickEndTurn(page, context = '') {
    try {
        // END TURN button is at center X (250), bottom of screen around Y=777
        await page.mouse.click(250, 777);

        logger.info('Clicked END TURN', { emoji: '⏭️  ', context });
        await delay(5); // Wait for enemy turn and new cards to be drawn
        return true;
    } catch (error) {
        logger.error(`Failed to click END TURN: ${error.message}`, { context });
        return false;
    }
}

/**
 * Check if battle is over
 */
export async function isBattleOver(page) {
    try {
        const isOver = await page.evaluate(() => {
            const text = document.body.innerText.toUpperCase();

            // Check for specific victory/defeat screens
            // Game shows "YOU WON!" or "YOU LOST!" on battle end
            const hasVictory = text.includes('VICTORY');
            const hasDefeat = text.includes('DEFEAT');
            const hasYouWin = text.includes('YOU WIN');
            const hasYouWon = text.includes('YOU WON');  // Actual game text
            const hasYouLose = text.includes('YOU LOSE');
            const hasYouLost = text.includes('YOU LOST'); // Actual game text
            const hasContinue = text.includes('CONTINUE'); // Victory/defeat screen has CONTINUE button
            const hasYourDamage = text.includes('YOUR DAMAGE'); // Victory screen shows damage dealt
            const hasRewards = text.includes('REWARDS'); // Victory screen shows rewards

            // Battle is over if:
            // 1. Victory/defeat message shown
            // 2. END TURN is no longer visible (battle ended)
            const hasEndTurn = text.includes('END TURN');

            if (hasVictory || hasDefeat || hasYouWin || hasYouWon || hasYouLose || hasYouLost) {
                return true;
            }

            // Check for victory/defeat screen elements (CONTINUE button with REWARDS or YOUR DAMAGE)
            if ((hasContinue && hasYourDamage) || (hasContinue && hasRewards)) {
                return true;
            }

            // If we're not in battle anymore (no END TURN, but also no PLAY button)
            // This means we might have returned to map
            const hasPlay = text.includes('PLAY');
            const hasMap = text.includes('TRAINING') && text.includes('FOREST');

            if (!hasEndTurn && hasMap) {
                return true;
            }

            return false;
        });
        return isOver;
    } catch {
        return false;
    }
}

/**
 * Check if it's player's turn (END TURN visible)
 */
export async function isPlayerTurn(page) {
    try {
        const hasEndTurn = await page.evaluate(() => {
            return document.body.innerText.toUpperCase().includes('END TURN');
        });
        return hasEndTurn;
    } catch {
        return false;
    }
}

/**
 * Click CONTINUE button after battle ends
 * CONTINUE button appears on victory/defeat screen
 * Based on screenshot: CONTINUE is at right side of popup, approximately (339, 614)
 * Works for all maps (TRAINING, FOREST, etc.)
 */
export async function clickContinue(page, context = '') {
    try {
        // Wait for victory/defeat dialog to fully appear
        await delay(3);

        logger.info('Looking for CONTINUE button...', { emoji: '🔍 ', context });

        // Try multiple retries to ensure button is clicked
        for (let retry = 0; retry < 5; retry++) {
            // Try multiple positions where CONTINUE might be
            // Based on 500x815 viewport and actual screenshot analysis
            // CONTINUE button is on the RIGHT side of the popup at approx (339, 614)
            const positions = [
                { x: 339, y: 614 },  // Actual CONTINUE button position from screenshot
                { x: 335, y: 610 },  // Slightly adjusted right side
                { x: 340, y: 620 },  // Lower right
                { x: 330, y: 600 },  // Upper right
                { x: 320, y: 614 },  // Slightly left of button
                { x: 350, y: 614 },  // Slightly right of button
                { x: 250, y: 614 },  // Center at same Y
                { x: 250, y: 550 },  // Center fallback
            ];

            for (const pos of positions) {
                await page.mouse.click(pos.x, pos.y);
                await delay(0.5);
            }

            // Wait a bit and check if we're back to map
            await delay(2);

            // Check if CONTINUE is still visible (meaning we need to click again)
            const stillVisible = await page.evaluate(() => {
                const text = document.body.innerText.toUpperCase();
                return text.includes('CONTINUE') || text.includes('YOU WON') || text.includes('YOU LOST') || text.includes('YOUR DAMAGE');
            });

            if (!stillVisible) {
                logger.info('CONTINUE clicked successfully', { emoji: '✅ ', context });
                return true;
            }

            logger.info(`Retry ${retry + 1}/5 - CONTINUE still visible`, { emoji: '🔄 ', context });
        }

        // Final aggressive click at the button position
        await page.mouse.click(339, 614);
        await delay(2);

        logger.info('Clicked CONTINUE (final attempt)', { emoji: '✅ ', context });
        return true;
    } catch (error) {
        logger.error(`Failed to click CONTINUE: ${error.message}`, { context });
        return false;
    }
}

/**
 * Run a complete battle
 */
export async function runBattle(page, context = '') {
    logger.info('Battle started!', { emoji: '⚔️  ', context });

    let turnCount = 0;
    const maxTurns = 50;
    const maxWaitForTurn = 30; // Maximum seconds to wait for player turn

    // Wait for battle to load
    await delay(3);

    while (turnCount < maxTurns) {
        // Check if battle is over
        if (await isBattleOver(page)) {
            logger.info('Battle completed!', { emoji: '🏆 ', context });
            break;
        }

        // Wait for player turn with timeout
        let waitedTime = 0;
        while (!await isPlayerTurn(page) && waitedTime < maxWaitForTurn) {
            // Check if battle ended while waiting
            if (await isBattleOver(page)) {
                logger.info('Battle completed during enemy turn!', { emoji: '🏆 ', context });
                break;
            }
            await delay(1);
            waitedTime++;
        }

        // Double-check if battle ended
        if (await isBattleOver(page)) {
            logger.info('Battle completed!', { emoji: '🏆 ', context });
            break;
        }

        // Check if we timed out waiting for player turn
        if (waitedTime >= maxWaitForTurn) {
            logger.warn('Timed out waiting for player turn', { context });
            break;
        }

        turnCount++;
        logger.info(`Turn ${turnCount}`, { emoji: '🎮 ', context });

        // Drag cards to attack
        await executeBattleTurn(page, context);

        // Check if battle ended after playing cards (enemy might have died)
        if (await isBattleOver(page)) {
            logger.info('Battle won after playing cards!', { emoji: '🏆 ', context });
            break;
        }

        // Only click END TURN if battle is still ongoing
        if (await isPlayerTurn(page)) {
            await clickEndTurn(page, context);
        }
    }

    // Click CONTINUE to dismiss victory/defeat dialog
    await clickContinue(page, context);

    return true;
}

/**
 * Main function to run all map battles
 */
export async function runAllMapBattles(token, context = '', headless = false) {
    logger.info('=== Starting Browser Battle Automation ===', { emoji: '🚀 ', context });

    let browser, page;

    try {
        const result = await launchBrowser(token, headless);
        browser = result.browser;
        page = result.page;

        await delay(2);
        await navigateToMap(page, context);

        // Map order (easier to harder, only check ones likely to be unlocked)
        const mapOrder = ['TRAINING', 'FOREST', 'BRIDGE', 'CAVES', 'GHOST TOWN', 'MOUNTAIN', 'CASTLE'];

        let totalBattles = 0;

        for (const mapName of mapOrder) {
            logger.info(`Checking ${mapName}...`, { emoji: '🗺️  ', context });

            // Click on the map
            await clickMap(page, mapName, context);

            // Get popup details
            const details = await getPopupDetails(page, context);

            if (!details.isOpen) {
                logger.warn(`${mapName}: No popup opened (might be locked)`, { context });
                await closePopup(page);
                continue;
            }

            if (details.isLocked) {
                logger.info(`${mapName}: Locked`, { emoji: '🔒 ', context });
                await closePopup(page);
                continue;
            }

            if (details.exhausted || details.attempts <= 0) {
                logger.info(`${mapName}: No attempts remaining (${details.attempts}/${details.maxAttempts})`, { emoji: '⏳ ', context });
                await closePopup(page);
                continue;
            }

            logger.info(`${mapName}: ${details.attempts}/${details.maxAttempts} attempts available`, { emoji: '✅ ', context });

            // Run battles until attempts exhausted
            while (details.canPlay && details.attempts > 0) {
                // Click PLAY
                await clickPlayButton(page, context);

                // Wait for battle to load
                await delay(3);

                // Run the battle
                await runBattle(page, context);
                totalBattles++;

                logger.info(`Completed battle ${totalBattles} on ${mapName}`, { emoji: '🏆 ', context });

                // Go back to map and check again
                await navigateToMap(page, context);
                await clickMap(page, mapName, context);

                const newDetails = await getPopupDetails(page, context);
                if (!newDetails.canPlay || newDetails.attempts <= 0) {
                    logger.info(`${mapName}: All attempts exhausted`, { emoji: '✅ ', context });
                    await closePopup(page);
                    break;
                }

                // Update for next iteration
                Object.assign(details, newDetails);
            }

            await closePopup(page);
        }

        logger.info(`=== Battle Automation Complete: ${totalBattles} battles ===`, { emoji: '🎉 ', context });

        await browser.close();
        return { success: true, totalBattles };

    } catch (error) {
        logger.error(`Battle automation failed: ${error.message}`, { context });
        if (browser) {
            await browser.close();
        }
        return { success: false, totalBattles: 0, error: error.message };
    }
}

export default {
    launchBrowser,
    navigateToMap,
    clickMap,
    getPopupDetails,
    clickPlayButton,
    executeBattleTurn,
    clickEndTurn,
    isBattleOver,
    runBattle,
    runAllMapBattles
};
