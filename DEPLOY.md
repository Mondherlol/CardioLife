# 🚀 Déploiement CardioTrack sur VPS OVH (guide débutant)

Ce guide part de **zéro**. À la fin, ton site (front + back + base de données) sera en
ligne, et **chaque `git push` sur `main` mettra automatiquement le site à jour**.

Légende :
- 💻 = commande à taper **sur ton PC Windows** (PowerShell)
- 🖥️ = commande à taper **sur le VPS** (une fois connecté en SSH)

Ton repo : `github.com/Mondherlol/CardioLife`
Tes images Docker : `ghcr.io/mondherlol/cardiotrack-frontend` et `.../cardiotrack-backend`

---

## 🧩 Comment ça marche (en 30 secondes)

1. Tu push ton code sur GitHub.
2. **GitHub Actions** construit 2 images Docker (front + back) et les stocke sur GHCR
   (le registre d'images de GitHub).
3. GitHub se connecte en SSH à ton VPS, fait un `git pull`, télécharge les nouvelles
   images et redémarre.
4. Sur le VPS, **Docker Compose** fait tourner 3 conteneurs :
   - `frontend` (nginx qui sert ton site React sur le port 80)
   - `backend` (ton API Node sur le port 5000, interne)
   - `mongo` (la base de données, interne)

Tu n'installes **ni Node, ni Mongo** sur le VPS. Docker s'occupe de tout.

### 🔑 Il y a DEUX clés SSH à créer (ne pas confondre)

| Clé | Générée où | Sert à quoi |
|-----|-----------|-------------|
| **Deploy key** | sur le **VPS** | Le VPS peut lire/cloner ton repo privé (VPS → GitHub) |
| **Actions key** | sur ton **PC** | GitHub peut se connecter au VPS pour déployer (GitHub → VPS) |

---

## Étape 0 — Récupérer les infos de connexion du VPS

Dans ton espace OVH (ou l'email reçu à l'achat), note :
- **L'adresse IP** du VPS (ex : `51.68.123.45`)
- **Le nom d'utilisateur** (souvent `ubuntu`)
- **Le mot de passe** initial

Dans la suite je note ton IP `IP_VPS` et ton user `ubuntu`. Remplace par les tiens.

---

## Étape 1 — Se connecter au VPS

💻 Ouvre **PowerShell** sur ton PC :

```bash
ssh ubuntu@IP_VPS
```

- La première fois : `Are you sure...` → tape `yes`.
- Entre le mot de passe (il ne s'affiche pas quand tu tapes, c'est normal).

Tu es maintenant **sur le VPS** (le début de ligne change). Pour en sortir : `exit`.

---

## Étape 2 — Mettre à jour le système

🖥️ Sur le VPS :

```bash
sudo apt update && sudo apt upgrade -y
```

---

## Étape 3 — Docker (déjà installé ✅)

Docker est déjà présent sur ton VPS. Vérifie juste :

```bash
docker version
docker compose version
```

Si les deux affichent des versions → parfait. Ajoute ton user au groupe docker pour
éviter `sudo` à chaque commande :

```bash
sudo usermod -aG docker $USER
```

Puis **déconnecte/reconnecte** (`exit`, puis `ssh ubuntu@IP_VPS`) et refais
`docker version` pour confirmer que ça marche **sans sudo**.

> Si `docker compose version` dit "command not found" :
> `sudo apt install -y docker-compose-plugin`

---

## Étape 4 — Configurer le pare-feu

🖥️ On n'ouvre que SSH, HTTP et HTTPS :

```bash
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable
sudo ufw status
```

> ⚠️ Ne ferme **jamais** le port 22 (SSH) sinon tu perds l'accès.

---

## Étape 5 — Cloner le repo privé (avec une "Deploy key")

Comme le repo est **privé**, le VPS a besoin d'une clé pour y accéder en lecture.
On génère une clé **sur le VPS** et on l'ajoute au repo comme *Deploy key* (lecture
seule).

### 5a. Générer la clé sur le VPS

🖥️ :

```bash
ssh-keygen -t ed25519 -C "cardiotrack-vps" -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
```

Copie **toute la ligne** affichée par `cat` (commence par `ssh-ed25519 ...`).

### 5b. Ajouter la clé publique sur GitHub

Sur GitHub : repo **CardioLife** → **Settings** → (menu gauche) **Deploy keys** →
**Add deploy key**.
- Title : `vps-ovh`
- Key : colle la ligne copiée
- ⚠️ **NE COCHE PAS** "Allow write access" (lecture seule suffit)
- **Add key**

### 5c. Dire à git d'utiliser cette clé

🖥️ Crée le fichier de config SSH :

```bash
nano ~/.ssh/config
```

Colle ceci :

```
Host github.com
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
```

Enregistre (`Ctrl+O`, `Entrée`) et quitte (`Ctrl+X`). Puis sécurise :

```bash
chmod 600 ~/.ssh/config
```

Teste la connexion à GitHub :

```bash
ssh -T git@github.com
```

Réponds `yes`. Message attendu :
`Hi Mondherlol/CardioLife! You've successfully authenticated, but GitHub does not
provide shell access.` → c'est bon, c'est le comportement normal. ✅

### 5d. Cloner le repo dans /opt/cardiotrack

🖥️ :

