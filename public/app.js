/* global io */
const ROLE_LABEL = { civil: "Civil", undercover: "Undercover", mrwhite: "Mr. White" };
const POINTS = { civil: 2, undercover: 10, mrwhite: 6 };
const SESSION_KEY = "undercover-session";
const NAME_KEY = "undercover-name";
const ACK_TIMEOUT_MS = 8000;
const TOAST_MS = 3500;

const app = document.getElementById("app");
const toastEl = document.getElementById("toast");
const offlineEl = document.getElementById("offline");
const socket = io();

let view = null; // état envoyé par le serveur
let ui = { wordShown: false, busy: false };

// ---------- stockage local (confort, facultatif) ----------

function readStore(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function writeStore(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* stockage indisponible : la reconnexion auto ne marchera pas */ }
}

// ---------- utilitaires ----------

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer = null;
function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, TOAST_MS);
}

function emit(event, payload) {
  return new Promise((resolve) => {
    socket.timeout(ACK_TIMEOUT_MS).emit(event, payload, (err, res) => {
      resolve(err ? { ok: false, error: "Le serveur ne répond pas. Vérifie ta connexion." } : res);
    });
  });
}

async function act(type, payload = {}) {
  const res = await emit("game:action", { type, ...payload });
  if (!res.ok) toast(res.error);
  return res;
}

function codeFromUrl() {
  const code = new URLSearchParams(location.search).get("salon");
  return code ? code.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5) : "";
}

function setUrlCode(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set("salon", code);
  else url.searchParams.delete("salon");
  history.replaceState(null, "", url);
}

