/* ============================================
   五子棋 — 完整游戏逻辑
   特性：双人 / AI 对战、计时器、音效、坐标、落子记录
   ============================================ */

// ============================================
//   常量
// ============================================
let BOARD_SIZE = 15;
const EMPTY = 0, BLACK = 1, WHITE = 2;
let CELL_SIZE, OFFSET, STONE_RADIUS;
let BOARD_PX = 600;
const STORAGE_KEY = 'gomoku_stats';
const THEME_KEY = 'gomoku_theme';

// ============================================
//   DOM 引用
// ============================================
const canvas = document.getElementById('boardCanvas');
const ctx = canvas.getContext('2d');
const turnStone = document.getElementById('turnStone');
const turnText  = document.getElementById('turnText');
const moveCount = document.getElementById('moveCount');
const statusEl  = document.getElementById('status');

// 模式
const modePvP  = document.getElementById('modePvP');
const modePvAI = document.getElementById('modePvAI');

// 音效
const soundToggle = document.getElementById('soundToggle');

// 难度
const diffBar = document.getElementById('diffBar');
const diffBtns = document.querySelectorAll('.diff-btn');

// 计时器
const timeBlackEl = document.getElementById('timeBlack');
const timeWhiteEl = document.getElementById('timeWhite');
const timerBlackEl = document.getElementById('timerBlack');
const timerWhiteEl = document.getElementById('timerWhite');

// 落子记录
const historyList  = document.getElementById('historyList');
const historyEmpty = document.getElementById('historyEmpty');
const historyBody  = document.getElementById('historyBody');
const historyToggle= document.getElementById('historyToggle');

// （设置已移除）

// 复盘
const replayBar  = document.getElementById('replayBar');
const replayPrev = document.getElementById('replayPrev');
const replayPlay = document.getElementById('replayPlay');
const replayNext = document.getElementById('replayNext');
const replayStep = document.getElementById('replayStep');
const replayExit = document.getElementById('replayExit');

// 禁手
const forbiddenTip = document.getElementById('forbiddenTip');

// ============================================
//   状态
// ============================================
let board = [];
let currentPlayer = BLACK;
let moves = [];
let gameOver = false;
let winLine = null;

let gameMode = 'pvp';      // 'pvp' | 'pvai'
let difficulty = 'medium'; // 'easy' | 'medium' | 'hard'
let soundEnabled = true;
let audioCtx = null;

// 计时器
let timerBlack = 600;
let timerWhite = 600;
let timerInterval = null;
let activeTimerPlayer = null; // BLACK 或 WHITE

// AI 正在思考中标志（防止并发触发）
let aiThinking = false;

// 胜利粒子特效
let victoryParticles = [];
let victoryParticleAnimId = null;

// 落子预览
let previewR = -1, previewC = -1;

// 掉落动画
let animDrop = null; // { r, c, player, startTime, callback }

// 复盘
let replayMode = false;
let replayIndex = 0;
let replayTimer = null; // auto-play timer

// 计时器暂停
let timerPaused = false;

// 设置状态
let timerDuration = 600; // 秒
let aiFirst = false;
let forbiddenEnabled = true;

// ============================================
//   棋盘大小重算
// ============================================

function recalcBoardSize(size) {
    BOARD_SIZE = size;
    CELL_SIZE = BOARD_PX / (BOARD_SIZE + 1);
    OFFSET = CELL_SIZE;
    STONE_RADIUS = CELL_SIZE * 0.43;
}

// ============================================
//   响应式画布 + HiDPI
// ============================================

function resizeCanvas() {
    const wrapper = document.querySelector('.board-wrapper');
    const style = getComputedStyle(wrapper);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const maxW = Math.min(window.innerWidth - 48, 600);
    BOARD_PX = Math.floor(Math.max(280, maxW - padding));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = BOARD_PX * dpr;
    canvas.height = BOARD_PX * dpr;
    canvas.style.width = BOARD_PX + 'px';
    canvas.style.height = BOARD_PX + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    recalcBoardSize(BOARD_SIZE);
}

function getStarPositions() {
    // 根据棋盘大小自动生成星位
    const s = BOARD_SIZE;
    if (s <= 9) return [[2,2],[2,6],[6,2],[6,6],[4,4]];
    // 13×13 和 15×15：天元 + 四角星
    const center = Math.floor(s / 2);
    const side = s >= 13 ? 3 : 2;
    const far = s - 1 - side;
    const stars = [[side,side],[side,far],[far,side],[far,far]];
    if (s >= 13) stars.push([side, center], [far, center], [center, side], [center, far]);
    stars.push([center, center]);
    return stars;
}

// ============================================
//   统计数据 (localStorage)
// ============================================
let stats = {
    totalGames: 0, blackWins: 0, whiteWins: 0,
    draws: 0, totalMoves: 0, maxMoves: 0
};

function loadStats() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) stats = { ...stats, ...JSON.parse(raw) };
    } catch (_) { /* ignore */ }
    renderStats();
}

function saveStats() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stats)); }
    catch (_) { /* ignore */ }
}

