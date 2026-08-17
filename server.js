const jsonServer = require('json-server');
const cors = require('cors');

const server = jsonServer.create();
const router = jsonServer.router('db.json');
const middlewares = jsonServer.defaults();

// Habilitar conexión con la App y el Dashboard
server.use(cors());
server.use(middlewares);
server.use(jsonServer.bodyParser);

// Traductor automático de rutas (elimina el /api/ para la BD)
server.use(jsonServer.rewriter({
  '/api/*/general': '/$1',
  '/api/:recurso/:id/estado': '/:recurso/:id',
  '/api/*': '/$1'
}));

// 🔥 CREADOR AUTOMÁTICO DEFINITIVO (Soluciona el Error 404) 🔥
server.use((req, res, next) => {
  // Extraemos el nombre de la tabla de la ruta (ej: de "/usuarios" extrae "usuarios")
  const pathParts = req.path.split('/').filter(p => p !== '');
  const recurso = pathParts[0];

  if (recurso) {
    const db = router.db; // Referencia directa a db.json
    
    // Si la tabla (recurso) no existe, la crea instantáneamente como un arreglo vacío.
    // Esto evita el Error 404 cuando el Dashboard hace un GET por primera vez.
    if (!db.has(recurso).value()) {
      db.set(recurso, []).write();
      console.log(`[Auto-DB] Nueva tabla creada automáticamente: ${recurso}`);
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
