const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, family: 4 });

const clean = v => {
  if (v === undefined || v === null || v === '') return null;
  return ['undefined', 'null', 'nan'].includes(String(v).trim().toLowerCase()) ? null : v;
};
const arr = v => Array.isArray(v) ? v : [];
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const num = v => { const n = Number(String(v ?? 0).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const status = v => String(v || 'PENDIENTE').trim().toUpperCase();
const js = v => JSON.stringify(v ?? null);
const fail = (res, e, tag) => { console.error(`[${tag}] status=ERROR message=${e.message}`); res.status(e.status || 500).json({ error: { code: e.status === 404 ? 'NOT_FOUND' : 'DATABASE_ERROR', message: e.message } }); };
const log = (tag, os, id, count = 1) => console.log(`[${tag}] os=${os} id=${id} registros=${count} status=OK`);

async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const value = await fn(c); await c.query('COMMIT'); return value; }
  catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}

async function osRow(c, code) {
  const q = await c.query(`SELECT o.id_os,o.codigo_os,a.* FROM ordenes_servicio o JOIN asignaciones a ON a.id_asignacion=o.id_asignacion WHERE o.codigo_os=$1`, [code]);
  if (!q.rows[0]) { const e = new Error(`OS ${code} no está asignada`); e.status = 404; throw e; }
  return q.rows[0];
}
async function syncOs(c, code) {
  await c.query(`INSERT INTO ordenes_servicio(id_asignacion,codigo_os) SELECT id_asignacion,os FROM asignaciones WHERE os=$1 ON CONFLICT(codigo_os) DO UPDATE SET id_asignacion=EXCLUDED.id_asignacion`, [code]);
  return osRow(c, code);
}

function flat(payload, prefix) {
  const out = new Map(), re = new RegExp(`^(.+)_${prefix}(\\d+)$`);
  Object.entries(payload).forEach(([k, v]) => { const m = k.match(re); if (m) { const n = Number(m[2]); if (!out.has(n)) out.set(n, {}); out.get(n)[k] = v; } });
  return out;
}
function children(payload, prefix) {
  const out = new Map(), re = new RegExp(`^(.+)_${prefix}(\\d+)_(\\d+)$`);
  Object.entries(payload).forEach(([k, v]) => { const m = k.match(re); if (!m) return; const p = Number(m[2]), n = Number(m[3]); if (!out.has(p)) out.set(p, new Map()); if (!out.get(p).has(n)) out.get(p).set(n, {}); out.get(p).get(n)[k] = v; });
  return out;
}
function arrayItems(input, prefix, numberName) {
  const out = new Map();
  arr(input).forEach((raw, i) => { if (!raw) return; const n = Number(raw[numberName] || raw.numero_item || i + 1); const data = obj(raw.items); if (Object.keys(data).length) out.set(n, data); else { const mapped = {}; Object.entries(raw).forEach(([k, v]) => { if (!k.startsWith('id_') && !k.startsWith('numero_') && !k.startsWith('__')) mapped[`${k}_${prefix}${n}`] = v; }); out.set(n, mapped); } });
  return out;
}
function alias(items, suffix) {
  const out = {};
  Object.entries(items || {}).forEach(([k, v]) => { out[k] = v; if (k.endsWith(suffix)) out[k.slice(0, -suffix.length)] = v; });
  return out;
}
function general(payload, prefix) {
  const out = {}, re = new RegExp(`_${prefix}\\d+$`);
  Object.entries(payload).forEach(([k, v]) => { if (!re.test(k) && !['id', 'items_viatico', 'items_rendicion', 'paradas', 'anomalias'].includes(k)) out[k] = v; });
  return out;
}
async function replace(c, { table, parentCol, numberCol, idCol, parentId, items }) {
  const ids = [];
  for (const [n, data] of [...items.entries()].sort((a, b) => a[0] - b[0])) {
    const q = await c.query(`INSERT INTO ${table}(${parentCol},${numberCol},items) VALUES($1,$2,$3) ON CONFLICT(${parentCol},${numberCol}) DO UPDATE SET items=EXCLUDED.items RETURNING ${idCol}`, [parentId, n, js(data)]);
    ids.push(q.rows[0][idCol]);
  }
  if (ids.length) await c.query(`DELETE FROM ${table} WHERE ${parentCol}=$1 AND NOT (${idCol}=ANY($2::uuid[]))`, [parentId, ids]);
  else await c.query(`DELETE FROM ${table} WHERE ${parentCol}=$1`, [parentId]);
  return ids;
}
async function file(c, type, entityId, name, mime, content) {
  if (!clean(content)) return;
  await c.query(`INSERT INTO archivos(entidad_tipo,entidad_id,nombre_archivo,mime_type,storage_path,contenido_base64) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(entidad_tipo,entidad_id,nombre_archivo) DO UPDATE SET contenido_base64=EXCLUDED.contenido_base64,mime_type=EXCLUDED.mime_type`, [type, entityId, name, mime, `db://archivos/${type}/${entityId}/${name}`, content]);
}

