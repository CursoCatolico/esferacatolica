# ✝ Esfera Católica
Agregador de blogs católicos en español. Reúne los últimos artículos de los mejores blogs de la blogosfera católica hispanohablante, actualizado automáticamente dos veces al día mediante GitHub Actions.

## 🧩 ¿Cómo funciona?

```
feeds.json     →         fetch-feeds.mjs          →   lastposts-<dominio>.json (+ lastposts.json)
   (manual)       (GitHub Actions, 1h y 13h UTC)                (jsDelivr CDN)
```

1. Se mantiene manualmente una lista de blogs aprobados en `feeds.json`.
2. GitHub Actions ejecuta `fetch-feeds.mjs` dos veces al día.
3. El resultado es **un fichero por dominio** (`lastposts-<dominio>.json`, con el host
   en minúsculas y sin `www.`, p. ej. `lastposts-elobservadorenlinea.com.json`). Cada
   fichero contiene un máximo de 5 blogs por **reparto aleatorio y equitativo**: todos
   los dominios aparecen un número similar de veces para un descubrimiento justo.
4. La asignación es **estable** (no cambia a diario) y **solo se recalcula** cuando un
   dominio entra o sale de `feeds.json`. Subir `PER_DOMAIN_SALT` a `v2` en
   `fetch-feeds.mjs` fuerza una remezcla manual completa. Las bajas eliminan su
   fichero automáticamente.
5. `lastposts.json` es una réplica para compatibilidad con widgets antiguos ya
   instalados. Todo queda disponible vía jsDelivr.
6. El widget pide el fichero de su propio dominio y, si aún no existe, recurre al
   global.


Disponible vía CDN en:
```
https://cdn.jsdelivr.net/gh/CursoCatolico/esferacatolica@main/lastposts.json
https://cdn.jsdelivr.net/gh/CursoCatolico/esferacatolica@main/lastposts-<dominio>.json
```

## 🌐 Participar

Esfera Católica es una comunidad de colaboración caritativa entre sitios y blogs católicos en internet. Funciona mediante un widget que permite el descubrimiento mutuo: cuando pones el widget en tu web, tus visitantes descubren otras páginas católicas de calidad, y tras una breve validación, tu sitio aparece automáticamente en el widget de todos los demás participantes.

Para instalar el widget de Esfera Católica acude a: [Widget Esfera Católica](https://www.wikitolica.com/e/esfera-catolica/)

## 🙏 Sobre el proyecto

La [Enciclopedia Católica Wikitólica](https://www.wikitolica.com/) Wikitólica busca acercar la riqueza de la tradición litúrgica de la Iglesia a la web moderna, manteniendo fidelidad, claridad y accesibilidad.

## ©️ Licencia de Uso
Este conjunto de datos se distribuye bajo la licencia [Creative Commons Atribución-ShareAlike 4.0 Internacional (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/) Usted es libre de compartir y adaptar el material para cualquier propósito, incluso comercial, siempre que otorgue el crédito correspondiente a Wikitólica y sus correspondientes artículos.

## ⚠️ Exención de Responsabilidad
El contenido de este Grafo de Conocimiento se ofrece "tal cual", sin garantías de ningún tipo respecto a su exactitud, integridad o actualidad. Wikitolica es un proyecto independiente y los datos aquí presentados tienen carácter puramente informativo, histórico y cultural. El uso de estos datos para fines teológicos, académicos o comerciales es responsabilidad exclusiva del usuario. Wikitolica se reserva el derecho de modificar o retirar datos sin previo aviso. Al usarlos acepta explícitamente nuestro [aviso legal](https://www.wikitolica.com/a/aviso-legal/).

<p align="center">
  Un proyecto de <a href="https://www.wikitolica.com"><strong>Wikitólica</strong></a> — La Enciclopedia Católica en español
</p>
