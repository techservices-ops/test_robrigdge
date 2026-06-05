const { Pool } = require('pg');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: dbUrl,
  ssl: (dbUrl && dbUrl.includes('render.com')) ? true : { rejectUnauthorized: false }
});

async function run() {
  try {
    const activeMasterId = 9;
    const workspaceId = 87;

    const result = await pool.query(
      `SELECT * FROM ims_items WHERE master_id = $1 AND workspace_id = $2 ORDER BY created_at ASC`,
      [activeMasterId, workspaceId]
    );

    console.log('Database rows count:', result.rows.length);

    // Map snake_case to camelCase for frontend
    const items = result.rows.map(r => ({
      id: r.id, masterId: r.master_id, barcode: r.barcode, name: r.name,
      category: r.category, baseUnit: r.base_unit, stock: Number(r.stock),
      trackingMode: r.tracking_mode, parentBarcode: r.parent_barcode || '',
      multiplier: r.multiplier ? Number(r.multiplier) : null,
      supplier: r.supplier || '', locations: r.locations || [],
      bom: r.bom || [], weight: r.weight, cost: r.cost,
      alertAt: r.alert_at, customFields: r.custom_fields || {}
    }));

    console.log('First mapped item:');
    console.log(items[0]);

    // Let's filter like the frontend does:
    const activeMaster = { id: 9 };
    const search = '';
    const categoryFilter = 'All';

    const activeProducts = items.filter(p => !activeMaster || p.masterId === activeMaster.id);
    console.log('activeProducts count:', activeProducts.length);

    const filtered = activeProducts.filter(p => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.barcode.toLowerCase().includes(search.toLowerCase());
      const matchCat = categoryFilter === 'All' || p.category === categoryFilter;
      return matchSearch && matchCat;
    });

    console.log('filtered count:', filtered.length);

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