function inviteLink() {
  const url = new URL(location.href);
  url.search = `?salon=${view.code}`;
  return url.toString();
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} copié !`);
  } catch {
    toast(`Copie impossible. ${label} : ${text}`);
  }
}

const byId = () => Object.fromEntries(view.players.map((p) => [p.id, p]));
const isHost = () => view.hostId === view.me.id;
const maxInfiltrators = (n) => Math.max(1, Math.floor((n - 1) / 2));

// ---------- rendu ----------

// Le rendu remplace le HTML : on préserve la saisie et le focus des champs en cours.
function render() {
  const fields = [...app.querySelectorAll("input[id]")].map((el) => ({ id: el.id, value: el.value }));
  const focused = document.activeElement && document.activeElement.id;
  app.innerHTML = view ? screenFor(view.phase)() : viewHome();
  fields.forEach(({ id, value }) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
  const toFocus = focused && document.getElementById(focused);
  if (toFocus) toFocus.focus();
  else app.querySelector("[autofocus]")?.focus();
}

function screenFor(phase) {
  if (phase === "lobby") return viewLobby;
  if (phase === "over") return viewOver;
  return viewGame;
}

function viewRules() {
  return `
    <details class="panel">
      <summary>Règles du jeu</summary>
      <ul>
        <li><strong>Les Civils</strong> reçoivent tous le même mot.</li>
        <li><strong>Les Undercovers</strong> reçoivent un mot proche, sans savoir qu'ils sont Undercover.</li>
        <li><strong>Mr. White</strong> ne reçoit aucun mot et doit improviser. Il ne parle jamais en premier.</li>
        <li><strong>À chaque tour</strong>, chacun écrit un indice sur son mot, sans le dire.</li>
        <li><strong>Puis tout le monde vote</strong> pour éliminer un joueur. En cas d'égalité, on revote entre les ex-aequo ; si l'égalité persiste, le sort tranche.</li>
        <li><strong>Si Mr. White est éliminé</strong>, il peut deviner le mot des Civils. S'il trouve, il gagne seul. Les accents, articles, pluriels et petites fautes de frappe sont acceptés.</li>
        <li><strong>Les Civils gagnent</strong> quand tous les Undercovers et Mr. White sont éliminés.</li>
        <li><strong>Les infiltrés gagnent</strong> s'il ne reste plus qu'un seul Civil en jeu.</li>
        <li><strong>Points</strong> : Civil ${POINTS.civil}, Mr. White ${POINTS.mrwhite}, Undercover ${POINTS.undercover}, pour chaque joueur du camp gagnant.</li>
      </ul>
    </details>`;
}

function viewHome() {
  const name = readStore(NAME_KEY) || "";
  const code = codeFromUrl();
  return `
    <header class="stack">
      <p class="eyebrow">Jeu d'ambiance en ligne · 3 à 20 joueurs</p>
      <h1>Under<span>cover</span></h1>
      <p class="muted">Chacun reçoit un mot secret sur son téléphone. Quelques-uns ont un mot légèrement différent, et Mr. White n'a rien du tout. Trouvez-les avant qu'ils ne vous trouvent.</p>
    </header>
    <section class="panel stack">
      <label for="name-input">Ton pseudo</label>
      <input type="text" id="name-input" maxlength="20" autocomplete="nickname" placeholder="Ex. Camille" value="${escapeHtml(name)}" ${name ? "" : "autofocus"}>
    </section>
    <section class="panel stack">
      <h2>Rejoindre un salon</h2>
      <form class="inline-form" data-form="join">
        <input type="text" id="code-input" class="code-input" maxlength="5" autocomplete="off" autocapitalize="characters"
               placeholder="CODE" aria-label="Code du salon" value="${escapeHtml(code)}">
        <button class="btn" type="submit" ${ui.busy ? "disabled" : ""}>Entrer</button>
      </form>
      <div class="divider">ou</div>
      <button class="btn ghost wide" data-action="create" ${ui.busy ? "disabled" : ""}>Créer un salon privé</button>
    </section>
    ${viewRules()}`;
}

function counterRow(key, role, label, value, other, max, editable) {
  if (!editable) {
    return `<div class="counter"><span><span class="dot ${role}"></span>${label}</span><span></span><output>${value}</output><span></span></div>`;
  }
  return `
    <div class="counter">
      <span><span class="dot ${role}"></span>${label}</span>
      <button class="icon-btn" data-action="setting" data-key="${key}" data-delta="-1" aria-label="Moins de ${label}" ${value <= 0 ? "disabled" : ""}>−</button>
      <output>${value}</output>
      <button class="icon-btn" data-action="setting" data-key="${key}" data-delta="1" aria-label="Plus de ${label}" ${value + other >= max ? "disabled" : ""}>+</button>
    </div>`;
}

function viewRoles() {
  const connected = view.players.filter((p) => p.connected).length;
  const { uc, mw } = view.settings;
  const max = maxInfiltrators(connected);
  const tooMany = uc + mw > max;
  const editable = isHost();
  const hint = connected < 3
    ? `<p class="hint bad">Il faut au moins 3 joueurs connectés pour lancer.</p>`
    : tooMany
      ? `<p class="hint bad">Trop d'infiltrés pour ${connected} joueurs : ${max} au maximum.</p>`
      : `<p class="hint">${editable ? "Tu choisis la répartition." : "L'hôte choisit la répartition."}</p>`;
  return `
    <section class="panel stack" aria-labelledby="roles-h">
      <h2 id="roles-h">Rôles</h2>
      <div class="counter"><span><span class="dot civil"></span>Civils</span><span></span><output>${Math.max(0, connected - uc - mw)}</output><span></span></div>
      ${counterRow("uc", "undercover", "Undercover", uc, mw, max, editable)}
      ${counterRow("mw", "mrwhite", "Mr. White", mw, uc, max, editable)}
      ${hint}
    </section>`;
}

function playerBadges(p) {
  const badges = [];
  if (p.id === view.me.id) badges.push(`<span class="tag">toi</span>`);
  if (p.id === view.hostId) badges.push(`<span class="tag">hôte</span>`);
  if (!p.connected) badges.push(`<span class="tag off">hors ligne</span>`);
  return badges.join("");
}

