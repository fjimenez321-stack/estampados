# Té-tazas — Puesta en marcha

Todo con tu **cuenta personal de Gmail**. Toma unos 15 minutos.

## 1. Drive
1. Crea una carpeta **Catálogo tazas**. Sube ahí las fotos de tus diseños.
   - Nombre del archivo = nombre y precio: `Gato astronauta_3500.jpg`
   - Sin precio → se usa $4.000. Ningún tazón baja de $4.000 (`MIN_PRICE`), aunque el archivo diga menos.
   - Subcarpetas (`Animales`, `Frases`…) = categorías del sitio.
2. Crea otra carpeta **Pedidos tazas** (ahí quedan las fotos que suban los clientes). Esta NO se comparte.
3. Copia el ID de cada carpeta: es lo que va después de `/folders/` en la URL.

## 2. Sheet + script
1. Crea una Google Sheet llamada **Pedidos tazas**.
2. Menú **Extensiones → Apps Script**. Borra lo que aparece y pega `Codigo.gs`.
3. Pega los dos ID en `CONFIG`. Si quieres un correo por cada pedido, pon tu dirección en `NOTIFY_EMAIL`.
4. Elige la función `setup` arriba y presiona **Ejecutar**. Acepta los permisos
   (aparecerá "Google no verificó esta app": *Configuración avanzada → Ir a…*; es tu propio script).
   Crea la hoja *Pedidos* y deja la carpeta del catálogo visible con enlace.
5. **Implementar → Nueva implementación → Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
6. Copia la URL que termina en `/exec`.

## 3. Sitio
1. En `index.html`, dentro de `CONFIG`, pega la URL en `API_URL` y completa tus datos en `BANK`.
2. Revisa la lista `STATIONS` y deja solo las estaciones donde de verdad entregas.
3. Crea un repositorio nuevo en GitHub, sube `index.html` y activa **Settings → Pages** (rama `main`).

Sin `API_URL` el sitio funciona en modo demostración, útil para probarlo antes.

## Organizar el catálogo (tu panel de administración es Drive)
```
Catálogo tazas/
├── Animales/                     ← subcarpeta = categoría
│   ├── descripcion.txt           ← texto bajo el filtro "Animales" (opcional)
│   ├── Gato astronauta_3500/     ← carpeta = UN producto con varias fotos
│   │   ├── foto1.jpg             ← la primera (por nombre) es la portada
│   │   ├── foto2.jpg
│   │   └── descripcion           ← cualquier texto dentro = descripción
│   ├── Perro_3500.jpg            ← foto suelta = producto de una foto
│   ├── Perro_3500 (2).jpg        ← mismo nombre + (2) o #2 = otra foto del mismo
│   └── Perro.txt                 ← descripción de la foto suelta
└── Frases/
    └── Mejor profe_4000.png
```
Hasta 10 fotos por producto (`MAX_IMAGES` en `Codigo.gs`).
- La descripción puede ser `.txt`, `.md` o un **Google Docs** con el mismo nombre (lo más cómodo desde el celular). El precio en el nombre del texto es opcional.
- Admite `**negrita**`, `*cursiva*` y listas con `- ` al inicio de la línea.
- Renombrar la carpeta cambia el nombre de la categoría; mover una foto la cambia de categoría.

## Horarios de entrega (hoja "Horarios" de tu Sheet)
`setup` crea la hoja con los horarios iniciales. Cada fila es un horario:

| Estación | Día | Desde | Hasta | Estado |
|---|---|---|---|---|
| Villa Alemana | Lunes | 16:00 | 16:30 | Disponible |
| Todas | Sábado | 08:00 | 09:00 | Disponible |

- **Todas** = vale para cualquier estación sin horarios propios. Si una estación tiene filas propias (como Villa Alemana), solo se ofrecen esas.
- Cuando un cliente reserva, la fila pasa a **Reservado** con el número de pedido y desaparece del sitio.
- Para liberarlo, cámbialo a **Disponible**. **Desactivado** lo oculta sin reservarlo (vacaciones, un día que no puedes).
- Para agregar horarios o estaciones, añade filas. Escribe el nombre de la estación igual que en el sitio.

## Tipos de tazón (carrito)
En `Codigo.gs` → `VARIANTS` defines los tipos y su recargo por unidad; en `COLORS`, los colores del tazón con interior de color. El sitio los toma del script, así que basta con cambiarlos ahí (y publicar una nueva versión).

## Instalar como app
El sitio se puede instalar en el celular (manifest + service worker):
- **Android / Chrome:** aparece el botón **⬇ Instalar** junto al carrito.
- **iPhone (Safari):** se muestra una nota con los pasos: Compartir → *Agregar a inicio*.

Si cambias imágenes o archivos del sitio, sube el número de `VERSION` en `sw.js` (`tetazas-v2`, `v3`…) para que las apps instaladas tomen la copia nueva. La página y el catálogo se actualizan solos.

## Precios especiales
- **Más de una foto o frase en un tazón:** casilla en el carrito, +$1.000 por tazón (`EXTRA_ELEMENT`).
- **Packs:** en `Codigo.gs` → `PACKS`. El *Pack de curso* son 30 tazones por $100.000 + IVA (19%) y aparece primero en el catálogo. Si no cobras IVA, pon `ivaPct: 0`. Para otro pack, agrega un elemento a la lista.

## Uso diario
- **Nuevo diseño:** súbelo a la carpeta. Aparece en máximo 10 minutos
  (o al instante abriendo `TU_URL/exec?action=catalog&fresh=1`).
- **Quitar un diseño:** bórralo o muévelo fuera de la carpeta.
- **Pedidos:** llegan a la hoja con el estado *Pendiente de abono*. Cámbialo desde la lista desplegable a medida que avanzas.
- **Si una foto sale en blanco:** ejecuta `setup` de nuevo.

## Ojo
- Si editas `Codigo.gs`, los cambios no se publican solos: **Implementar → Administrar implementaciones → editar → Nueva versión**. Así mantienes la misma URL.
- Los precios se recalculan en el script, así que nadie puede alterar el total desde el navegador.
