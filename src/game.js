// Logique pure du jeu : chaque fonction reçoit un salon et renvoie un nouveau salon, sans effet de bord.
import { WORD_PAIRS } from "./words.js";

export const POINTS = { civil: 2, undercover: 10, mrwhite: 6 };
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 20;
export const MAX_NAME_LENGTH = 20;
export const MAX_CLUE_LENGTH = 60;
export const MAX_GUESS_LENGTH = 40;

// ---------- utilitaires ----------

export function shuffle(list, rng = Math.random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function foldAccents(text) {
  return String(text).toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae")
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeWord(text) {
  return foldAccents(text).replace(/[^a-z0-9]/g, "");
}

// ---------- validation tolérante de la proposition de Mr. White ----------

const ARTICLES = new Set(["le", "la", "les", "l", "un", "une", "des", "du", "de", "d"]);
const MIN_PLURAL_LENGTH = 4;

// Forme comparable : sans accents, sans articles, sans marque du pluriel (-s / -x), sans espaces.
export function comparableForm(text) {
  return foldAccents(text).split(/[^a-z0-9]+/)
    .filter((token) => token && !ARTICLES.has(token))
    .map((token) => (token.length >= MIN_PLURAL_LENGTH ? token.replace(/[sx]$/, "") : token))
    .join("");
}

export function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j] + 1, current[j - 1] + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length];
}

// Fautes de frappe tolérées selon la longueur du mot à trouver : aucune sous 5 lettres, 1 dès 5, 2 dès 9.
export function typoTolerance(length) {
  if (length >= 9) return 2;
  if (length >= 5) return 1;
  return 0;
}

export function isCorrectGuess(guess, word) {
  const target = comparableForm(word);
  const attempt = comparableForm(guess);
  if (!attempt || !target) return false;
  return editDistance(attempt, target) <= typoTolerance(target.length);
}

