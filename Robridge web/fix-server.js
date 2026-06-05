const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// 1. user_devices missing workspace_id
code = code.replace(
  'user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,',
  'user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,\n        workspace_id INTEGER,'
);

// 2. DELETE /api/devices/:deviceId missing userId
code = code.replace(
  "const { deviceId } = req.params;\n    const wsId = req.workspace_id;",
  "const { deviceId } = req.params;\n    const wsId = req.workspace_id;\n    const userId = req.user.id;"
);

// 3. POST /api/ims/production/scan increment built_qty
code = code.replace(
  "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,\n      [req.workspace_id, req.user.id, woId||null, barcode, itemName||barcode, stageId, stageName||'', outcome, Number(qty)||1, batchNo||null, notes||null]\n    );",
  "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,\n      [req.workspace_id, req.user.id, woId||null, barcode, itemName||barcode, stageId, stageName||'', outcome, Number(qty)||1, batchNo||null, notes||null]\n    );\n    \n    if (woId && outcome === 'FORWARD') {\n      await client.query('UPDATE ims_workorders SET built_qty = built_qty + $1 WHERE id = $2 AND workspace_id = $3', [Number(qty)||1, woId, req.workspace_id]);\n    }"
);

// 4. POST /api/ims/workorders BOM qty parsing
code = code.replace(
  "[woId, b.barcode, b.name||b.barcode, Number(b.qty)*Number(targetQty), avail.rows[0]?.stock||0, b.unit||'pcs']",
  "[woId, b.barcode, b.name||b.barcode, Number(b.qty || b.needed || b.quantity || 1)*Number(targetQty), avail.rows[0]?.stock||0, b.unit||'pcs']"
);

// 5. PUT /api/ims/workorders/:id/status
code = code.replace(
  "if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Work order not found' });\n    const w = result.rows[0];",
  "if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Work order not found' });\n    const w = result.rows[0];\n    if (w.status === 'CANCELLED' && status === 'COMPLETE') return res.status(400).json({ success: false, error: 'Cannot complete a cancelled work order' });"
);

code = code.replace(
  "UPDATE ims_items SET stock = stock + $1, updated_at=CURRENT_TIMESTAMP WHERE barcode=$2 AND workspace_id=$3`,\n          [w.target_qty, w.product_barcode, req.workspace_id]",
  "UPDATE ims_items SET stock = stock + $1, updated_at=CURRENT_TIMESTAMP WHERE barcode=$2 AND workspace_id=$3`,\n          [builtQty !== undefined ? builtQty : w.built_qty, w.product_barcode, req.workspace_id]"
);

code = code.replace(
  "UPDATE ims_workorders SET status=$1, built_qty=COALESCE($2,built_qty), updated_at=CURRENT_TIMESTAMP WHERE id=$3`,\n      [status, builtQty||null, req.params.id]",
  "UPDATE ims_workorders SET status=$1, built_qty=COALESCE($2,built_qty), updated_at=CURRENT_TIMESTAMP WHERE id=$3`,\n      [status, builtQty !== undefined ? builtQty : null, req.params.id]"
);

// 6. DELETE /api/ims/workorders/:id checking status
code = code.replace(
  "app.delete('/api/ims/workorders/:id', authenticateToken, requireWorkspace, requireRole(['manager','admin','owner']), async (req, res) => {\n  try {\n    await pool.query('DELETE FROM ims_wo_items WHERE wo_id=$1', [req.params.id]);",
  "app.delete('/api/ims/workorders/:id', authenticateToken, requireWorkspace, requireRole(['manager','admin','owner']), async (req, res) => {\n  try {\n    const chk = await pool.query('SELECT status FROM ims_workorders WHERE id=$1 AND workspace_id=$2', [req.params.id, req.workspace_id]);\n    if (chk.rows.length && chk.rows[0].status === 'COMPLETE') return res.status(400).json({ success: false, error: 'Cannot delete completed work order' });\n    await pool.query('DELETE FROM ims_wo_items WHERE wo_id=$1', [req.params.id]);"
);

// 7. GET /api/ims/grn/:id/items workspace isolation
code = code.replace(
  "SELECT * FROM ims_grn_items WHERE grn_id=$1",
  "SELECT i.* FROM ims_grn_items i JOIN ims_grn g ON g.id = i.grn_id WHERE i.grn_id=$1 AND g.workspace_id=$2"
);

code = code.replace(
  "pool.query(`SELECT * FROM ims_grn_items WHERE grn_id=$1`, [req.params.id]);",
  "pool.query(`SELECT i.* FROM ims_grn_items i JOIN ims_grn g ON g.id = i.grn_id WHERE i.grn_id=$1 AND g.workspace_id=$2`, [req.params.id, req.workspace_id]);"
);

