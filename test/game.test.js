import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer, applyAction, createRoom, gainsFor, normalizeWord, revealsWord, setConnected, settingsError,
  speakingOrder, tallyVotes, viewFor, winnerOf, POINTS,
} from "../src/game.js";

// Générateur pseudo-aléatoire déterministe pour des tests reproductibles.
function seededRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function lobbyWith(names, settings = { uc: 1, mw: 0 }) {
  let room = createRoom("ABCDE", { id: "p0", name: names[0], token: "t0" });
  names.slice(1).forEach((name, i) => {
    room = addPlayer(room, { id: `p${i + 1}`, name, token: `t${i + 1}` }).room;
  });
  return applyAction(room, "p0", { type: "updateSettings", ...settings }).room;
}

function startedGame(names, settings, seed) {
  return applyAction(lobbyWith(names, settings), "p0", { type: "start" }, seededRng(seed)).room;
}

function playCluesRound(room) {
  return room.order.reduce((r, id) => applyAction(r, id, { type: "clue", text: `indice-${id}` }).room, room);
}

function voteAll(room, targetFor, rng = seededRng()) {
  const voters = room.players.filter((p) => p.alive && p.role);
  return voters.reduce((r, p) => (r.phase === "vote" ? applyAction(r, p.id, { type: "vote", targetId: targetFor(p) }, rng).room : r), room);
}

test("normalizeWord ignore accents, casse et ponctuation", () => {
  assert.equal(normalizeWord("  Hélicoptère! "), "helicoptere");
  assert.equal(normalizeWord("Pain au chocolat"), "painauchocolat");
});

test("revealsWord détecte le mot exact mais pas un mot qui le contient", () => {
  assert.equal(revealsWord("c'est un chat", "Chat"), true);
  assert.equal(revealsWord("un château fort", "Chat"), false);
  assert.equal(revealsWord("j'adore le pain au chocolat", "Pain au chocolat"), true);
  assert.equal(revealsWord("peu importe", null), false);
});

