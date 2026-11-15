# Notes de compatibilité et sources amont

## Dépôts officiels clonés

Les dépôts suivants ont été clonés en lecture seule avant l’intégration : Chromium `e48bcc0fe103`, Playwright `b4d016aadc5c` et Playwright MCP `78eca85361ef`. Le dépôt CORTEX.Cowork de départ était au commit `4bbea81dc73a`.

Le README officiel de Chromium précise que son checkout pris en charge se fait via `depot_tools`, pas par un simple `git clone`. Le runtime n’essaie donc pas de reconstruire Chromium depuis les sources : il utilise l’image Linux officielle Playwright, épinglée sur la même version que le paquet Playwright pour éviter une incompatibilité client/navigateur.[1] [2]

## Pourquoi le serveur MCP est un adaptateur

L’upstream Playwright MCP fournit le protocole, les outils d’automatisation et un transport HTTP. Sa documentation précise toutefois que le serveur MCP n’est pas une frontière de sécurité. Le runtime CORTEX ajoute l’authentification Bearer, le rattachement explicite à un `session_id` et la séparation de BrowserContexts, au lieu d’exposer directement un MCP Playwright sans authentification.[3] [4]

Le clone MCP au commit `78eca85361ef` indique `@playwright/mcp` `0.0.85`, qui dépend de Playwright `1.66.0-alpha-2026-11-09`. La version précédente `0.0.84` dépend de `1.65.0-alpha-2026-10-30`. Ces versions ne correspondent pas à l’image stable Playwright `1.65.0-noble`; le runtime utilise donc Playwright `1.65.0` et le SDK MCP officiel `1.25.2`, avec un petit ensemble d’outils Browser adaptés aux sessions CORTEX.[5] [6]

Le transport MCP est Streamable HTTP avec réponse JSON (`enableJsonResponse: true`). L’essai local a validé le handshake MCP, `tools/list` (12 outils) et l’appel `browser_navigate`; SSE n’est pas requis pour ce client. La compatibilité Quick Tunnel reste à valider depuis un vrai tunnel public.

## Liaison des sessions agent/Browser

OpenHands et ACP reçoivent le conversation ID non secret dans `system_message_suffix_append`. Pour Cloud, l’ID de conversation est alloué par le backend après la requête de création; le client crée donc un `cloud-browser-<UUID>` avant le POST, l’envoie dans le tag `cortex_browser_session_id` et dans le suffixe de lancement, puis le Browser tab lit ce tag via les métadonnées de conversation. Les tests vérifient le contrat frontend/API; l’exécution face à un backend Cloud/ACP réel demeure une validation de déploiement.

## Sécurité du conteneur et capacité gratuite

La documentation Playwright vise principalement les tests et le développement et déconseille la navigation de sites non fiables sans configuration supplémentaire. Elle recommande un utilisateur non-root et un profil seccomp approprié pour le sandbox Chromium. Le Dockerfile utilise `pwuser`, mais le sandbox et seccomp n’ont pas été vérifiés dans un conteneur réel du sandbox; l’isolation annoncée est celle des BrowserContexts et du conteneur, pas une garantie complète contre du contenu hostile.[2]

Les pages Render consultées le 15 novembre 2026 indiquent que l’offre gratuite fournit 512 Mo et met en veille les services Web gratuits après 15 minutes sans trafic. Une création de service `free` par l’API Render a renvoyé HTTP 402 (« Payment information is required to complete this request ») avant tout ID de ressource. Aucune ressource n’a été créée et aucune carte n’a été ajoutée. Le runtime local, avec une page publique simple, a consommé environ 445 Mio PSS pour le processus Node et ses descendants Chromium; ce n’est qu’une mesure indicative, mais elle laisse peu de marge sous 512 Mo.[7] [8] [9]

La documentation Cloudflare indique que Quick Tunnels ne requièrent ni compte ni domaine, produisent une URL aléatoire temporaire et sont destinés au développement. Ils ne garantissent pas la disponibilité, ont une limite indiquée de 200 requêtes simultanées et ne prennent pas en charge SSE. Le mode JSON Streamable HTTP utilisé ici évite le besoin SSE, sans remplacer un test bout en bout du tunnel.[10]

Les Docker Spaces Hugging Face ne sont pas retenus comme hôte gratuit sans engagement : leur documentation indique qu’un plan PRO est nécessaire pour créer un Space de type Docker, même si l’option CPU Basic peut être affichée à 0 $/heure.[11] [12]

## Références

[1]: https://github.com/chromium/chromium "Dépôt source officiel Chromium"
[2]: https://playwright.dev/docs/docker "Documentation officielle Playwright sur Docker"
[3]: https://github.com/microsoft/playwright-mcp "Dépôt officiel Playwright MCP"
[4]: https://playwright.dev/mcp/introduction "Introduction officielle Playwright MCP"
[5]: https://www.npmjs.com/package/@playwright/mcp "Métadonnées npm de Playwright MCP"
[6]: https://www.npmjs.com/package/@playwright/mcp/v/0.0.84 "Version 0.0.84 du paquet Playwright MCP"
[7]: https://render.com/pricing "Tarifs officiels Render"
[8]: https://render.com/docs/free "Limites officielles des services gratuits Render"
[9]: https://render.com/docs/compute-plans "Plans de calcul Render"
[10]: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/ "Cloudflare Quick Tunnels"
[11]: https://huggingface.co/docs/hub/en/spaces-overview "Vue d’ensemble des Hugging Face Spaces"
[12]: https://huggingface.co/docs/hub/en/spaces-gpus "Matériel et facturation des Spaces Hugging Face"
