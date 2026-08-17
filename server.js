const jsonServer = require('json-server');
const cors = require('cors');

const server = jsonServer.create();
const router = jsonServer.router('db.json');
const middlewares = jsonServer.defaults();

// Habilitar conexión con la App y el Dashboard
server.use(cors());
server.use(middlewares);
server.use(jsonServer.bodyParser);

// Traductor automático de rutas
server.use(jsonServer.rewriter({
  '/api/*/general': '/$1',
  '/api/:recurso/:id/estado': '/:recurso/:id',
  '/api/*': '/$1'
}));

// 🔥 CREADOR AUTOMÁTICO DEFINITIVO Y CORREGIDO 🔥
server.use((req, res, next) => {
  // 1. Obtenemos la URL original (ej. /api/usuarios)
  let currentUrl = req.originalUrl || req.url;
  
  // 2. Limpiamos parámetros extras (ej. ?id=1)
  currentUrl = currentUrl.split('?')[0];
  
  // 3. Separamos la ruta en palabras
  const parts = currentUrl.split('/').filter(p => p !== '');
  
  // 4. Identificamos el nombre real de la tabla
  let recurso = parts[0];
  // Si la ruta empieza con "api", la tabla real es la segunda palabra
  if (recurso === 'api' && parts.length > 1) {
    recurso = parts[1]; // Aquí atrapa "usuarios", "asignaciones", etc.
  }

  // 5. Verificamos y creamos la tabla si no existe
  if (recurso) {
    const db = router.db;
    if (!db.has(recurso).value()) {
      db.set(recurso, []).write();
      console.log(`[Auto-DB] Se creó la tabla correctamente: ${recurso}`);
    }
  }
  
  next();
});

// Iniciar la base de datos
server.use(router);

const port = process.env.PORT || 10000;
server.listen(port, () => {
  console.log(`Servidor automático corriendo en el puerto ${port}`);
});
