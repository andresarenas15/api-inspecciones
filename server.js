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

const URL_GOOGLE_SCRIPT = 'https://script.google.com/macros/s/AKfycbyVyEEuCIgpgP45rh7lC-7wPmlCx4bML8vOVCL9XlUp68G9r_JIHe39Tj-6o4Yh9-Y/exec';

app.post('/api/asignaciones', async (req, res) => {
    const nuevaAsignacion = req.body;
    
    // Guardamos localmente en la memoria del servidor
    asignaciones.unshift(nuevaAsignacion);

    try {
        // ENVIAMOS EL RESPALDO A GOOGLE DRIVE MEDIANTE EL SCRIPT
        await fetch(URL_GOOGLE_SCRIPT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nuevaAsignacion)
        });
        console.log("Respaldo enviado a Google Drive correctamente");
    } catch (error) {
        console.error("Error al respaldar en Drive:", error);
    }

    res.json({ success: true, message: "Asignación registrada y respaldada en Drive" });
});
