const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Conexión segura forzando IPv4 para evitar el error ENETUNREACH en Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  family: 4 
});

// Inicialización automática de la estructura relacional basada en la OS
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        fullname VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        password VARCHAR(255) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS asignaciones (
        os VARCHAR(100) PRIMARY KEY,
        id VARCHAR(100),
        project VARCHAR(255),
        client VARCHAR(255),
        ins VARCHAR(100),
        start TIMESTAMP,
        "end" TIMESTAMP,
        state VARCHAR(50) DEFAULT 'Asignada',
        day INT,
        tasks JSONB,
        addresses JSONB,
        reporteConfig JSONB,
        progress NUMERIC DEFAULT 0.0,
        modules_data JSONB DEFAULT '{}'::jsonb
      );

      CREATE TABLE IF NOT EXISTS rendiciones (
        id VARCHAR(100) PRIMARY KEY,
        os VARCHAR(100) REFERENCES asignaciones(os) ON DELETE CASCADE,
        username_creador VARCHAR(100),
        ejecutivo VARCHAR(255),
        observaciones TEXT,
        detalles TEXT,
        total_gastado NUMERIC,
        estado VARCHAR(50) DEFAULT 'Pendiente',
        motivo_revision TEXT,
        items_rendicion JSONB
      );

      CREATE TABLE IF NOT EXISTS viaticos (
        id VARCHAR(100) PRIMARY KEY,
        os VARCHAR(100) REFERENCES asignaciones(os) ON DELETE CASCADE,
        username_creador VARCHAR(100),
        ejecutivo VARCHAR(255),
        dias_ope INT,
        detalles TEXT,
        total NUMERIC,
        estado VARCHAR(50) DEFAULT 'Pendiente',
        motivo_revision TEXT,
        items_viatico JSONB
      );

      CREATE TABLE IF NOT EXISTS reporte_campo (
        id SERIAL PRIMARY KEY,
        os VARCHAR(100),
        submatriz VARCHAR(255),
        parametro VARCHAR(255),
        punto VARCHAR(100),
        reporte TEXT
      );
    `);
    console.log("[PostgreSQL] Tablas e infraestructura de OS inicializadas correctamente.");
  } catch (err) {
    console.error("[PostgreSQL] Error crítico al inicializar la base de datos:", err);
  }
}

initDB();

// --- ENDPOINTS DE USUARIOS ---
app.get('/api/usuarios', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM usuarios');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/usuarios', async (req, res) => {
  const { username, fullname, role, password } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO usuarios (username, fullname, role, password) VALUES ($1, $2, $3, $4) RETURNING *',
      [username, fullname, role, password]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/usuarios/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ENDPOINTS DE ASIGNACIONES ---

// Endpoint para obtener todas las asignaciones (Dashboard Coordinador)
app.get('/api/asignaciones/general', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM asignaciones');
    
    // FIX INTEGRAL: Mapeamos el JSON para corregir la minúscula forzada por PostgreSQL
    const asignacionesFix = result.rows.map(row => {
      return {
        ...row,
        // PostgreSQL envía "reporteconfig", nosotros lo forzamos a "reporteConfig" para que la App lo lea.
        reporteConfig: row.reporteconfig || row.reporteConfig || null
      };
    });
    
    res.json(asignacionesFix);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Endpoint filtrado por usuario (FIX para la App Monitoristas)
app.get('/api/asignaciones/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const result = await pool.query('SELECT * FROM asignaciones WHERE LOWER(ins) = LOWER($1)', [username]);
    
    // FIX INTEGRAL: Mapeamos el JSON para el Monitorista
    const asignacionesFix = result.rows.map(row => {
      return {
        ...row,
        reporteConfig: row.reporteconfig || row.reporteConfig || null
      };
    });
    
    res.json(asignacionesFix);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/asignaciones', async (req, res) => {
  const r = req.body;
  try {
    await pool.query(
      `INSERT INTO asignaciones (os, id, project, client, ins, start, "end", state, day, tasks, addresses, reporteConfig, progress)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (os) DO UPDATE SET state = $8, progress = $13, tasks = $10, reporteConfig = $12`,
      [r.os, r.id, r.project, r.client, r.ins, r.start, r.end, r.state, r.day, JSON.stringify(r.tasks), JSON.stringify(r.addresses), JSON.stringify(r.reporteConfig), r.progress]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 🔥 ENDPOINT DINÁMICO PARA MÓDULOS DE LA APP
app.post('/api/asignaciones/:os/modulo', async (req, res) => {
  const { os } = req.params;
  const { moduloName, data } = req.body;
  try {
    await pool.query(
      `UPDATE asignaciones 
       SET modules_data = jsonb_set(COALESCE(modules_data, '{}'::jsonb), ARRAY[$1], $2::jsonb)
       WHERE os = $3`,
      [moduloName, JSON.stringify(data), os]
    );
    res.json({ success: true, message: `Módulo ${moduloName} guardado para la OS ${os}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/asignaciones/:os', async (req, res) => {
  try {
    await pool.query('DELETE FROM asignaciones WHERE os = $1', [req.params.os]);
    res.json({ success: true, message: 'Asignación eliminada' });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

// --- ENDPOINTS DE RENDICIONES Y VIÁTICOS ---
app.get('/api/rendiciones/general', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM rendiciones');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/rendiciones/:username', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM rendiciones WHERE username_creador = $1', [req.params.username]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/rendiciones', async (req, res) => {
  const r = req.body;
  try {
    await pool.query(
      'INSERT INTO rendiciones (id, os, username_creador, total_gastado, estado, items_rendicion) VALUES ($1, $2, $3, $4, $5, $6)',
      [r.id, r.os, r.username_creador, r.total_gastado, r.estado, JSON.stringify(r.items_rendicion)]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/rendiciones/:id/estado', async (req, res) => {
  const { estado, motivo_revision } = req.body;
  try {
    await pool.query('UPDATE rendiciones SET estado = $1, motivo_revision = $2 WHERE id = $3', [estado, motivo_revision, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/viaticos/general', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM viaticos');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/viaticos/:username', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM viaticos WHERE username_creador = $1', [req.params.username]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/viaticos', async (req, res) => {
  const r = req.body;
  try {
    await pool.query(
      'INSERT INTO viaticos (id, os, username_creador, total, estado, items_viatico) VALUES ($1, $2, $3, $4, $5, $6)',
      [r.id, r.os, r.username_creador, r.total, r.estado, JSON.stringify(r.items_viatico)]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/viaticos/:id/estado', async (req, res) => {
  const { estado, motivo_revision } = req.body;
  try {
    await pool.query('UPDATE viaticos SET estado = $1, motivo_revision = $2 WHERE id = $3', [estado, motivo_revision, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- REPORTE DE CAMPO ---
app.get('/api/reporte-campo/:os', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reporte_campo WHERE os = $1', [req.params.os]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/reporte-campo/:os/:parametro', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reporte_campo WHERE os = $1 AND parametro = $2', [req.params.os, req.params.parametro]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/reporte-campo', async (req, res) => {
  const r = req.body;
  try {
    await pool.query('INSERT INTO reporte_campo (os, submatriz, parametro, punto, reporte) VALUES ($1, $2, $3, $4, $5)', 
    [r.os, r.submatriz, r.parametro, r.punto, r.reporte]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- HOJA DE RUTA ---
app.get('/api/hoja-ruta/:os', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM asignaciones WHERE os = $1', [req.params.os]);
    res.json(result.rows[0] ? result.rows[0].modules_data?.hoja_ruta : null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/hoja-ruta', async (req, res) => {
  const r = req.body;
  try {
    await pool.query(
      'UPDATE asignaciones SET modules_data = jsonb_set(COALESCE(modules_data, \'{}\'::jsonb), \'{hoja_ruta}\', $1::jsonb) WHERE os = $2',
      [JSON.stringify(r), r.os]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor PostgreSQL conectado y operando en el puerto ${PORT}`);
});