```bash
sudo mkdir -p /opt/cardiotrack
sudo chown -R $USER:$USER /opt/cardiotrack
git clone git@github.com:Mondherlol/CardioLife.git /opt/cardiotrack
cd /opt/cardiotrack
ls
```

Tu dois voir `docker-compose.prod.yml`, `backend/`, `src/`, etc. ✅

---

## Étape 6 — Créer le fichier secret `.env.prod`

Ce fichier contient tes clés. Il **reste sur le VPS** (il est dans `.gitignore`, donc
jamais envoyé sur GitHub).

🖥️ Génère une clé JWT et copie-la :

```bash
openssl rand -hex 64
```

Puis crée le fichier :

```bash
nano /opt/cardiotrack/.env.prod
```

Colle ceci (remplace les `< >`) :

```
JWT_SECRET=<colle_ici_la_chaine_générée>
JWT_EXPIRES_IN=7d
CLIENT_ORIGIN=http://IP_VPS
PUBLIC_SITE_API_KEY=
IMAGE_NAMESPACE=mondherlol
```

> ⚠️ `IMAGE_NAMESPACE=mondherlol` en **minuscules**.
> `CLIENT_ORIGIN` : mets ton IP pour l'instant, tu mettras `https://ton-domaine.tld`
> plus tard.

Enregistre (`Ctrl+O`, `Entrée`, `Ctrl+X`).

---

## Étape 7 — Créer la clé pour que GitHub déploie (Actions key)

GitHub Actions doit pouvoir se connecter en SSH à ton VPS pour lancer le déploiement.

### 7a. Générer la clé sur ton PC

💻 :

```bash
cd "C:\Users\mondh\OneDrive\Desktop\CardioLife\CardioTrack"
ssh-keygen -t ed25519 -C "github-actions-cardiotrack" -f cardiotrack_deploy -N ""
```

Ça crée `cardiotrack_deploy` (privée) et `cardiotrack_deploy.pub` (publique). Ces
fichiers sont déjà dans `.gitignore`, ils ne partiront pas sur GitHub.

### 7b. Installer la clé publique sur le VPS

💻 Affiche la clé publique :

```bash
type cardiotrack_deploy.pub
```

Copie la ligne, puis 🖥️ **sur le VPS** :

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "COLLE_ICI_cardiotrack_deploy.pub" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

---

## Étape 8 — Créer un token GitHub pour lire les images (GHCR)

Le VPS doit pouvoir télécharger tes images Docker privées.

1. github.com → ta photo → **Settings**
2. Tout en bas : **Developer settings**
3. **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**
4. Nom : `cardiotrack-ghcr`, expiration : `No expiration`
5. Coche **uniquement** **`read:packages`**
6. **Generate token** → **copie-le** (tu ne le reverras plus).

---

## Étape 9 — Ajouter les secrets dans GitHub

Repo **CardioLife** → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**. Crée ces **4 secrets** :

| Nom               | Valeur                                                              |
|-------------------|--------------------------------------------------------------------|
| `VPS_HOST`        | l'IP du VPS (ex : `51.68.123.45`)                                  |
| `VPS_USER`        | ton user SSH (ex : `ubuntu`)                                       |
| `VPS_SSH_KEY`     | contenu **complet** du fichier `cardiotrack_deploy` (clé privée)   |
| `GHCR_READ_TOKEN` | le token de l'étape 8                                              |

> 💻 Pour afficher la clé privée à copier : `type cardiotrack_deploy`
> Copie **tout**, y compris `-----BEGIN...` et `-----END...`.

---

## Étape 10 — Lancer le premier déploiement 🎉

💻 Sur ton PC :

```bash
cd "C:\Users\mondh\OneDrive\Desktop\CardioLife\CardioTrack"
git add -A
git commit -m "Configuration deploiement VPS"
git push origin main
```

Va sur GitHub → onglet **Actions** et regarde le workflow tourner :
1. Build des images front + back (~2-4 min)
2. Push sur GHCR
3. SSH au VPS → `git pull` → `docker compose pull` → redémarrage

Quand tout est vert ✅, ouvre `http://IP_VPS` → ton site est en ligne !
Les fois suivantes, un simple `git push` suffit.

---

## Étape 11 — Vérifier / dépanner sur le VPS

🖥️ :

```bash
cd /opt/cardiotrack
docker compose --env-file .env.prod -f docker-compose.prod.yml ps        # état
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f backend   # logs
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d      # relancer
```

---

## Étape 12 — (Recommandé) Domaine + HTTPS

Le site répond en `http://IP_VPS` (non sécurisé).

1. **Domaine** : chez ton registrar, crée un enregistrement **A** pointant ton domaine
   vers `IP_VPS`.
2. **HTTPS** : ajouter **Caddy** devant l'appli donne un certificat SSL Let's Encrypt
   automatique et gratuit. → Demande-moi, je te l'ajoute au `docker-compose.prod.yml`.

Une fois le domaine actif : remets `CLIENT_ORIGIN=https://ton-domaine.tld` dans
`.env.prod`, puis relance (`git push` ou `up -d`).

---

## 🔒 Rappels sécurité

- Ne commit **jamais** `.env.prod`, ni `cardiotrack_deploy` (déjà dans `.gitignore`).
- MongoDB n'est **pas** exposé sur Internet → parfait.
- Pare-feu actif : seuls 22, 80, 443 ouverts.