// Usuarios
const userView = r => ({ ...r, yape: r.celular, nombre: r.a_nombre || r.fullname });
app.get('/api/usuarios', async (_req, res) => { try { res.json((await pool.query('SELECT * FROM usuarios ORDER BY username')).rows.map(userView)); } catch (e) { fail(res, e, 'USUARIOS_LIST'); } });
app.post('/api/usuarios', async (req, res) => { const r = req.body; try { const q = await pool.query('INSERT INTO usuarios(username,fullname,nombres,apellidos,role,password,banco,cuenta,cci,celular,billetera,a_nombre,firma) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *', [r.username, r.fullname, r.nombres, r.apellidos, r.role, r.password, r.banco, r.cuenta, r.cci, r.celular, r.billetera, r.a_nombre, r.firma]); res.status(201).json(userView(q.rows[0])); } catch (e) { fail(res, e, 'USUARIOS_CREATE'); } });
app.put('/api/usuarios/:id', async (req, res) => { const r = req.body; try { const q = await pool.query('UPDATE usuarios SET username=$1,fullname=$2,nombres=$3,apellidos=$4,role=$5,password=$6,banco=$7,cuenta=$8,cci=$9,celular=$10,billetera=$11,a_nombre=$12,firma=COALESCE($13,firma) WHERE id=$14 RETURNING *', [r.username, r.fullname, r.nombres, r.apellidos, r.role, r.password, r.banco, r.cuenta, r.cci, r.celular, r.billetera, r.a_nombre, r.firma, req.params.id]); res.json(userView(q.rows[0])); } catch (e) { fail(res, e, 'USUARIOS_UPDATE'); } });
app.delete('/api/usuarios/:id', async (req, res) => { try { await pool.query('DELETE FROM usuarios WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch (e) { fail(res, e, 'USUARIOS_DELETE'); } });

// Asignaciones
const assignment = r => ({ ...r, order: r.os, reporteConfig: r.reporteconfig || null });
app.get('/api/asignaciones/general', async (_req, res) => { try { res.json((await pool.query('SELECT * FROM asignaciones ORDER BY start DESC NULLS LAST')).rows.map(assignment)); } catch (e) { fail(res, e, 'ASIGNACIONES_LIST'); } });
app.get('/api/asignaciones/:username', async (req, res) => { try { res.json((await pool.query('SELECT * FROM asignaciones WHERE LOWER(ins)=LOWER($1) ORDER BY start', [req.params.username])).rows.map(assignment)); } catch (e) { fail(res, e, 'ASIGNACIONES_USER'); } });
async function saveAssignment(c, r, id) {
  const params = [r.os, r.project, r.client, r.ins, clean(r.start), clean(r.end), r.state, r.day, js(r.tasks || []), js(r.addresses || []), js(r.reporteConfig), num(r.progress)];
  const q = id
    ? await c.query(`UPDATE asignaciones SET os=$1,project=$2,client=$3,ins=$4,start=$5,"end"=$6,state=$7,day=$8,tasks=$9,addresses=$10,reporteconfig=$11,progress=$12 WHERE id=$13 RETURNING *`, [...params, id])
    : await c.query(`INSERT INTO asignaciones(os,project,client,ins,start,"end",state,day,tasks,addresses,reporteconfig,progress) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(os) DO UPDATE SET project=EXCLUDED.project,client=EXCLUDED.client,ins=EXCLUDED.ins,start=EXCLUDED.start,"end"=EXCLUDED."end",state=EXCLUDED.state,day=EXCLUDED.day,tasks=EXCLUDED.tasks,addresses=EXCLUDED.addresses,reporteconfig=EXCLUDED.reporteconfig,progress=EXCLUDED.progress RETURNING *`, params);
  if (!q.rows[0]) { const e = new Error('Asignación no encontrada'); e.status = 404; throw e; }
  await syncOs(c, r.os); return q.rows[0];
}
app.post('/api/asignaciones', async (req, res) => { if (!clean(req.body.os)) return res.status(400).json({ error: { code: 'OS_REQUIRED', message: 'OS inválida' } }); try { res.status(201).json(assignment(await tx(c => saveAssignment(c, req.body)))); } catch (e) { fail(res, e, 'ASIGNACIONES_CREATE'); } });
app.put('/api/asignaciones/:id', async (req, res) => { try { res.json(assignment(await tx(c => saveAssignment(c, req.body, req.params.id)))); } catch (e) { fail(res, e, 'ASIGNACIONES_UPDATE'); } });
app.delete('/api/asignaciones/:id', async (req, res) => { try { await pool.query('DELETE FROM asignaciones WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch (e) { fail(res, e, 'ASIGNACIONES_DELETE'); } });

// Verificaciones y anomalías
async function readVerifications(c, os) {
  const rows = (await c.query('SELECT * FROM verificaciones_os WHERE id_os=$1 ORDER BY numero_verificacion', [os.id_os])).rows, out = [];
  for (const v of rows) {
    const an = (await c.query('SELECT * FROM anomalias_verificacion WHERE id_verificacion=$1 ORDER BY numero_anomalia', [v.id_verificacion])).rows;
    const item = { id: v.id_verificacion, id_verificacion: v.id_verificacion, os: os.codigo_os, instancia_n: v.numero_verificacion, ...alias(v.items, `_ver${v.numero_verificacion}`) };
    item.anomalias = an.map(a => ({ id_anomalia: a.id_anomalia, numero_anomalia: a.numero_anomalia, items: a.items, ...alias(a.items, `_ver${v.numero_verificacion}_${a.numero_anomalia}`) }));
    item.calibracion_vigente = item.calib_vig;
    item.fecha_ultima_calibracion = item.fecha_ult_cal;
    item.fotos = an.map(a => a.items[`foto_ver${v.numero_verificacion}_${a.numero_anomalia}`]).filter(Boolean);
    item.evidencias_evaluacion = Object.entries(v.items || {}).filter(([k, value]) => k.startsWith('foto_') && clean(value)).map(([campo, contenido]) => ({ campo, contenido }));
    item.detalle_anomalia = an.map(a => a.items[`desc_anom_ver${v.numero_verificacion}_${a.numero_anomalia}`]).filter(Boolean).join(' | ');
    an.forEach(a => Object.assign(item, a.items)); out.push(item);
  } return out;
}
app.get('/api/verificaciones/:os', async (req, res) => { try { res.json(await tx(async c => readVerifications(c, await osRow(c, req.params.os)))); } catch (e) { fail(res, e, 'VERIFICACIONES_LIST'); } });
app.post('/api/verificaciones', async (req, res) => {
  const r = req.body, code = clean(r.os), n = Number(r.instancia_n || 1); if (!code) return res.status(400).json({ error: { code: 'OS_REQUIRED', message: 'OS inválida' } });
  try { const saved = await tx(async c => {
    const os = await osRow(c, code), items = flat(r, 'ver').get(n) || obj(r.items);
    const q = await c.query(`INSERT INTO verificaciones_os(id_os,numero_verificacion,items) VALUES($1,$2,$3) ON CONFLICT(id_os,numero_verificacion) DO UPDATE SET items=EXCLUDED.items RETURNING id_verificacion`, [os.id_os, n, js(items)]);
    const id = q.rows[0].id_verificacion, anomalies = children(r, 'ver').get(n) || arrayItems(r.anomalias, 'anom', 'numero_anomalia');
    for (const [key, content] of Object.entries(items)) if (key.startsWith('foto_')) await file(c, 'verificacion', id, `${key}.jpg`, 'image/jpeg', content);
    const ids = await replace(c, { table: 'anomalias_verificacion', parentCol: 'id_verificacion', numberCol: 'numero_anomalia', idCol: 'id_anomalia', parentId: id, items: anomalies });
    let i = 0; for (const [m, data] of anomalies) await file(c, 'anomalia', ids[i++], `foto_ver${n}_${m}.jpg`, 'image/jpeg', data[`foto_ver${n}_${m}`]);
    return { id_verificacion: id, numero_verificacion: n };
  }); log('VERIFICACIONES_UPSERT', code, saved.id_verificacion); res.status(201).json({ success: true, ...saved }); } catch (e) { fail(res, e, 'VERIFICACIONES_UPSERT'); }
});

// Hoja de ruta y paradas
function stops(r) { const f = flat(r, 'par'); return f.size ? f : arrayItems(r.paradas, 'par', 'numero_parada'); }
async function readRoute(c, os) {
  const h = (await c.query('SELECT * FROM hojas_ruta_os WHERE id_os=$1', [os.id_os])).rows[0]; if (!h) return null;
  const ps = (await c.query('SELECT * FROM paradas_ruta WHERE id_hoja_ruta=$1 ORDER BY numero_parada', [h.id_hoja_ruta])).rows;
  const out = { id_hoja_ruta: h.id_hoja_ruta, os: os.codigo_os, ...h.datos_ruta, ...h.salida, ...h.estado };
  out.placa = out.placa_vehiculo;
  out.isHojaConcluida = out.is_hoja_concluida;
  out.isSalidaGuardada = out.is_salida_guardada;
  out.gpsSalida = out.gps_salida;
  out.foto_combustible = out.foto_comb;
  out.salida = { gps: out.gps_salida, fecha: out.fecha_hora_salida, hora: out.fecha_hora_salida, km: out.km_salida, foto_km: out.foto_km, foto_combustible: out.foto_comb };
  out.paradas = ps.map(p => { const a = alias(p.items, `_par${p.numero_parada}`); return { id_parada: p.id_parada, numero_parada: p.numero_parada, items: p.items, ...a, descripcion: a.descrip, gpsParada: a.gps, observacion: a.descrip, fecha_hora: a.fecha_hora, fechaHora: a.fecha_hora, fecha: a.fecha_hora, hora: a.fecha_hora }; }); ps.forEach(p => Object.assign(out, p.items)); return out;
}
app.get('/api/hoja-ruta/:os', async (req, res) => { try { res.json(await tx(async c => readRoute(c, await osRow(c, req.params.os)))); } catch (e) { fail(res, e, 'HOJA_RUTA_GET'); } });
app.post('/api/hoja-ruta', async (req, res) => {
  const r = req.body, code = clean(r.os); if (!code) return res.status(400).json({ error: { code: 'OS_REQUIRED', message: 'OS inválida' } });
  try { const saved = await tx(async c => {
    const os = await osRow(c, code), data = { proyecto: r.proyecto, fecha_salida_asignada: r.fecha_salida_asignada, conductor: r.conductor, responsable: r.responsable, placa_vehiculo: r.placa_vehiculo }, salida = { gps_salida: r.gps_salida, fecha_hora_salida: r.fecha_hora_salida, km_salida: r.km_salida, foto_km: r.foto_km, foto_comb: r.foto_comb }, state = { is_salida_guardada: !!r.is_salida_guardada, is_hoja_concluida: !!r.is_hoja_concluida };
    const q = await c.query(`INSERT INTO hojas_ruta_os(id_os,datos_ruta,salida,estado) VALUES($1,$2,$3,$4) ON CONFLICT(id_os) DO UPDATE SET datos_ruta=EXCLUDED.datos_ruta,salida=EXCLUDED.salida,estado=EXCLUDED.estado RETURNING id_hoja_ruta`, [os.id_os, js(data), js(salida), js(state)]);
    const id = q.rows[0].id_hoja_ruta;
    await file(c, 'hoja_ruta', id, 'foto_km.jpg', 'image/jpeg', r.foto_km);
    await file(c, 'hoja_ruta', id, 'foto_comb.jpg', 'image/jpeg', r.foto_comb);
    const collection = stops(r), ids = await replace(c, { table: 'paradas_ruta', parentCol: 'id_hoja_ruta', numberCol: 'numero_parada', idCol: 'id_parada', parentId: id, items: collection });
    let i = 0; for (const [n, dataStop] of collection) { const pid = ids[i++]; for (const key of ['foto', 'foto_precio', 'foto_combini', 'foto_combfin']) await file(c, 'parada', pid, `${key}_par${n}.jpg`, 'image/jpeg', dataStop[`${key}_par${n}`]); }
    return { id_hoja_ruta: id, paradas: ids.length };
  }); log('HOJA_RUTA_UPSERT', code, saved.id_hoja_ruta, saved.paradas); res.status(201).json({ success: true, ...saved }); } catch (e) { fail(res, e, 'HOJA_RUTA_UPSERT'); }
});

// Viáticos y rendiciones
function itemSet(r, prefix, name) { const f = flat(r, prefix); return f.size ? f : arrayItems(r[name], prefix, 'numero_item'); }
function total(set, prefix) { let value = 0; for (const [n, item] of set) value += num(item[`importe_${prefix}${n}`] ?? item.importe); return value; }
function viaGeneral(g) {
  const out = { ...g };
  out.fecha_solicitud_via = out.fecha_solicitud_via ?? out.fecha_sol;
  out.fecha_salida_via = out.fecha_salida_via ?? out.fecha_salida;
  out.fecha_inicio_via = out.fecha_inicio_via ?? out.fecha_inicio;
  out.fecha_termino_via = out.fecha_termino_via ?? out.fecha_termino;
  out.dias_operativos_via = out.dias_operativos_via ?? out.dias_ope;
  out.ejecutivo_via = out.ejecutivo_via ?? out.ejecutivo;
  out.monitorista1_via = out.monitorista1_via ?? out.inspector1;
  out.monitorista2_via = out.monitorista2_via ?? out.inspector2;
  out.monitorista3_via = out.monitorista3_via ?? out.inspector3;
  out.hora_inicio_via = out.hora_inicio_via ?? out.hora_inicio;
  out.hora_fin_via = out.hora_fin_via ?? out.hora_fin;
  out.observaciones_via = out.observaciones_via ?? out.observaciones;
  out.monitor_dep_via = out.monitor_dep_via ?? out.detalles;
  out.realizado_via = out.realizado_via ?? out.realizado;
  out.fecha_sol = out.fecha_sol ?? out.fecha_solicitud_via;
  out.fecha_salida = out.fecha_salida ?? out.fecha_salida_via;
  out.fecha_inicio = out.fecha_inicio ?? out.fecha_inicio_via;
  out.fecha_termino = out.fecha_termino ?? out.fecha_termino_via;
  out.dias_ope = out.dias_ope ?? out.dias_operativos_via;
  out.ejecutivo = out.ejecutivo ?? out.ejecutivo_via;
  out.inspector1 = out.inspector1 ?? out.monitorista1_via;
  out.inspector2 = out.inspector2 ?? out.monitorista2_via;
  out.inspector3 = out.inspector3 ?? out.monitorista3_via;
  out.hora_inicio = out.hora_inicio ?? out.hora_inicio_via;
  out.hora_fin = out.hora_fin ?? out.hora_fin_via;
  out.observaciones = out.observaciones ?? out.observaciones_via;
  out.detalles = out.detalles ?? out.monitor_dep_via;
  out.realizado = out.realizado ?? out.realizado_via;
  return out;
}
function renGeneral(g) {
  const out = { ...g };
  out.fecha_solicitud_ren = out.fecha_solicitud_ren ?? out.fecha_sol;
  out.fecha_salida_ren = out.fecha_salida_ren ?? out.fecha_salida;
  out.fecha_inicio_ren = out.fecha_inicio_ren ?? out.fecha_inicio;
  out.fecha_termino_ren = out.fecha_termino_ren ?? out.fecha_termino;
  out.dias_operativos_ren = out.dias_operativos_ren ?? out.dias_ope;
  out.ejecutivo_ren = out.ejecutivo_ren ?? out.ejecutivo;
  out.monitorista1_ren = out.monitorista1_ren ?? out.inspector1;
  out.monitorista2_ren = out.monitorista2_ren ?? out.inspector2;
  out.monitorista3_ren = out.monitorista3_ren ?? out.inspector3;
  out.hora_inicio_ren = out.hora_inicio_ren ?? out.hora_inicio;
  out.hora_fin_ren = out.hora_fin_ren ?? out.hora_fin;
  out.observarciones_ren = out.observarciones_ren ?? out.observaciones;
  out.monitor_dep_ren = out.monitor_dep_ren ?? out.detalles;
  out.realizado_ren = out.realizado_ren ?? out.realizado;
  out.fecha_sol = out.fecha_sol ?? out.fecha_solicitud_ren;
  out.fecha_salida = out.fecha_salida ?? out.fecha_salida_ren;
  out.fecha_inicio = out.fecha_inicio ?? out.fecha_inicio_ren;
  out.fecha_termino = out.fecha_termino ?? out.fecha_termino_ren;
  out.dias_ope = out.dias_ope ?? out.dias_operativos_ren;
  out.ejecutivo = out.ejecutivo ?? out.ejecutivo_ren;
  out.inspector1 = out.inspector1 ?? out.monitorista1_ren;
  out.inspector2 = out.inspector2 ?? out.monitorista2_ren;
  out.inspector3 = out.inspector3 ?? out.monitorista3_ren;
  out.hora_inicio = out.hora_inicio ?? out.hora_inicio_ren;
  out.hora_fin = out.hora_fin ?? out.hora_fin_ren;
  out.observaciones = out.observaciones ?? out.observarciones_ren;
  out.detalles = out.detalles ?? out.monitor_dep_ren;
  out.realizado = out.realizado ?? out.realizado_ren;
  return out;
}
async function readVia(c, os) {
  const v = (await c.query('SELECT * FROM solicitudes_viatico WHERE id_os=$1', [os.id_os])).rows[0]; if (!v) return null;
  const items = (await c.query('SELECT * FROM items_viatico WHERE id_solicitud_viatico=$1 ORDER BY numero_item', [v.id_solicitud_viatico])).rows;
  const out = { id: v.id_solicitud_viatico, id_solicitud_viatico: v.id_solicitud_viatico, os: os.codigo_os, username_creador: v.username_creador, ...viaGeneral(v.datos_generales), total: num(v.total_via), total_via: num(v.total_via), estado: status(v.estado), motivo_revision: v.motivo_revision };
  out.items_viatico = items.map(i => ({ id_item_viatico: i.id_item_viatico, numero_item: i.numero_item, items: i.items, ...alias(i.items, `_via${i.numero_item}`) })); items.forEach(i => Object.assign(out, i.items)); return out;
}
async function saveVia(c, r) {
  const os = await osRow(c, r.os), set = itemSet(r, 'via', 'items_viatico'), amount = total(set, 'via'), g = viaGeneral(general(r, 'via'));
  const q = await c.query(`INSERT INTO solicitudes_viatico(id_os,username_creador,datos_generales,total_via,estado,motivo_revision) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id_os) DO UPDATE SET username_creador=EXCLUDED.username_creador,datos_generales=EXCLUDED.datos_generales,total_via=EXCLUDED.total_via,estado=EXCLUDED.estado,motivo_revision=EXCLUDED.motivo_revision RETURNING id_solicitud_viatico`, [os.id_os, r.username_creador, js(g), amount, 'PENDIENTE', null]);
  const id = q.rows[0].id_solicitud_viatico;
  await replace(c, { table: 'items_viatico', parentCol: 'id_solicitud_viatico', numberCol: 'numero_item', idCol: 'id_item_viatico', parentId: id, items: set });
  await c.query('UPDATE rendiciones_os SET total_via=$2,devolver_ren=$2-total_gastado_ren WHERE id_os=$1', [os.id_os, amount]);
  return { id_solicitud_viatico: id, total_via: amount };
}
async function readRen(c, os) {
  const r = (await c.query('SELECT * FROM rendiciones_os WHERE id_os=$1', [os.id_os])).rows[0]; if (!r) return null;
  const items = (await c.query('SELECT * FROM items_rendicion WHERE id_rendicion=$1 ORDER BY numero_item', [r.id_rendicion])).rows;
  const out = { id: r.id_rendicion, id_rendicion: r.id_rendicion, os: os.codigo_os, username_creador: r.username_creador, ...renGeneral(r.datos_generales), total_gastado: num(r.total_gastado_ren), total_gastado_ren: num(r.total_gastado_ren), viaticos: r.total_via, total_via: r.total_via, devolver_ren: r.devolver_ren, estado: status(r.estado), motivo_revision: r.motivo_revision };
  out.items_rendicion = items.map(i => { const a = alias(i.items, `_ren${i.numero_item}`), attached = arr(a.adjuntos); return { id_item_rendicion: i.id_item_rendicion, numero_item: i.numero_item, items: i.items, ...a, nro_comprobante: a.num_comprobante, archivo_base64: a.archivo_base64 || attached[0] || null, archivo_pdf_base64: a.archivo_pdf_base64 || attached[1] || null }; }); items.forEach(i => Object.assign(out, i.items)); return out;
}
async function saveRen(c, r) {
  const os = await osRow(c, r.os), set = itemSet(r, 'ren', 'items_rendicion'), spent = total(set, 'ren'), g = renGeneral(general(r, 'ren')), via = (await c.query('SELECT total_via FROM solicitudes_viatico WHERE id_os=$1', [os.id_os])).rows[0], deposited = via ? via.total_via : null, back = deposited === null ? null : num(deposited) - spent;
  const q = await c.query(`INSERT INTO rendiciones_os(id_os,username_creador,datos_generales,total_gastado_ren,total_via,devolver_ren,estado,motivo_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id_os) DO UPDATE SET username_creador=EXCLUDED.username_creador,datos_generales=EXCLUDED.datos_generales,total_gastado_ren=EXCLUDED.total_gastado_ren,total_via=EXCLUDED.total_via,devolver_ren=EXCLUDED.devolver_ren,estado=EXCLUDED.estado,motivo_revision=EXCLUDED.motivo_revision RETURNING id_rendicion`, [os.id_os, r.username_creador, js(g), spent, deposited, back, 'PENDIENTE', null]);
  const id = q.rows[0].id_rendicion, ids = await replace(c, { table: 'items_rendicion', parentCol: 'id_rendicion', numberCol: 'numero_item', idCol: 'id_item_rendicion', parentId: id, items: set });
  let i = 0; for (const [n, item] of set) {
    const itemId = ids[i++], stored = [];
    const image = item[`archivo_base64_ren${n}`] || item.archivo_base64, pdf = item[`archivo_pdf_base64_ren${n}`] || item.archivo_pdf_base64;
    if (clean(image)) stored.push({ content: image, mime: 'image/jpeg' });
    if (clean(pdf)) stored.push({ content: pdf, mime: 'application/pdf' });
    if (!stored.length) arr(item[`adjuntos_ren${n}`] || item.adjuntos).forEach((content, index) => stored.push({ content, mime: index === 1 ? 'application/pdf' : 'image/jpeg' }));
    for (let a = 0; a < stored.length; a++) await file(c, 'item_rendicion', itemId, `adjunto_ren${n}_${a + 1}`, stored[a].mime, stored[a].content);
  }
  return { id_rendicion: id, total_gastado_ren: spent, total_via: deposited, devolver_ren: back };
}
async function listBy(c, table, userColumn, user, reader) {
  const q = user ? await c.query(`SELECT o.* FROM ${table} x JOIN ordenes_servicio o ON o.id_os=x.id_os WHERE LOWER(x.${userColumn})=LOWER($1)`, [user]) : await c.query(`SELECT o.* FROM ${table} x JOIN ordenes_servicio o ON o.id_os=x.id_os ORDER BY x.actualizado_en DESC`);
  const out = []; for (const os of q.rows) out.push(await reader(c, os)); return out;
}
app.get('/api/viaticos/general', async (_req, res) => { try { res.json(await tx(c => listBy(c, 'solicitudes_viatico', 'username_creador', null, readVia))); } catch (e) { fail(res, e, 'VIATICOS_GENERAL'); } });
app.get('/api/viaticos/os/:os', async (req, res) => { try { const v = await tx(async c => readVia(c, await osRow(c, req.params.os))); res.json(v ? [v] : []); } catch (e) { fail(res, e, 'VIATICOS_OS'); } });
app.get('/api/viaticos/:username', async (req, res) => { try { res.json(await tx(c => listBy(c, 'solicitudes_viatico', 'username_creador', req.params.username, readVia))); } catch (e) { fail(res, e, 'VIATICOS_USER'); } });
app.post('/api/viaticos', async (req, res) => { try { const s = await tx(c => saveVia(c, req.body)); log('VIATICOS_UPSERT', req.body.os, s.id_solicitud_viatico); res.status(201).json({ success: true, id: s.id_solicitud_viatico, ...s }); } catch (e) { fail(res, e, 'VIATICOS_UPSERT'); } });
app.put('/api/viaticos/:id', async (req, res) => { try { const s = await tx(async c => { const os = await osRow(c, req.body.os); const current = (await c.query('SELECT id_solicitud_viatico FROM solicitudes_viatico WHERE id_os=$1', [os.id_os])).rows[0]; if (!current || current.id_solicitud_viatico !== req.params.id) { const e = new Error('La solicitud no corresponde a la OS'); e.status = 409; throw e; } return saveVia(c, req.body); }); res.json({ success: true, id: s.id_solicitud_viatico, ...s }); } catch (e) { fail(res, e, 'VIATICOS_UPDATE'); } });
app.put('/api/viaticos/:id/estado', async (req, res) => { try { res.json((await pool.query('UPDATE solicitudes_viatico SET estado=$1,motivo_revision=$2 WHERE id_solicitud_viatico=$3 RETURNING *', [status(req.body.estado), req.body.motivo_revision, req.params.id])).rows[0]); } catch (e) { fail(res, e, 'VIATICOS_ESTADO'); } });
app.get('/api/rendiciones/general', async (_req, res) => { try { res.json(await tx(c => listBy(c, 'rendiciones_os', 'username_creador', null, readRen))); } catch (e) { fail(res, e, 'RENDICIONES_GENERAL'); } });
app.get('/api/rendiciones/os/:os', async (req, res) => { try { const r = await tx(async c => readRen(c, await osRow(c, req.params.os))); res.json(r ? [r] : []); } catch (e) { fail(res, e, 'RENDICIONES_OS'); } });
app.get('/api/rendiciones/:username', async (req, res) => { try { res.json(await tx(c => listBy(c, 'rendiciones_os', 'username_creador', req.params.username, readRen))); } catch (e) { fail(res, e, 'RENDICIONES_USER'); } });
app.post('/api/rendiciones', async (req, res) => { try { const s = await tx(c => saveRen(c, req.body)); log('RENDICIONES_UPSERT', req.body.os, s.id_rendicion); res.status(201).json({ success: true, id: s.id_rendicion, ...s }); } catch (e) { fail(res, e, 'RENDICIONES_UPSERT'); } });
app.put('/api/rendiciones/:id', async (req, res) => { try { const s = await tx(async c => { const os = await osRow(c, req.body.os); const current = (await c.query('SELECT id_rendicion FROM rendiciones_os WHERE id_os=$1', [os.id_os])).rows[0]; if (!current || current.id_rendicion !== req.params.id) { const e = new Error('La rendición no corresponde a la OS'); e.status = 409; throw e; } return saveRen(c, req.body); }); res.json({ success: true, id: s.id_rendicion, ...s }); } catch (e) { fail(res, e, 'RENDICIONES_UPDATE'); } });
app.put('/api/rendiciones/:id/estado', async (req, res) => { try { res.json((await pool.query('UPDATE rendiciones_os SET estado=$1,motivo_revision=$2 WHERE id_rendicion=$3 RETURNING *', [status(req.body.estado), req.body.motivo_revision, req.params.id])).rows[0]); } catch (e) { fail(res, e, 'RENDICIONES_ESTADO'); } });

// Reportes, subcontrata y agregado OS
const reportView = r => ({ ...(r.datos || {}), ...r, descripcion: (r.datos || {}).descripcion || '' });
app.get('/api/reporte-campo/:os/:parametro', async (req, res) => { try {
  const args = [req.params.os, req.params.parametro], clauses = ['os=$1', 'parametro=$2'];
  const matrix = clean(req.query.matriz), submatrix = clean(req.query.submatriz);
  if (matrix) { args.push(matrix); clauses.push(`matriz=$${args.length}`); }
  if (submatrix) { args.push(submatrix); clauses.push(`submatriz=$${args.length}`); }
  res.json((await pool.query(`SELECT * FROM reporte_campo WHERE ${clauses.join(' AND ')} ORDER BY creado_en,id`, args)).rows.map(reportView));
} catch (e) { fail(res, e, 'REPORTE_PARAM'); } });
app.get('/api/reporte-campo/:os', async (req, res) => { try { res.json((await pool.query('SELECT * FROM reporte_campo WHERE os=$1 ORDER BY submatriz,parametro,creado_en,id', [req.params.os])).rows.map(reportView)); } catch (e) { fail(res, e, 'REPORTE_GET'); } });
app.post('/api/reporte-campo', async (req, res) => { const r = req.body; try { const saved = await tx(async c => {
  const os = await osRow(c, r.os), data = js({ ...r, descripcion: clean(r.descripcion) || '' });
  if (clean(r.id)) {
    const q = await c.query(`UPDATE reporte_campo SET matriz=$1,submatriz=$2,parametro=$3,punto=$4,reporte=$5,datos=$6 WHERE id=$7 AND id_os=$8 RETURNING *`, [r.matriz, r.submatriz, r.parametro, r.punto, r.reporte, data, r.id, os.id_os]);
    if (!q.rows[0]) { const e = new Error('Punto de reporte no encontrado para la OS'); e.status = 404; throw e; }
    return q.rows[0];
  }
  return (await c.query(`INSERT INTO reporte_campo(id_os,os,matriz,submatriz,parametro,punto,reporte,datos) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id_os,submatriz,parametro,punto) DO UPDATE SET matriz=EXCLUDED.matriz,reporte=EXCLUDED.reporte,datos=EXCLUDED.datos RETURNING *`, [os.id_os, r.os, r.matriz, r.submatriz, r.parametro, r.punto, r.reporte, data])).rows[0];
}); res.status(201).json(reportView(saved)); } catch (e) { fail(res, e, 'REPORTE_UPSERT'); } });
app.post('/api/subcontratas', async (req, res) => { const r = req.body; try { const saved = await tx(async c => { const os = await osRow(c, r.os); return (await c.query(`INSERT INTO subcontratas(id_os,os,datos) VALUES($1,$2,$3) ON CONFLICT(id_os) DO UPDATE SET datos=EXCLUDED.datos RETURNING *`, [os.id_os, r.os, js(r)])).rows[0]; }); res.status(201).json(saved); } catch (e) { fail(res, e, 'SUBCONTRATA_UPSERT'); } });
app.get('/api/os/:os', async (req, res) => { try { res.json(await tx(async c => { const os = await osRow(c, req.params.os); return { os: assignment(os), verificaciones: await readVerifications(c, os), hoja_ruta: await readRoute(c, os), viaticos: await readVia(c, os), rendicion: await readRen(c, os), reportes_campo: (await c.query('SELECT * FROM reporte_campo WHERE id_os=$1', [os.id_os])).rows, subcontrata: (await c.query('SELECT * FROM subcontratas WHERE id_os=$1', [os.id_os])).rows[0] || null }; })); } catch (e) { fail(res, e, 'OS_AGREGADO'); } });

app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: `Ruta ${req.method} ${req.path} no existe` } }));
const PORT = process.env.PORT || 10000;
if (require.main === module) app.listen(PORT, '0.0.0.0', () => console.log(`Servidor relacional activo en puerto ${PORT}`));
module.exports = { app, pool, flat, children, arrayItems, alias, viaGeneral, renGeneral, itemSet, total };
