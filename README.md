# Taller de Tazas — Puesta en marcha

Todo con tu **cuenta personal de Gmail**. Toma unos 15 minutos.

## 1. Drive
1. Crea una carpeta **Catálogo tazas**. Sube ahí las fotos de tus diseños.
   - Nombre del archivo = nombre y precio: `Gato astronauta_3500.jpg`
   - Sin precio → se usa $3.500.
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
├── Animales/                 ← subcarpeta = categoría
│   ├── descripcion.txt       ← texto bajo el filtro "Animales" (opcional)
│   ├── Gato astronauta_3500.jpg
│   └── Gato astronauta.txt   ← descripción del producto (opcional)
└── Frases/
    └── Mejor profe_4000.png
```
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

## Uso diario
- **Nuevo diseño:** súbelo a la carpeta. Aparece en máximo 10 minutos
  (o al instante abriendo `TU_URL/exec?action=catalog&fresh=1`).
- **Quitar un diseño:** bórralo o muévelo fuera de la carpeta.
- **Pedidos:** llegan a la hoja con el estado *Pendiente de abono*. Cámbialo desde la lista desplegable a medida que avanzas.
- **Si una foto sale en blanco:** ejecuta `setup` de nuevo.

## Ojo
- Si editas `Codigo.gs`, los cambios no se publican solos: **Implementar → Administrar implementaciones → editar → Nueva versión**. Así mantienes la misma URL.
- Los precios se recalculan en el script, así que nadie puede alterar el total desde el navegador.
