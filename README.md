# ✝ Esfera Católica
Agregador de blogs católicos en español. Reúne los últimos artículos de los mejores blogs de la blogosfera católica hispanohablante, actualizado automáticamente dos veces al día mediante GitHub Actions.

## 🧩 ¿Cómo funciona?

```
feeds.json     →         fetch-feeds.mjs          →   lastposts.json
   (manual)       (GitHub Actions, 6h y 18h UTC)      (jsDelivr CDN)
```

1. Se mantiene manualmente una lista de blogs aprobados en `feeds.json`.
2. GitHub Actions ejecuta `fetch-feeds.mjs` dos veces al día.
3. El resultado se publica en `lastposts.json` y queda disponible vía jsDelivr.


Disponible vía CDN en:
```
https://cdn.jsdelivr.net/gh/CursoCatolico/esferacatolica@main/lastposts.json
```

## 📅 Participar

Próximamente...

## 📜 Licencia

Este proyecto se distribuye bajo la licencia [Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/deed.es). Eres libre de usar, modificar y redistribuir el código, siempre que cites la fuente y mantengas la misma licencia.

## 🙏 Sobre el proyecto

Wikitólica busca acercar la riqueza de la tradición litúrgica de la Iglesia a la web moderna, manteniendo fidelidad, claridad y accesibilidad. Estos widgets siguen esa misma filosofía: herramientas simples, útiles y respetuosas con el contenido que presentan.

<p align="center">
  Un proyecto de <a href="https://www.wikitolica.com"><strong>Wikitólica</strong></a> — La Enciclopedia Católica en español
</p>