export function cleanText(text, maxLength) {
  if (typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function revealsWord(clue, word) {
  if (!word) return false;
  const target = normalizeWord(word);
  if (word.includes(" ")) return normalizeWord(clue).includes(target);
  return clue.split(/[\s'’-]+/).some((token) => normalizeWord(token) === target);
}

export function maxInfiltrators(playerCount) {
  return Math.max(1, Math.floor((playerCount - 1) / 2));
}

export function settingsError(playerCount, { uc, mw }) {
  if (playerCount < MIN_PLAYERS) return `Il faut au moins ${MIN_PLAYERS} joueurs connectés.`;
  if (playerCount > MAX_PLAYERS) return `${MAX_PLAYERS} joueurs maximum.`;
  if (uc + mw < 1) return "Il faut au moins un Undercover ou un Mr. White.";
  if (uc + mw > maxInfiltrators(playerCount)) {
    return `Trop d'infiltrés pour ${playerCount} joueurs : ${maxInfiltrators(playerCount)} au maximum.`;
  }
  return null;
}

const alivePlayers = (room) => room.players.filter((p) => p.alive && p.role);

// ---------- règles ----------

// Tire une paire pas encore jouée dans ce salon ; quand toutes l'ont été, on repart de zéro.
export function pickPair(usedPairs, rng = Math.random) {
  const used = new Set(usedPairs);
  const fresh = WORD_PAIRS.map((_, i) => i).filter((i) => !used.has(i));
  const pool = fresh.length ? fresh : WORD_PAIRS.map((_, i) => i);
  const pairIndex = pool[Math.floor(rng() * pool.length)];
  return { pairIndex, usedPairs: fresh.length ? [...usedPairs, pairIndex] : [pairIndex] };
}

export function dealRoles(players, { uc, mw }, rng = Math.random, pairIndex = Math.floor(rng() * WORD_PAIRS.length)) {
  const [civWord, ucWord] = shuffle(WORD_PAIRS[pairIndex], rng);
  const roles = shuffle([
    ...Array(uc).fill("undercover"),
    ...Array(mw).fill("mrwhite"),
    ...Array(players.length - uc - mw).fill("civil"),
  ], rng);
  const wordFor = { civil: civWord, undercover: ucWord, mrwhite: null };
  return {
    civWord,
    ucWord,
    players: players.map((p, i) => ({ ...p, role: roles[i], word: wordFor[roles[i]], alive: true })),
  };
}

// Ordre de parole : dans l'ordre d'arrivée, en partant d'un joueur au hasard qui n'est pas Mr. White.
export function speakingOrder(players, rng = Math.random) {
  const alive = players.filter((p) => p.alive && p.role);
  const starters = alive.filter((p) => p.role !== "mrwhite");
  const start = alive.indexOf(starters[Math.floor(rng() * starters.length)]);
  return [...alive.slice(start), ...alive.slice(0, start)].map((p) => p.id);
}

export function tallyVotes(votes) {
  const counts = {};
  Object.values(votes).forEach((target) => { counts[target] = (counts[target] || 0) + 1; });
  const max = Math.max(0, ...Object.values(counts));
  const top = Object.keys(counts).filter((id) => counts[id] === max);
  return { counts, top };
}

export function winnerOf(players) {
  const alive = players.filter((p) => p.alive && p.role);
  const civilians = alive.filter((p) => p.role === "civil").length;
  if (alive.length === civilians) return "civil";
  if (civilians <= 1) return "infiltrators";
  return null;
}

export function gainsFor(players, winner, guesserId) {
  return Object.fromEntries(players.filter((p) => p.role).map((p) => {
    if (winner === "mrwhite-guess") return [p.id, p.id === guesserId ? POINTS.mrwhite : 0];
    if (winner === "civil") return [p.id, p.role === "civil" ? POINTS.civil : 0];
    return [p.id, p.role === "civil" ? 0 : POINTS[p.role]];
  }));
}

// ---------- salon ----------

const EMPTY_GAME = {
  round: 0, order: [], speakerIndex: 0, clues: [], votes: {}, candidates: [], tieCount: 0,
  lastCounts: null, tieBroken: false, eliminatedId: null, guess: null, winner: null, gains: {},
  civWord: null, ucWord: null,
};

export function createRoom(code, host) {
  return {
    code, hostId: host.id, phase: "lobby", settings: { uc: 1, mw: 0 }, players: [newPlayer(host)], usedPairs: [], ...EMPTY_GAME,
  };
}

function newPlayer({ id, name, token }) {
  return { id, name, token, connected: true, alive: true, role: null, word: null, score: 0 };
}

export function nameError(room, rawName) {
  const name = cleanText(rawName, MAX_NAME_LENGTH);
  if (!name) return "Choisis un pseudo.";
  if (room && room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return "Ce pseudo est déjà pris dans ce salon.";
  return null;
}

export function addPlayer(room, { id, name, token }) {
  if (!["lobby", "over"].includes(room.phase)) return { error: "La partie a déjà commencé. Attends la fin pour rejoindre." };
  if (room.players.length >= MAX_PLAYERS) return { error: "Le salon est complet." };
  const error = nameError(room, name);
  if (error) return { error };
  return { room: { ...room, players: [...room.players, newPlayer({ id, name: cleanText(name, MAX_NAME_LENGTH), token })] } };
}

export function removePlayer(room, playerId) {
  return ensureHost({ ...room, players: room.players.filter((p) => p.id !== playerId) });
}

export function setConnected(room, playerId, connected, rng = Math.random) {
  const players = room.players.map((p) => (p.id === playerId ? { ...p, connected } : p));
  return checkVoteComplete(ensureHost({ ...room, players }), rng);
}

export function ensureHost(room) {
  const host = room.players.find((p) => p.id === room.hostId);
  if (host && host.connected) return room;
  const next = room.players.find((p) => p.connected);
  return next ? { ...room, hostId: next.id } : room;
}

// ---------- déroulement d'une partie ----------

function beginRound(room, rng) {
  return {
    ...room, phase: "clues", round: room.round + 1, order: speakingOrder(room.players, rng), speakerIndex: 0,
    votes: {}, candidates: [], tieCount: 0, lastCounts: null, tieBroken: false, eliminatedId: null, guess: null,
  };
}

function advanceSpeaker(room) {
  const speakerIndex = room.speakerIndex + 1;
  if (speakerIndex < room.order.length) return { ...room, speakerIndex };
  return { ...room, speakerIndex, phase: "vote", votes: {}, candidates: alivePlayers(room).map((p) => p.id), tieCount: 0 };
}

function eliminate(room, playerId) {
  const players = room.players.map((p) => (p.id === playerId ? { ...p, alive: false } : p));
  const target = players.find((p) => p.id === playerId);
  return { ...room, players, eliminatedId: playerId, votes: {}, phase: target.role === "mrwhite" ? "guess" : "reveal" };
}

function resolveVote(room, rng) {
  const { counts, top } = tallyVotes(room.votes);
  if (top.length === 0) return room;
  if (top.length > 1 && room.tieCount === 0) {
    return { ...room, votes: {}, candidates: top, tieCount: 1, lastCounts: counts };
  }
  const eliminatedId = top.length === 1 ? top[0] : top[Math.floor(rng() * top.length)];
  return eliminate({ ...room, lastCounts: counts, tieBroken: top.length > 1 }, eliminatedId);
}

// Le vote se clôt dès que tous les joueurs encore en vie et connectés ont voté.
export function checkVoteComplete(room, rng = Math.random) {
  if (room.phase !== "vote") return room;
  const voters = alivePlayers(room).filter((p) => p.connected);
  const allVoted = voters.length > 0 && voters.every((p) => room.votes[p.id] !== undefined);
  return allVoted ? resolveVote(room, rng) : room;
}

function finish(room, winner, guesserId) {
  const gains = gainsFor(room.players, winner, guesserId);
  const players = room.players.map((p) => ({ ...p, score: p.score + (gains[p.id] || 0) }));
  return { ...room, players, phase: "over", winner, gains };
}

function nextStep(room, rng) {
  const winner = winnerOf(room.players);
  return winner ? finish(room, winner, null) : beginRound(room, rng);
}

// ---------- actions des joueurs ----------

const clampCount = (value) => Math.min(MAX_PLAYERS, Math.max(0, Math.trunc(Number(value) || 0)));

const handlers = {
  updateSettings: {
    phases: ["lobby", "over"], hostOnly: true,
    run(room, _actor, { uc, mw }) {
      const settings = { uc: clampCount(uc), mw: clampCount(mw) };
      if (settings.uc + settings.mw < 1) return { error: "Il faut au moins un Undercover ou un Mr. White." };
      return { room: { ...room, settings } };
    },
  },
  start: {
    phases: ["lobby", "over"], hostOnly: true,
    run(room, _actor, _action, rng) {
      const present = room.players.filter((p) => p.connected);
      const error = settingsError(present.length, room.settings);
      if (error) return { error };
      const fresh = present.map((p) => ({ ...p, role: null, word: null, alive: true }));
      const { pairIndex, usedPairs } = pickPair(room.usedPairs, rng);
      const { players, civWord, ucWord } = dealRoles(fresh, room.settings, rng, pairIndex);
      return { room: beginRound({ ...room, ...EMPTY_GAME, players, civWord, ucWord, usedPairs }, rng) };
    },
  },
  clue: {
    phases: ["clues"],
    run(room, actor, { text }) {
      if (room.order[room.speakerIndex] !== actor.id) return { error: "Ce n'est pas ton tour." };
      const clue = cleanText(text, MAX_CLUE_LENGTH);
      if (!clue) return { error: "Écris un indice." };
      if (revealsWord(clue, actor.word)) return { error: "Tu ne peux pas dire ton mot !" };
      const clues = [...room.clues, { round: room.round, playerId: actor.id, text: clue }];
      return { room: advanceSpeaker({ ...room, clues }) };
    },
  },
  skipSpeaker: {
    phases: ["clues"], hostOnly: true,
    run(room) {
      const clues = [...room.clues, { round: room.round, playerId: room.order[room.speakerIndex], text: null }];
      return { room: advanceSpeaker({ ...room, clues }) };
    },
  },
  vote: {
    phases: ["vote"],
    run(room, actor, { targetId }, rng) {
      if (!actor.alive || !actor.role) return { error: "Les joueurs éliminés ne votent pas." };
      if (targetId === actor.id) return { error: "Tu ne peux pas voter contre toi." };
      if (!room.candidates.includes(targetId)) return { error: "Ce joueur ne peut pas être visé." };
      return { room: checkVoteComplete({ ...room, votes: { ...room.votes, [actor.id]: targetId } }, rng) };
    },
  },
  closeVote: {
    phases: ["vote"], hostOnly: true,
    run(room, _actor, _action, rng) {
      if (Object.keys(room.votes).length === 0) return { error: "Personne n'a encore voté." };
      return { room: resolveVote(room, rng) };
    },
  },
  guess: {
    phases: ["guess"],
    run(room, actor, { text }) {
      if (actor.id !== room.eliminatedId) return { error: "Seul Mr. White peut deviner." };
      const guess = cleanText(text, MAX_GUESS_LENGTH);
      if (!guess) return { error: "Propose un mot." };
      const correct = isCorrectGuess(guess, room.civWord);
      const withGuess = { ...room, guess: { text: guess, correct } };
      return { room: correct ? finish(withGuess, "mrwhite-guess", actor.id) : { ...withGuess, phase: "reveal" } };
    },
  },
  next: {
    // En phase "guess", l'hôte peut passer si Mr. White ne répond plus.
    phases: ["reveal", "guess"], hostOnly: true,
    run(room, _actor, _action, rng) {
      return { room: nextStep(room, rng) };
    },
  },
  backToLobby: {
    phases: ["over"], hostOnly: true,
    run(room) {
      const players = room.players.map((p) => ({ ...p, role: null, word: null, alive: true }));
      return { room: { ...room, ...EMPTY_GAME, players, phase: "lobby" } };
    },
  },
  kick: {
    phases: ["lobby", "over"], hostOnly: true,
    run(room, actor, { playerId }) {
      if (playerId === actor.id) return { error: "Tu ne peux pas t'exclure toi-même." };
      if (!room.players.some((p) => p.id === playerId)) return { error: "Joueur introuvable." };
      return { room: removePlayer(room, playerId) };
    },
  },
};

export function applyAction(room, actorId, action, rng = Math.random) {
  const handler = handlers[action && action.type];
  if (!handler) return { error: "Action inconnue." };
  const actor = room.players.find((p) => p.id === actorId);
  if (!actor) return { error: "Tu ne fais plus partie de ce salon." };
  if (!handler.phases.includes(room.phase)) return { error: "Action impossible à ce moment de la partie." };
  if (handler.hostOnly && room.hostId !== actorId) return { error: "Seul l'hôte peut faire ça." };
  return handler.run(room, actor, action, rng);
}

// ---------- ce que chaque joueur a le droit de voir ----------

export function viewFor(room, viewerId) {
  const me = room.players.find((p) => p.id === viewerId);
  const over = room.phase === "over";
  const showCounts = ["reveal", "guess", "over"].includes(room.phase) || (room.phase === "vote" && room.tieCount > 0);
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    settings: room.settings,
    round: room.round,
    me: {
      id: me.id,
      name: me.name,
      inGame: Boolean(me.role),
      alive: me.alive,
      word: me.word,
      isMrWhite: me.role === "mrwhite",
      role: over || !me.alive ? me.role : null,
    },
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      alive: p.alive,
      inGame: Boolean(p.role),
      score: p.score,
      role: p.role && (over || !p.alive) ? p.role : null,
      word: over ? p.word : null,
    })),
    order: room.order,
    speakerId: room.phase === "clues" ? room.order[room.speakerIndex] : null,
    clues: room.clues,
    candidates: room.candidates,
    tie: room.phase === "vote" && room.tieCount > 0,
    votedIds: Object.keys(room.votes),
    myVote: room.votes[viewerId] ?? null,
    lastCounts: showCounts ? room.lastCounts : null,
    tieBroken: room.tieBroken,
    eliminatedId: room.eliminatedId,
    guess: room.guess,
    winner: room.winner,
    gains: over ? room.gains : {},
    civWord: over ? room.civWord : null,
    ucWord: over ? room.ucWord : null,
  };
}