function viewLobby() {
  const players = view.players.map((p) => `
    <li class="player">
      <span class="dot ${p.connected ? "online" : "offline"}"></span>
      <span class="name">${escapeHtml(p.name)}${playerBadges(p)}</span>
      ${isHost() && p.id !== view.me.id
        ? `<button class="small-btn" data-action="kick" data-id="${p.id}" aria-label="Retirer ${escapeHtml(p.name)}">Retirer</button>`
        : `<span class="score">${p.score} pts</span>`}
    </li>`).join("");
  const connected = view.players.filter((p) => p.connected).length;
  const { uc, mw } = view.settings;
  const canStart = connected >= 3 && uc + mw >= 1 && uc + mw <= maxInfiltrators(connected);
  return `
    <section class="panel stack center">
      <p class="eyebrow">Code du salon privé</p>
      <p class="room-code">${escapeHtml(view.code)}</p>
      <div class="row" style="justify-content:center">
        <button class="small-btn" data-action="copyCode">Copier le code</button>
        <button class="small-btn" data-action="copyLink">Copier le lien d'invitation</button>
      </div>
    </section>
    <section class="panel stack" aria-labelledby="players-h">
      <div class="row between"><h2 id="players-h">Joueurs</h2><span class="muted">${connected} connecté${connected > 1 ? "s" : ""}</span></div>
      <ul class="players">${players}</ul>
    </section>
    ${viewRoles()}
    ${isHost()
      ? `<button class="btn wide" data-action="start" ${canStart ? "" : "disabled"}>Lancer la partie</button>`
      : `<p class="center muted">En attente que l'hôte lance la partie…</p>`}
    <button class="btn ghost wide" data-action="leave">Quitter le salon</button>
    ${viewRules()}`;
}

function viewSecret() {
  const me = view.me;
  if (!me.inGame) return `<p class="panel muted">Partie en cours. Tu joueras à la prochaine.</p>`;
  const content = me.isMrWhite
    ? `<p class="eyebrow">Ton rôle</p><p class="word">Mr. White</p><p class="small">Tu n'as pas de mot. Écoute et bluffe.</p>`
    : `<p class="eyebrow">Ton mot secret</p><p class="word">${escapeHtml(me.word)}</p>`;
  return `
    <button class="secret ${ui.wordShown ? "shown" : ""}" data-action="toggleWord" aria-pressed="${ui.wordShown}">
      <span class="stack" style="gap:4px">${ui.wordShown ? content : `<span class="eyebrow">Ton mot secret</span><span class="muted">Caché. Vérifie que personne ne regarde ton écran.</span>`}</span>
      <span class="toggle">${ui.wordShown ? "Cacher" : "Afficher"}</span>
    </button>
    ${me.inGame && !me.alive ? `<p class="center muted">Tu as été éliminé (${ROLE_LABEL[me.role]}). Tu peux suivre la suite de la partie.</p>` : ""}`;
}

function cluesFor(playerId) {
  return view.clues.filter((c) => c.playerId === playerId).map((c) => {
    if (c.text === null) return `<span class="clue skipped">passé</span>`;
    const current = c.round === view.round ? "current" : "";
    return `<span class="clue ${current}" title="Tour ${c.round}">${escapeHtml(c.text)}</span>`;
  }).join("");
}

function viewBoard() {
  const players = byId();
  const ordered = [...view.order, ...view.players.filter((p) => p.inGame && !view.order.includes(p.id)).map((p) => p.id)];
  const rows = ordered.map((id) => {
    const p = players[id];
    if (!p) return "";
    const speaking = view.speakerId === id;
    const voted = view.phase === "vote" && view.votedIds.includes(id);
    const right = p.role
      ? `<span class="stamp ${p.role}" style="font-size:.6rem">${ROLE_LABEL[p.role]}</span>`
      : voted ? `<span class="voted">a voté</span>` : "";
    return `
      <li class="player ${speaking ? "speaking" : ""} ${p.alive ? "" : "out"}">
        <span class="dot ${p.connected ? "online" : "offline"}"></span>
        <span class="name">${escapeHtml(p.name)}${playerBadges(p)}<span class="clues">${cluesFor(id)}</span></span>
        ${right}
      </li>`;
  }).join("");
  return `<section class="stack"><p class="eyebrow">Indices</p><ul class="players">${rows}</ul></section>`;
}

