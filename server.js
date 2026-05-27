/* ============================================
   五子棋远程联机 — HTTP 静态文件 + WebSocket 服务器
   ============================================ */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3456;

// ── MIME 类型 ──
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
};

// ── HTTP 服务器 (提供静态文件) ──
const server = http.createServer((req, res) => {
    let url = req.url.split('?')[0]; // 去 query
    if (url === '/') url = '/index.html';

    const filePath = path.join(__dirname, url);
    const ext = path.extname(filePath).toLowerCase();

    // 安全检查：防止目录穿越
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
        });
        res.end(data);
    });
});

// ── WebSocket 附加到同一个 HTTP server ──
const wss = new WebSocketServer({ server });

// ── 房间存储 ──
const rooms = new Map();

// ── 工具函数 ──
function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 5; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

function send(ws, data) {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(data));
    }
}

function opponentIndex(idx) {
    return idx === 0 ? 1 : 0;
}

// ── WebSocket 连接处理 ──
wss.on('connection', (ws, req) => {
    let myRoomId = null;
    let myIndex = -1;
    const clientIP = req.socket.remoteAddress;
    console.log(`🔗 新连接: ${clientIP}`);

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); }
        catch (_) { return; }

        switch (msg.type) {

            case 'create_room': {
                const roomId = generateRoomId();
                rooms.set(roomId, {
                    players: [ws, null],
                    history: [],
                    createdAt: Date.now(),
                });
                myRoomId = roomId;
                myIndex = 0;
                send(ws, { type: 'room_created', roomId, player: 'black' });
                console.log(`🏠 房间 ${roomId} 已创建 (黑棋)`);
                break;
            }

            case 'join_room': {
                const { roomId } = msg;
                const room = rooms.get(roomId);
                if (!room) {
                    send(ws, { type: 'error', message: '房间不存在' });
                    return;
                }
                if (room.players[1] !== null) {
                    send(ws, { type: 'error', message: '房间已满' });
                    return;
                }
                if (room.players[0] === ws) {
                    send(ws, { type: 'error', message: '不能加入自己创建的房间' });
                    return;
                }
                room.players[1] = ws;
                myRoomId = roomId;
                myIndex = 1;
                send(ws, { type: 'room_joined', roomId, player: 'white' });
                send(room.players[0], { type: 'opponent_joined' });
                send(room.players[0], { type: 'game_start', yourColor: 'black' });
                send(room.players[1], { type: 'game_start', yourColor: 'white' });
                console.log(`👥 玩家加入房间 ${roomId} (白棋)`);
                break;
            }

            case 'move': {
                const room = rooms.get(myRoomId);
                if (!room) return;
                const opp = room.players[opponentIndex(myIndex)];
                send(opp, { type: 'opponent_move', r: msg.r, c: msg.c });
                room.history.push({ r: msg.r, c: msg.c, player: myIndex });
                break;
            }

            case 'undo_request': {
                const room = rooms.get(myRoomId);
                if (!room) return;
                const opp = room.players[opponentIndex(myIndex)];
                send(opp, { type: 'undo_request' });
                break;
            }

            case 'undo_response': {
                const room = rooms.get(myRoomId);
                if (!room) return;
                const opp = room.players[opponentIndex(myIndex)];
                send(opp, { type: 'undo_response', accepted: msg.accepted });
                if (msg.accepted && room.history.length >= 2) {
                    room.history.pop();
                    room.history.pop();
                }
                break;
            }

            case 'resign': {
                const room = rooms.get(myRoomId);
                if (!room) return;
                const opp = room.players[opponentIndex(myIndex)];
                send(opp, { type: 'opponent_resigned' });
                console.log(`🏳️ 房间 ${myRoomId}: 玩家${myIndex === 0 ? '黑' : '白'}投降`);
                break;
            }

            case 'chat': {
                const room = rooms.get(myRoomId);
                if (!room) return;
                const opp = room.players[opponentIndex(myIndex)];
                send(opp, { type: 'chat', text: msg.text });
                break;
            }

            default:
                break;
        }
    });

    ws.on('close', () => {
        if (myRoomId) {
            const room = rooms.get(myRoomId);
            if (room) {
                const opp = room.players[opponentIndex(myIndex)];
                send(opp, { type: 'opponent_left' });
                rooms.delete(myRoomId);
                console.log(`👋 房间 ${myRoomId} 已关闭`);
            }
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket 错误:', err.message);
    });
});

server.listen(PORT, () => {
    console.log(`🎮 五子棋联机服务器已启动`);
    console.log(`   HTTP + WebSocket → http://localhost:${PORT}`);
});

// 定期清理超过 2 小时的空房间
setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
        if ((!room.players[0] || room.players[0].readyState !== 1) &&
            (!room.players[1] || room.players[1].readyState !== 1) &&
            now - room.createdAt > 2 * 60 * 60 * 1000) {
            rooms.delete(id);
        }
    }
}, 30 * 60 * 1000);
