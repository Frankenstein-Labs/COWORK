# Relais — CORTEX Browser Runtime

## État après cette étape

La branche de fonctionnalité contient le panneau Browser distant, le runtime Chromium/Playwright avec son adaptateur MCP authentifié, la configuration Docker Compose locale et un smoke test reproductible. Aucun service Render n’a été créé : la demande de service gratuit a été refusée par Render avec HTTP 402 exigeant des informations de paiement. Aucune carte ni ressource payante n’a été ajoutée.

Le Browser tab pilote un vrai processus Chromium. Les sessions sont des `BrowserContext` séparés par `(tenant, session_id)`; leurs cookies, stockage, pages et onglets sont cloisonnés. Le service garde les profils éphémères en mémoire et ne persiste aucun cookie après arrêt.

Le démarrage local OpenHands/ACP reçoit le `conversationId` comme session MCP. Le démarrage Cloud génère un identifiant aléatoire `cloud-browser-*`, le place dans les tags de conversation et dans le suffixe de lancement agent; le Browser tab récupère ensuite le tag dans les métadonnées. Les contrats locaux et Cloud ont des tests unitaires. Cette liaison n’a pas été validée contre un vrai backend Cloud/ACP connecté.

## Vérifications effectuées

Le runtime a été démarré sans Docker avec Chromium système réel `/usr/bin/chromium`, version `156.0.8078.73`. Le smoke test complet a réussi sur une instance locale propre : navigation, retour/avance/actualisation, capture JPEG, lecture de page et snapshot d’accessibilité, saisie et clics sur un formulaire public, création/sélection/fermeture d’onglets, sessions indépendantes, isolation entre deux tenants, rejet des requêtes sans Bearer, CORS exact, blocage loopback/privé, `tools/list` et appel MCP `browser_navigate`.

La mesure indicative du processus Node et de Chromium pour une page simple était d’environ 445 Mio PSS dans le sandbox. Ce chiffre n’est pas une mesure Render exacte, mais il montre la faible marge d’un service de 512 Mo, en particulier avec plusieurs onglets. La vérification Docker réelle n’a pas été exécutée : le sandbox courant ne possède pas de daemon Docker. Le déploiement via Quick Tunnel n’a pas encore été essayé de bout en bout.

## Pour l’utiliser sans carte ni abonnement

Sur un ordinateur contrôlé par l’utilisateur avec Docker et OpenSSL, suivre `README.md` : créer `browser-runtime/.env` avec `openssl rand -hex 32`, démarrer `docker compose up --build`, puis lancer `cloudflared tunnel --url http://127.0.0.1:10000`. Utiliser l’URL `trycloudflare.com` dans le panneau Browser et son `/mcp` dans les réglages MCP, avec le même jeton. L’ordinateur et les processus Docker/tunnel doivent rester allumés; l’URL change au redémarrage et ce mode n’est pas un hébergement permanent.

Ajouter ensuite le serveur MCP dans `/mcp` et le sélectionner dans `mcp_server_refs` du profil d’agent qui doit piloter le navigateur. La configuration MCP de compte/profil reste une action explicite, car elle donne à l’agent l’accès au navigateur. Après chaque redémarrage du Quick Tunnel, mettre à jour l’URL dans le panneau Browser et la configuration MCP.

## Limites et prochaine validation

La capture de l’interface est rafraîchie périodiquement (~1,2 s), pas transmise en vidéo. Les onglets sont gérés dans des BrowserContexts d’un processus Chromium commun dans un conteneur; ce n’est pas une isolation OS individuelle par onglet. Les requêtes réseau de navigation sont filtrées applicativement, mais aucune politique d’egress réseau dédiée n’est configurée. Le sandbox Chromium/seccomp doit être vérifié avant de traiter des sites non fiables.

Quand l’utilisateur lancera le Docker local, vérifier le healthcheck et les logs, puis exécuter `npm run smoke` contre le runtime. Tester ensuite depuis CORTEX.Cowork déployé sur Vercel avec le vrai Quick Tunnel : CORS, screenshot live, clic/saisie, appels MCP et profil sélectionné. Ne pas redemander ni ajouter un plan Render payant à moins que l’utilisateur ne l’autorise explicitement.

Lire aussi [`FREE-HOSTING.md`](./FREE-HOSTING.md) pour l’évaluation no-card et [`TECHNICAL-NOTES.md`](./TECHNICAL-NOTES.md) pour les dépôts amont et les sources officielles.
