// ========================================================================
//  PULSO — SERVIDOR MINIMALISTA DE DISCOVERY + SIGNALING
//  NO guarda claves, NO procesa WebRTC, NO almacena nada sensible.
//  Solo indica quién está conectado y reenvía mensajes entre peers.
// ========================================================================

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 5000;

// Permitir JSON
app.use(express.json());

// CORS (muy abierto para permitir pruebas)
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

// Servidor HTTP
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocket.Server({ server });

// Peers conectados: peerId → { ws, alias, lastSeen }
const peers = new Map();

// Generador simple de IDs
const genId = () =>
    Date.now().toString(36) + Math.random().toString(36).substring(2, 8);

// ========================================================================
//  ENDPOINT HTTP: Solo health-check
// ========================================================================
app.get("/", (req, res) => {
    res.json({
        service: "Pulso Discovery Server",
        status: "running",
        connectedPeers: peers.size
    });
});

// ========================================================================
//  MANEJO DE CONEXIONES WS
// ========================================================================
wss.on("connection", (ws, req) => {
    const peerId = genId();

    peers.set(peerId, {
        ws,
        alias: null,
        lastSeen: Date.now()
    });

    console.log(`[+] Peer conectado: ${peerId} | Total: ${peers.size}`);

    // Enviar ID al cliente
    ws.send(JSON.stringify({
        type: "WELCOME",
        peerId
    }));

    // -------------------------------------------------------------
    //  RECEPCIÓN DE MENSAJES
    // -------------------------------------------------------------
    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);
            const peer = peers.get(peerId);
            if (!peer) return;

            // Actualizar último contacto
            peer.lastSeen = Date.now();

            // ------------------------------
            // HEARTBEAT
            // ------------------------------
            if (data.type === "HEARTBEAT") {
                return;
            }

            // ------------------------------
            // IDENTIFY
            // ------------------------------
            if (data.type === "IDENTIFY") {
                peer.alias = data.alias || `peer-${peerId}`;
                console.log(`[IDENTIFY] ${peerId} → alias=${peer.alias}`);

                // Enviar lista completa de peers al recién llegado
                const list = [];
                peers.forEach((p, id) => {
                    if (p.alias) {
                        list.push({ peerId: id, alias: p.alias });
                    }
                });

                ws.send(JSON.stringify({
                    type: "PEER_LIST",
                    peers: list
                }));

                // Avisar a todos los demás que hay peer nuevo
                broadcastExcept(peerId, {
                    type: "PEER_JOINED",
                    peerId,
                    alias: peer.alias
                });
                return;
            }

            // ------------------------------
            // RELAY WEBRTC
            // ------------------------------
            if (data.type === "WEBRTC" && data.to) {
                const target = peers.get(data.to);
                if (target && target.ws.readyState === WebSocket.OPEN) {
                    data.from = peerId;
                    target.ws.send(JSON.stringify(data));
                }
                return;
            }

        } catch (e) {
            console.error(`ERROR ${peerId}:`, e);
        }
    });

    // -------------------------------------------------------------
    //  DESCONEXIÓN
    // -------------------------------------------------------------
    ws.on("close", () => {
        const alias = peers.get(peerId)?.alias || "unknown";
        peers.delete(peerId);

        console.log(`[-] Peer desconectado: ${peerId} (${alias})`);

        // Avisar a todos los demás
        broadcastAll({
            type: "PEER_LEFT",
            peerId
        });
    });
});

// ========================================================================
//  BROADCAST helpers
// ========================================================================
function broadcastAll(obj) {
    const msg = JSON.stringify(obj);
    peers.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(msg);
        }
    });
}

function broadcastExcept(exceptId, obj) {
    const msg = JSON.stringify(obj);
    peers.forEach((p, id) => {
        if (id !== exceptId && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(msg);
        }
    });
}

// ========================================================================
//  LIMPIEZA DE PEERS INACTIVOS
// ========================================================================
setInterval(() => {
    const now = Date.now();
    const TIMEOUT = 120000; // 2 minutos

    peers.forEach((peer, id) => {
        if (now - peer.lastSeen > TIMEOUT) {
            console.log(`[TIMEOUT] Eliminando peer: ${id}`);
            try { peer.ws.close(); } catch {}
            peers.delete(id);

            broadcastAll({
                type: "PEER_LEFT",
                peerId: id
            });
        }
    });
}, 30000);

// ========================================================================
//  INICIAR SERVIDOR
// ========================================================================
server.listen(PORT, () => {
    console.log("===============================================");
    console.log("  Pulso Discovery + Signaling Server");
    console.log("===============================================");
    console.log(`  HTTP: http://localhost:${PORT}`);
    console.log(`  WS:   ws://localhost:${PORT}`);
    console.log("===============================================");
});
