const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// Conexión segura forzando IPv4
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  family: 4  
});

// NUEVA FUNCIÓN DE SANEAMIENTO
const safeVal = (v) => {
  if (v === undefined || v === null || v === '' || 
      String(v).trim().toLowerCase() === 'undefined' || 
      String(v).trim().toLowerCase() === 'null' || 
      String(v).trim().toLowerCase() === 'nan') {
    return null; // Fuerza un NULL real para que la BD lo acepte (fechas, foráneas, numéricos)
  }
  return v;
};

// Inicialización de la estructura relacional y EXPANSIÓN FORZADA DE TABLAS EXISTENTES
async function initDB() {
  try {
    // 1. Crear tablas si no existen
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

      CREATE TABLE IF NOT EXISTS verificaciones (
        id VARCHAR(100) PRIMARY KEY,
        os VARCHAR(100),
        equipo VARCHAR(255),
        marca VARCHAR(100),
        modelo VARCHAR(100),
        codigo VARCHAR(100),
        nro_serie VARCHAR(100),
        fecha_verificacion TIMESTAMP,
        calibracion_vigente VARCHAR(50),
        fecha_ultima_calibracion TIMESTAMP,
        estado_fisico JSONB,
        funcionamiento JSONB,
        control_operativo JSONB,
        anomalias JSONB
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

    // 2. FORZAR EXPANSIÓN DE TABLAS EXISTENTES (El fix definitivo)
    await pool.query(`
      ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS area VARCHAR(100);
      ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS fecha_sol TIMESTAMP;
      ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS lugar_servicio VARCHAR(255);
      ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS proyecto VARCHAR(255);
      ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS fecha_salida TIMESTAMP;
      ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS fecha_inicio TIMESTAMP;
      ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS fecha_termino TIMESTAMP;
      ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS dias_ope INT;
      ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS inspector1 VARCHAR(100);
      ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS inspector2 VARCHAR(100);
      ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS inspector3 VARCHAR(100);
      ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS hora_inicio VARCHAR(20);
      ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS hora_fin VARCHAR(20);
      ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS viaticos NUMERIC;
      ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS realizado VARCHAR(100);

      ALTER TABLE viaticos ADD COLUMN IF NOT EXISTS area VARCHAR(100);
      ALTER TABLE viaticos ADD COLUMN IF NOT EXISTS fecha_sol TIMESTAMP;
      ALTER TABLE viaticos ADD COLUMN IF NOT EXISTS lugar_servicio VARCHAR(255);
      ALTER TABLE viaticos ADD COLUMN IF NOT EXISTS proyecto VARCHAR(255);
      ALTER TABLE viaticos ADD COLUMN IF NOT EXISTS fecha_salida TIMESTAMP;
      ALTER TABLE viaticos ADD COLUMN IF NOT EXISTS fecha_inicio TIMESTAMP;
      ALTER TABLE viaticos ADD COLUMN IF NOT EXISTS fecha_termino TIMESTAMP;
      ALTER TABLE viaticos ADD COLUMN IF NOT EXISTS inspector1 VARCHAR(100);
      ALTER TABLE viaticos ADD COLUMN IF NOT EXISTS inspector2 VARCHAR(100);
      ALTER TABLE viaticos ADD COLUMN IF NOT EXISTS inspector3 VARCHAR(100);
      ALTER TABLE viaticos ADD COLUMN IF NOT EXISTS hora_inicio VARCHAR(20);
      ALTER TABLE viaticos ADD COLUMN IF NOT EXISTS hora_fin VARCHAR(20);
      ALTER TABLE viaticos ADD COLUMN IF NOT EXISTS realizado VARCHAR(100);
      ALTER TABLE viaticos ADD COLUMN IF NOT EXISTS observaciones TEXT;
    `);

    console.log("[PostgreSQL] Tablas inicializadas y columnas faltantes agregadas con éxito.");
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
app.get('/api/asignaciones/general', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM asignaciones');
    const asignacionesFix = result.rows.map(row => ({
      ...row,
      reporteConfig: row.reporteconfig || row.reporteConfig || null
    }));
    res.json(asignacionesFix);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/asignaciones/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const result = await pool.query('SELECT * FROM asignaciones WHERE LOWER(ins) = LOWER($1)', [username]);
    const asignacionesFix = result.rows.map(row => ({
      ...row,
      reporteConfig: row.reporteconfig || row.reporteConfig || null
    }));
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
    res.json({ success: true, message: `Módulo ${moduloName} guardado` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ENDPOINTS DE RENDICIONES ---
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
      `INSERT INTO rendiciones (
        id, os, username_creador, area, fecha_sol, lugar_servicio, proyecto,
        fecha_salida, fecha_inicio, fecha_termino, dias_ope, ejecutivo,
        inspector1, inspector2, inspector3, hora_inicio, hora_fin,
        items_rendicion, total_gastado, viaticos, observaciones, detalles, realizado, estado, motivo_revision
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
      ON CONFLICT (id) DO UPDATE SET 
        area = EXCLUDED.area, fecha_sol = EXCLUDED.fecha_sol, lugar_servicio = EXCLUDED.lugar_servicio,
        proyecto = EXCLUDED.proyecto, fecha_salida = EXCLUDED.fecha_salida, fecha_inicio = EXCLUDED.fecha_inicio,
        fecha_termino = EXCLUDED.fecha_termino, dias_ope = EXCLUDED.dias_ope, ejecutivo = EXCLUDED.ejecutivo,
        inspector1 = EXCLUDED.inspector1, inspector2 = EXCLUDED.inspector2, inspector3 = EXCLUDED.inspector3,
        hora_inicio = EXCLUDED.hora_inicio, hora_fin = EXCLUDED.hora_fin, items_rendicion = EXCLUDED.items_rendicion,
        total_gastado = EXCLUDED.total_gastado, viaticos = EXCLUDED.viaticos, observaciones = EXCLUDED.observaciones,
        detalles = EXCLUDED.detalles, realizado = EXCLUDED.realizado, estado = EXCLUDED.estado, motivo_revision = EXCLUDED.motivo_revision`,
      [
        safeVal(r.id), safeVal(r.os), safeVal(r.username_creador), safeVal(r.area), safeVal(r.fecha_sol), safeVal(r.lugar_servicio), safeVal(r.proyecto),
        safeVal(r.fecha_salida), safeVal(r.fecha_inicio), safeVal(r.fecha_termino), safeVal(r.dias_ope), safeVal(r.ejecutivo),
        safeVal(r.inspector1), safeVal(r.inspector2), safeVal(r.inspector3), safeVal(r.hora_inicio), safeVal(r.hora_fin),
        JSON.stringify(r.items_rendicion || []), safeVal(r.total_gastado), safeVal(r.viaticos), 
        safeVal(r.observaciones), safeVal(r.detalles), safeVal(r.realizado), safeVal(r.estado), safeVal(r.motivo_revision)
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Error en rendiciones:", err); 
    res.status(500).json({ error: err.message }); 
  }
});

app.put('/api/rendiciones/:id/estado', async (req, res) => {
  const { estado, motivo_revision } = req.body;
  try {
    await pool.query('UPDATE rendiciones SET estado = $1, motivo_revision = $2 WHERE id = $3', [estado, motivo_revision, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ENDPOINTS DE VIÁTICOS ---
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
      `INSERT INTO viaticos (
        id, os, username_creador, area, fecha_sol, lugar_servicio, proyecto,
        fecha_salida, fecha_inicio, fecha_termino, dias_ope, ejecutivo,
        inspector1, inspector2, inspector3, hora_inicio, hora_fin,
        items_viatico, total, detalles, realizado, observaciones, estado, motivo_revision
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
      ON CONFLICT (id) DO UPDATE SET 
        area = EXCLUDED.area, fecha_sol = EXCLUDED.fecha_sol, lugar_servicio = EXCLUDED.lugar_servicio,
        proyecto = EXCLUDED.proyecto, fecha_salida = EXCLUDED.fecha_salida, fecha_inicio = EXCLUDED.fecha_inicio,
        fecha_termino = EXCLUDED.fecha_termino, dias_ope = EXCLUDED.dias_ope, ejecutivo = EXCLUDED.ejecutivo,
        inspector1 = EXCLUDED.inspector1, inspector2 = EXCLUDED.inspector2, inspector3 = EXCLUDED.inspector3,
        hora_inicio = EXCLUDED.hora_inicio, hora_fin = EXCLUDED.hora_fin, items_viatico = EXCLUDED.items_viatico,
        total = EXCLUDED.total, detalles = EXCLUDED.detalles, realizado = EXCLUDED.realizado,
        observaciones = EXCLUDED.observaciones, estado = EXCLUDED.estado, motivo_revision = EXCLUDED.motivo_revision`,
      [
        safeVal(r.id), safeVal(r.os), safeVal(r.username_creador), safeVal(r.area), safeVal(r.fecha_sol), safeVal(r.lugar_servicio), safeVal(r.proyecto),
        safeVal(r.fecha_salida), safeVal(r.fecha_inicio), safeVal(r.fecha_termino), safeVal(r.dias_ope), safeVal(r.ejecutivo),
        safeVal(r.inspector1), safeVal(r.inspector2), safeVal(r.inspector3), safeVal(r.hora_inicio), safeVal(r.hora_fin),
        JSON.stringify(r.items_viatico || []), safeVal(r.total), safeVal(r.detalles), safeVal(r.realizado), 
        safeVal(r.observaciones), safeVal(r.estado), safeVal(r.motivo_revision)
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Error en viaticos:", err);
    res.status(500).json({ error: err.message }); 
  }
});

app.put('/api/viaticos/:id/estado', async (req, res) => {
  const { estado, motivo_revision } = req.body;
  try {
    await pool.query('UPDATE viaticos SET estado = $1, motivo_revision = $2 WHERE id = $3', [estado, motivo_revision, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- VERIFICACIÓN DE EQUIPOS ---
app.get('/api/verificaciones/:os', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM verificaciones WHERE os = $1', [req.params.os]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/verificaciones', async (req, res) => {
  const r = req.body;
  try {
    await pool.query(
      `INSERT INTO verificaciones (
        id, os, equipo, marca, modelo, codigo, nro_serie,
        fecha_verificacion, calibracion_vigente, fecha_ultima_calibracion,
        estado_fisico, funcionamiento, control_operativo, anomalias
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO UPDATE SET
        os = EXCLUDED.os, equipo = EXCLUDED.equipo, marca = EXCLUDED.marca,
        modelo = EXCLUDED.modelo, codigo = EXCLUDED.codigo, nro_serie = EXCLUDED.nro_serie,
        fecha_verificacion = EXCLUDED.fecha_verificacion, calibracion_vigente = EXCLUDED.calibracion_vigente,
        fecha_ultima_calibracion = EXCLUDED.fecha_ultima_calibracion, estado_fisico = EXCLUDED.estado_fisico,
        funcionamiento = EXCLUDED.funcionamiento, control_operativo = EXCLUDED.control_operativo, anomalias = EXCLUDED.anomalias`,
      [
        safeVal(r.id), safeVal(r.os), safeVal(r.equipo), safeVal(r.marca), safeVal(r.modelo), safeVal(r.codigo), safeVal(r.nro_serie),
        safeVal(r.fecha_verificacion), safeVal(r.calibracion_vigente), safeVal(r.fecha_ultima_calibracion),
        JSON.stringify(r.estado_fisico || {}), JSON.stringify(r.funcionamiento || {}),
        JSON.stringify(r.control_operativo || {}), JSON.stringify(r.anomalias || [])
      ]
    );
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
      [JSON.stringify(r), safeVal(r.os)]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor PostgreSQL conectado y operando en el puerto ${PORT}`);
});
