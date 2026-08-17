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

// 🔥 CREADOR AUTOMÁTICO DE TABLAS 🔥
server.use((req, res, next) => {
  // Solo actuamos si se está intentando guardar nueva información (POST)
  if (req.method === 'POST') {
    const db = router.db; // Acceso directo a db.json
    const recurso = req.path.split('/')[1]; // Obtiene el nombre del módulo (ej: "usuarios")
    
    // Si la tabla (recurso) no existe en db.json, la crea al instante como []
    if (recurso && !db.has(recurso).value()) {
      db.set(recurso, []).write();
      console.log(`¡Nueva tabla creada automáticamente: ${recurso}!`);
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
