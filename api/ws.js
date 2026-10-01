import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { attachConnection } from '../server/gameHub.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  attachConnection(ws);
});

export default server;
