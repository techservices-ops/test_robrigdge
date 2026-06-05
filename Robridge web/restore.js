const fs = require('fs');
let lines = fs.readFileSync('server.js', 'utf8').split('\n');

// Find the broken section: starts at the orphaned 'try {' after POST /api/ims/grn closes
// Lines 6019-6028 (0-indexed: 6018-6027) are the orphaned approve body
// We need to replace lines 6018-6035 (0-indexed) with the full correct routes

const orphanStart = lines.findIndex((l, i) => i >= 6017 && l.trim() === 'try {');
const rejectEnd = lines.findIndex((l, i) => i >= orphanStart && l.includes("status='REJECTED'"));
const rejectClose = lines.findIndex((l, i) => i >= rejectEnd && l.trim() === '});');

console.log('Orphan start (0-idx):', orphanStart, '| line:', orphanStart+1);
console.log('Reject end (0-idx):', rejectEnd, '| line:', rejectEnd+1);
console.log('Reject close (0-idx):', rejectClose, '| line:', rejectClose+1);

const correctRoutes = [
`app.post('/api/ims/grn/:id/approve', authenticateToken, requireWorkspace, requireRole(['manager','admin','owner']), async (req, res) => {`,
`  const client = await pool.connect();`,
`  try {`,
`    const grn = await client.query('SELECT * FROM ims_grn WHERE id=$1 AND workspace_id=$2', [req.params.id, req.workspace_id]);`,
`    if (!grn.rows.length) return res.status(404).json({ success: false, error: 'GRN not found' });`,
`    const g = grn.rows[0];`,
`    if (g.status !== 'PENDING') return res.status(400).json({ success: false, error: 'Already processed' });`,
`    await client.query('BEGIN');`,
`    const items = await client.query('SELECT * FROM ims_grn_items WHERE grn_id=$1', [req.params.id]);`,
`    for (const it of items.rows) {`,
`      const qty = Number(it.received_qty);`,
`      if (g.type === 'INWARD') {`,
"        await client.query(`UPDATE ims_items SET stock=stock+$1,updated_at=CURRENT_TIMESTAMP WHERE barcode=$2 AND workspace_id=$3`, [qty, it.barcode, req.workspace_id]);",
"        await client.query(`INSERT INTO ims_scan_events (user_id,workspace_id,barcode,item_name,workflow,quantity,notes) VALUES ($1,$2,$3,$4,'RECEIVE',$5,'GRN:'||$6)`, [req.user.id, req.workspace_id, it.barcode, it.name, qty, g.doc_no]);",
`      } else {`,
"        await client.query(`UPDATE ims_items SET stock=GREATEST(stock-$1,0),updated_at=CURRENT_TIMESTAMP WHERE barcode=$2 AND workspace_id=$3`, [qty, it.barcode, req.workspace_id]);",
"        await client.query(`INSERT INTO ims_scan_events (user_id,workspace_id,barcode,item_name,workflow,quantity,notes) VALUES ($1,$2,$3,$4,'DISPATCH',$5,'DN:'||$6)`, [req.user.id, req.workspace_id, it.barcode, it.name, qty, g.doc_no]);",
`      }`,
`    }`,
"    await client.query(`UPDATE ims_grn SET status='APPROVED',approved_by=$1,approved_at=CURRENT_TIMESTAMP WHERE id=$2`, [req.user.id, req.params.id]);",
`    await client.query('COMMIT');`,
`    res.json({ success: true });`,
`  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ success: false, error: e.message }); }`,
`  finally { client.release(); }`,
`});`,
``,
`app.post('/api/ims/grn/:id/reject', authenticateToken, requireWorkspace, requireRole(['manager','admin','owner']), async (req, res) => {`,
`  try {`,
"    await pool.query(`UPDATE ims_grn SET status='REJECTED' WHERE id=$1 AND workspace_id=$2`, [req.params.id, req.workspace_id]);",
`    res.json({ success: true });`,
`  } catch (e) { res.status(500).json({ success: false, error: e.message }); }`,
`});`,
``,
`// ==========================================`,
`// GRN / DISPATCH — SCAN-TO-VERIFY`,
`// ==========================================`,
`app.post('/api/ims/grn/verify-scan', authenticateToken, requireWorkspace, async (req, res) => {`,
`  try {`,
`    const { barcode, mode } = req.body;`,
`    if (!barcode) return res.status(400).json({ success: false, error: 'barcode required' });`,
`    const grnType = mode === 'DISPATCH' ? 'OUTWARD' : 'INWARD';`,
`    const wsId = parseInt(req.workspace_id);`,
`    const itemResult = await pool.query(`,
`      \`SELECT i.id as item_id, i.grn_id, i.name, i.ordered_qty, i.received_qty, i.unit,`,
`              g.doc_no, g.supplier, g.type`,
`       FROM ims_grn_items i`,
`       JOIN ims_grn g ON g.id = i.grn_id`,
`       WHERE g.workspace_id = $1 AND g.type = $2 AND g.status = 'PENDING' AND i.barcode = $3`,
`       ORDER BY g.created_at ASC LIMIT 1\`,`,
`      [wsId, grnType, barcode]`,
`    );`,
`    if (itemResult.rows.length === 0) {`,
`      return res.json({ success: true, matched: false,`,
`        message: \`Barcode not on any pending \${mode === 'DISPATCH' ? 'Dispatch Note' : 'GRN'}\` });`,
`    }`,
`    const item = itemResult.rows[0];`,
`    const updated = await pool.query(`,
`      'UPDATE ims_grn_items SET received_qty = received_qty + 1 WHERE id = $1 RETURNING received_qty',`,
`      [item.item_id]`,
`    );`,
`    const newQty = updated.rows[0].received_qty;`,
`    const fullyReceived = Number(newQty) >= Number(item.ordered_qty);`,
`    io.to(\`workspace_\${wsId}\`).emit('grn_item_updated', {`,
`      grnId: item.grn_id, itemId: item.item_id, barcode,`,
`      name: item.name, receivedQty: newQty, orderedQty: item.ordered_qty,`,
`      fullyReceived, docNo: item.doc_no`,
`    });`,
`    res.json({ success: true, matched: true,`,
`      item: { name: item.name, barcode, orderedQty: item.ordered_qty, receivedQty: newQty, unit: item.unit, fullyReceived },`,
`      grn: { id: item.grn_id, docNo: item.doc_no, supplier: item.supplier }`,
`    });`,
`  } catch (e) {`,
`    console.error('verify-scan error:', e.message);`,
`    res.status(500).json({ success: false, error: e.message });`,
`  }`,
`});`,
``
];

// Replace lines from orphanStart to rejectClose (inclusive)
lines.splice(orphanStart, rejectClose - orphanStart + 1, ...correctRoutes);
fs.writeFileSync('server.js', lines.join('\n'));
console.log('Done! GRN routes fully repaired and verify-scan added.');
