# Relais — CORTEX Browser Runtime

## État à la remise

Le code est sur la branche `feat/render-chromium-browser`. Le panneau Browser utilise un vrai service Chromium distant, avec barre d’adresse, navigation, onglets et captures. L’agent OpenHands local reçoit l’identifiant non secret de la conversation. Le runtime expose l’API HTTPS et les outils MCP `browser_*`.

Le runtime a été testé en local avec un processus Chromium réel (`/usr/bin/chromium`, version rapportée pendant le test `156.0.8078.73`). Le scénario a confirmé une navigation HTTPS vers `example.com`, une capture JPEG 1365×900, deux onglets dans la même session, une seconde session restant sur `about:blank`, le refus d’une URL loopback et une navigation par appel MCP vers `example.net`. La dernière assertion du script de test regardait l’élément `tabs[0]` au lieu de l’onglet marqué `active`; la réponse MCP montrait bien `example.net` sur l’onglet actif. Aucun déploiement Render n’a été créé.

Les tests ciblés de Canvas ont réussi : 112 tests, dont les tests Browser et le contexte agent. Le typecheck a réussi. Refaire lint/typecheck après toute modification et tester dans l’environnement Render/Vercel réel.

## Étapes restantes

1. Créer manuellement le service Web Docker Render depuis la racine du dépôt, avec `browser-runtime/Dockerfile`, `/healthz` comme health check et une taille mémoire/CPU adaptée à Chromium. Choisir/valider le plan Render avant de créer une ressource pouvant être facturée.
2. Fournir à Render `BROWSER_RUNTIME_API_KEYS` avec un jeton aléatoire d’au moins 32 caractères par utilisateur et un identifiant tenant stable. Configurer `BROWSER_RUNTIME_ALLOWED_ORIGINS` avec l’origine exacte de CORTEX.Cowork sur Vercel. Ne jamais mettre ces secrets dans Git ou dans `VITE_*`.
3. Dans le panneau Browser, renseigner l’URL HTTPS Render et le jeton utilisateur. Dans `/mcp`, ajouter `https://<render-host>/mcp` avec authentification Bearer et le même jeton, puis rattacher la référence MCP (`mcp_server_refs`) au profil OpenHands local qui doit utiliser le navigateur.
4. Vérifier depuis l’application Vercel publiée : CORS, authentification, capture live, saisie/clic, navigation, plusieurs onglets et isolement entre deux comptes/tenants réels. Le rafraîchissement visuel est actuellement périodique (~1,2 s), pas un flux vidéo.
5. Examiner l’isolation avant d’autoriser des sites non fiables. Le conteneur utilise `pwuser`, mais l’activation du sandbox Chromium dépend d’un profil seccomp que Render peut ne pas exposer. Si Render ne permet pas la configuration exigée par Playwright, choisir un environnement d’exécution qui la permet ou définir explicitement le niveau de risque accepté.
6. Compléter la liaison session-ID pour les conversations Cloud côté backend, après allocation de leur ID de conversation, et valider séparément le transport de la consigne pour ACP. Le code actuel ne promet le partage automatique qu’au démarrage OpenHands local.
7. Si les profils de cookies doivent survivre aux redémarrages, concevoir ensuite un stockage chiffré et tenant-scopé avec gestion de clés, rétention et suppression. Le comportement actuel est volontairement éphémère.

Lire aussi [README.md](./README.md) pour le déploiement/configuration et [TECHNICAL-NOTES.md](./TECHNICAL-NOTES.md) pour les sources amont et la justification du serveur MCP session-aware.
