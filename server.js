const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Extracción manual de la URL de Supabase para forzar conexión IPv4 directa por host
const url = new URL(process.env.DATABASE_URL);

const pool = new Pool({
  host: url.hostname,
  port: url.port || 5432,
  database: url.pathname.slice(1),
  user: url.username,
  password: url.password,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  family: 4 // Forzar estrictamente protocolo IPv4 a nivel de socket
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

// --- ENDPOINT NORMALIZADO (CASE-INSENSITIVE) ---
app.get('/api/asignaciones/:username', async (req, res) => {
  const { username } = req.params;
  try {
    // Usamos LOWER para comparar ambos lados en minúsculas, evitando errores de tipeo o mayúsculas
    const result = await pool.query('SELECT * FROM asignaciones WHERE LOWER(ins) = LOWER($1)', [username]);
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

// --- ENDPOINTS DE ASIGNACIONES (AISLAMIENTO ABSOLUTO POR OS) ---
app.get('/api/asignaciones/general', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM asignaciones');
    res.json(result.rows);
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

// 🔥 ENDPOINT UNIVERSAL DINÁMICO PARA MÓDULOS DE LA APP (Aislamiento por OS)
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

// --- ENDPOINTS DE RENDICIONES Y VIÁTICOS ---
app.get('/api/rendiciones/general', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM rendiciones');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- NUEVO: ENDPOINT PARA ASIGNACIONES FILTRADAS POR USUARIO/INSPECTOR ---
app.get('/api/asignaciones/:username', async (req, res) => {
  const { username } = req.params;
  try {
    // Filtramos la base de datos usando el campo 'ins' (inspector)
    const result = await pool.query('SELECT * FROM asignaciones WHERE ins = $1', [username]);
    res.json(result.rows);
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor PostgreSQL conectado y operando en el puerto ${PORT}`);
});