function renderStats() {
    document.getElementById('totalGames').textContent = stats.totalGames;
    document.getElementById('blackWins').textContent  = stats.blackWins;
    document.getElementById('whiteWins').textContent  = stats.whiteWins;
    document.getElementById('draws').textContent      = stats.draws;
    document.getElementById('avgMoves').textContent   =
        stats.totalGames > 0 ? Math.round(stats.totalMoves / stats.totalGames) : 0;
    document.getElementById('maxMoves').textContent   = stats.maxMoves;
}

function recordGame(winner) {
    stats.totalGames++;
    if (winner === 'black') stats.blackWins++;
    else if (winner === 'white') stats.whiteWins++;
    else if (winner === 'draw') stats.draws++;
    const m = moves.length;
    stats.totalMoves += m;
    if (m > stats.maxMoves) stats.maxMoves = m;
    saveStats();
    renderStats();
}

// ============================================
//   AI 引擎 — 基于模式评分的启发式算法
// ============================================

// 方向向量：水平、垂直、主对角线、副对角线
const DIRS = [[0,1],[1,0],[1,1],[1,-1]];

/**
 * 从 (r,c) 沿 (dr,dc) 方向统计连续同色棋子及两端情况
 * 返回: { count, openEnds }  count=连子数, openEnds=开放端数(0/1/2)
 */
function countDirection(r, c, dr, dc, player) {
    let count = 1;
    // 正方向
    for (let step = 1; step < 5; step++) {
        const nr = r + dr * step, nc = c + dc * step;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
        if (board[nr][nc] !== player) break;
        count++;
    }
    // 负方向
    for (let step = 1; step < 5; step++) {
        const nr = r - dr * step, nc = c - dc * step;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
        if (board[nr][nc] !== player) break;
        count++;
    }
    return count;
}

/**
 * 检查 (r,c) 沿 (dr,dc) 方向一端是否是开放（空格）
 */
function countOpenEnds(r, c, dr, dc, player) {
    let ends = 0;
    // 正方向末端
    let step = 1;
    while (step < 10) {
        const nr = r + dr * step, nc = c + dc * step;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
        if (board[nr][nc] !== EMPTY) break;
        ends++;
        break; // 只看第一个空格
    }
    // 负方向末端
    step = 1;
    while (step < 10) {
        const nr = r - dr * step, nc = c - dc * step;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
        if (board[nr][nc] !== EMPTY) break;
        ends++;
        break;
    }
    return ends;
}

/**
 * 评估如果 player 在 (r,c) 落子后的综合评分
 */
function evaluatePosition(r, c, player) {
    if (board[r][c] !== EMPTY) return -Infinity;
    let score = 0;

    for (const [dr, dc] of DIRS) {
        // 先假装落子
        board[r][c] = player;
        const count = countDirection(r, c, dr, dc, player);
        board[r][c] = EMPTY;

        if (count >= 5) return 1000000; // 必胜

        const openEnds = countOpenEnds(r, c, dr, dc, player);

        // 评分权重
        if (count === 4) {
            if (openEnds === 2) score += 50000;  // 活四
            else if (openEnds === 1) score += 5000; // 冲四
        } else if (count === 3) {
            if (openEnds === 2) score += 5000;   // 活三
            else if (openEnds === 1) score += 500; // 眠三
        } else if (count === 2) {
            if (openEnds === 2) score += 200;    // 活二
            else if (openEnds === 1) score += 50;
        } else if (count === 1) {
            if (openEnds === 2) score += 10;
        }
    }

    // 位置奖励：靠近中心更好
    const center = 7;
    const dist = Math.abs(r - center) + Math.abs(c - center);
    score += Math.max(0, 14 - dist);

    return score;
}

/**
 * 获取 AI 的最佳落子位置
 */
/**
 * 获取 AI 的最佳落子位置（按当前难度）
 */
function getBestMove() {
    const isEasy   = difficulty === 'easy';
    const isHard   = difficulty === 'hard';

    // 如果是第一步，直接下天元
    if (moves.length === 0) {
        return { r: 7, c: 7 };
    }

    // 简单模式：偶尔下随便的位置
    if (isEasy && Math.random() < 0.25) {
        const empty = [];
        for (let r = 0; r < BOARD_SIZE; r++)
            for (let c = 0; c < BOARD_SIZE; c++)
                if (board[r][c] === EMPTY) empty.push({ r, c });
        if (empty.length > 0)
            return empty[Math.floor(Math.random() * empty.length)];
    }

    let bestScore = -Infinity;
    let candidates = [];

    // 遍历所有空格
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (board[r][c] !== EMPTY) continue;

            // 只评估已有棋子附近的空格（剪枝优化）
            let nearStone = false;
            for (let dr = -2; dr <= 2; dr++) {
                for (let dc = -2; dc <= 2; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] !== EMPTY) {
                        nearStone = true;
                        break;
                    }
                }
                if (nearStone) break;
            }
            if (!nearStone) continue;

            // 进攻分（AI 自己）
            const attack = evaluatePosition(r, c, WHITE);
            // 防守分（堵对手）
            const defense = evaluatePosition(r, c, BLACK);

            let total;
            if (isEasy) {
                // 🟢 简单：防守意识弱，加随机扰动
                total = attack * 0.8 + defense * 0.3 + (Math.random() - 0.5) * 300;
            } else if (isHard) {
                // 🔴 困难：攻防都加强，无随机性
                total = attack * 1.3 + defense * 1.5;
            } else {
                // 🟡 中等：原行为
                total = attack * 1.1 + defense;
            }

            if (total > bestScore) {
                bestScore = total;
                candidates = [{ r, c }];
            } else if (total === bestScore) {
                candidates.push({ r, c });
            }
        }
    }

    if (candidates.length === 0) {
        return { r: 7, c: 7 };
    }

    if (isEasy && candidates.length > 1 && Math.random() < 0.4) {
        // 简单模式：多给一些随机性
        const idx = Math.floor(Math.random() * Math.min(candidates.length, 5));
        return candidates[idx];
    }

    // 困难模式：总是精确选最高分
    if (isHard) {
        return candidates[0];
    }

    // 中等模式：同等分数随机选
    return candidates[Math.floor(Math.random() * candidates.length)];
}