function viewCluePhase() {
  const speaker = byId()[view.speakerId];
  const mine = view.speakerId === view.me.id;
  const action = mine
    ? `<form class="stack panel" data-form="clue">
         <label for="clue-input">À toi ! Donne un indice sur ton mot</label>
         <div class="inline-form">
           <input type="text" id="clue-input" maxlength="60" autocomplete="off" placeholder="Un mot ou une courte phrase" autofocus>
           <button class="btn" type="submit">Envoyer</button>
         </div>
       </form>`
    : `<p class="panel center">C'est au tour de <strong>${escapeHtml(speaker?.name)}</strong> de donner un indice…</p>`;
  const skip = isHost() && !mine
    ? `<button class="btn ghost wide" data-action="skipSpeaker">Passer le tour de ${escapeHtml(speaker?.name)}</button>`
    : "";
  return `${action}${viewBoard()}${skip}`;
}

function viewVotePhase() {
  const players = byId();
  const canVote = view.me.inGame && view.me.alive;
  const targets = view.candidates.filter((id) => id !== view.me.id).map((id) => `
    <li><button class="player ${view.myVote === id ? "selected" : ""}" data-action="vote" data-id="${id}" aria-pressed="${view.myVote === id}">
      <span class="num">${view.myVote === id ? "✕" : "·"}</span>
      <span class="name">${escapeHtml(players[id].name)}<span class="clues">${cluesFor(id)}</span></span><span></span>
    </button></li>`).join("");
  const alive = view.players.filter((p) => p.inGame && p.alive);
  const tieNames = view.candidates.map((id) => escapeHtml(players[id].name)).join(" et ");
  return `
    ${view.tie ? `<p class="panel center"><strong>Égalité !</strong> Nouveau vote entre ${tieNames}.</p>` : ""}
    ${canVote
      ? `<section class="stack"><p class="eyebrow">Vote pour éliminer · ${view.votedIds.length}/${alive.length} ont voté</p>
           <ul class="players">${targets}</ul>
           <p class="hint">${view.myVote ? "Vote enregistré. Tu peux encore changer d'avis." : "Touche un joueur pour voter contre lui."}</p></section>`
      : `<p class="panel center">Vote en cours · ${view.votedIds.length}/${alive.length}</p>`}
    ${viewBoard()}
    ${isHost() ? `<button class="btn ghost wide" data-action="closeVote" ${view.votedIds.length ? "" : "disabled"}>Clore le vote maintenant</button>` : ""}`;
}

function viewCounts() {
  if (!view.lastCounts) return "";
  const players = byId();
  const rows = Object.entries(view.lastCounts).sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `<tr><td>${escapeHtml(players[id]?.name)}</td><td class="num">${n} voix</td></tr>`).join("");
  return `<div class="panel table-wrap"><table><tbody>${rows}</tbody></table>
    ${view.tieBroken ? `<p class="hint" style="margin-top:8px">Égalité persistante : le sort a tranché.</p>` : ""}</div>`;
}

function viewEliminated() {
  const p = byId()[view.eliminatedId];
  return `
    <section class="result panel stack">
      <p class="eyebrow">Éliminé</p>
      <p class="big-name">${escapeHtml(p.name)}</p>
      <span class="stamp ${p.role}">${ROLE_LABEL[p.role]}</span>
    </section>`;
}

