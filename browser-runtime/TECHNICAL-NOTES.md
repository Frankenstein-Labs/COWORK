# Notes de compatibilité et sources amont

## Dépôts officiels clonés

Les dépôts suivants ont été clonés en lecture seule avant l’intégration : Chromium `e48bcc0fe103`, Playwright `b4d016aadc5c` et Playwright MCP `78eca85361ef`. Le dépôt CORTEX.Cowork de départ était au commit `4bbea81dc73a`.

Le README officiel de Chromium précise que son checkout pris en charge se fait via `depot_tools`, pas par un simple `git clone`. Le runtime Render n’essaie donc pas de reconstruire les sources Chromium : il utilise l’image Linux officielle Playwright, épinglée sur la même version que le paquet Playwright afin d’éviter une incompatibilité entre le client et les exécutables navigateur.[1] [2]

## Pourquoi le serveur MCP est un adaptateur

L’upstream Playwright MCP fournit le protocole, les outils d’automatisation et un transport HTTP. Sa documentation précise cependant que le serveur MCP n’est pas une frontière de sécurité. Le runtime CORTEX ajoute donc l’authentification Bearer, le rattachement explicite à un `session_id` par conversation et la séparation des `BrowserContext`, au lieu d’exposer directement un endpoint Playwright MCP sans authentification.[3] [4]

Le clone MCP au commit `78eca85361ef` indique `@playwright/mcp` `0.0.85`, qui dépend de Playwright `1.66.0-alpha-2026-11-09`. La version précédente `0.0.84` dépend de `1.65.0-alpha-2026-10-30`. Ces paquets ne correspondent pas à l’image stable Playwright `1.65.0-noble` sélectionnée pour le premier runtime. Pour éviter de mélanger une version alpha et un binaire de navigateur différent, ce service utilise Playwright `1.65.0` et le SDK MCP officiel `1.25.2`, puis expose un petit ensemble d’outils adaptés aux sessions CORTEX. Il n’embarque pas le paquet serveur `@playwright/mcp` lui-même.[5] [6]

## Sécurité du conteneur

La documentation officielle Playwright avertit que l’image est destinée principalement aux tests et au développement et déconseille de visiter des sites non fiables sans configuration supplémentaire. Elle recommande un utilisateur non-root et un profil seccomp donnant au Chromium la possibilité d’utiliser les namespaces nécessaires à son sandbox. Le Dockerfile CORTEX utilise `pwuser`; Render doit encore être vérifié pour savoir si le profil seccomp requis peut être configuré. En l’absence de cette preuve, l’isolation annoncée est celle du conteneur et des contextes applicatifs, pas une garantie d’activation du sandbox Chromium.[2]

## Références

[1]: https://github.com/chromium/chromium "Dépôt source officiel Chromium"
[2]: https://playwright.dev/docs/docker "Documentation officielle Playwright sur Docker"
[3]: https://github.com/microsoft/playwright-mcp "Dépôt officiel Playwright MCP"
[4]: https://playwright.dev/mcp/introduction "Introduction officielle Playwright MCP"
[5]: https://www.npmjs.com/package/@playwright/mcp "Métadonnées npm de Playwright MCP"
[6]: https://www.npmjs.com/package/@playwright/mcp/v/0.0.84 "Version 0.0.84 du paquet Playwright MCP"
