// HTTP + WebSocket layer.
//  - Legacy-compatible endpoints: /tiltscan, /macid/:mac, /data/:file, /log.csv
//  - Dashboard: /ui (built React app), live state + commands over WebSocket /ws
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { listTimezones, currentTimezone } from '../system/system.js';

const STATE_THROTTLE_MS = 150;

/** @param {import('../app.js').TiltPiApp} app */
export function createServer(app, config) {
  const ex = express();
  ex.disable('x-powered-by');

  // ---- legacy endpoints (other Tilt Pis, the Tkinter dashboard and scripts rely on these)
  ex.get('/tiltscan', (_req, res) => res.json(app.snapshot.current()));

  ex.get('/macid/:mac', (req, res) => res.json(app.readings.findByMac(req.params.mac)));

  const sendDataFile = (name, res) => {
    const file = path.resolve(config.dataDir, name);
    if (path.dirname(file) !== config.dataDir || !file.endsWith('.json')) {
      return res.status(404).json({});
    }
    fs.readFile(file, 'utf8', (err, text) => {
      res.set('Access-Control-Allow-Origin', '*');
      if (err) return res.status(404).json({});
      try {
        res.json(JSON.parse(text));
      } catch {
        res.type('text/plain').send(text);
      }
    });
  };
  ex.get('/data/', (_req, res) => sendDataFile('global.json', res));
  ex.get('/data/:file', (req, res) => {
    const name = req.params.file;
    sendDataFile(name.endsWith('.json') ? name : name + '.json', res);
  });

  ex.get('/log.csv', (_req, res) => {
    const file = path.join(config.dataDir, 'log.csv');
    if (!fs.existsSync(file)) return res.status(404).end();
    res.download(file, 'log.csv');
  });

  // ---- dashboard
  ex.use('/ui', express.static(config.webDir, { index: 'index.html' }));
  ex.get(/^\/ui(\/.*)?$/, (_req, res) => {
    const index = path.join(config.webDir, 'index.html');
    if (fs.existsSync(index)) res.sendFile(index);
    else res.status(503).send('Dashboard not built. Run "npm run build" in web/.');
  });
  ex.get('/', (_req, res) => res.redirect('/ui/'));

  const server = http.createServer(ex);
  attachWebSocket(server, app);
  return server;
}

function attachWebSocket(server, app) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const broadcast = (msg) => {
    const text = JSON.stringify(msg);
    for (const ws of wss.clients) if (ws.readyState === 1) ws.send(text);
  };

  let pending = null;
  app.on('state', () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      if (wss.clients.size) broadcast({ type: 'state', state: app.state() });
    }, STATE_THROTTLE_MS);
  });
  app.on('toast', (toast) => broadcast({ type: 'toast', toast }));
  app.on('beerUpdated', (color) => broadcast({ type: 'beerUpdated', color }));

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'static', timezones: listTimezones(), timezone: currentTimezone() }));
    ws.send(JSON.stringify({ type: 'state', state: app.state() }));
    ws.on('message', async (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg?.type !== 'cmd') return;
      try {
        await app.command(msg.name, msg.args ?? {});
      } catch (err) {
        console.error(`[cmd ${msg.name}]`, err);
        ws.send(JSON.stringify({ type: 'toast', toast: { topic: 'Error', message: err.message, displayTime: 3 } }));
      }
    });
  });
}