function viewGuessPhase() {
  const p = byId()[view.eliminatedId];
  const mine = view.me.id === view.eliminatedId;
  const body = mine
    ? `<form class="stack panel" data-form="guess">
         <label for="guess-input">Dernière chance : quel est le mot des Civils ?</label>
         <div class="inline-form">
           <input type="text" id="guess-input" maxlength="40" autocomplete="off" placeholder="Ta proposition" autofocus>
           <button class="btn" type="submit">Valider</button>
         </div>
       </form>`
    : `<p class="panel center"><strong>${escapeHtml(p.name)}</strong> tente de deviner le mot des Civils…</p>`;
  const skip = isHost() && !mine ? `<button class="btn ghost wide" data-action="next">Passer (Mr. White ne répond pas)</button>` : "";
  return `${viewEliminated()}${body}${viewCounts()}${skip}`;
}

function viewRevealPhase() {
  const guess = view.guess
    ? `<p class="panel center">Mr. White a proposé « ${escapeHtml(view.guess.text)} » : raté.</p>`
    : "";
  return `
    ${viewEliminated()}
    ${guess}
    ${viewCounts()}
    ${isHost() ? `<button class="btn wide" data-action="next">Continuer</button>` : `<p class="center muted">En attente de l'hôte pour continuer…</p>`}
    ${viewBoard()}`;
}

function viewGame() {
  const phases = { clues: viewCluePhase, vote: viewVotePhase, guess: viewGuessPhase, reveal: viewRevealPhase };
  const titles = { clues: "Indices", vote: "Vote", guess: "Mr. White démasqué", reveal: "Résultat du vote" };
  return `
    <header class="row between">
      <p class="eyebrow">Salon ${escapeHtml(view.code)} · Tour ${view.round}</p>
      <button class="small-btn" data-action="leave">Quitter</button>
    </header>
    <h2>${titles[view.phase]}</h2>
    ${viewSecret()}
    ${phases[view.phase]()}`;
}

function viewOver() {
  const titles = {
    civil: ["Les Civils gagnent", "Tous les infiltrés ont été démasqués."],
    infiltrators: ["Les infiltrés gagnent", "Il ne reste qu'un seul Civil en jeu."],
    "mrwhite-guess": ["Mr. White gagne", `Il a deviné le mot des Civils : « ${escapeHtml(view.guess?.text)} ».`],
  };
  const [title, reason] = titles[view.winner];
  const inGame = view.players.filter((p) => p.inGame);
  const rows = inGame.map((p) => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td><span class="dot ${p.role}"></span>${ROLE_LABEL[p.role]}</td>
      <td>${p.word ? escapeHtml(p.word) : "—"}</td>
      <td class="num ${view.gains[p.id] ? "gain" : ""}">${view.gains[p.id] ? "+" + view.gains[p.id] : "0"}</td>
    </tr>`).join("");
  const ranking = [...view.players].sort((a, b) => b.score - a.score)
    .map((p) => `<tr><td>${escapeHtml(p.name)}${playerBadges(p)}</td><td class="num">${p.score}</td></tr>`).join("");
  return `
    <section class="result stack">
      <p class="eyebrow">Salon ${escapeHtml(view.code)} · Fin de partie en ${view.round} tour${view.round > 1 ? "s" : ""}</p>
      <h2>${title}</h2>
      <p class="muted">${reason}</p>
    </section>
    <div class="words">
      <div class="panel"><p class="eyebrow"><span class="dot civil"></span>Civils</p><p class="w">${escapeHtml(view.civWord)}</p></div>
      <div class="panel"><p class="eyebrow"><span class="dot undercover"></span>Undercover</p><p class="w">${escapeHtml(view.ucWord)}</p></div>
    </div>
    <section class="panel table-wrap">
      <table><thead><tr><th>Joueur</th><th>Rôle</th><th>Mot</th><th class="num">Gain</th></tr></thead><tbody>${rows}</tbody></table>
    </section>
    <section class="panel stack">
      <h2>Classement du salon</h2>
      <div class="table-wrap"><table><thead><tr><th>Joueur</th><th class="num">Points</th></tr></thead><tbody>${ranking}</tbody></table></div>
    </section>
    ${isHost()
      ? `${viewRoles()}
         <button class="btn wide" data-action="start">Rejouer</button>
         <button class="btn ghost wide" data-action="backToLobby">Retour au salon</button>`
      : `<p class="center muted">En attente que l'hôte relance une partie…</p>`}
    <button class="btn ghost wide" data-action="leave">Quitter le salon</button>`;
}

// ---------- actions ----------

function readName() {
  const name = (document.getElementById("name-input")?.value || "").trim();
  if (!name) {
    toast("Choisis d'abord un pseudo.");
    document.getElementById("name-input")?.focus();
    return null;
  }
  writeStore(NAME_KEY, name);
  return name;
}

async function enterRoom(event, payload) {
  ui = { ...ui, busy: true };
  render();
  const res = await emit(event, payload);
  ui = { ...ui, busy: false };
  if (!res.ok) {
    toast(res.error);
    render();
    return;
  }
  writeStore(SESSION_KEY, { code: res.code, token: res.token });
  setUrlCode(res.code);
}

function leaveRoom(reason) {
  writeStore(SESSION_KEY, null);
  setUrlCode("");
  view = null;
  ui = { ...ui, wordShown: false };
  render();
  if (reason) toast(reason);
}

const clickActions = {
  create() {
    const name = readName();
    if (name) enterRoom("room:create", { name });
  },
  async leave() {
    await emit("room:leave", {});
    leaveRoom();
  },
  copyCode() { copy(view.code, "Code"); },
  copyLink() { copy(inviteLink(), "Lien"); },
  toggleWord() { ui = { ...ui, wordShown: !ui.wordShown }; render(); },
  setting(el) {
    const { uc, mw } = view.settings;
    const next = { uc, mw, [el.dataset.key]: view.settings[el.dataset.key] + Number(el.dataset.delta) };
    act("updateSettings", next);
  },
  start() { ui = { ...ui, wordShown: false }; act("start"); },
  kick(el) { act("kick", { playerId: el.dataset.id }); },
  skipSpeaker() { act("skipSpeaker"); },
  vote(el) { act("vote", { targetId: el.dataset.id }); },
  closeVote() { act("closeVote"); },
  next() { act("next"); },
  backToLobby() { act("backToLobby"); },
};

const formActions = {
  join() {
    const name = readName();
    const code = (document.getElementById("code-input")?.value || "").trim().toUpperCase();
    if (!name) return;
    if (code.length !== 5) return toast("Le code du salon fait 5 lettres.");
    enterRoom("room:join", { code, name });
  },
  async clue() {
    const input = document.getElementById("clue-input");
    const res = await act("clue", { text: input.value });
    if (res.ok) input.value = "";
  },
  guess() {
    act("guess", { text: document.getElementById("guess-input").value });
  },
};

app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  clickActions[el.dataset.action]?.(el);
});

app.addEventListener("submit", (e) => {
  e.preventDefault();
  formActions[e.target.dataset.form]?.();
});

app.addEventListener("input", (e) => {
  if (e.target.id === "code-input") e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
});

// ---------- connexion ----------

socket.on("connect", async () => {
  offlineEl.hidden = true;
  const session = readStore(SESSION_KEY);
  if (!session) return;
  const res = await emit("room:join", { code: session.code, token: session.token });
  if (!res.ok) leaveRoom("Ce salon n'existe plus.");
});

socket.on("disconnect", () => { offlineEl.hidden = false; });

socket.on("state", (state) => {
  const newGame = view && view.phase !== "clues" && state.phase === "clues" && state.round === 1;
  if (newGame) ui = { ...ui, wordShown: false };
  view = state;
  render();
});

socket.on("kicked", ({ reason }) => leaveRoom(reason));

render();
