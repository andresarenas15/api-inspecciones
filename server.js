const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());

// IMPORTANTE: Ampliamos el límite a 50mb para soportar las fotos de los comprobantes
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- BASES DE DATOS EN MEMORIA ---
// (Estas variables se reiniciarán si Render entra en suspensión, es ideal para pruebas)
let asignaciones = [];
let rendiciones = [];

// ==========================================
// 1. ENDPOINTS DE ASIGNACIONES
// ==========================================
app.post('/api/asignaciones', (req, res) => {
    const nuevaAsignacion = req.body;
    asignaciones.unshift(nuevaAsignacion);
    console.log("Nueva OS asignada:", nuevaAsignacion.os);
    res.json({ success: true, message: "Asignación registrada en servidor" });
});

app.get('/api/asignaciones/:username', (req, res) => {
    // Por ahora enviamos todo, pero aquí puedes filtrar por el username del inspector
    res.json(asignaciones);
});

// ==========================================
// 2. ENDPOINTS DE RENDICIONES
// ==========================================

// A. Obtener TODAS las rendiciones (Para el Dashboard del Coordinador)
app.get('/api/rendiciones/all', (req, res) => {
    res.json(rendiciones);
});

// B. Obtener rendiciones de UN inspector (Para la App Flutter)
app.get('/api/rendiciones/:username', (req, res) => {
    const username = req.params.username;
    const filtradas = rendiciones.filter(r => r.username_creador === username);
    res.json(filtradas);
});

// C. Crear o Modificar una rendición (Desde Flutter)
app.post('/api/rendiciones', (req, res) => {
    const nuevaRendicion = req.body;
    
    if (!nuevaRendicion.id) {
        // Es nueva: le creamos un ID único
        nuevaRendicion.id = Date.now().toString();
        rendiciones.unshift(nuevaRendicion);
    } else {
        // Ya tiene ID: es una rendición observada que el inspector acaba de corregir
        const index = rendiciones.findIndex(r => r.id === nuevaRendicion.id);
        if (index !== -1) {
            rendiciones[index] = nuevaRendicion;
        } else {
            rendiciones.unshift(nuevaRendicion);
        }
    }
    
    console.log("Rendición procesada. OS:", nuevaRendicion.os);
    res.json({ success: true, message: "Rendición guardada correctamente" });
});

// D. Aprobar, Observar o Rechazar (Desde el Dashboard HTML)
app.put('/api/rendiciones/:id/estado', (req, res) => {
    const id = req.params.id;
    const { estado, motivo_revision } = req.body;
    
    const index = rendiciones.findIndex(r => r.id === id);
    if (index !== -1) {
        rendiciones[index].estado = estado;
        rendiciones[index].motivo_revision = motivo_revision || '';
        console.log(`Rendición ${id} cambió a estado: ${estado}`);
        res.json({ success: true, message: `Rendición ${estado}` });
    } else {
        res.status(404).json({ error: "Rendición no encontrada" });
    }
});

// ==========================================
// INICIO DEL SERVIDOR
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});
