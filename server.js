const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Servir archivos estáticos (landing page + descargas)
app.use(express.static('public'));
app.use('/downloads', express.static('downloads'));

// Crear servidor HTTP
const server = require('http').createServer(app);

// WebSocket para peers P2P
const wss = new WebSocket.Server({ server });

// Almacén de peers activos
const peers = new Map(); // peerId -> { ws, ip, lastSeen }

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function getPeerList() {
  const list = [];
  peers.forEach((peer, id) => {
    list.push({ id, ip: peer.ip, lastSeen: peer.lastSeen });
  });
  return list;
}

wss.on('connection', (ws, req) => {
  const peerId = generateId();
  const ip = req.socket.remoteAddress;
  
  peers.set(peerId, { ws, ip, lastSeen: Date.now() });
  
  console.log(`[+] Peer conectado: ${peerId} (${ip}) - Total: ${peers.size}`);
  
  // Enviar lista de peers al nuevo nodo
  ws.send(JSON.stringify({ 
    type: 'WELCOME', 
    peerId: peerId,
    peers: getPeerList() 
  }));
  
  // Manejar mensajes
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'HEARTBEAT') {
        peers.get(peerId).lastSeen = Date.now();
      }
    } catch (err) {
      console.error('Error procesando mensaje:', err);
    }
  });
  
  // Manejar desconexión
  ws.on('close', () => {
    peers.delete(peerId);
    console.log(`[-] Peer desconectado: ${peerId} - Total: ${peers.size}`);
  });
});

// Limpieza de peers inactivos cada 60 segundos
setInterval(() => {
  const now = Date.now();
  const timeout = 90000; // 90 segundos sin heartbeat
  
  peers.forEach((peer, id) => {
    if (now - peer.lastSeen > timeout) {
      console.log(`[X] Peer timeout: ${id}`);
      peer.ws.close();
      peers.delete(id);
    }
  });
}, 60000);

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`[PULSO] Servidor corriendo en puerto ${PORT}`);
  console.log(`[PULSO] Landing: http://localhost:${PORT}`);
  console.log(`[PULSO] WebSocket: ws://localhost:${PORT}`);
});
