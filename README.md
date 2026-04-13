# ✝ Esfera Católica

<p align="center">
  <a href="https://wikitolica.com">
    <img src="https://img.shields.io/badge/impulsado%20por-Wikitólica-7a1c1c?style=for-the-badge&logoColor=white" alt="Impulsado por Wikitólica"/>
  </a>
  <img src="https://img.shields.io/badge/licencia-CC%20BY--SA%204.0-lightgrey?style=for-the-badge" alt="CC BY-SA 4.0"/>
  <img src="https://img.shields.io/badge/actualización-2×%20al%20día-4a7c4e?style=for-the-badge" alt="2 veces al día"/>
</p>

> Agregador de blogs católicos en español. Reúne los últimos artículos de los mejores blogs de la blogosfera católica hispanohablante, actualizado automáticamente dos veces al día mediante GitHub Actions.

## ¿Cómo funciona?

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

## Participar

Próximamente...

## Licencia

El código y los datos de este repositorio se publican bajo licencia  
**[Creative Commons Atribución-CompartirIgual 4.0 Internacional (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/deed.es)**.


<p align="center">
  Un proyecto de <a href="https://wikitolica.com"><strong>Wikitólica</strong></a> — La Enciclopedia Católica en español
</p>
