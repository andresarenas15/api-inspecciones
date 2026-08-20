const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Aumentado a 50mb por la carga de fotos en Base64

// Conexión segura forzando IPv4
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  family: 4  
});

// FUNCIÓN DE SANEAMIENTO (ESTRICTA)
const safeVal = (v) => {
  if (v === undefined || v === null || v === '' || 
      String(v).trim().toLowerCase() === 'undefined' || 
      String(v).trim().toLowerCase() === 'null' || 
      String(v).trim().toLowerCase() === 'nan') {
    return null;
  }
  return v;
};

// FUNCIÓN PARA AGRUPAR SUFIJOS DINÁMICOS DESDE FLUTTER
const agruparSufijos = (payload, sufijoTarget, nombreArray) => {
  const arr = [];
  const regex = new RegExp(`^(.*)_${sufijoTarget}(\\d+)$`);
  
  Object.keys(payload).forEach(key => {
    const match = key.match(regex);
    if (match) {
      const prop = match[1];
      const index = parseInt(match[2]) - 1;
      
      if (!arr[index]) arr[index] = {};
      arr[index][prop] = payload[key];
      
      delete payload[key]; 
    }
  });
  
  const cleanArr = arr.filter(item => item !== null && item !== undefined);
  if (cleanArr.length > 0) payload[nombreArray] = cleanArr;
  
  return payload;
};

