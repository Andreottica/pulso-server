const express = require('express');
const WebSocket = require('ws');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware para parsear JSON
app.use(express.json());

// Servir archivos estáticos (landing page + descargas)
app.use(express.static('public'));
app.use('/downloads', express.static('downloads'));

// Crear servidor HTTP
const server = require('http').createServer(app);

// WebSocket para peers P2P
const wss = new WebSocket.Server({ server });

// Almacén de peers activos
const peers = new Map(); // peerId -> { ws, ip, lastSeen }

// Archivo de usuarios registrados
const USERS_FILE = path.join(__dirname, 'users.json');

// Cargar usuarios desde archivo
let registeredUsers = new Set();

async function loadUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        const users = JSON.parse(data);
        registeredUsers = new Set(users);
        console.log(`[USERS] ${registeredUsers.size} usuarios cargados`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[USERS] Archivo de usuarios no existe, creando nuevo...');
            await saveUsers();
        } else {
            console.error('[USERS] Error cargando usuarios:', error);
        }
    }
}

async function saveUsers() {
    try {
        const users = Array.from(registeredUsers);
        await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
        console.log(`[USERS] ${users.length} usuarios guardados`);
    } catch (error) {
        console.error('[USERS] Error guardando usuarios:', error);
    }
}

// Inicializar usuarios al arrancar
loadUsers();

// === ENDPOINTS DE REGISTRO ===

// Verificar disponibilidad de username
app.post('/api/check-username', (req, res) => {
    const { username } = req.body;
    
    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Username inválido' });
    }
    
    const usernameLower = username.toLowerCase().trim();
    
    if (usernameLower.length < 3 || usernameLower.length > 20) {
        return res.status(400).json({ error: 'Username debe tener entre 3 y 20 caracteres' });
    }
    
    const available = !registeredUsers.has(usernameLower);
    
    res.json({ 
        username: usernameLower,
        available: available 
    });
});

// Registrar nuevo username
app.post('/api/register-username', async (req, res) => {
    const { username } = req.body;
    
    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Username inválido' });
    }
    
    const usernameLower = username.toLowerCase().trim();
    
    if (usernameLower.length < 3 || usernameLower.length > 20) {
        return res.status(400).json({ error: 'Username debe tener entre 3 y 20 caracteres' });
    }
    
    if (registeredUsers.has(usernameLower)) {
        return res.status(409).json({ error: 'Username ya está en uso' });
    }
    
    registeredUsers.add(usernameLower);
    await saveUsers();
    
    console.log(`[USERS] Usuario registrado: ${usernameLower}`);
    
    res.json({ 
        success: true,
        username: usernameLower 
    });
});

// Eliminar username
app.post('/api/unregister-username', async (req, res) => {
    const { username } = req.body;
    
    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Username inválido' });
    }
    
    const usernameLower = username.toLowerCase().trim();
    
    if (!registeredUsers.has(usernameLower)) {
        return res.status(404).json({ error: 'Username no encontrado' });
    }
    
    registeredUsers.delete(usernameLower);
    await saveUsers();
    
    console.log(`[USERS] Usuario eliminado: ${usernameLower}`);
    
    res.json({ 
        success: true,
        username: usernameLower 
    });
});

// === WEBSOCKET PARA P2P ===

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
  
  ws.send(JSON.stringify({ 
    type: 'WELCOME', 
    peerId: peerId,
    peers: getPeerList() 
  }));
  
  peers.forEach((peer, id) => {
    if (id !== peerId && peer.ws.readyState === 1) {
      peer.ws.send(JSON.stringify({
        type: 'NEW_PEER',
        peerId: peerId
      }));
    }
  });
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'HEARTBEAT') {
        peers.get(peerId).lastSeen = Date.now();
      }
      
      if (data.type === 'WEBRTC_OFFER' || data.type === 'WEBRTC_ANSWER' || data.type === 'ICE_CANDIDATE') {
        const targetPeer = peers.get(data.to);
        if (targetPeer && targetPeer.ws.readyState === 1) {
          targetPeer.ws.send(JSON.stringify(data));
        }
      }
    } catch (err) {
      console.error('Error procesando mensaje:', err);
    }
  });
  
  ws.on('close', () => {
    peers.delete(peerId);
    console.log(`[-] Peer desconectado: ${peerId} - Total: ${peers.size}`);
    
    peers.forEach((peer, id) => {
      if (peer.ws.readyState === 1) {
        peer.ws.send(JSON.stringify({
          type: 'PEER_LEFT',
          peerId: peerId
        }));
      }
    });
  });
});

setInterval(() => {
  const now = Date.now();
  const timeout = 90000;
  
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
