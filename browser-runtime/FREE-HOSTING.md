# Options gratuites pour le Browser Runtime

## Résultat de l’essai Render

Le plan Web Render gratuit est annoncé avec 512 Mo et une mise en veille après 15 minutes sans trafic. La documentation le destine aux essais, pas aux applications de production. Dans notre essai local avec un vrai Chromium ouvert sur une page HTTP simple, le processus Node et ses descendants ont consommé environ 445 Mio de PSS. Cette mesure n’est pas une garantie du même chiffre dans le conteneur Render, mais elle montre qu’il resterait très peu de marge pour d’autres pages, onglets ou contextes.

La création d’un service Render `free` a été tentée sans abonnement payant. L’API Render l’a refusée avant de retourner un ID de service, avec HTTP 402 : « Payment information is required to complete this request ». Aucune carte n’a été ajoutée et aucune ressource n’a été créée. Aucun nouvel essai et aucun plan payant n’ont été choisis.

## Docker local sans frais d’hébergement

Le chemin gratuit utilisable est d’exécuter `browser-runtime` avec Docker sur un ordinateur que l’utilisateur contrôle. Le fichier `compose.yaml` limite le port publié à `127.0.0.1`, garde le jeton hors du dépôt et configure le CORS pour l’origine Vercel de CORTEX.Cowork. L’ordinateur et le conteneur doivent rester allumés pendant l’utilisation. Les profils et sessions sont éphémères et disparaissent à l’arrêt du runtime.

Pour rendre le runtime joignable à Vercel et à un agent distant, Cloudflare documente les Quick Tunnels gratuits sans compte ni domaine. Ils créent une URL temporaire `trycloudflare.com`; l’URL change au redémarrage du tunnel et cesse de fonctionner quand le processus s’arrête. Cloudflare les destine aux essais et au développement, sans garantie de disponibilité. La documentation indique une limite de 200 requêtes simultanées et l’absence de support SSE.

Le serveur MCP CORTEX répond en JSON via Streamable HTTP (`enableJsonResponse: true`). Le handshake, `tools/list` et `browser_navigate` ont été testés sur HTTP local. Le flux SSE n’est donc pas requis par ce client précis; la vérification du tunnel public reste à faire sur l’ordinateur de l’utilisateur. Éviter l’authentification Quick Tunnel par e-mail pour ce MCP non interactif, puisqu’elle nécessite une session de navigateur.

## Autres hôtes sans frais

Les Docker Spaces Hugging Face ne sont pas retenus comme solution gratuite sans engagement : leur documentation indique qu’un plan PRO est nécessaire pour créer un Space Docker, même si le matériel CPU Basic affiché peut être tarifé à 0 $/heure. Aucun Space n’a été créé.

## Lancer sur l’ordinateur de l’utilisateur

```sh
cd browser-runtime
cp .env.example .env
TOKEN="$(openssl rand -hex 32)"
printf 'BROWSER_RUNTIME_API_KEYS={"%s":"cortex-owner"}\nBROWSER_RUNTIME_ALLOWED_ORIGINS=https://cowork-chi-seven.vercel.app\n' "$TOKEN" > .env
chmod 600 .env
docker compose up --build
```

Dans un second terminal sur le même ordinateur, installer `cloudflared` puis démarrer le tunnel temporaire :

```sh
cloudflared tunnel --url http://127.0.0.1:10000
```

Renseigner l’URL `https://….trycloudflare.com` affichée par `cloudflared` dans l’onglet Browser. Ajouter aussi `https://….trycloudflare.com/mcp` comme transport Streamable HTTP distant dans les réglages MCP, avec le même Bearer token, puis sélectionner ce serveur dans le profil OpenHands souhaité. Le tunnel étant temporaire, son URL doit être mise à jour après chaque redémarrage.

Pour valider le service, définir `BROWSER_RUNTIME_URL`, `BROWSER_RUNTIME_API_KEY` et éventuellement `BROWSER_RUNTIME_SECOND_API_KEY`, puis exécuter `npm run smoke` depuis `browser-runtime`. Le test navigue vers des pages publiques et soumet un formulaire de démonstration; l’exécuter uniquement sur une instance jetable de test.

## Sources officielles consultées le 15 novembre 2026

| Source                                | URL                                                                 |
| ------------------------------------- | ------------------------------------------------------------------- |
| Render, tarifs et plans               | https://render.com/pricing                                          |
| Render, limites gratuites             | https://render.com/docs/free                                        |
| Render, plans de calcul               | https://render.com/docs/compute-plans                               |
| Cloudflare, Quick Tunnels             | https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/ |
| Hugging Face, aperçu des Spaces       | https://huggingface.co/docs/hub/en/spaces-overview                  |
| Hugging Face, matériel et facturation | https://huggingface.co/docs/hub/en/spaces-gpus                      |
