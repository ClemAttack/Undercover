# Undercover

Jeu d'ambiance en ligne, de 3 à 20 joueurs, chacun sur son téléphone. Un joueur crée un **salon privé**, partage le **code à 5 lettres** (ou le lien d'invitation), et les autres le rejoignent.

## Règles

- **Civils** : ils reçoivent tous le même mot.
- **Undercovers** : ils reçoivent un mot proche, sans savoir qu'ils sont Undercover.
- **Mr. White** : il ne reçoit aucun mot et doit bluffer. Il ne parle jamais en premier.
- À chaque tour, chacun écrit un indice sur son mot (sans le dire), puis tout le monde vote pour éliminer un joueur.
- En cas d'égalité, on revote entre les ex-aequo ; si l'égalité persiste, le sort tranche.
- Mr. White éliminé peut deviner le mot des Civils : s'il trouve, il gagne seul. La réponse est validée avec tolérance : accents, majuscules, articles (« le », « l' »…) et pluriels sont ignorés, et les fautes de frappe sont acceptées selon la longueur du mot (aucune sous 5 lettres, 1 dès 5 lettres, 2 dès 9).
- Les **Civils** gagnent quand tous les infiltrés sont éliminés. Les **infiltrés** gagnent s'il ne reste qu'un seul Civil.
- Chat du salon : pour s'expliquer sur les votes et se défendre. Un joueur éliminé ne peut plus écrire jusqu'à la fin de la partie, et personne ne peut écrire son propre mot. Le chat annonce aussi les débuts de partie, les éliminations et la proposition de Mr. White.
- Taille du salon : l'hôte règle le nombre de places (3 à 20, 20 par défaut). Une fois le salon plein, plus personne ne peut entrer ; un joueur déjà inscrit qui se reconnecte garde sa place.
- Thèmes : l'hôte choisit un ou plusieurs thèmes (animaux, nourriture, lieux, métiers…), ou le mode **Mélange** qui pioche dans toutes les paires. Le thème n'est jamais affiché pendant la partie.
- Points : Civil 2, Mr. White 6, Undercover 10 (pour chaque joueur du camp gagnant). Le classement est conservé tant que le salon existe.

## Lancer en local

```bash
npm install
npm start          # http://localhost:3000
npm test           # tests de la logique de jeu
```

Pour tester à plusieurs en local, ouvrez plusieurs onglets (ou une fenêtre de navigation privée par joueur, la reconnexion automatique étant mémorisée par navigateur).

## Déployer en ligne

Le jeu est un serveur Node.js (Express + Socket.IO) qui garde les salons en mémoire. Il faut donc un hébergeur qui fait tourner un **processus Node permanent avec WebSockets** (pas un hébergement statique comme GitHub Pages ou Netlify).

### Render (gratuit pour commencer)

1. Sur [render.com](https://render.com), **New → Web Service**, puis connectez le dépôt GitHub.
2. Build command : `npm install` · Start command : `npm start`.
3. Render fournit automatiquement la variable `PORT`. C'est tout.

L'offre gratuite met le serveur en veille après 15 min sans visite : le premier chargement prend alors ~30 s, et les salons en cours sont perdus au redémarrage.

### Autres options

Railway, Fly.io ou un VPS fonctionnent de la même façon : `npm install` puis `npm start`, avec la variable d'environnement `PORT` si besoin. Gardez **une seule instance** : les salons sont en mémoire et ne sont pas partagés entre plusieurs instances.

## Structure

```
server.js          Serveur HTTP + Socket.IO, gestion des salons et des connexions
src/game.js        Logique pure du jeu (rôles, tours, votes, victoire, vue filtrée par joueur)
src/words.js       324 paires de mots classées par thème (pas de répétition dans un salon avant épuisement)
public/            Client web (HTML, CSS, JS sans framework)
test/              Tests de la logique (node --test)
```

Le serveur n'envoie à chaque joueur que ce qu'il a le droit de voir : son propre mot, et les rôles des joueurs déjà éliminés. Les mots de tous ne sont révélés qu'en fin de partie.