// ==========================================
// RUTAS DE USUARIOS Y ASIGNACIONES
// ==========================================
app.get('/api/usuarios', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM usuarios');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/usuarios', async (req, res) => {
  const { username, fullname, role, password } = req.body;
  try {
    const result = await pool.query('INSERT INTO usuarios (username, fullname, role, password) VALUES ($1, $2, $3, $4) RETURNING *', [username, fullname, role, password]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/usuarios/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/asignaciones/general', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM asignaciones');
    const asignacionesFix = result.rows.map(row => ({ ...row, reporteConfig: row.reporteconfig || row.reporteConfig || null }));
    res.json(asignacionesFix);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/asignaciones/:username', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM asignaciones WHERE LOWER(ins) = LOWER($1)', [req.params.username]);
    const asignacionesFix = result.rows.map(row => ({ ...row, reporteConfig: row.reporteconfig || row.reporteConfig || null }));
    res.json(asignacionesFix);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/asignaciones', async (req, res) => {
  const r = req.body;
  const osLimpia = safeVal(r.os);
  if (!osLimpia) return res.status(400).json({ error: "OS inválida o indefinida" });
  try {
    await pool.query(
      `INSERT INTO asignaciones (os, id, project, client, ins, start, "end", state, day, tasks, addresses, reporteConfig, progress)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (os) DO UPDATE SET state = $8, progress = $13, tasks = $10, reporteConfig = $12`,
      [osLimpia, r.id, r.project, r.client, r.ins, r.start, r.end, r.state, r.day, JSON.stringify(r.tasks), JSON.stringify(r.addresses), JSON.stringify(r.reporteConfig), r.progress]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 1. MÓDULO: VERIFICACIONES (_verN)
// ==========================================
app.get('/api/verificaciones/:os', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM verificaciones WHERE os = $1', [req.params.os]);
    res.json(result.rows.map(r => ({ ...r, ...(r.datos || {}) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/verificaciones', async (req, res) => {
  let r = req.body;
  const osLimpia = safeVal(r.os);
  if (!osLimpia) return res.status(400).json({ error: "OS inválida" });

  // Agrupamos la n cantidad de equipos
  r = agruparSufijos(r, 'ver', 'equipos');
  const equipos = r.equipos || [];
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Para evitar duplicados de la misma OS al reenviar, borramos e insertamos los nuevos
    await client.query('DELETE FROM verificaciones WHERE os = $1', [osLimpia]);

    for (let i = 0; i < equipos.length; i++) {
      const eq = equipos[i];
      const idVer = `${osLimpia}_ver_${i+1}`;
      
      const estado_fisico = {
        carcasa: eq.carcasa, estructura: eq.estructura, pantalla: eq.pantalla, 
        cables: eq.cables, conectores: eq.conect, bateria: eq.bat, 
        accesorios: eq.accesorios, comp_ext: eq.comp_ext, limpieza: eq.limpieza
      };

      const funcionamiento = {
        encendido: eq.encendido, funge: eq.funge, lectura: eq.lec, 
        medicion: eq.medi, botones: eq.boto, controles: eq.cont, 
        sensores: eq.sens, indicadores: eq.ind, comunicacion: eq.comun, 
        conexion: eq.conexion, aut_bat: eq.aut_bat
      };

      const control_operativo = {
        calib_vig: eq.calib_vig, fecha_ult_cal: eq.fecha_ult_cal, 
        cert_disp: eq.cert_disp, verificacion_previa: eq.ver, equi_apto: eq.equi_apto
      };

      const anomalias = [];
      if (eq.tipo_anom || eq.desc_anom || eq.foto) {
        anomalias.push({
          tipo_anomalia: eq.tipo_anom, descripcion: eq.desc_anom, 
          tipo_falla: eq.tipo_falla, accion_tomada: eq.accion, 
          motivo: eq.motivo, especificar_motivo: eq.esp_motivo, foto: eq.foto
        });
      }

      await client.query(
        `INSERT INTO verificaciones (
          id, os, equipo, marca, modelo, codigo, nro_serie,
          fecha_verificacion, calibracion_vigente, fecha_ultima_calibracion,
          estado_fisico, funcionamiento, control_operativo, anomalias, datos
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          idVer, osLimpia, safeVal(eq.equipo), safeVal(eq.marca), safeVal(eq.modelo), 
          safeVal(eq.codigo), safeVal(eq.numero_serie), safeVal(eq.fecha_verificacion), 
          safeVal(eq.calib_vig), safeVal(eq.fecha_ult_cal),
          JSON.stringify(estado_fisico), JSON.stringify(funcionamiento), 
          JSON.stringify(control_operativo), JSON.stringify(anomalias), JSON.stringify(eq)
        ]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) { 
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message }); 
  } finally {
    client.release();
  }
});

// ==========================================
// 2. MÓDULO: HOJA DE RUTA (_parN)
// ==========================================
app.get('/api/hoja-ruta/:os', async (req, res) => {
  try {
    const result = await pool.query('SELECT datos FROM hojas_ruta WHERE os = $1', [req.params.os]);
    if (result.rows.length > 0) res.json(result.rows[0].datos);
    else res.json(null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/hoja-ruta', async (req, res) => {
  let r = req.body;
  const osLimpia = safeVal(r.os);
  if (!osLimpia) return res.status(400).json({ error: "OS inválida" });

  r = agruparSufijos(r, 'par', 'paradas');

  try {
    await pool.query(`INSERT INTO hojas_ruta (os, datos) VALUES ($1, $2) ON CONFLICT (os) DO UPDATE SET datos = EXCLUDED.datos`, [osLimpia, JSON.stringify(r)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 3. MÓDULO: VIÁTICOS (_viaN)
// ==========================================
app.get('/api/viaticos/general', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM viaticos');
    res.json(result.rows.map(r => ({ ...r, ...(r.datos || {}) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/viaticos/:username', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM viaticos WHERE LOWER(username_creador) = LOWER($1)', [req.params.username]);
    res.json(result.rows.map(r => ({ ...r, ...(r.datos || {}) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/viaticos', async (req, res) => {
  let r = req.body;
  const osLimpia = safeVal(r.os);
  if (!osLimpia) return res.status(400).json({ error: "OS requerida para viáticos" });

  // Agrupamos los ítems _viaN
  r = agruparSufijos(r, 'via', 'items_viatico');

  // Traducción estricta: Flutter names -> Database names
  const area = safeVal(r.area);
  const lugar_servicio = safeVal(r.lugar_servicio);
  const proyecto = safeVal(r.proyecto) || safeVal(r.project);
  const fecha_sol = safeVal(r.fecha_solicitud_via) || safeVal(r.fecha_sol);
  const fecha_salida = safeVal(r.fecha_salida_via) || safeVal(r.fecha_salida);
  const fecha_inicio = safeVal(r.fecha_inicio_via) || safeVal(r.fecha_inicio);
  const fecha_termino = safeVal(r.fecha_termino_via) || safeVal(r.fecha_termino);
  const dias_ope = safeVal(r.dias_operativos_via) || safeVal(r.dias_ope);
  const ejecutivo = safeVal(r.ejecutivo_via) || safeVal(r.ejecutivo);
  const inspector1 = safeVal(r.monitorista1_via) || safeVal(r.inspector1);
  const inspector2 = safeVal(r.monitorista2_via) || safeVal(r.inspector2);
  const inspector3 = safeVal(r.monitorista3_via) || safeVal(r.inspector3);
  const hora_inicio = safeVal(r.hora_inicio_via) || safeVal(r.hora_inicio);
  const hora_fin = safeVal(r.hora_fin_via) || safeVal(r.hora_fin);
  const total = safeVal(r.total_via) || safeVal(r.total);
  const observaciones = safeVal(r.observaciones_via) || safeVal(r.observaciones);
  const realizado = safeVal(r.realizado_via) || safeVal(r.realizado);
  const estado = safeVal(r.estado) || 'Pendiente';

  try {
    await pool.query(
      `INSERT INTO viaticos (
        id, os, username_creador, area, fecha_sol, lugar_servicio, proyecto,
        fecha_salida, fecha_inicio, fecha_termino, dias_ope, ejecutivo,
        inspector1, inspector2, inspector3, hora_inicio, hora_fin,
        items_viatico, total, observaciones, realizado, estado, datos
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      ON CONFLICT (id) DO UPDATE SET 
        area = EXCLUDED.area, fecha_sol = EXCLUDED.fecha_sol, lugar_servicio = EXCLUDED.lugar_servicio,
        proyecto = EXCLUDED.proyecto, fecha_salida = EXCLUDED.fecha_salida, fecha_inicio = EXCLUDED.fecha_inicio,
        fecha_termino = EXCLUDED.fecha_termino, dias_ope = EXCLUDED.dias_ope, ejecutivo = EXCLUDED.ejecutivo,
        inspector1 = EXCLUDED.inspector1, inspector2 = EXCLUDED.inspector2, inspector3 = EXCLUDED.inspector3,
        hora_inicio = EXCLUDED.hora_inicio, hora_fin = EXCLUDED.hora_fin, items_viatico = EXCLUDED.items_viatico,
        total = EXCLUDED.total, observaciones = EXCLUDED.observaciones, realizado = EXCLUDED.realizado,
        estado = EXCLUDED.estado, datos = EXCLUDED.datos`,
      [
        safeVal(r.id), osLimpia, safeVal(r.username_creador), area, fecha_sol, lugar_servicio, proyecto,
        fecha_salida, fecha_inicio, fecha_termino, dias_ope, ejecutivo,
        inspector1, inspector2, inspector3, hora_inicio, hora_fin,
        JSON.stringify(r.items_viatico || []), total, observaciones, realizado, estado, JSON.stringify(r)
      ]
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

// ==========================================
// 4. MÓDULO: RENDICIONES (_renN)
// ==========================================
app.get('/api/rendiciones/general', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM rendiciones');
    res.json(result.rows.map(r => ({ ...r, ...(r.datos || {}) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/rendiciones/:username', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM rendiciones WHERE LOWER(username_creador) = LOWER($1)', [req.params.username]);
    res.json(result.rows.map(r => ({ ...r, ...(r.datos || {}) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/rendiciones', async (req, res) => {
  let r = req.body;
  const osLimpia = safeVal(r.os);
  if (!osLimpia) return res.status(400).json({ error: "OS requerida para rendición" });

  // Agrupamos los ítems _renN
  r = agruparSufijos(r, 'ren', 'items_rendicion');

  // Traducción estricta: Flutter names -> Database names
  const area = safeVal(r.area);
  const lugar_servicio = safeVal(r.lugar_servicio);
  const proyecto = safeVal(r.proyecto) || safeVal(r.project);
  const fecha_sol = safeVal(r.fecha_solicitud_ren) || safeVal(r.fecha_sol);
  const fecha_salida = safeVal(r.fecha_salida_ren) || safeVal(r.fecha_salida);
  const fecha_inicio = safeVal(r.fecha_inicio_ren) || safeVal(r.fecha_inicio);
  const fecha_termino = safeVal(r.fecha_termino_ren) || safeVal(r.fecha_termino);
  const dias_ope = safeVal(r.dias_operativos_ren) || safeVal(r.dias_ope);
  const ejecutivo = safeVal(r.ejecutivo_ren) || safeVal(r.ejecutivo);
  const inspector1 = safeVal(r.monitorista1_ren) || safeVal(r.inspector1);
  const inspector2 = safeVal(r.monitorista2_ren) || safeVal(r.inspector2);
  const inspector3 = safeVal(r.monitorista3_ren) || safeVal(r.inspector3);
  const hora_inicio = safeVal(r.hora_inicio_ren) || safeVal(r.hora_inicio);
  const hora_fin = safeVal(r.hora_fin_ren) || safeVal(r.hora_fin);
  const total_gastado = safeVal(r.total_gastado_ren) || safeVal(r.total_gastado);
  const viaticos_val = safeVal(r.total_via) || safeVal(r.viaticos);
  const observaciones = safeVal(r.observarciones_ren) || safeVal(r.observaciones); // Tolera el typo del prompt
  const realizado = safeVal(r.realizado_ren) || safeVal(r.realizado);
  const estado = safeVal(r.estado) || 'Pendiente';

  try {
    await pool.query(
      `INSERT INTO rendiciones (
        id, os, username_creador, area, fecha_sol, lugar_servicio, proyecto,
        fecha_salida, fecha_inicio, fecha_termino, dias_ope, ejecutivo,
        inspector1, inspector2, inspector3, hora_inicio, hora_fin,
        items_rendicion, total_gastado, viaticos, observaciones, realizado, estado, datos
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
      ON CONFLICT (id) DO UPDATE SET 
        area = EXCLUDED.area, fecha_sol = EXCLUDED.fecha_sol, lugar_servicio = EXCLUDED.lugar_servicio,
        proyecto = EXCLUDED.proyecto, fecha_salida = EXCLUDED.fecha_salida, fecha_inicio = EXCLUDED.fecha_inicio,
        fecha_termino = EXCLUDED.fecha_termino, dias_ope = EXCLUDED.dias_ope, ejecutivo = EXCLUDED.ejecutivo,
        inspector1 = EXCLUDED.inspector1, inspector2 = EXCLUDED.inspector2, inspector3 = EXCLUDED.inspector3,
        hora_inicio = EXCLUDED.hora_inicio, hora_fin = EXCLUDED.hora_fin, items_rendicion = EXCLUDED.items_rendicion,
        total_gastado = EXCLUDED.total_gastado, viaticos = EXCLUDED.viaticos, observaciones = EXCLUDED.observaciones,
        realizado = EXCLUDED.realizado, estado = EXCLUDED.estado, datos = EXCLUDED.datos`,
      [
        safeVal(r.id), osLimpia, safeVal(r.username_creador), area, fecha_sol, lugar_servicio, proyecto,
        fecha_salida, fecha_inicio, fecha_termino, dias_ope, ejecutivo,
        inspector1, inspector2, inspector3, hora_inicio, hora_fin,
        JSON.stringify(r.items_rendicion || []), total_gastado, viaticos_val, observaciones, realizado, estado, JSON.stringify(r)
      ]
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

// ==========================================
// 5. REPORTES Y SUBCONTRATAS (Básicos)
// ==========================================
app.get('/api/reporte-campo/:os', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reporte_campo WHERE os = $1', [req.params.os]);
    res.json(result.rows.map(r => ({ ...r, ...(r.datos || {}) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/reporte-campo', async (req, res) => {
  const r = req.body;
  if (!safeVal(r.os)) return res.status(400).json({ error: "OS inválida" });
  try {
    if (r.id) await pool.query('UPDATE reporte_campo SET reporte = $1, datos = $2 WHERE id = $3', [r.reporte, JSON.stringify(r), r.id]);
    else await pool.query('INSERT INTO reporte_campo (os, submatriz, parametro, punto, reporte, datos) VALUES ($1, $2, $3, $4, $5, $6)', [r.os, r.submatriz, r.parametro, r.punto, r.reporte, JSON.stringify(r)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/subcontratas', async (req, res) => {
  const r = req.body;
  if (!safeVal(r.os)) return res.status(400).json({ error: "OS inválida" });
  try {
    await pool.query('INSERT INTO subcontratas (os, datos) VALUES ($1, $2)', [r.os, JSON.stringify(r)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// ARRANQUE DEL SERVIDOR
// ==========================================
const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Servidor PostgreSQL conectado y operando en http://${HOST}:${PORT}`);
});