// 8. POST /api/ims/grn add transactions
code = code.replace(
  "app.post('/api/ims/grn', authenticateToken, requireWorkspace, async (req, res) => {\n  try {\n    const { docNo, type, supplier, poRef, vehicleNo, notes, items } = req.body;",
  "app.post('/api/ims/grn', authenticateToken, requireWorkspace, async (req, res) => {\n  const client = await pool.connect();\n  try {\n    await client.query('BEGIN');\n    const { docNo, type, supplier, poRef, vehicleNo, notes, items } = req.body;\n    if (!['INWARD', 'OUTWARD'].includes(type)) return res.status(400).json({ success: false, error: 'Invalid type' });"
);
// replace pool with client inside POST /api/ims/grn
let grnPostRegex = /const prefix = type === 'INWARD' \? 'GRN' : 'DN';([\s\S]*?)res\.json\(\{ success: true, grn: grn\.rows\[0\] \}\);\n  \} catch \(e\) \{ res\.status\(500\)\.json/m;
let match = code.match(grnPostRegex);
if (match) {
  let inner = match[1].replace(/pool\.query/g, 'client.query');
  code = code.replace(grnPostRegex, `const prefix = type === 'INWARD' ? 'GRN' : 'DN';${inner}await client.query('COMMIT');\n    res.json({ success: true, grn: grn.rows[0] });\n  } catch (e) { await client.query('ROLLBACK'); res.status(500).json`);
}

// 9. POST /api/ims/grn/:id/approve & reject roles
code = code.replace(
  "app.post('/api/ims/grn/:id/approve', authenticateToken, requireWorkspace, async (req, res) => {",
  "app.post('/api/ims/grn/:id/approve', authenticateToken, requireWorkspace, requireRole(['manager','admin','owner']), async (req, res) => {"
);
code = code.replace(
  "app.post('/api/ims/grn/:id/reject', authenticateToken, requireWorkspace, async (req, res) => {",
  "app.post('/api/ims/grn/:id/reject', authenticateToken, requireWorkspace, requireRole(['manager','admin','owner']), async (req, res) => {"
);

// 10. POST /api/ims/grn/:id/reject PENDING check
code = code.replace(
  "app.post('/api/ims/grn/:id/reject', authenticateToken, requireWorkspace, requireRole(['manager','admin','owner']), async (req, res) => {\n  try {\n    await pool.query(",
  "app.post('/api/ims/grn/:id/reject', authenticateToken, requireWorkspace, requireRole(['manager','admin','owner']), async (req, res) => {\n  try {\n    const chk = await pool.query('SELECT status FROM ims_grn WHERE id=$1 AND workspace_id=$2', [req.params.id, req.workspace_id]);\n    if (!chk.rows.length || chk.rows[0].status !== 'PENDING') return res.status(400).json({ success: false, error: 'Only PENDING GRNs can be rejected' });\n    await pool.query("
);

// 11. GET /api/ims/locations/:id/stock ownership check
code = code.replace(
  "WHERE s.location_id=$1 ORDER BY s.updated_at DESC`,",
  "JOIN ims_locations l ON l.id = s.location_id WHERE s.location_id=$1 AND l.workspace_id=$2 ORDER BY s.updated_at DESC`,"
);
code = code.replace(
  "SELECT s.*, i.name as item_name, i.category\n       FROM ims_location_stock s\n       LEFT JOIN ims_items i ON i.barcode=s.barcode AND i.workspace_id=$2\n       WHERE s.location_id=$1 ORDER BY s.updated_at DESC`,",
  "SELECT s.*, i.name as item_name, i.category\n       FROM ims_location_stock s\n       LEFT JOIN ims_items i ON i.barcode=s.barcode AND i.workspace_id=$2\n       JOIN ims_locations l ON l.id = s.location_id\n       WHERE s.location_id=$1 AND l.workspace_id=$2 ORDER BY s.updated_at DESC`,"
);

// 12. PUT /api/ims/locations/:id validation
code = code.replace(
  "const { name, type, description } = req.body;",
  "const { name, type, description } = req.body;\n    if (!name) return res.status(400).json({ success: false, error: 'Name required' });"
);

// 13. DELETE /api/ims/locations/:id transaction
code = code.replace(
  "app.delete('/api/ims/locations/:id', authenticateToken, requireWorkspace, async (req, res) => {\n  try {\n    await pool.query('DELETE FROM ims_location_stock WHERE location_id=$1', [req.params.id]);\n    await pool.query('DELETE FROM ims_locations WHERE id=$1 AND workspace_id=$2', [req.params.id, req.workspace_id]);\n    res.json({ success: true });\n  } catch (e) { res.status(500).json({ success: false, error: e.message }); }\n});",
  "app.delete('/api/ims/locations/:id', authenticateToken, requireWorkspace, async (req, res) => {\n  const client = await pool.connect();\n  try {\n    await client.query('BEGIN');\n    await client.query('DELETE FROM ims_location_stock WHERE location_id=$1', [req.params.id]);\n    await client.query('DELETE FROM ims_locations WHERE id=$1 AND workspace_id=$2', [req.params.id, req.workspace_id]);\n    await client.query('COMMIT');\n    res.json({ success: true });\n  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ success: false, error: e.message }); } finally { client.release(); }\n});"
);

fs.writeFileSync('server.js', code);
console.log('Fixed server.js');
