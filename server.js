import express from "express";
import { createServer } from "node:http";
import { randomUUID, randomInt } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import {
  addPlayer, applyAction, createRoom, nameError, removePlayer, setConnected, viewFor, cleanText, MAX_NAME_LENGTH,
} from "./src/game.js";

const PORT = Number(process.env.PORT) || 3000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 5;
const MAX_ROOMS = 2000;
const ROOM_IDLE_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const RATE_WINDOW_MS = 10 * 1000;
const RATE_MAX_EVENTS = 40;

const app = express();
app.disable("x-powered-by");
app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), "public")));
app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const httpServer = createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 10_000 });

const rooms = new Map(); // code -> salon
const lastActivity = new Map(); // code -> timestamp
const playerSocket = new Map(); // playerId -> socket.id
const socketSeat = new Map(); // socket.id -> { code, playerId }

function newCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    if (!rooms.has(code)) return code;
  }
  throw new Error("Impossible de générer un code de salon unique");
}

function saveRoom(code, room) {
  rooms.set(code, room);
  lastActivity.set(code, Date.now());
}

function broadcast(code) {
  const room = rooms.get(code);
  if (!room) return;
  room.players.forEach((p) => {
    const socketId = playerSocket.get(p.id);
    if (socketId) io.to(socketId).emit("state", viewFor(room, p.id));
  });
}

function seat(socket, code, playerId) {
  const previous = playerSocket.get(playerId);
  if (previous && previous !== socket.id) {
    socketSeat.delete(previous);
    io.to(previous).emit("kicked", { reason: "Tu t'es connecté depuis un autre onglet." });
  }
  playerSocket.set(playerId, socket.id);
  socketSeat.set(socket.id, { code, playerId });
}

function unseat(socketId, { leave }) {
  const info = socketSeat.get(socketId);
  if (!info) return;
  socketSeat.delete(socketId);
  if (playerSocket.get(info.playerId) === socketId) playerSocket.delete(info.playerId);
  const room = rooms.get(info.code);
  if (!room) return;
  const canRemove = leave && ["lobby", "over"].includes(room.phase);
  const updated = canRemove ? removePlayer(room, info.playerId) : setConnected(room, info.playerId, false);
  if (updated.players.length === 0) {
    rooms.delete(info.code);
    lastActivity.delete(info.code);
    return;
  }
  saveRoom(info.code, updated);
  broadcast(info.code);
}

function notifyRemoved(before, after) {
  const remaining = new Set(after.players.map((p) => p.id));
  before.players.filter((p) => !remaining.has(p.id)).forEach((p) => {
    const socketId = playerSocket.get(p.id);
    if (!socketId) return;
    io.to(socketId).emit("kicked", { reason: "L'hôte t'a retiré du salon." });
    socketSeat.delete(socketId);
    playerSocket.delete(p.id);
  });
}

function rateLimiter() {
  let windowStart = Date.now();
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart > RATE_WINDOW_MS) { windowStart = now; count = 0; }
    count += 1;
    return count <= RATE_MAX_EVENTS;
  };
}

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error) => ({ ok: false, error });

io.on("connection", (socket) => {
  const allow = rateLimiter();
  const handle = (event, handler) => socket.on(event, (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    if (!allow()) return reply(fail("Trop de requêtes, ralentis un peu."));
    try {
      reply(handler(payload && typeof payload === "object" ? payload : {}));
    } catch (err) {
      console.error(`[${event}]`, err);
      reply(fail("Erreur du serveur, réessaie."));
    }
  });

  handle("room:create", ({ name }) => {
    if (rooms.size >= MAX_ROOMS) return fail("Le serveur est plein, réessaie plus tard.");
    const error = nameError(null, name);
    if (error) return fail(error);
    unseat(socket.id, { leave: true });
    const code = newCode();
    const player = { id: randomUUID(), name: cleanText(name, MAX_NAME_LENGTH), token: randomUUID() };
    saveRoom(code, createRoom(code, player));
    seat(socket, code, player.id);
    broadcast(code);
    return ok({ code, token: player.token });
  });

  handle("room:join", ({ code, name, token }) => {
    const roomCode = typeof code === "string" ? code.trim().toUpperCase() : "";
    const room = rooms.get(roomCode);
    if (!room) return fail("Aucun salon avec ce code. Vérifie les lettres.");

    const returning = typeof token === "string" && room.players.find((p) => p.token === token);
    if (returning) {
      const current = socketSeat.get(socket.id);
      if (!current || current.playerId !== returning.id) unseat(socket.id, { leave: true });
      saveRoom(roomCode, setConnected(room, returning.id, true));
      seat(socket, roomCode, returning.id);
      broadcast(roomCode);
      return ok({ code: roomCode, token: returning.token });
    }

    const player = { id: randomUUID(), name, token: randomUUID() };
    const result = addPlayer(room, player);
    if (result.error) return fail(result.error);
    unseat(socket.id, { leave: true });
    saveRoom(roomCode, result.room);
    seat(socket, roomCode, player.id);
    broadcast(roomCode);
    return ok({ code: roomCode, token: player.token });
  });

  handle("room:leave", () => {
    unseat(socket.id, { leave: true });
    return ok();
  });

  handle("game:action", (action) => {
    const info = socketSeat.get(socket.id);
    const room = info && rooms.get(info.code);
    if (!room) return fail("Tu n'es dans aucun salon.");
    const result = applyAction(room, info.playerId, action);
    if (result.error) return fail(result.error);
    notifyRemoved(room, result.room);
    saveRoom(info.code, result.room);
    broadcast(info.code);
    return ok();
  });

  socket.on("disconnect", () => unseat(socket.id, { leave: false }));
});

// Supprime les salons où plus personne n'est connecté depuis un moment.
setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, code) => {
    const idle = now - (lastActivity.get(code) || 0) > ROOM_IDLE_MS;
    if (idle && room.players.every((p) => !p.connected)) {
      rooms.delete(code);
      lastActivity.delete(code);
    }
  });
}, CLEANUP_INTERVAL_MS).unref();

httpServer.listen(PORT, () => {
  console.log(`Undercover prêt sur http://localhost:${PORT}`);
});