test("settingsError refuse trop d'infiltrés ou aucun", () => {
  assert.match(settingsError(2, { uc: 1, mw: 0 }), /au moins 3/);
  assert.match(settingsError(5, { uc: 0, mw: 0 }), /au moins un/);
  assert.match(settingsError(4, { uc: 1, mw: 1 }), /Trop d'infiltrés/);
  assert.equal(settingsError(5, { uc: 1, mw: 1 }), null);
});

test("Mr. White ne parle jamais en premier", () => {
  const players = ["a", "b", "c", "d"].map((id, i) => ({ id, alive: true, role: i === 0 ? "mrwhite" : "civil" }));
  for (let seed = 1; seed < 50; seed++) {
    const order = speakingOrder(players, seededRng(seed));
    assert.notEqual(order[0], "a");
    assert.equal(order.length, 4);
  }
});

test("tallyVotes renvoie les joueurs à égalité", () => {
  assert.deepEqual(tallyVotes({ a: "x", b: "y", c: "x" }).top, ["x"]);
  assert.deepEqual(tallyVotes({ a: "x", b: "y" }).top.sort(), ["x", "y"]);
});

test("winnerOf : civils quand plus d'infiltrés, infiltrés quand un seul civil reste", () => {
  const make = (roles) => roles.map(([role, alive], i) => ({ id: `${i}`, role, alive }));
  assert.equal(winnerOf(make([["civil", true], ["civil", true], ["undercover", false]])), "civil");
  assert.equal(winnerOf(make([["civil", true], ["civil", false], ["undercover", true]])), "infiltrators");
  assert.equal(winnerOf(make([["civil", true], ["civil", true], ["undercover", true]])), null);
});

test("gainsFor attribue les points selon le camp gagnant", () => {
  const players = [{ id: "c", role: "civil" }, { id: "u", role: "undercover" }, { id: "w", role: "mrwhite" }];
  assert.deepEqual(gainsFor(players, "civil"), { c: POINTS.civil, u: 0, w: 0 });
  assert.deepEqual(gainsFor(players, "infiltrators"), { c: 0, u: POINTS.undercover, w: POINTS.mrwhite });
  assert.deepEqual(gainsFor(players, "mrwhite-guess", "w"), { c: 0, u: 0, w: POINTS.mrwhite });
});

test("addPlayer refuse un pseudo déjà pris et une partie en cours", () => {
  const room = lobbyWith(["Alice", "Bruno", "Chloé"]);
  assert.match(addPlayer(room, { id: "x", name: "alice", token: "x" }).error, /déjà pris/);
  const started = applyAction(room, "p0", { type: "start" }, seededRng()).room;
  assert.match(addPlayer(started, { id: "y", name: "Zoé", token: "y" }).error, /déjà commencé/);
});

test("seul l'hôte peut lancer la partie", () => {
  const room = lobbyWith(["Alice", "Bruno", "Chloé"]);
  assert.match(applyAction(room, "p1", { type: "start" }).error, /hôte/);
});

test("une partie distribue les rôles et fait parler chacun à son tour", () => {
  const room = startedGame(["A", "B", "C", "D", "E"], { uc: 1, mw: 1 }, 7);
  assert.equal(room.phase, "clues");
  const roles = room.players.map((p) => p.role).sort();
  assert.deepEqual(roles, ["civil", "civil", "civil", "mrwhite", "undercover"]);
  const notSpeaker = room.order[1];
  assert.match(applyAction(room, notSpeaker, { type: "clue", text: "salut" }).error, /pas ton tour/);
  const afterClues = playCluesRound(room);
  assert.equal(afterClues.phase, "vote");
  assert.equal(afterClues.clues.length, 5);
});

test("on ne peut pas donner son propre mot comme indice", () => {
  const room = startedGame(["A", "B", "C", "D"], { uc: 1, mw: 0 }, 3);
  const speaker = room.players.find((p) => p.id === room.order[0]);
  assert.match(applyAction(room, speaker.id, { type: "clue", text: speaker.word }).error, /ton mot/);
});

test("éliminer le seul undercover fait gagner les civils", () => {
  const room = playCluesRound(startedGame(["A", "B", "C", "D"], { uc: 1, mw: 0 }, 11));
  const uc = room.players.find((p) => p.role === "undercover");
  const other = room.players.find((p) => p.role === "civil");
  const voted = voteAll(room, (p) => (p.id === uc.id ? other.id : uc.id));
  assert.equal(voted.phase, "reveal");
  assert.equal(voted.eliminatedId, uc.id);
  const over = applyAction(voted, "p0", { type: "next" }).room;
  assert.equal(over.phase, "over");
  assert.equal(over.winner, "civil");
  assert.equal(over.players.find((p) => p.id === other.id).score, POINTS.civil);
});

test("une égalité déclenche un second vote entre les ex-aequo", () => {
  const room = playCluesRound(startedGame(["A", "B", "C", "D"], { uc: 1, mw: 0 }, 5));
  const [a, b] = room.players;
  const tied = voteAll(room, (p) => (p.id === a.id ? b.id : p.id === b.id ? a.id : [a.id, b.id][Number(p.id.slice(1)) % 2]));
  assert.equal(tied.phase, "vote");
  assert.equal(tied.tieCount, 1);
  assert.deepEqual([...tied.candidates].sort(), [a.id, b.id].sort());
});

test("Mr. White éliminé qui devine le mot gagne seul", () => {
  const room = playCluesRound(startedGame(["A", "B", "C", "D", "E"], { uc: 1, mw: 1 }, 9));
  const mw = room.players.find((p) => p.role === "mrwhite");
  const scapegoat = room.players.find((p) => p.id !== mw.id);
  const voted = voteAll(room, (p) => (p.id === mw.id ? scapegoat.id : mw.id));
  assert.equal(voted.phase, "guess");
  assert.match(applyAction(voted, scapegoat.id, { type: "guess", text: "x" }).error, /Seul Mr. White/);
  const won = applyAction(voted, mw.id, { type: "guess", text: voted.civWord.toUpperCase() }).room;
  assert.equal(won.phase, "over");
  assert.equal(won.winner, "mrwhite-guess");
  assert.equal(won.players.find((p) => p.id === mw.id).score, POINTS.mrwhite);
});

test("le vote se clôt si le dernier votant manquant se déconnecte", () => {
  const room = playCluesRound(startedGame(["A", "B", "C", "D"], { uc: 1, mw: 0 }, 13));
  const [target, ...others] = room.players;
  const lastVoter = others[others.length - 1];
  const partial = others.slice(0, -1).reduce((r, p) => applyAction(r, p.id, { type: "vote", targetId: target.id }).room, room);
  const withTarget = applyAction(partial, target.id, { type: "vote", targetId: others[0].id }).room;
  assert.equal(withTarget.phase, "vote");
  const closed = setConnected(withTarget, lastVoter.id, false);
  assert.notEqual(closed.phase, "vote");
  assert.equal(closed.eliminatedId, target.id);
});

test("viewFor ne révèle ni les rôles ni les mots des autres pendant la partie", () => {
  const room = startedGame(["A", "B", "C", "D", "E"], { uc: 1, mw: 1 }, 21);
  const view = viewFor(room, "p0");
  assert.equal(view.me.word, room.players[0].word);
  assert.ok(view.players.every((p) => p.role === null && p.word === null));
  assert.equal(view.civWord, null);
  assert.equal(JSON.stringify(view).includes("token"), false);
});

test("l'hôte est transféré quand il se déconnecte", () => {
  const room = lobbyWith(["Alice", "Bruno", "Chloé"]);
  const updated = setConnected(room, "p0", false);
  assert.equal(updated.hostId, "p1");
});
