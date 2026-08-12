const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

let asignaciones = [
  {
    id: 1, os: 'OS-2026-045', project: 'Proyecto Andina', client: 'Constructora Andina', 
    ins: 'Iván Morales', start: '2026-08-10T08:00', end: '2026-08-12T17:00', 
    state: 'En progreso', day: 10, tasks: ['Reportes de campo', 'Verificación de equipos'], 
    addresses: ['Av. Principal 450', 'Av. Industrial 250']
  }
];

app.post('/api/asignaciones', (req, res) => {
    const nuevaAsignacion = req.body;
    asignaciones.unshift(nuevaAsignacion);
    console.log("Nueva asignación guardada:", nuevaAsignacion.os);
    res.json({ success: true, message: "Asignación registrada en servidor" });
});

app.get('/api/asignaciones/:inspector', (req, res) => {
    const username = req.params.inspector;
    const nombres = {
        'inspector1': 'Iván Morales',
        'inspector2': 'Carla Rojas',
        'inspector3': 'Luis Pérez'
    };
    
    const nombreReal = nombres[username];
    const asignacionesDelInspector = asignaciones.filter(a => a.ins === nombreReal);
    res.json(asignacionesDelInspector);
});

// Render asigna el puerto automáticamente mediante process.env.PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});