// ============================================
//   计时器暂停
// ============================================

function toggleTimerPause() {
    if (gameOver || replayMode) return;
    if (timerPaused) {
        timerPaused = false;
        timerInterval = setInterval(timerTick, 1000);
        timerBlackEl.classList.remove('paused-timer');
        timerWhiteEl.classList.remove('paused-timer');
        statusEl.textContent = '';
        statusEl.className = 'status';
    } else {
        timerPaused = true;
        clearInterval(timerInterval);
        timerInterval = null;
        timerBlackEl.classList.add('paused-timer');
        timerWhiteEl.classList.add('paused-timer');
        statusEl.textContent = '⏸ 计时已暂停';
        statusEl.className = 'status';
    }
}

// ============================================
//   音效 (Web Audio API)
// ============================================

function initAudio() {
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) { /* 不支持音频 */ }
}

function playTone(freq, duration, type = 'sine', volume = 0.15) {
    if (!soundEnabled || !audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(volume, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (_) { /* ignore */ }
}

function playMoveSound() {
    // 每次落子音调略有不同，更自然
    const freq = 480 + Math.random() * 80;
    playTone(freq, 0.1, 'sine', 0.25);
}

function playWinSound() {
    if (!soundEnabled || !audioCtx) return;
    setTimeout(() => playTone(523, 0.15, 'sine', 0.25), 0);
    setTimeout(() => playTone(659, 0.15, 'sine', 0.25), 150);
    setTimeout(() => playTone(784, 0.3, 'sine', 0.25), 300);
}

// ============================================
//   计时器
// ============================================

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    activeTimerPlayer = null;
    timerBlackEl.classList.remove('active-timer');
    timerWhiteEl.classList.remove('active-timer');
}

function startTimer() {
    stopTimer();
    timerBlack = timerDuration;
    timerWhite = timerDuration;
    updateTimerDisplay();
    if (gameOver) return;
    if (timerDuration === 0) return; // 无计时模式
    activeTimerPlayer = currentPlayer;
    if (activeTimerPlayer === BLACK) {
        timerBlackEl.classList.add('active-timer');
    } else {
        timerWhiteEl.classList.add('active-timer');
    }
    timerInterval = setInterval(timerTick, 1000);
}

function switchTimer() {
    if (gameOver) return;
    timerBlackEl.classList.remove('active-timer');
    timerWhiteEl.classList.remove('active-timer');
    activeTimerPlayer = currentPlayer;
    if (activeTimerPlayer === BLACK) {
        timerBlackEl.classList.add('active-timer');
    } else {
        timerWhiteEl.classList.add('active-timer');
    }
}

function timerTick() {
    if (gameOver) {
        stopTimer();
        return;
    }
    if (activeTimerPlayer === BLACK) {
        timerBlack--;
        if (timerBlack <= 0) {
            timerBlack = 0;
            updateTimerDisplay();
            // 黑棋超时 → 白胜
            gameOver = true;
            statusEl.textContent = '⏰ 黑棋超时！白棋获胜！';
            statusEl.className = 'status win';
            recordGame('white');
            draw();
            updateUI();
            stopTimer();
            return;
        }
    } else if (activeTimerPlayer === WHITE) {
        timerWhite--;
        if (timerWhite <= 0) {
            timerWhite = 0;
            updateTimerDisplay();
            // 白棋超时 → 黑胜
            gameOver = true;
            statusEl.textContent = '⏰ 白棋超时！黑棋获胜！';
            statusEl.className = 'status win';
            recordGame('black');
            draw();
            updateUI();
            stopTimer();
            return;
        }
    }
    updateTimerDisplay();
}

function updateTimerDisplay() {
    if (timerDuration === 0) {
        timeBlackEl.textContent = '--:--';
        timeWhiteEl.textContent = '--:--';
        return;
    }
    const fmt = (sec) => {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };
    timeBlackEl.textContent = fmt(timerBlack);
    timeWhiteEl.textContent = fmt(timerWhite);
}

// ============================================
//   掉落动画
// ============================================

function startDropAnimation(r, c, player, callback) {
    animDrop = { r, c, player, startTime: performance.now(), callback };
    requestAnimationFrame(animateDropFrame);
}

function animateDropFrame(timestamp) {
    if (!animDrop) return;
    const elapsed = timestamp - animDrop.startTime;
    const duration = 200;
    const progress = Math.min(elapsed / duration, 1);
    animDrop.progress = progress;
    draw();
    if (progress < 1) {
        requestAnimationFrame(animateDropFrame);
    } else {
        playMoveSound();
        const cb = animDrop.callback;
        animDrop = null;
        if (cb) cb();
        // 清除预览
        previewR = -1; previewC = -1;
        draw();
    }
}

// ============================================
//   棋盘初始化
// ============================================

function initBoard() {
    stopTimer();
    resizeCanvas();
    board = Array.from({ length: BOARD_SIZE }, () =>
        Array(BOARD_SIZE).fill(EMPTY)
    );
    currentPlayer = BLACK;
    moves = [];
    gameOver = false;
    winLine = null;
    aiThinking = false;
    previewR = -1; previewC = -1;
    animDrop = null;
    victoryParticles = [];
    if (victoryParticleAnimId) {
        cancelAnimationFrame(victoryParticleAnimId);
        victoryParticleAnimId = null;
    }
    replayMode = false;
    replayIndex = 0;
    if (replayTimer) {
        clearInterval(replayTimer);
        replayTimer = null;
        replayPlay.textContent = '▶';
        replayPlay.classList.remove('playing');
    }
    replayBar.classList.add('hidden');
    forbiddenTip.classList.add('hidden');
    updateUI();
    renderHistory();
    draw();
    startTimer();
    // AI 先手模式
    if (aiFirst && gameMode === 'pvai') {
        currentPlayer = WHITE;
        aiThinking = true;
        setTimeout(() => {
            if (!gameOver) { aiMove(); }
            aiThinking = false;
        }, 300);
    }
}

// ============================================
//   绘制
// ============================================

function draw() {
    ctx.clearRect(0, 0, BOARD_PX, BOARD_PX);

    // 棋盘背景
    ctx.fillStyle = themeColors.boardBg;
    ctx.fillRect(0, 0, BOARD_PX, BOARD_PX);

    // 坐标标注
    drawCoords();

    // 网格线
    ctx.strokeStyle = themeColors.grid;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < BOARD_SIZE; i++) {
        const pos = OFFSET + i * CELL_SIZE;
        ctx.beginPath(); ctx.moveTo(OFFSET, pos);
        ctx.lineTo(OFFSET + (BOARD_SIZE - 1) * CELL_SIZE, pos); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pos, OFFSET);
        ctx.lineTo(pos, OFFSET + (BOARD_SIZE - 1) * CELL_SIZE); ctx.stroke();
    }

    // 星位（根据棋盘大小自动计算）
    const stars = getStarPositions();
    ctx.fillStyle = themeColors.grid;
    for (const [r, c] of stars) {
        ctx.beginPath();
        ctx.arc(OFFSET + c * CELL_SIZE, OFFSET + r * CELL_SIZE, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    // 棋子
    for (let r = 0; r < BOARD_SIZE; r++)
        for (let c = 0; c < BOARD_SIZE; c++)
            if (board[r][c] !== EMPTY) drawStone(r, c, board[r][c]);

    // 上一步标记 — 金色三角指示器
    if (moves.length > 0 && !gameOver && !victoryParticles.length) {
        const last = moves[moves.length - 1];
        const x = OFFSET + last.c * CELL_SIZE;
        const y = OFFSET + last.r * CELL_SIZE;
        const sz = STONE_RADIUS * 0.5;
        ctx.save();
        ctx.fillStyle = '#f1c40f';
        ctx.strokeStyle = '#e67e22';
        ctx.lineWidth = 1;
        ctx.shadowColor = 'rgba(241,196,15,0.6)';
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.moveTo(x - sz * 0.6, y + sz * 0.85);
        ctx.lineTo(x + sz * 0.6, y + sz * 0.85);
        ctx.lineTo(x, y + sz * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    // 落子预览（鼠标悬停）
    if (previewR >= 0 && previewC >= 0 && !gameOver && board[previewR][previewC] === EMPTY && !animDrop) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        drawStone(previewR, previewC, currentPlayer);
        ctx.restore();
    }

    // 掉落动画
    if (animDrop) {
        const { r, c, player, startTime } = animDrop;
        const elapsed = performance.now() - startTime;
        const duration = 200;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const targetY = OFFSET + r * CELL_SIZE;
        const startY = -STONE_RADIUS * 4;
        const currentY = startY + (targetY - startY) * eased;

        // 保存并裁剪到棋盘区域
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, BOARD_PX, BOARD_PX);
        ctx.clip();

        // 手动绘制动画中的棋子
        const x = OFFSET + c * CELL_SIZE, y = currentY;
        const isBlack = player === BLACK;
        const s = {b1:'#555',b2:'#222',b3:'#000',w1:'#fff',w2:'#f0f0f0',w3:'#ccc',wBorder:'#bbb'};

        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;

        const grad = ctx.createRadialGradient(
            x - STONE_RADIUS * 0.3, y - STONE_RADIUS * 0.3, STONE_RADIUS * 0.1,
            x, y, STONE_RADIUS
        );
        if (isBlack) {
            grad.addColorStop(0, s.b1); grad.addColorStop(0.4, s.b2); grad.addColorStop(1, s.b3);
        } else {
            grad.addColorStop(0, s.w1); grad.addColorStop(0.4, s.w2); grad.addColorStop(1, s.w3);
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, STONE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // 胜利粒子
    if (victoryParticles.length > 0) {
        for (const p of victoryParticles) {
            if (p.life <= 0) continue;
            ctx.save();
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    // 获胜连线 + 光晕
    if (winLine) {
        ctx.save();
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 4;
        ctx.shadowColor = '#e74c3c';
        ctx.shadowBlur = 12;
        const a = winLine[0], b = winLine[winLine.length - 1];
        ctx.beginPath();
        ctx.moveTo(OFFSET + a.c * CELL_SIZE, OFFSET + a.r * CELL_SIZE);
        ctx.lineTo(OFFSET + b.c * CELL_SIZE, OFFSET + b.r * CELL_SIZE);
        ctx.stroke();
        ctx.restore();

        for (const p of winLine) {
            const x = OFFSET + p.c * CELL_SIZE, y = OFFSET + p.r * CELL_SIZE;
            const g = ctx.createRadialGradient(x, y, 2, x, y, STONE_RADIUS + 6);
            g.addColorStop(0, 'rgba(231,76,60,0.6)');
            g.addColorStop(1, 'rgba(231,76,60,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, STONE_RADIUS + 6, 0, Math.PI * 2);
            ctx.fill();
        }
        for (const p of winLine) drawStone(p.r, p.c, board[p.r][p.c]);
    }
}

function drawCoords() {
    ctx.fillStyle = themeColors.grid;
    ctx.font = `${Math.round(CELL_SIZE * 0.36)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 列坐标 A-O
    for (let c = 0; c < BOARD_SIZE; c++) {
        const x = OFFSET + c * CELL_SIZE;
        const label = String.fromCharCode(65 + c);
        // 上
        ctx.fillText(label, x, OFFSET * 0.45);
        // 下
        ctx.fillText(label, x, BOARD_PX - OFFSET * 0.45);
    }

    // 行坐标 1-15
    for (let r = 0; r < BOARD_SIZE; r++) {
        const y = OFFSET + r * CELL_SIZE;
        const label = (r + 1).toString();
        // 左
        ctx.fillText(label, OFFSET * 0.55, y);
        // 右
        ctx.fillText(label, BOARD_PX - OFFSET * 0.55, y);
    }
}

function drawStone(r, c, player) {
    const s = {b1:'#555',b2:'#222',b3:'#000',w1:'#fff',w2:'#f0f0f0',w3:'#ccc',wBorder:'#bbb'};
    const x = OFFSET + c * CELL_SIZE, y = OFFSET + r * CELL_SIZE;
    const isBlack = player === BLACK;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    const grad = ctx.createRadialGradient(
        x - STONE_RADIUS * 0.3, y - STONE_RADIUS * 0.3, STONE_RADIUS * 0.1,
        x, y, STONE_RADIUS
    );
    if (isBlack) {
        grad.addColorStop(0, s.b1); grad.addColorStop(0.4, s.b2); grad.addColorStop(1, s.b3);
    } else {
        grad.addColorStop(0, s.w1); grad.addColorStop(0.4, s.w2); grad.addColorStop(1, s.w3);
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, STONE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (!isBlack) {
        ctx.strokeStyle = s.wBorder;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(x, y, STONE_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.fillStyle = isBlack ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(x - STONE_RADIUS * 0.25, y - STONE_RADIUS * 0.25, STONE_RADIUS * 0.25, 0, Math.PI * 2);
    ctx.fill();
}

// ============================================
//   胜负判定
// ============================================

function checkWin(r, c, player) {
    for (const [dr, dc] of DIRS) {
        const line = [{ r, c }];
        for (let step = 1; step < 5; step++) {
            const nr = r + dr * step, nc = c + dc * step;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
            if (board[nr][nc] !== player) break;
            line.push({ r: nr, c: nc });
        }
        for (let step = 1; step < 5; step++) {
            const nr = r - dr * step, nc = c - dc * step;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
            if (board[nr][nc] !== player) break;
            line.unshift({ r: nr, c: nc });
        }
        if (line.length >= 5) return line;
    }
    return null;
}

// ============================================
//   禁手规则（黑棋双活三、双四、长连）
// ============================================

function isForbiddenMove(r, c, player) {
    // 只对黑棋且在 PvP 模式且开启禁手时生效
    if (!forbiddenEnabled) return false;
    if (player !== BLACK || gameMode !== 'pvp') return false;
    // 空格才检测
    if (board[r][c] !== EMPTY) return false;

    // 1. 长连检测（>5）
    board[r][c] = player;
    for (const [dr, dc] of DIRS) {
        let count = 1;
        for (let step = 1; step < 10; step++) {
            const nr = r + dr * step, nc = c + dc * step;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
            if (board[nr][nc] !== player) break;
            count++;
        }
        for (let step = 1; step < 10; step++) {
            const nr = r - dr * step, nc = c - dc * step;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
            if (board[nr][nc] !== player) break;
            count++;
        }
        if (count > 5) { board[r][c] = EMPTY; return true; }
    }

    // 2. 双四检测
    let fours = 0;
    for (const [dr, dc] of DIRS) {
        const count = countDirection(r, c, dr, dc, player);
        const ends = countOpenEnds(r, c, dr, dc, player);
        if (count === 4 && ends >= 1) fours++;
    }

    // 3. 双活三检测
    let threes = 0;
    for (const [dr, dc] of DIRS) {
        const count = countDirection(r, c, dr, dc, player);
        const ends = countOpenEnds(r, c, dr, dc, player);
        if (count === 3 && ends === 2) threes++;
    }

    board[r][c] = EMPTY;

    if (fours >= 2) return true;   // 双四禁手
    if (threes >= 2) return true;  // 双活三禁手
    return false;
}

// ============================================
//   落子记录渲染
// ============================================

function renderHistory() {
    historyList.innerHTML = '';
    if (moves.length === 0) {
        historyEmpty.style.display = 'block';
        return;
    }
    historyEmpty.style.display = 'none';

    const colLabel = (c) => String.fromCharCode(65 + c);
    const rowLabel = (r) => (r + 1).toString();

    for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        const li = document.createElement('li');
        const playerClass = m.player === BLACK ? 'black' : 'white';
        const playerLabel = m.player === BLACK ? '⚫' : '⚪';
        li.innerHTML = `<span class="h-num">${i + 1}.</span><span class="h-player ${playerClass}">${playerLabel}</span> <span class="h-coord">${colLabel(m.c)}${rowLabel(m.r)}</span>`;
        historyList.appendChild(li);
    }

    // 滚动到底部
    historyBody.scrollTop = historyBody.scrollHeight;
}

// ============================================
//   胜利粒子特效
// ============================================

function spawnVictoryParticles(winLine) {
    victoryParticles = [];
    const colors = ['#f1c40f','#e74c3c','#e67e22','#f39c12','#ff6b6b','#ffd93d','#6bcb77','#ffeaa7'];
    for (let i = 0; i < 80; i++) {
        const pos = winLine[Math.floor(Math.random() * winLine.length)];
        const x = OFFSET + pos.c * CELL_SIZE;
        const y = OFFSET + pos.r * CELL_SIZE;
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 5;
        victoryParticles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 3,
            life: 1,
            decay: 0.006 + Math.random() * 0.018,
            color: colors[Math.floor(Math.random() * colors.length)],
            size: 2 + Math.random() * 4
        });
    }
    if (!victoryParticleAnimId) {
        victoryParticleAnimId = requestAnimationFrame(animateVictoryParticles);
    }
}

function animateVictoryParticles() {
    let alive = false;
    for (const p of victoryParticles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.06;
        p.life -= p.decay;
        if (p.life > 0) alive = true;
    }
    draw();
    if (alive) {
        victoryParticleAnimId = requestAnimationFrame(animateVictoryParticles);
    } else {
        victoryParticleAnimId = null;
        victoryParticles = [];
        draw();
    }
}

// ============================================
//   游戏操作
// ============================================

function placeStone(r, c) {
    board[r][c] = currentPlayer;
    moves.push({ r, c, player: currentPlayer });
    renderHistory();

    // 判胜
    winLine = checkWin(r, c, currentPlayer);
    if (winLine) {
        gameOver = true;
        const name = currentPlayer === BLACK ? '黑棋' : '白棋';
        statusEl.textContent = `🏆 ${name} 获胜！共 ${moves.length} 手`;
        statusEl.className = 'status win';
        recordGame(currentPlayer === BLACK ? 'black' : 'white');
        playWinSound();
        spawnVictoryParticles(winLine);
        stopTimer();
        // draw() 由粒子动画驱动，不在此处调用
        updateUI();
        replayMode = true;
        replayBar.classList.remove('hidden');
        replayIndex = moves.length;
        updateReplayUI();
        return true; // 游戏结束
    }

    // 平局
    if (moves.length >= BOARD_SIZE * BOARD_SIZE) {
        gameOver = true;
        statusEl.textContent = '🤝 平局！棋盘已满';
        statusEl.className = 'status';
        recordGame('draw');
        stopTimer();
        // 平局也来点小粒子
        spawnVictoryParticles(moves.slice(-5));
        updateUI();
        replayMode = true;
        replayBar.classList.remove('hidden');
        replayIndex = moves.length;
        updateReplayUI();
        return true;
    }

    // 切换玩家
    currentPlayer = currentPlayer === BLACK ? WHITE : BLACK;
    updateUI();
    switchTimer();
    draw();
    return false;
}

// 从事件中提取逻辑棋盘坐标
function eventToBoard(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = BOARD_PX / rect.width;
    const scaleY = BOARD_PX / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const mx = (clientX - rect.left) * scaleX;
    const my = (clientY - rect.top)  * scaleY;
    const c = Math.round((mx - OFFSET) / CELL_SIZE);
    const r = Math.round((my - OFFSET) / CELL_SIZE);
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return null;
    const cx = OFFSET + c * CELL_SIZE, cy = OFFSET + r * CELL_SIZE;
    if (Math.hypot(mx - cx, my - cy) > CELL_SIZE * 0.48) return null;
    return { r, c, mx, my };
}

function handleClick(e) {
    if (gameOver) return;
    if (aiThinking) return;
    // AI 模式下轮到 AI 时不允许点击
    if (gameMode === 'pvai' && currentPlayer === WHITE) return;

    const pos = eventToBoard(e);
    if (!pos) return;
    const { r, c } = pos;
    if (board[r][c] !== EMPTY) return;

    // 启动掉落动画，完成后执行落子逻辑
    startDropAnimation(r, c, currentPlayer, () => {
        const ended = placeStone(r, c);
        // AI 模式且游戏未结束 → AI 落子
        if (!ended && gameMode === 'pvai') {
            aiThinking = true;
            setTimeout(() => {
                if (!gameOver) {
                    aiMove();
                }
                aiThinking = false;
            }, 200);
        }
    });
}

function aiMove() {
    if (gameOver) return;
    if (currentPlayer !== WHITE) return; // AI 执白

    const move = getBestMove();
    if (!move) return;

    startDropAnimation(move.r, move.c, WHITE, () => {
        placeStone(move.r, move.c);
    });
}

function undoMove() {
    if (moves.length === 0) return;
    if (aiThinking) return;
    // AI 模式下不能悔棋（或只能悔对手的棋）
    if (gameMode === 'pvai') {
        // 连续悔两步（AI + 玩家）
        if (moves.length >= 2) {
            for (let i = 0; i < 2; i++) {
                const last = moves.pop();
                board[last.r][last.c] = EMPTY;
            }
            currentPlayer = BLACK;
        } else {
            return;
        }
    } else {
        if (gameOver) { gameOver = false; winLine = null; }
        const last = moves.pop();
        board[last.r][last.c] = EMPTY;
        currentPlayer = last.player;
    }

    statusEl.textContent = '';
    statusEl.className = 'status';
    stopTimer();
    updateUI();
    renderHistory();
    draw();
    if (!gameOver) startTimer();
    gameOver = false;
    winLine = null;
}

function resetGame() {
    initBoard();
    statusEl.textContent = '';
    statusEl.className = 'status';
}

function updateUI() {
    if (gameOver) return;
    const isBlack = currentPlayer === BLACK;
    turnStone.textContent = isBlack ? '⚫' : '⚪';
    turnText.textContent  = isBlack ? '黑棋' : '白棋';
    moveCount.textContent = moves.length;
}

// ============================================
//   复盘功能
// ============================================

function updateReplayUI() {
    replayStep.textContent = `${replayIndex}/${moves.length}`;
}

function applyReplayState() {
    board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
    for (let i = 0; i < replayIndex; i++) {
        const m = moves[i];
        board[m.r][m.c] = m.player;
    }
    updateReplayUI();
    draw();
}

function replayGoPrev() {
    if (replayIndex <= 0) return;
    replayIndex--;
    applyReplayState();
}

function replayGoNext() {
    if (replayIndex >= moves.length) return;
    replayIndex++;
    applyReplayState();
}

function toggleReplayAutoPlay() {
    if (replayTimer) {
        clearInterval(replayTimer);
        replayTimer = null;
        replayPlay.textContent = '▶';
        replayPlay.classList.remove('playing');
    } else {
        if (replayIndex >= moves.length) replayIndex = 0;
        replayPlay.textContent = '⏸';
        replayPlay.classList.add('playing');
        replayTimer = setInterval(() => {
            if (replayIndex >= moves.length) {
                clearInterval(replayTimer);
                replayTimer = null;
                replayPlay.textContent = '▶';
                replayPlay.classList.remove('playing');
                return;
            }
            replayIndex++;
            applyReplayState();
        }, 600);
    }
}

function exitReplay() {
    replayMode = false;
    if (replayTimer) {
        clearInterval(replayTimer);
        replayTimer = null;
        replayPlay.textContent = '▶';
        replayPlay.classList.remove('playing');
    }
    replayBar.classList.add('hidden');
    board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
    for (const m of moves) {
        board[m.r][m.c] = m.player;
    }
    draw();
}

// ============================================
//   模式切换
// ============================================

function setMode(mode) {
    if (gameMode === mode) return;
    gameMode = mode;
    modePvP.classList.toggle('active', mode === 'pvp');
    modePvAI.classList.toggle('active', mode === 'pvai');
    // 显示/隐藏难度选择
    diffBar.classList.toggle('hidden', mode === 'pvp');
    // 切换模式时重置棋盘
    resetGame();
}

// ============================================
//   事件绑定
// ============================================

// 清除落子预览
function clearPreview() {
    if (previewR !== -1) {
        previewR = -1; previewC = -1;
        if (!animDrop) draw();
    }
}

// 画布鼠标悬停 — 落子预览
canvas.addEventListener('mousemove', function(e) {
    const pos = eventToBoard(e);
    if (pos && board[pos.r][pos.c] === EMPTY) {
        if (previewR !== pos.r || previewC !== pos.c) {
            previewR = pos.r; previewC = pos.c;
            if (!animDrop) draw();
        }
    } else {
        clearPreview();
    }
});
canvas.addEventListener('mouseleave', clearPreview);

// 触摸事件 — 移动端落子 + 预览
canvas.addEventListener('touchstart', function(e) {
    e.preventDefault();
    handleClick(e);
}, { passive: false });

canvas.addEventListener('touchmove', function(e) {
    e.preventDefault();
    const pos = eventToBoard(e);
    if (pos && board[pos.r][pos.c] === EMPTY) {
        if (previewR !== pos.r || previewC !== pos.c) {
            previewR = pos.r; previewC = pos.c;
            if (!animDrop) draw();
        }
    } else {
        clearPreview();
    }
}, { passive: false });

canvas.addEventListener('touchend', function(e) {
    e.preventDefault();
    clearPreview();
}, { passive: false });

canvas.addEventListener('click', handleClick);
document.getElementById('resetBtn').addEventListener('click', resetGame);
document.getElementById('undoBtn').addEventListener('click', undoMove);

// 模式切换
modePvP.addEventListener('click', () => setMode('pvp'));
modePvAI.addEventListener('click', () => setMode('pvai'));

// 难度切换
diffBtns.forEach(btn => {
    btn.addEventListener('click', function() {
        const diff = this.dataset.diff;
        if (diff === difficulty) return;
        difficulty = diff;
        diffBtns.forEach(b => b.classList.toggle('active', b.dataset.diff === diff));
        resetGame();
    });
});

// 音效开关
soundToggle.addEventListener('click', function() {
    soundEnabled = !soundEnabled;
    this.textContent = soundEnabled ? '🔊' : '🔇';
    this.classList.toggle('muted', !soundEnabled);
    if (soundEnabled && !audioCtx) initAudio();
});

// 主题切换
document.getElementById('themeToggle').addEventListener('click', cycleTheme);

// 统计面板折叠
document.getElementById('dashToggle').addEventListener('click', function() {
    const collapsed = document.getElementById('dashBody').classList.toggle('collapsed');
    this.textContent = collapsed ? '▼' : '▲';
});
document.getElementById('clearStatsBtn').addEventListener('click', function() {
    if (confirm('确定清除所有对局记录吗？')) {
        stats = { totalGames: 0, blackWins: 0, whiteWins: 0, draws: 0, totalMoves: 0, maxMoves: 0 };
        saveStats();
        renderStats();
    }
});

// 复盘按钮
replayPrev.addEventListener('click', replayGoPrev);
replayNext.addEventListener('click', replayGoNext);
replayPlay.addEventListener('click', toggleReplayAutoPlay);
replayExit.addEventListener('click', exitReplay);

// 键盘快捷键
document.addEventListener('keydown', function(e) {
    const key = e.key;
    // 复盘模式下的快捷键
    if (replayMode) {
        if (key === 'ArrowLeft' || key === 'ArrowUp') { replayGoPrev(); e.preventDefault(); }
        else if (key === 'ArrowRight' || key === 'ArrowDown') { replayGoNext(); e.preventDefault(); }
        else if (key === ' ') { toggleReplayAutoPlay(); e.preventDefault(); }
        else if (key === 'Escape') { exitReplay(); e.preventDefault(); }
        return;
    }
    // 普通模式快捷键（不输入文字时才触发）
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (key === 'r' || key === 'R') { resetGame(); e.preventDefault(); }
    else if (key === 'z' || key === 'Z') { undoMove(); e.preventDefault(); }
    else if (key === ' ' && !replayMode) { toggleTimerPause(); e.preventDefault(); }
});

// 棋盘大小选择
document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        const size = parseInt(this.dataset.size);
        if (size === BOARD_SIZE) return;
        document.querySelectorAll('.size-btn').forEach(b => b.classList.toggle('active', b === this));
        recalcBoardSize(size);
        resetGame();
    });
});

// 落子记录折叠
historyToggle.addEventListener('click', function() {
    const collapsed = historyBody.classList.toggle('collapsed');
    this.textContent = collapsed ? '▼' : '▲';
});

// 音效初始化在首次用户交互时
document.addEventListener('click', function initOnce() {
    initAudio();
    document.removeEventListener('click', initOnce);
}, { once: true });

// ============================================
//   主题切换
// ============================================

// 缓存的 Canvas 主题色（JS 绘制用）
let themeColors = { boardBg: '#dcb35c', grid: '#5a3e1b' };

function updateThemeColors() {
    const style = getComputedStyle(document.body);
    themeColors.boardBg = style.getPropertyValue('--board-canvas-bg').trim() || '#dcb35c';
    themeColors.grid = style.getPropertyValue('--grid-color').trim() || '#5a3e1b';
}

function loadTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'dark';
    document.body.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
    updateThemeColors();
}

function cycleTheme() {
    const themes = ['dark', 'light', 'wood'];
    const current = document.body.getAttribute('data-theme') || 'dark';
    const idx = themes.indexOf(current);
    const next = themes[(idx + 1) % themes.length];
    document.body.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    updateThemeIcon(next);
    updateThemeColors();
    if (!animDrop && !victoryParticles.length) draw();
}

function updateThemeIcon(theme) {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const icons = { dark: '🌙', light: '☀️', wood: '🪵' };
    btn.textContent = icons[theme] || '🌙';
}

// ============================================
//   启动
// ============================================

loadStats();
loadTheme();
initBoard();

// 响应式监听
window.addEventListener('resize', () => {
    if (!animDrop && !victoryParticles.length) resizeCanvas();
});
