const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// For render.com health check / any unmatched route → serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// ────────────────────────────────────────────────
// WebSocket server
// ────────────────────────────────────────────────

const wss = new WebSocket.Server({ server });

let currentDrawer = null;        // ws of current drawer or null
let lastTurnEnded = 0;
const TURN_DURATION = 60_000;    // 60 seconds

const clients = new Set();       // all connected ws clients

// Broadcast to everyone except sender (or to everyone)
function broadcast(data, exclude = null) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

wss.on('connection', (ws) => {
  clients.add(ws);

  // Send current state to new user
  ws.send(JSON.stringify({
    type: 'init',
    canDraw: currentDrawer === null,
    timeLeft: currentDrawer ? Math.max(0, TURN_DURATION - (Date.now() - lastTurnEnded)) : 0,
    drawer: currentDrawer ? 'someone' : null
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'draw' && ws === currentDrawer) {
        broadcast({
          type: 'draw',
          x0: data.x0, y0: data.y0,
          x1: data.x1, y1: data.y1,
          color: data.color || '#000'
        }, ws);
      }

      else if (data.type === 'request-turn') {
        if (currentDrawer === null && Date.now() - lastTurnEnded > TURN_DURATION) {
          currentDrawer = ws;
          lastTurnEnded = Date.now();

          broadcast({ type: 'new-turn', drawer: 'someone', timeLeft: TURN_DURATION });
          ws.send({ type: 'your-turn', duration: TURN_DURATION });
        } else {
          ws.send({
            type: 'turn-info',
            canDraw: false,
            timeLeft: currentDrawer ? TURN_DURATION - (Date.now() - lastTurnEnded) : 0
          });
        }
      }

      else if (data.type === 'clear') {
        if (ws === currentDrawer) {
          broadcast({ type: 'clear' });
        }
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    clients.delete(ws);
    if (ws === currentDrawer) {
      currentDrawer = null;
      lastTurnEnded = Date.now();
      broadcast({
        type: 'turn-ended',
        message: 'Current drawer left — next person can draw!'
      });
    }
  });
});

console.log('WebSocket server ready');
