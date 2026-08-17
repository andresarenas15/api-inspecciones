const jsonServer = require('json-server');
const cors = require('cors');

const server = jsonServer.create();
const router = jsonServer.router('db.json');
const middlewares = jsonServer.defaults();

// Habilitar CORS para evitar bloqueos del navegador en el Dashboard
server.use(cors());
server.use(middlewares);
server.use(jsonServer.bodyParser);

// Traductor automático de rutas (Rewriter)
// Esto es vital para que las rutas que llama tu Dashboard coincidan con el archivo db.json
server.use(jsonServer.rewriter({
  '/api/asignaciones/general': '/asignaciones',
  '/api/rendiciones/general': '/rendiciones',
  '/api/viaticos/general': '/viaticos',
  '/api/:recurso/:id/estado': '/:recurso/:id',
  '/api/*': '/$1'
}));

server.use(router);

const port = process.env.PORT || 10000;
server.listen(port, () => {
  console.log(`Servidor automático corriendo en el puerto ${port}`);
});
